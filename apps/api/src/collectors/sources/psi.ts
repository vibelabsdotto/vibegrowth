/**
 * Collector `psi`: port of growth.py `psi_run` (PageSpeed Insights v5, lab data + CrUX field
 * categories). KPI with dims {"strategy","url"}: performance, seo, accessibility, best_practices,
 * lcp_ms, cls, tbt_ms (date = today). API key: env GOOGLE_PSI_API_KEY or `google-growth-api-key`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  dimsKey,
  errorMessage,
  finish,
  redact,
  resolveToday,
  rstripSlash,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type KpiRow,
  type SourceCollector,
} from './types.js';
import { httpFetch } from './http.js';

export const PSI_KEY_FILE = 'google-growth-api-key';

export interface PsiConfig {
  /** Pages to measure. Default: [<url>/] */
  urls?: string[];
  /** Fallback when `urls` is empty: site URL (homepage). */
  url?: string;
  strategies?: Array<'mobile' | 'desktop'>;
}

export const id = 'psi';
export const label = 'PageSpeed Insights / CrUX';
export const channelKinds: ChannelKind[] = ['website'];
export const configSchema: ConfigSchema = {
  urls: { description: 'Zu messende Seiten (absolute URLs). Ohne Angabe: Startseite aus url', required: false, type: 'string[]' },
  url: { description: 'Website-URL, Startseite als Standard-Messseite', required: false, type: 'string' },
  strategies: { description: 'mobile und/oder desktop', required: false, type: 'string[]', default: ['mobile', 'desktop'] },
};

async function psiKey(secretsDir: string): Promise<string | null> {
  if (process.env.GOOGLE_PSI_API_KEY) return process.env.GOOGLE_PSI_API_KEY;
  try {
    return (await fs.readFile(path.join(secretsDir, PSI_KEY_FILE), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

interface LhAudit {
  score?: number | null;
  numericValue?: number;
}
interface PsiResponse {
  lighthouseResult: {
    categories: Record<string, { score?: number | null; auditRefs?: Array<{ id: string }> }>;
    audits: Record<string, LhAudit>;
  };
  loadingExperience?: { metrics?: Record<string, { category?: string }> };
}

export interface PsiMeasurement {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  best_practices: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  field: Record<string, string | undefined>;
  failed_seo: string[];
}

export async function psiRun(url: string, strategy: string, ctx: CollectorContext): Promise<PsiMeasurement> {
  const q = new URLSearchParams([['url', url], ['strategy', strategy]]);
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
  const key = await psiKey(ctx.secretsDir);
  if (key) q.set('key', key);
  const r = await httpFetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`, { timeoutS: 120 }, ctx.fetch ?? fetch);
  if (r.status !== 200) throw new Error(redact(`PSI HTTP ${r.status}: ${r.text().slice(0, 200)}`, [key]));
  const d = r.json<PsiResponse>();
  const lh = d.lighthouseResult;
  const cat: Record<string, number> = {};
  for (const [k, v] of Object.entries(lh.categories)) cat[k] = Math.round((v.score ?? 0) * 100);
  const au = lh.audits;
  const field: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(d.loadingExperience?.metrics ?? {})) field[k] = v.category;
  return {
    performance: cat['performance'] ?? null,
    seo: cat['seo'] ?? null,
    accessibility: cat['accessibility'] ?? null,
    best_practices: cat['best-practices'] ?? null,
    lcp_ms: au['largest-contentful-paint']?.numericValue ?? null,
    cls: au['cumulative-layout-shift']?.numericValue ?? null,
    tbt_ms: au['total-blocking-time']?.numericValue ?? null,
    field,
    failed_seo: (lh.categories['seo']?.auditRefs ?? []).filter((a) => au[a.id]?.score === 0).map((a) => a.id),
  };
}

const METRICS = ['performance', 'seo', 'accessibility', 'best_practices', 'lcp_ms', 'cls', 'tbt_ms'] as const;

export async function collectPsi(config: PsiConfig, ctx: CollectorContext): Promise<CollectorResult> {
  const today = resolveToday(ctx);
  const urls = config.urls?.length ? config.urls : config.url ? [`${rstripSlash(config.url)}/`] : [];
  const strategies = config.strategies?.length ? config.strategies : (['mobile', 'desktop'] as const);
  const kpi: KpiRow[] = [];
  const errors: string[] = [];
  const results: Record<string, Omit<PsiMeasurement, 'lcp_ms' | 'tbt_ms' | 'cls'> & { lcp_s: number; cls: number }> = {};
  if (!urls.length) {
    const msg = 'psi: Konfiguration "urls" oder "url" fehlt';
    return finish({ kpi, summary: msg, stats: {}, errors: [msg] });
  }
  for (const url of urls) {
    for (const strategy of strategies) {
      try {
        const p = await psiRun(url, strategy, ctx);
        const dims = dimsKey({ strategy, url });
        for (const m of METRICS) {
          const v = p[m];
          if (typeof v === 'number' && Number.isFinite(v)) kpi.push({ source: 'psi', date: today, metric: m, dims, value: v });
        }
        results[`${strategy} ${url}`] = {
          performance: p.performance,
          seo: p.seo,
          accessibility: p.accessibility,
          best_practices: p.best_practices,
          lcp_s: Math.round((p.lcp_ms ?? 0) / 10) / 100,
          cls: Math.round((p.cls ?? 0) * 1000) / 1000,
          field: p.field,
          failed_seo: p.failed_seo,
        };
      } catch (e) {
        errors.push(`psi ${strategy} ${url}: ${errorMessage(e)}`);
      }
    }
  }
  const parts = Object.entries(results).map(([k, v]) => `${k}: Perf ${v.performance ?? '–'}, SEO ${v.seo ?? '–'}, LCP ${v.lcp_s}s`);
  const summary = `PSI: ${parts.join('; ') || 'keine Messung'}${errors.length ? `; ${errors.length} Fehler` : ''}`;
  return finish({ kpi, summary, stats: { results }, errors });
}

export const psiCollector: SourceCollector<PsiConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectPsi,
};

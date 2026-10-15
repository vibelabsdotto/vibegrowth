/**
 * Collector `gsc`: port of the Search Console part of growth.py `cmd_collect`.
 * KPI (dims ''): clicks, impressions, ctr, position per day; Query×Seite rows for `search_daily`;
 * sitemap status in stats. Window: end = yesterday, start = end - (days - 1), dataState "all".
 */
import {
  dateWindow,
  dimsKey,
  errorMessage,
  finish,
  requireString,
  resolveToday,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type KpiRow,
  type SearchRow,
  type SourceCollector,
} from './types.js';
import { googleApi } from './google-auth.js';

export interface GscConfig {
  /** e.g. "sc-domain:chrono-app.net" */
  property: string;
}

export const id = 'gsc';
export const label = 'Google Search Console';
export const channelKinds: ChannelKind[] = ['website'];
export const configSchema: ConfigSchema = {
  property: {
    description: 'Search-Console-Property, z. B. sc-domain:chrono-app.net oder https://example.com/',
    required: true,
    type: 'string',
    example: 'sc-domain:chrono-app.net',
  },
};

const ROW_LIMIT = 25000;

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscSitemap {
  path?: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  errors?: string;
  warnings?: string;
  isPending?: boolean;
  contents?: unknown;
}

export async function collectGsc(config: GscConfig, ctx: CollectorContext): Promise<CollectorResult> {
  const { start, end } = dateWindow(ctx.days, resolveToday(ctx));
  const kpi: KpiRow[] = [];
  const search: SearchRow[] = [];
  const errors: string[] = [];
  const stats: Record<string, unknown> = { range: [start, end] };
  let days = 0;
  let clicks = 0;
  let impressions = 0;
  let property: string;
  try {
    property = requireString(config as unknown as Record<string, unknown>, 'property', 'gsc');
  } catch (e) {
    return finish({ kpi, summary: errorMessage(e), stats, errors: [errorMessage(e)] });
  }
  const site = encodeURIComponent(property);
  const queryUrl = `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`;

  try {
    const tot = await googleApi<{ rows?: GscRow[] }>(
      'POST',
      queryUrl,
      { startDate: start, endDate: end, dimensions: ['date'], dataState: 'all' },
      ctx,
    );
    const rows = tot.rows ?? [];
    for (const r of rows) {
      const date = r.keys[0];
      kpi.push(
        { source: 'gsc', date, metric: 'clicks', dims: dimsKey(), value: r.clicks },
        { source: 'gsc', date, metric: 'impressions', dims: dimsKey(), value: r.impressions },
        { source: 'gsc', date, metric: 'ctr', dims: dimsKey(), value: r.ctr },
        { source: 'gsc', date, metric: 'position', dims: dimsKey(), value: r.position },
      );
    }
    days = rows.length;
    clicks = rows.reduce((a, r) => a + r.clicks, 0);
    impressions = rows.reduce((a, r) => a + r.impressions, 0);
    Object.assign(stats, { days, clicks, impressions });

    let startRow = 0;
    for (;;) {
      const page = await googleApi<{ rows?: GscRow[] }>(
        'POST',
        queryUrl,
        { startDate: start, endDate: end, dimensions: ['date', 'query', 'page'], rowLimit: ROW_LIMIT, startRow, dataState: 'all' },
        ctx,
      );
      const pr = page.rows ?? [];
      for (const r of pr) {
        const [date, query, pg] = r.keys;
        search.push({ source: 'gsc', date, query, page: pg ?? '', clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
      }
      startRow += pr.length;
      if (pr.length < ROW_LIMIT) break;
    }
    stats.query_rows = search.length;
  } catch (e) {
    errors.push(`gsc: ${errorMessage(e)}`);
  }

  if (!errors.length) {
    try {
      const sm = await googleApi<{ sitemap?: GscSitemap[] }>('GET', `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps`, undefined, ctx);
      stats.sitemaps = (sm.sitemap ?? []).map((x) => ({
        path: x.path,
        submitted: x.lastSubmitted,
        downloaded: x.lastDownloaded,
        errors: x.errors,
        warnings: x.warnings,
        pending: x.isPending,
        contents: x.contents,
      }));
    } catch (e) {
      errors.push(`gsc sitemaps: ${errorMessage(e)}`);
    }
  }

  const summary = errors.length
    ? `GSC ${start}–${end}: Fehler (${errors.join('; ').slice(0, 200)})`
    : `GSC ${start}–${end}: ${days} Tage, ${clicks} Klicks, ${impressions} Impressionen, ${search.length} Query×Seite-Zeilen`;
  return finish({ kpi, search, window: { from: start, to: end }, summary, stats, errors });
}

export const gscCollector: SourceCollector<GscConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectGsc,
};

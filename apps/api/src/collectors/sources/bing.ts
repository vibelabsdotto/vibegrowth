/**
 * Collector `bing`: port of the Bing Webmaster part of growth.py `cmd_collect`.
 * KPI (dims ''): clicks, impressions per day (GetRankAndTrafficStats, full history Bing returns);
 * queries (GetQueryStats) as `search_daily` rows with page ''; crawl stats in stats.
 * API key: `bing-webmaster-api-key` in secretsDir (sent as query parameter, never logged).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CollectorError,
  dateWindow,
  dimsKey,
  errorMessage,
  finish,
  redact,
  requireString,
  resolveToday,
  rstripSlash,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type FetchFn,
  type KpiRow,
  type SearchRow,
  type SourceCollector,
} from './types.js';
import { httpFetch } from './http.js';

export const BING_KEY_FILE = 'bing-webmaster-api-key';

export interface BingConfig {
  /** Site URL as verified in Bing Webmaster (trailing slash added). */
  url: string;
}

export const id = 'bing';
export const label = 'Bing Webmaster';
export const channelKinds: ChannelKind[] = ['website'];
export const configSchema: ConfigSchema = {
  url: { description: 'Website-URL wie in Bing Webmaster verifiziert, z. B. https://chrono-app.net/', required: true, type: 'string' },
};

export async function bingApiKey(secretsDir: string): Promise<string> {
  try {
    const k = (await fs.readFile(path.join(secretsDir, BING_KEY_FILE), 'utf8')).trim();
    if (k) return k;
  } catch {
    /* handled below */
  }
  throw new CollectorError('CONFIG', `Zugang fehlt: ${BING_KEY_FILE} nicht in secretsDir gefunden`);
}

/** growth.py `bing()`: GET (or POST with body) against the Bing Webmaster JSON API, returns `d`. */
export async function bingApi<T = unknown>(
  method: string,
  ctx: { secretsDir: string; fetch?: FetchFn },
  opts: { siteUrl?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<T> {
  const key = await bingApiKey(ctx.secretsDir);
  const q = new URLSearchParams({ apikey: key, ...(opts.params ?? {}) });
  if (opts.siteUrl && opts.body === undefined) q.set('siteUrl', opts.siteUrl);
  const url = `https://ssl.bing.com/webmaster/api.svc/json/${method}?${q.toString()}`;
  const r = await httpFetch(
    url,
    {
      method: opts.body !== undefined ? 'POST' : 'GET',
      timeoutS: 60,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
    ctx.fetch ?? fetch,
  );
  if (r.status !== 200) {
    throw new CollectorError('EXTERNAL', redact(`bing ${method} HTTP ${r.status}: ${r.text().slice(0, 160)}`, [key]));
  }
  return r.json<{ d: T }>().d;
}

/** "/Date(1760486400000-0700)/" → UTC date (growth.py `_bing_date`). */
export function bingDate(v: unknown): string | null {
  const m = /\/Date\((\d+)/.exec(typeof v === 'string' ? v : '');
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

interface BingTraffic {
  Date?: string;
  Clicks?: number;
  Impressions?: number;
}
interface BingQuery extends BingTraffic {
  Query?: string;
  AvgImpressionPosition?: number;
  AvgClickPosition?: number;
}
interface BingCrawl {
  Date?: string;
  InIndex?: number;
  CrawledPages?: number;
  CrawlErrors?: number;
}

export async function collectBing(config: BingConfig, ctx: CollectorContext): Promise<CollectorResult> {
  const today = resolveToday(ctx);
  const { start, end } = dateWindow(ctx.days, today);
  const kpi: KpiRow[] = [];
  const search: SearchRow[] = [];
  const errors: string[] = [];
  const stats: Record<string, unknown> = {};
  const n = { days: 0, clicks: 0, impressions: 0, queries: 0, indexed: null as number | null };
  let siteUrl: string;
  try {
    siteUrl = `${rstripSlash(requireString(config as unknown as Record<string, unknown>, 'url', 'bing'))}/`;
  } catch (e) {
    return finish({ kpi, summary: errorMessage(e), stats, errors: [errorMessage(e)] });
  }
  try {
    const traffic = (await bingApi<BingTraffic[] | null>('GetRankAndTrafficStats', ctx, { siteUrl })) ?? [];
    for (const r of traffic) {
      const date = bingDate(r.Date);
      if (!date) continue;
      kpi.push(
        { source: 'bing', date, metric: 'clicks', dims: dimsKey(), value: r.Clicks ?? 0 },
        { source: 'bing', date, metric: 'impressions', dims: dimsKey(), value: r.Impressions ?? 0 },
      );
    }
    const inWindow = traffic.filter((r) => {
      const d = bingDate(r.Date);
      return d !== null && d >= start && d <= end;
    });
    n.days = traffic.length;
    n.clicks = traffic.reduce((a, r) => a + (r.Clicks ?? 0), 0);
    n.impressions = traffic.reduce((a, r) => a + (r.Impressions ?? 0), 0);
    Object.assign(stats, { days: n.days, clicks: n.clicks, impressions: n.impressions });
    stats.window = {
      from: start,
      to: end,
      days: inWindow.length,
      clicks: inWindow.reduce((a, r) => a + (r.Clicks ?? 0), 0),
      impressions: inWindow.reduce((a, r) => a + (r.Impressions ?? 0), 0),
    };

    const queries = (await bingApi<BingQuery[] | null>('GetQueryStats', ctx, { siteUrl })) ?? [];
    for (const r of queries) {
      const clicks = r.Clicks ?? 0;
      const impressions = r.Impressions ?? 0;
      search.push({
        source: 'bing',
        date: bingDate(r.Date) ?? today,
        query: r.Query ?? '',
        page: '',
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0,
        position: r.AvgImpressionPosition ?? 0,
      });
    }
    n.queries = stats.queries = queries.length;

    const crawl = (await bingApi<BingCrawl[] | null>('GetCrawlStats', ctx, { siteUrl })) ?? [];
    const last = crawl.length ? crawl[crawl.length - 1] : {};
    n.indexed = stats.indexed = last.InIndex ?? null;
    stats.crawled = last.CrawledPages ?? null;
    stats.crawl_errors = last.CrawlErrors ?? null;
  } catch (e) {
    errors.push(`bing: ${errorMessage(e)}`);
  }
  const summary = errors.length
    ? `Bing: Fehler (${errors.join('; ').slice(0, 200)})`
    : `Bing: ${n.days} Tage (${n.clicks} Klicks, ${n.impressions} Impressionen), ${n.queries} Query-Zeilen, im Index ${n.indexed ?? '–'}`;
  return finish({ kpi, search, summary, stats, errors });
}

export const bingCollector: SourceCollector<BingConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectBing,
};

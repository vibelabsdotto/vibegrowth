/**
 * Shared types and helpers for the collector sources (TS port of website-growth/scripts/growth.py).
 * Pure modules: no Nest, no DB. Each collector returns normalised rows (CONTRACT §7.1); the
 * CollectorsModule provider writes them through the growth services.
 */

export type FetchFn = typeof fetch;

/** One row for `kpi_daily`. `dims` is '' for the daily total, otherwise stable JSON with sorted keys. */
export interface KpiRow {
  source: string;
  date: string;
  metric: string;
  dims: string;
  value: number;
}

/** One row for `search_daily`. `page` is '' when the source has no page dimension (Bing). */
export interface SearchRow {
  source: 'gsc' | 'bing';
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type AuditSeverity = 'error' | 'warning' | 'info';

export interface AuditIssue {
  url: string;
  code: string;
  severity: AuditSeverity;
  detail: string;
}

export interface AuditPage {
  url: string;
  data: Record<string, unknown>;
}

export interface AuditResult {
  pages: number;
  /** No finding with severity `error` (growth.py run ok; `audit_runs.ok`). */
  ok: boolean;
  issues: AuditIssue[];
  pageData: AuditPage[];
}

export interface CollectorContext {
  /** Look-back window in days (growth.py `--days`). */
  days: number;
  /** Folder with the access files (CONTRACT §3 `secretsDir`). Read only, except the OAuth token file. */
  secretsDir: string;
  /** Injectable fetch (default: global fetch). */
  fetch?: FetchFn;
  /** Override "today" (YYYY-MM-DD, local). Default: local date of the process. */
  today?: string;
}

export interface CollectorResult {
  ok: boolean;
  kpi: KpiRow[];
  search?: SearchRow[];
  audit?: AuditResult;
  /**
   * Date window the source was asked for (inclusive). Rows of this source inside the window are
   * complete, so the writer may replace them (growth.py deletes GA4 event params from `start` on).
   */
  window?: { from: string; to: string };
  summary: string;
  stats: Record<string, unknown>;
  /** Readable error messages without secret contents. Non-empty ⇒ ok = false. */
  errors: string[];
}

export interface ConfigField {
  description: string;
  required: boolean;
  type: 'string' | 'number' | 'string[]' | 'object' | 'array';
  default?: unknown;
  example?: unknown;
}

export type ConfigSchema = Record<string, ConfigField>;

export type ChannelKind = 'website' | 'ios' | 'android' | 'youtube' | 'instagram' | 'other';

export interface SourceCollector<C = Record<string, unknown>> {
  id: string;
  label: string;
  channelKinds: ChannelKind[];
  configSchema: ConfigSchema;
  collect(config: C, ctx: CollectorContext): Promise<CollectorResult>;
}

/** Error with a contract code (§4). Messages never contain secret contents. */
export class CollectorError extends Error {
  constructor(
    public readonly code: 'CONFIG' | 'EXTERNAL' | 'INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'CollectorError';
  }
}

/** Stable dims key: '' for no dims, otherwise JSON with sorted keys (CONTRACT §6 kpi_daily.dims). */
export function dimsKey(dims?: Record<string, string | number | boolean | null> | null): string {
  if (!dims) return '';
  const keys = Object.keys(dims).sort();
  if (keys.length === 0) return '';
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = dims[k];
  return JSON.stringify(sorted);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date of the process as YYYY-MM-DD (growth.py `dt.date.today()`). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** growth.py collect window: end = yesterday, start = end - (days - 1). */
export function dateWindow(days: number, today: string): { start: string; end: string; today: string } {
  const n = Math.max(1, Math.floor(days || 1));
  const end = addDays(today, -1);
  return { start: addDays(end, -(n - 1)), end, today };
}

export function resolveToday(ctx: CollectorContext): string {
  if (ctx.today && /^\d{4}-\d{2}-\d{2}$/.test(ctx.today)) return ctx.today;
  return localToday();
}

/** Strip a trailing slash run like Python's `rstrip("/")`. */
export function rstripSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Replace any occurrence of the given secret values with '***'. */
export function redact(message: string, secrets: Array<string | null | undefined>): string {
  let out = message;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('***');
  }
  return out;
}

export function requireString(config: Record<string, unknown>, key: string, label: string): string {
  const v = config[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new CollectorError('CONFIG', `${label}: Konfiguration "${key}" fehlt`);
  }
  return v.trim();
}

export function finish(
  base: Omit<CollectorResult, 'ok' | 'errors'> & { errors?: string[] },
): CollectorResult {
  const errors = base.errors ?? [];
  return { ...base, ok: errors.length === 0, errors };
}

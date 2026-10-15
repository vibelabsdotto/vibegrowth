/**
 * Read-only access to the website-growth system: growth.db (opened read-only, one read
 * transaction for a consistent snapshot), sites.json and the README. Nothing here writes.
 */
import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { VGError } from "../../core/util"

export type Row = Record<string, unknown>
export type SiteConfig = Record<string, unknown>

/** Tables of growth.py, store_attribution.py and app_funnel.py with the columns the import maps. */
export const KNOWN_TABLES: Record<string, string[]> = {
  runs: ["id", "site", "kind", "ts", "ok", "summary"],
  gsc_daily: [
    "site",
    "date",
    "query",
    "page",
    "clicks",
    "impressions",
    "ctr",
    "position",
  ],
  gsc_totals: ["site", "date", "clicks", "impressions", "ctr", "position"],
  ga_daily: [
    "site",
    "date",
    "channel",
    "landing",
    "sessions",
    "users",
    "engaged",
    "key_events",
  ],
  ga_events: ["site", "date", "event", "count"],
  ga_event_params: ["site", "date", "event", "param", "value", "count"],
  psi: [
    "site",
    "date",
    "url",
    "strategy",
    "performance",
    "seo",
    "accessibility",
    "best_practices",
    "lcp_ms",
    "cls",
    "tbt_ms",
    "field",
  ],
  audit_issues: ["run_id", "site", "url", "code", "severity", "detail"],
  audit_pages: ["run_id", "site", "url", "data"],
  ai_checks: [
    "site",
    "date",
    "engine",
    "prompt",
    "mentioned",
    "cited",
    "competitors",
    "citations",
    "excerpt",
    "ts",
    "status",
    "error",
    "model",
    "answer",
    "brands",
    "position",
    "links",
    "cited_urls",
    "sources",
    "meta",
    "evidence",
  ],
  actions: ["id", "site", "ts", "kind", "summary", "ref", "exp_id"],
  experiments: [
    "id",
    "site",
    "created",
    "title",
    "hypothesis",
    "pages",
    "metric",
    "start_date",
    "eval_days",
    "status",
    "result",
    "verdict",
  ],
  bing_daily: ["site", "date", "clicks", "impressions"],
  bing_queries: ["site", "date", "query", "clicks", "impressions", "position"],
  store_daily: [
    "site",
    "store",
    "app",
    "report",
    "date",
    "dims",
    "metric",
    "value",
  ],
  app_events: ["site", "date", "platform", "event", "count", "users"],
  app_daily: ["site", "date", "platform", "active_users", "new_users"],
  app_retention: [
    "site",
    "cohort",
    "cohort_start",
    "cohort_end",
    "users",
    "d1",
    "d7",
    "d28",
    "updated",
  ],
}

export interface TableInfo {
  name: string
  columns: string[]
  rows: number
}

/** growth.db, read-only with query_only and one read transaction for the whole import. */
export class GrowthDb {
  private readonly db: Database.Database
  readonly tables: TableInfo[]

  constructor(readonly file: string) {
    try {
      this.db = new Database(file, { readonly: true, fileMustExist: true })
    } catch (e) {
      throw new VGError(
        "INVALID",
        `growth.db nicht lesbar: ${file} (${e instanceof Error ? e.message : String(e)})`
      )
    }
    this.db.pragma("query_only = ON")
    this.db.pragma("busy_timeout = 15000")
    this.db.prepare("BEGIN").run()
    const names = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[]
    if (!names.length)
      throw new VGError("INVALID", `growth.db enthält keine Tabellen: ${file}`)
    this.tables = names.map(({ name }) => ({
      name,
      columns: (
        this.db.prepare(`PRAGMA table_info("${name}")`).all() as {
          name: string
        }[]
      ).map((c) => c.name),
      rows: (
        this.db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as {
          n: number
        }
      ).n,
    }))
  }

  has(table: string) {
    return this.tables.some((t) => t.name === table)
  }

  /** All rows of a known table (empty when the table does not exist), in a stable order. */
  rows(table: string, orderBy = "rowid"): Row[] {
    if (!this.has(table)) return []
    return this.db
      .prepare(`SELECT * FROM "${table}" ORDER BY ${orderBy}`)
      .all() as Row[]
  }

  close() {
    if (!this.db.open) return
    try {
      this.db.prepare("ROLLBACK").run()
    } finally {
      this.db.close()
    }
  }
}

export function readSites(file: string): Record<string, SiteConfig> {
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    throw new VGError("NOT_FOUND", `sites.json nicht gefunden: ${file}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new VGError("INVALID", `sites.json ist kein gültiges JSON: ${file}`)
  }
  if (!isObject(parsed))
    throw new VGError(
      "INVALID",
      "sites.json muss ein Objekt {site: {...}} sein"
    )
  const out: Record<string, SiteConfig> = {}
  for (const [id, cfg] of Object.entries(parsed)) {
    if (!isObject(cfg))
      throw new VGError("INVALID", `sites.json: Eintrag ${id} ist kein Objekt`)
    out[id] = cfg
  }
  return out
}

/** README.md next to sites.json (website-growth root), null when missing. */
export function readReadme(
  sitesFile: string
): { file: string; text: string } | null {
  const file = path.join(path.dirname(sitesFile), "README.md")
  try {
    return { file, text: fs.readFileSync(file, "utf8") }
  } catch {
    return null
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** JSON text → value, fallback on null/invalid. */
export function parseJsonText(v: unknown, fallback: unknown = null): unknown {
  if (typeof v !== "string" || !v.trim()) return fallback
  try {
    return JSON.parse(v) as unknown
  } catch {
    return fallback
  }
}

export const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null

export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() && Number.isFinite(Number(v))
      ? Number(v)
      : null

export const strList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim())
    : []

/** Text of a scalar cell ('' for null/objects). */
export const text = (v: unknown): string =>
  typeof v === "string"
    ? v
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : ""

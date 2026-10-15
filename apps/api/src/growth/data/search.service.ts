import { Injectable } from "@nestjs/common"
import type { SearchRow } from "../../collectors/sources"
import { nowIso, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { requireProject } from "./rows"
import { windowEnding, yesterday } from "./validate"

export const SEARCH_SOURCES = ["gsc", "bing"] as const

export interface SearchQuery {
  project: string
  source?: string
  days: number
  end?: string
  /** Path suffix (/blog/x) or absolute URL. */
  page?: string
  opportunities?: boolean
  limit: number
}

const UPSERT = `INSERT INTO search_daily (project_id, source, date, query, page, clicks, impressions, ctr, position, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (project_id, source, date, query, page) DO UPDATE SET
  clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr,
  position = excluded.position, updated_at = excluded.updated_at
WHERE search_daily.clicks IS NOT excluded.clicks OR search_daily.impressions IS NOT excluded.impressions
   OR search_daily.ctr IS NOT excluded.ctr OR search_daily.position IS NOT excluded.position`

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

/** Page filter: absolute URL exact (ignoring a trailing slash), otherwise path suffix; "/" = start page. */
export function pageCondition(page: string): { sql: string; params: string[] } {
  const value = page.trim().replace(/\/+$/, "")
  if (!value)
    return {
      sql: "instr(substr(rtrim(page, '/'), instr(page, '://') + 3), '/') = 0",
      params: [],
    }
  if (/^https?:\/\//.test(value))
    return { sql: "rtrim(page, '/') = ?", params: [value] }
  const suffix = value.startsWith("/") ? value : `/${value}`
  return {
    sql: "substr(rtrim(page, '/'), -length(?)) = ?",
    params: [suffix, suffix],
  }
}

/** search_daily: query × page per day from GSC and Bing. */
@Injectable()
export class SearchService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Inside the caller's tx. With replace: rows of the source in [from, to] are deleted first (complete window). */
  writeRows(
    projectId: string,
    rows: SearchRow[],
    replace?: { source: string; from: string; to: string }
  ): { rows: number; changed: number; removed: number } {
    let removed = 0
    if (replace) {
      removed = this.ctx.sqlite
        .prepare(
          "DELETE FROM search_daily WHERE project_id = ? AND source = ? AND date >= ? AND date <= ?"
        )
        .run(projectId, replace.source, replace.from, replace.to).changes
    }
    const stmt = this.ctx.sqlite.prepare(UPSERT)
    const at = nowIso()
    let changed = 0
    for (const r of rows) {
      changed += stmt.run(
        projectId,
        r.source,
        r.date,
        r.query,
        r.page ?? "",
        r.clicks,
        r.impressions,
        r.ctr,
        r.position,
        at
      ).changes
    }
    return { rows: rows.length, changed, removed }
  }

  /** GET /search: aggregated per source/query/page; opportunities = position 4–20 with impressions. */
  query(q: SearchQuery) {
    requireProject(this.ctx, q.project)
    if (
      q.source !== undefined &&
      !SEARCH_SOURCES.includes(q.source as (typeof SEARCH_SOURCES)[number])
    )
      throw new VGError(
        "INVALID",
        `source muss einer von ${SEARCH_SOURCES.join("|")} sein, war: ${q.source}`
      )
    const window = windowEnding(q.end ?? yesterday(), q.days)
    const where = ["project_id = ?", "date >= ?", "date <= ?"]
    const params: unknown[] = [q.project, window.from, window.to]
    if (q.source) {
      where.push("source = ?")
      params.push(q.source)
    }
    if (q.page !== undefined) {
      const c = pageCondition(q.page)
      where.push(c.sql)
      params.push(...c.params)
    }
    const grouped = `SELECT source, query, page,
        SUM(clicks) AS clicks, SUM(impressions) AS impressions,
        COALESCE(SUM(position * impressions) / NULLIF(SUM(impressions), 0), AVG(position)) AS position
      FROM search_daily WHERE ${where.join(" AND ")}
      GROUP BY source, query, page`
    const having = q.opportunities
      ? "WHERE position >= 4 AND position <= 20 AND impressions > 0"
      : ""
    const order = q.opportunities
      ? "impressions DESC, position ASC"
      : "clicks DESC, impressions DESC"
    const rows = this.ctx.sqlite
      .prepare(
        `SELECT * FROM (${grouped}) ${having} ORDER BY ${order}, query, page LIMIT ?`
      )
      .all(...params, q.limit) as {
      source: string
      query: string
      page: string
      clicks: number
      impressions: number
      position: number
    }[]
    const totals = this.ctx.sqlite
      .prepare(
        `SELECT COUNT(*) AS groups, COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions
         FROM (${grouped}) ${having}`
      )
      .get(...params) as { groups: number; clicks: number; impressions: number }
    return {
      project: q.project,
      source: q.source ?? null,
      window,
      opportunities: q.opportunities ?? false,
      total: totals.groups,
      totals: { clicks: totals.clicks, impressions: totals.impressions },
      rows: rows.map((r) => ({
        source: r.source,
        query: r.query,
        page: r.page,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.impressions ? round(r.clicks / r.impressions, 4) : 0,
        position: round(r.position, 2),
      })),
    }
  }
}

import { Injectable } from "@nestjs/common"
import { dimsKey, type KpiRow } from "../../collectors/sources"
import { accounts, channels } from "../../core/schema"
import { isDate, nowIso, recordHistory, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { findProject, requireProject } from "./rows"
import { body, isPlainObject, onlyKeys } from "./validate"

export interface KpiFilter {
  project: string
  source?: string
  metric?: string
  from?: string
  to?: string
  /** undefined = all, '' = daily totals only, otherwise a dims key (normalised). */
  dims?: string
  channel?: string
}

export interface KpiView {
  project: string
  source: string
  date: string
  metric: string
  dims: string
  value: number
  channel: string | null
  updatedAt: string
}

interface KpiDbRow {
  project_id: string
  source: string
  date: string
  metric: string
  dims: string
  value: number
  channel_id: string | null
  updated_at: string
}

export type KpiWriteRow = KpiRow & { channelId?: string | null }

/** Breakdown rows (dims != '') of this source inside [from, to] are replaced by the written rows. */
export interface ReplaceWindow {
  source: string
  from: string
  to: string
  /** Limit the replacement to these metrics (partial runs). Default: every metric of the source. */
  metrics?: string[]
}

const UPSERT = `INSERT INTO kpi_daily (project_id, source, date, metric, dims, value, channel_id, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (project_id, source, date, metric, dims) DO UPDATE SET
  value = excluded.value,
  channel_id = COALESCE(excluded.channel_id, kpi_daily.channel_id),
  updated_at = excluded.updated_at
WHERE kpi_daily.value IS NOT excluded.value
   OR kpi_daily.channel_id IS NOT COALESCE(excluded.channel_id, kpi_daily.channel_id)`

/** Normalises dims input (object, JSON text, '' or null) to the stable key. */
export function normaliseDims(raw: unknown, field = "dims"): string {
  if (raw === undefined || raw === null || raw === "") return ""
  let obj: unknown = raw
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw)
    } catch {
      throw new VGError("INVALID", `${field} muss ein JSON-Objekt sein`)
    }
  }
  if (!isPlainObject(obj))
    throw new VGError("INVALID", `${field} muss ein JSON-Objekt sein`)
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && !["string", "number", "boolean"].includes(typeof v))
      throw new VGError(
        "INVALID",
        `${field}.${k} muss Text, Zahl, true/false oder null sein`
      )
  }
  return dimsKey(obj as Record<string, string | number | boolean | null>)
}

/** kpi_daily: daily values per project/source/metric/dims (CONTRACT §7.1). */
@Injectable()
export class KpiService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  list(filter: KpiFilter): KpiView[] {
    requireProject(this.ctx, filter.project)
    const where = ["project_id = ?"]
    const params: unknown[] = [filter.project]
    const add = (sql: string, v: unknown) => {
      where.push(sql)
      params.push(v)
    }
    if (filter.source) add("source = ?", filter.source)
    if (filter.metric) add("metric = ?", filter.metric)
    if (filter.from) add("date >= ?", filter.from)
    if (filter.to) add("date <= ?", filter.to)
    if (filter.dims !== undefined) add("dims = ?", filter.dims)
    if (filter.channel) add("channel_id = ?", filter.channel)
    const rows = this.ctx.sqlite
      .prepare(
        `SELECT * FROM kpi_daily WHERE ${where.join(" AND ")} ORDER BY date, source, metric, dims`
      )
      .all(...params) as KpiDbRow[]
    return rows.map((r) => ({
      project: r.project_id,
      source: r.source,
      date: r.date,
      metric: r.metric,
      dims: r.dims,
      value: r.value,
      channel: r.channel_id,
      updatedAt: r.updated_at,
    }))
  }

  /** Daily totals (dims '') of one source/metric in [from, to], ascending by date. */
  series(
    projectId: string,
    source: string,
    metric: string,
    from: string,
    to: string,
    dims = ""
  ): { date: string; value: number }[] {
    return this.ctx.sqlite
      .prepare(
        `SELECT date, value FROM kpi_daily
         WHERE project_id = ? AND source = ? AND metric = ? AND dims = ? AND date >= ? AND date <= ?
         ORDER BY date`
      )
      .all(projectId, source, metric, dims, from, to) as {
      date: string
      value: number
    }[]
  }

  /**
   * Writes rows for one project. Must run inside the caller's tx (no history: the caller writes
   * one entry per run or ingest). Returns the number of rows inserted or changed.
   */
  writeRows(
    projectId: string,
    rows: KpiWriteRow[],
    replace?: ReplaceWindow
  ): { rows: number; changed: number; removed: number } {
    let removed = 0
    if (replace) {
      const metricFilter = replace.metrics
        ? ` AND metric IN (${replace.metrics.map(() => "?").join(",") || "NULL"})`
        : ""
      removed = this.ctx.sqlite
        .prepare(
          `DELETE FROM kpi_daily WHERE project_id = ? AND source = ? AND dims != '' AND date >= ? AND date <= ?${metricFilter}`
        )
        .run(
          projectId,
          replace.source,
          replace.from,
          replace.to,
          ...(replace.metrics ?? [])
        ).changes
    }
    const stmt = this.ctx.sqlite.prepare(UPSERT)
    const at = nowIso()
    let changed = 0
    for (const r of rows) {
      changed += stmt.run(
        projectId,
        r.source,
        r.date,
        r.metric,
        r.dims,
        r.value,
        r.channelId ?? null,
        at
      ).changes
    }
    return { rows: rows.length, changed, removed }
  }

  /** POST /kpi/ingest {rows:[{project,source,date,metric,dims?,value,channel?}]}: upsert, one history entry. */
  ingest(raw: unknown, actor: string) {
    const input = body(raw)
    onlyKeys(input, ["rows"])
    if (!Array.isArray(input.rows) || input.rows.length === 0)
      throw new VGError("INVALID", "rows muss eine nicht leere Liste sein")
    if (input.rows.length > 200_000)
      throw new VGError("INVALID", "rows: höchstens 200000 Zeilen pro Aufruf")
    const parsed = input.rows.map((r: unknown, i: number) => {
      const at = `rows[${i}]`
      if (!isPlainObject(r))
        throw new VGError("INVALID", `${at} muss ein JSON-Objekt sein`)
      const extra = Object.keys(r).filter(
        (k) =>
          ![
            "project",
            "source",
            "date",
            "metric",
            "dims",
            "value",
            "channel",
          ].includes(k)
      )
      if (extra.length)
        throw new VGError(
          "INVALID",
          `${at}: unbekannte Felder ${extra.join(", ")}`
        )
      const str = (k: string) => {
        const v = r[k]
        if (typeof v !== "string" || !v.trim())
          throw new VGError("INVALID", `${at}.${k} fehlt`)
        return v.trim()
      }
      const date = str("date")
      if (!isDate(date))
        throw new VGError("INVALID", `${at}.date muss YYYY-MM-DD sein`)
      const value = r.value
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new VGError("INVALID", `${at}.value muss eine Zahl sein`)
      const channel =
        r.channel === undefined || r.channel === null ? null : str("channel")
      return {
        project: str("project"),
        source: str("source"),
        date,
        metric: str("metric"),
        dims: normaliseDims(r.dims, `${at}.dims`),
        value,
        channelId: channel,
      }
    })
    const projectIds = [...new Set(parsed.map((r) => r.project))].sort()
    return this.database.tx(() => {
      for (const id of projectIds) {
        if (!findProject(this.ctx, id))
          throw new VGError("NOT_FOUND", `Projekt ${id} nicht gefunden`)
      }
      const known = new Set([
        ...this.ctx.db
          .select({ id: channels.id })
          .from(channels)
          .all()
          .map((c) => c.id),
        ...this.ctx.db
          .select({ id: accounts.id })
          .from(accounts)
          .all()
          .map((c) => c.id),
      ])
      for (const r of parsed) {
        if (r.channelId && !known.has(r.channelId))
          throw new VGError("NOT_FOUND", `Kanal ${r.channelId} nicht gefunden`)
      }
      let changed = 0
      for (const id of projectIds) {
        changed += this.writeRows(
          id,
          parsed.filter((r) => r.project === id)
        ).changed
      }
      const dates = parsed.map((r) => r.date).sort()
      const result = {
        rows: parsed.length,
        changed,
        projects: projectIds,
        sources: [...new Set(parsed.map((r) => r.source))].sort(),
        from: dates[0],
        to: dates[dates.length - 1],
      }
      recordHistory(this.ctx, {
        actor,
        entity: "kpi_daily",
        entityId: projectIds.join(","),
        action: "ingest",
        after: result,
      })
      return result
    })
  }
}

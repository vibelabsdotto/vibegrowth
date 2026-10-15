import { Injectable } from "@nestjs/common"
import { addDays, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { KpiService } from "./kpi.service"
import { requireProject } from "./rows"
import { isPlainObject, jsonObject, windowEnding, yesterday } from "./validate"

export type FunnelAggregation = "sum" | "last"

export interface FunnelStageDef {
  key: string
  label: string
  /** "<source>:<metric>", metric may contain ":" (ga4:event:download_click). Daily totals (dims ''). */
  sources: string[]
  agg: FunnelAggregation
}

/** CONTRACT §7.3 default stages. */
export const DEFAULT_FUNNEL: readonly FunnelStageDef[] = [
  {
    key: "impression",
    label: "Impressionen",
    sources: ["gsc:impressions", "bing:impressions"],
    agg: "sum",
  },
  {
    key: "click",
    label: "Klicks",
    sources: ["gsc:clicks", "bing:clicks"],
    agg: "sum",
  },
  { key: "visit", label: "Besuche", sources: ["ga4:sessions"], agg: "sum" },
  {
    key: "download_click",
    label: "Download-Klicks",
    sources: ["ga4:event:download_click"],
    agg: "sum",
  },
  {
    key: "install",
    label: "Installationen",
    sources: ["play:installs", "asc:installs"],
    agg: "sum",
  },
  {
    key: "first_entry",
    label: "Erster Eintrag",
    sources: ["app:event:first_entry_created"],
    agg: "sum",
  },
  {
    key: "active_d7",
    label: "Aktiv D7",
    sources: ["app:active_d7"],
    agg: "last",
  },
  {
    key: "active_d28",
    label: "Aktiv D28",
    sources: ["app:active_d28"],
    agg: "last",
  },
]

export interface FunnelStage {
  key: string
  label: string
  value: number | null
  prev: number | null
  /** Relative change to the previous window, null when prev is 0 or missing. */
  delta: number | null
  /** value / value of the previous stage, null for the first stage or a missing/0 base. */
  conversion: number | null
  prevConversion: number | null
  hasData: boolean
  /** Last day of this stage's window. Earlier than window.to when its sources lag (e.g. Play exports ~3 days). */
  asOf: string
}

export interface Funnel {
  project: string
  window: { from: string; to: string }
  prevWindow: { from: string; to: string }
  stages: FunnelStage[]
  weakest: string | null
}

const round = (n: number) => Math.round(n * 10000) / 10000

function splitSource(spec: string): [string, string] {
  const i = spec.indexOf(":")
  if (i <= 0 || i === spec.length - 1)
    throw new VGError(
      "INVALID",
      `funnel: Quelle "${spec}" muss <source>:<metric> sein`
    )
  return [spec.slice(0, i), spec.slice(i + 1)]
}

/**
 * Stages for a project config: projects.config.funnel is a list (or {stages:[…]}) of
 * {key, label?, sources?, agg?}. Keys of default stages inherit the missing fields.
 * Throws INVALID for malformed overrides (ProjectsService validates on write).
 */
export function funnelStages(
  config: Record<string, unknown>
): FunnelStageDef[] {
  const raw = config.funnel
  if (raw === undefined || raw === null)
    return DEFAULT_FUNNEL.map((s) => ({ ...s }))
  const list = Array.isArray(raw)
    ? raw
    : isPlainObject(raw) && Array.isArray(raw.stages)
      ? raw.stages
      : null
  if (!list || list.length === 0)
    throw new VGError(
      "INVALID",
      "config.funnel muss eine nicht leere Liste von Stufen sein"
    )
  const seen = new Set<string>()
  return list.map((entry: unknown, i: number) => {
    const at = `config.funnel[${i}]`
    if (!isPlainObject(entry) || typeof entry.key !== "string" || !entry.key)
      throw new VGError("INVALID", `${at}.key fehlt`)
    if (seen.has(entry.key))
      throw new VGError("INVALID", `${at}.key ${entry.key} doppelt`)
    seen.add(entry.key)
    const base = DEFAULT_FUNNEL.find((s) => s.key === entry.key)
    const sources = entry.sources ?? base?.sources
    if (
      !Array.isArray(sources) ||
      sources.length === 0 ||
      !sources.every((s) => typeof s === "string")
    )
      throw new VGError(
        "INVALID",
        `${at}.sources muss eine Liste <source>:<metric> sein`
      )
    for (const s of sources) splitSource(s)
    const agg = entry.agg ?? base?.agg ?? "sum"
    if (agg !== "sum" && agg !== "last")
      throw new VGError("INVALID", `${at}.agg muss sum oder last sein`)
    const label = entry.label ?? base?.label ?? entry.key
    if (typeof label !== "string")
      throw new VGError("INVALID", `${at}.label muss ein Text sein`)
    return { key: entry.key, label, sources, agg }
  })
}

/** Funnel per project from kpi_daily (CONTRACT §7.3). */
@Injectable()
export class FunnelService {
  constructor(
    private readonly database: DatabaseService,
    private readonly kpi: KpiService
  ) {}

  private aggregate(
    projectId: string,
    stage: FunnelStageDef,
    w: { from: string; to: string }
  ): number | null {
    let total = 0
    let hasData = false
    for (const spec of stage.sources) {
      const [source, metric] = splitSource(spec)
      const rows = this.kpi.series(projectId, source, metric, w.from, w.to)
      if (!rows.length) continue
      hasData = true
      total +=
        stage.agg === "last"
          ? rows[rows.length - 1].value
          : rows.reduce((a, r) => a + r.value, 0)
    }
    return hasData ? total : null
  }

  /** Latest day with a total (dims '') for any of the stage's sources, not after `end`. */
  private latest(
    projectId: string,
    stage: FunnelStageDef,
    end: string
  ): string | null {
    let max: string | null = null
    const q = this.database.ctx.sqlite.prepare(
      "SELECT max(date) AS d FROM kpi_daily WHERE project_id = ? AND source = ? AND metric = ? AND dims = '' AND date <= ?"
    )
    for (const spec of stage.sources) {
      const [source, metric] = splitSource(spec)
      const d = (q.get(projectId, source, metric, end) as { d: string | null })
        .d
      if (d && (!max || d > max)) max = d
    }
    return max
  }

  /**
   * Funnel for `days` days ending at `end` (default yesterday) against the window before.
   * Signature is stable: growth-work (overview, context) calls funnel(projectId, days, end).
   */
  funnel(projectId: string, days = 7, end?: string): Funnel {
    const project = requireProject(this.database.ctx, projectId)
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new VGError("INVALID", "days muss eine ganze Zahl 1–365 sein")
    const window = windowEnding(end ?? yesterday(), days)
    const prevWindow = windowEnding(addDays(window.from, -1), days)
    const defs = funnelStages(jsonObject(project.config))
    const stages: FunnelStage[] = []
    for (const [i, def] of defs.entries()) {
      // A lagging source would otherwise look like a drop: compare equal windows ending at its last day.
      const last = this.latest(projectId, def, window.to)
      const asOf =
        last && last < window.to && last >= window.from ? last : window.to
      const w = asOf === window.to ? window : windowEnding(asOf, days)
      const pw =
        asOf === window.to
          ? prevWindow
          : windowEnding(addDays(w.from, -1), days)
      const value = this.aggregate(projectId, def, w)
      const prev = this.aggregate(projectId, def, pw)
      const before = i > 0 ? stages[i - 1] : null
      const ratio = (a: number | null, b: number | null | undefined) =>
        a !== null && b !== null && b !== undefined && b !== 0
          ? round(a / b)
          : null
      stages.push({
        key: def.key,
        label: def.label,
        value,
        prev,
        delta:
          value !== null && prev !== null && prev !== 0
            ? round((value - prev) / prev)
            : null,
        conversion: before ? ratio(value, before.value) : null,
        prevConversion: before ? ratio(prev, before.prev) : null,
        hasData: value !== null,
        asOf,
      })
    }
    let weakest: string | null = null
    let min = Infinity
    for (const s of stages) {
      if (s.hasData && s.conversion !== null && s.conversion < min) {
        min = s.conversion
        weakest = s.key
      }
    }
    return { project: projectId, window, prevWindow, stages, weakest }
  }
}

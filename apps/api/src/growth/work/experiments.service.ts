import { Injectable } from "@nestjs/common"
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  type SQL,
} from "drizzle-orm"
import type { Ctx } from "../../core/db"
import { changes, experiments, kpiDaily, searchDaily } from "../../core/schema"
import {
  addDays,
  assertDate,
  getById,
  json,
  parseJson,
  patchRow,
  recordHistory,
  today,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import {
  checkChannel,
  listOf,
  oneOf,
  optOneOf,
  pathMatches,
  relChange,
  requireProject,
  round,
  yesterday,
} from "./shared"

export const EXPERIMENT_TARGET_TYPES = [
  "page",
  "post",
  "store",
  "other",
] as const
export const EXPERIMENT_STATUS = ["running", "evaluated", "stopped"] as const
export const VERDICTS = ["win", "loss", "neutral", "inconclusive"] as const
export const SEARCH_METRICS = [
  "clicks",
  "impressions",
  "ctr",
  "position",
] as const

/** Minimum impressions per window for search metrics, below → inconclusive. */
export const MIN_IMPRESSIONS = 50
/** Relative change from which a result counts as win/loss. */
export const THRESHOLD = 0.1

/** kpi metrics that are averaged instead of summed (rates, scores, gauges). */
const AVG_METRICS = new Set([
  "ctr",
  "position",
  "rating",
  "retention_d1",
  "retention_d7",
  "retention_d28",
  "performance",
  "seo",
  "accessibility",
  "best_practices",
  "lcp_ms",
  "cls",
  "tbt_ms",
  "up",
  "tls_days",
  "latency_ms",
])
/** kpi metrics where the last value in the window counts (rolling actives). */
const LAST_METRICS = new Set(["active_d7", "active_d28"])

export type ExperimentRow = typeof experiments.$inferSelect
type Aggregation = "sum" | "avg" | "last" | "search"

/** How a kpi metric is aggregated over a window: last value, average or sum. */
export function kpiAggregation(metric: string): "sum" | "avg" | "last" {
  return LAST_METRICS.has(metric)
    ? "last"
    : AVG_METRICS.has(metric)
      ? "avg"
      : "sum"
}

export interface ExperimentInput {
  projectId: string
  channelId?: string | null
  title: string
  hypothesis?: string | null
  targetType?: string
  target?: string | null
  metric: string
  startDate?: string
  baselineDays?: number
  evalDays?: number
  sourceKey?: string | null
}

export interface ExperimentPatch {
  channelId?: string | null
  title?: string
  hypothesis?: string | null
  targetType?: string
  target?: string | null
  metric?: string
  startDate?: string
  baselineDays?: number
  evalDays?: number
  status?: string
  verdict?: string | null
}

export interface WindowResult {
  from: string
  to: string
  days: number
  daysWithData: number
  value: number | null
  perDay: number | null
  clicks?: number
  impressions?: number
}

export interface ExperimentResult {
  metric: string
  aggregation: Aggregation
  baseline: WindowResult
  after: WindowResult
  /** relative change (per day for summed metrics), null without base */
  change: number | null
}

function checkMetric(metric: string) {
  const m = metric.trim()
  if ((SEARCH_METRICS as readonly string[]).includes(m)) return m
  if (/^[a-z0-9_-]+:.+$/i.test(m)) return m
  throw new VGError(
    "INVALID",
    `metric muss clicks, impressions, ctr, position oder <quelle>:<metrik> sein, war: ${metric}`
  )
}

function checkDays(v: number, field: string) {
  if (!Number.isInteger(v) || v < 1 || v > 365)
    throw new VGError("INVALID", `${field} muss 1–365 sein, war: ${v}`)
  return v
}

export function windows(
  e: Pick<ExperimentRow, "startDate" | "baselineDays" | "evalDays">
) {
  return {
    baseline: {
      from: addDays(e.startDate, -e.baselineDays),
      to: addDays(e.startDate, -1),
    },
    after: {
      from: e.startDate,
      to: addDays(e.startDate, e.evalDays - 1),
    },
  }
}

/** Due when start_date + eval_days <= yesterday (contract §7.5). */
export function dueOn(e: Pick<ExperimentRow, "startDate" | "evalDays">) {
  return addDays(e.startDate, e.evalDays + 1)
}

export function isDue(e: Pick<ExperimentRow, "startDate" | "evalDays">) {
  return addDays(e.startDate, e.evalDays) <= yesterday()
}

interface SearchDay {
  clicks: number
  impressions: number
  posWeighted: number
}

/**
 * Daily series of an experiment metric. Search metrics with a target come from search_daily (gsc)
 * filtered by page path suffix, without target from the gsc daily totals; <source>:<metric> from
 * kpi_daily (dims '').
 */
export function metricDays(
  ctx: Ctx,
  e: Pick<ExperimentRow, "projectId" | "metric" | "target" | "targetType">,
  from: string,
  to: string
): { aggregation: Aggregation; days: Map<string, SearchDay | number> } {
  const isSearch = (SEARCH_METRICS as readonly string[]).includes(e.metric)
  if (isSearch && e.target) {
    const days = new Map<string, SearchDay>()
    const rows = ctx.db
      .select()
      .from(searchDaily)
      .where(
        and(
          eq(searchDaily.projectId, e.projectId),
          eq(searchDaily.source, "gsc"),
          gte(searchDaily.date, from),
          lte(searchDaily.date, to)
        )
      )
      .all()
    for (const r of rows) {
      if (!pathMatches(r.page, e.target)) continue
      const d = days.get(r.date) ?? {
        clicks: 0,
        impressions: 0,
        posWeighted: 0,
      }
      d.clicks += r.clicks
      d.impressions += r.impressions
      d.posWeighted += r.position * r.impressions
      days.set(r.date, d)
    }
    return { aggregation: "search", days }
  }
  if (isSearch) {
    const rows = ctx.db
      .select()
      .from(kpiDaily)
      .where(
        and(
          eq(kpiDaily.projectId, e.projectId),
          eq(kpiDaily.source, "gsc"),
          eq(kpiDaily.dims, ""),
          inArray(kpiDaily.metric, ["clicks", "impressions", "position"]),
          gte(kpiDaily.date, from),
          lte(kpiDaily.date, to)
        )
      )
      .all()
    const raw = new Map<string, Record<string, number>>()
    for (const r of rows) {
      const d = raw.get(r.date) ?? {}
      d[r.metric] = r.value
      raw.set(r.date, d)
    }
    const days = new Map<string, SearchDay>()
    for (const [date, d] of raw)
      days.set(date, {
        clicks: d.clicks ?? 0,
        impressions: d.impressions ?? 0,
        posWeighted: (d.position ?? 0) * (d.impressions ?? 0),
      })
    return { aggregation: "search", days }
  }
  const i = e.metric.indexOf(":")
  const source = e.metric.slice(0, i)
  const metric = e.metric.slice(i + 1)
  const rows = ctx.db
    .select()
    .from(kpiDaily)
    .where(
      and(
        eq(kpiDaily.projectId, e.projectId),
        eq(kpiDaily.source, source),
        eq(kpiDaily.metric, metric),
        eq(kpiDaily.dims, ""),
        gte(kpiDaily.date, from),
        lte(kpiDaily.date, to)
      )
    )
    .all()
  const days = new Map<string, number>()
  for (const r of rows) days.set(r.date, (days.get(r.date) ?? 0) + r.value)
  const aggregation: Aggregation = kpiAggregation(metric)
  return { aggregation, days }
}

function searchValue(metric: string, d: SearchDay): number | null {
  if (metric === "clicks") return d.clicks
  if (metric === "impressions") return d.impressions
  if (metric === "ctr") return d.impressions ? d.clicks / d.impressions : null
  return d.impressions ? d.posWeighted / d.impressions : null
}

function windowResult(
  metric: string,
  aggregation: Aggregation,
  days: Map<string, SearchDay | number>,
  from: string,
  to: string
): WindowResult {
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  const inWin = [...days.entries()]
    .filter(([d]) => d >= from && d <= to)
    .sort(([a], [b]) => a.localeCompare(b))
  const base = { from, to, days: n, daysWithData: inWin.length }
  if (aggregation === "search") {
    const s = { clicks: 0, impressions: 0, posWeighted: 0 }
    for (const [, d] of inWin) {
      const v = d as SearchDay
      s.clicks += v.clicks
      s.impressions += v.impressions
      s.posWeighted += v.posWeighted
    }
    const value = inWin.length ? searchValue(metric, s) : null
    const summed = metric === "clicks" || metric === "impressions"
    return {
      ...base,
      value: round(value, metric === "position" ? 2 : 4),
      perDay: summed && value !== null ? round(value / n, 4) : null,
      clicks: s.clicks,
      impressions: s.impressions,
    }
  }
  const vals = inWin.map(([, v]) => v as number)
  if (!vals.length) return { ...base, value: null, perDay: null }
  if (aggregation === "sum") {
    const sum = vals.reduce((a, b) => a + b, 0)
    return { ...base, value: round(sum), perDay: round(sum / n) }
  }
  if (aggregation === "last")
    return { ...base, value: vals[vals.length - 1], perDay: null }
  return {
    ...base,
    value: round(vals.reduce((a, b) => a + b, 0) / vals.length),
    perDay: null,
  }
}

/** Baseline vs. after window of an experiment, computed from the stored data. */
export function computeResult(ctx: Ctx, e: ExperimentRow): ExperimentResult {
  const w = windows(e)
  const { aggregation, days } = metricDays(ctx, e, w.baseline.from, w.after.to)
  const baseline = windowResult(
    e.metric,
    aggregation,
    days,
    w.baseline.from,
    w.baseline.to
  )
  const after = windowResult(
    e.metric,
    aggregation,
    days,
    w.after.from,
    w.after.to
  )
  // Summed metrics compare per day, so unequal window lengths stay comparable.
  const useRate = baseline.perDay !== null && after.perDay !== null
  const change = round(
    useRate
      ? relChange(after.perDay, baseline.perDay)
      : relChange(after.value, baseline.value),
    4
  )
  return { metric: e.metric, aggregation, baseline, after, change }
}

export function verdictFor(
  metric: string,
  r: ExperimentResult
): (typeof VERDICTS)[number] {
  const isSearch = (SEARCH_METRICS as readonly string[]).includes(metric)
  if (
    isSearch &&
    ((r.baseline.impressions ?? 0) < MIN_IMPRESSIONS ||
      (r.after.impressions ?? 0) < MIN_IMPRESSIONS)
  )
    return "inconclusive"
  if (r.change === null) return "inconclusive"
  const c = metric === "position" ? -r.change : r.change
  if (c >= THRESHOLD) return "win"
  if (c <= -THRESHOLD) return "loss"
  return "neutral"
}

export function experimentOut(e: ExperimentRow) {
  return {
    ...e,
    result: parseJson<ExperimentResult | null>(e.result, null),
    windows: windows(e),
    dueOn: dueOn(e),
  }
}

@Injectable()
export class ExperimentsService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  list(f: { project?: string; status?: string }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(experiments.projectId, f.project))
    const statuses = listOf(f.status, EXPERIMENT_STATUS, "status")
    if (statuses) conds.push(inArray(experiments.status, statuses))
    return this.ctx.db
      .select()
      .from(experiments)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(experiments.startDate), desc(experiments.id))
      .all()
      .map(experimentOut)
  }

  get(id: number) {
    const ctx = this.ctx
    const e = getById(ctx, experiments, id, "Experiment")
    const w = windows(e)
    // Through today, so changes logged today get a marker on the chart (today has no numbers yet).
    const end = w.after.to < today() ? w.after.to : today()
    const { days } = metricDays(ctx, e, w.baseline.from, end)
    const series: {
      date: string
      value: number | null
      clicks?: number
      impressions?: number
    }[] = []
    for (let d = w.baseline.from; d <= end; d = addDays(d, 1)) {
      const v = days.get(d)
      if (v === undefined) series.push({ date: d, value: null })
      else if (typeof v === "number") series.push({ date: d, value: v })
      else
        series.push({
          date: d,
          value: round(searchValue(e.metric, v), 4),
          clicks: v.clicks,
          impressions: v.impressions,
        })
    }
    const changeRows = ctx.db
      .select()
      .from(changes)
      .where(
        or(
          and(
            eq(changes.projectId, e.projectId),
            gte(changes.date, w.baseline.from),
            lte(changes.date, w.after.to)
          ),
          eq(changes.experimentId, e.id)
        )
      )
      .orderBy(asc(changes.date), asc(changes.id))
      .all()
    return {
      ...experimentOut(e),
      due: e.status === "running" && isDue(e),
      /** running: result so far, not stored */
      interim: e.status === "running" ? computeResult(ctx, e) : null,
      series,
      changes: changeRows,
    }
  }

  add(input: ExperimentInput, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, input.projectId)
      const title = input.title?.trim()
      if (!title) throw new VGError("INVALID", "title fehlt")
      if (!input.metric) throw new VGError("INVALID", "metric fehlt")
      const row = ctx.db
        .insert(experiments)
        .values({
          projectId: project.id,
          channelId: checkChannel(ctx, project.id, input.channelId),
          title,
          hypothesis: input.hypothesis ?? null,
          targetType: oneOf(
            input.targetType ?? "page",
            EXPERIMENT_TARGET_TYPES,
            "targetType"
          ),
          target: input.target?.trim() || null,
          metric: checkMetric(input.metric),
          startDate: input.startDate
            ? assertDate(input.startDate, "startDate")
            : today(),
          baselineDays: checkDays(input.baselineDays ?? 28, "baselineDays"),
          evalDays: checkDays(input.evalDays ?? 28, "evalDays"),
          status: "running",
          actor,
          sourceKey: input.sourceKey ?? null,
        })
        .returning()
        .get()
      recordHistory(ctx, {
        actor,
        entity: "experiment",
        entityId: row.id,
        action: "create",
        after: row,
      })
      return experimentOut(row)
    })
  }

  update(id: number, p: ExperimentPatch, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const e = getById(ctx, experiments, id, "Experiment")
      const patch: Record<string, unknown> = {}
      if (p.title !== undefined) {
        if (!p.title?.trim())
          throw new VGError("INVALID", "title darf nicht leer sein")
        patch.title = p.title.trim()
      }
      if (p.hypothesis !== undefined) patch.hypothesis = p.hypothesis
      if (p.channelId !== undefined)
        patch.channelId = checkChannel(ctx, e.projectId, p.channelId)
      if (p.targetType !== undefined)
        patch.targetType = oneOf(
          p.targetType,
          EXPERIMENT_TARGET_TYPES,
          "targetType"
        )
      if (p.target !== undefined) patch.target = p.target?.trim() || null
      if (p.metric !== undefined) patch.metric = checkMetric(p.metric)
      if (p.startDate !== undefined)
        patch.startDate = assertDate(p.startDate, "startDate")
      if (p.baselineDays !== undefined)
        patch.baselineDays = checkDays(p.baselineDays, "baselineDays")
      if (p.evalDays !== undefined)
        patch.evalDays = checkDays(p.evalDays, "evalDays")
      if (p.status !== undefined)
        patch.status = oneOf(p.status, EXPERIMENT_STATUS, "status")
      if (p.verdict !== undefined)
        patch.verdict = optOneOf(p.verdict, VERDICTS, "verdict") ?? null
      return experimentOut(
        patchRow(ctx, experiments, "experiment", id, patch, actor)
      )
    })
  }

  /** Evaluate every due running experiment (contract §7.5). */
  evaluate(input: { project?: string }, actor: string) {
    const ctx = this.ctx
    if (input.project) requireProject(ctx, input.project)
    return this.database.tx(() => {
      const conds: SQL[] = [eq(experiments.status, "running")]
      if (input.project) conds.push(eq(experiments.projectId, input.project))
      const running = ctx.db
        .select()
        .from(experiments)
        .where(and(...conds))
        .orderBy(asc(experiments.id))
        .all()
      const evaluated: {
        id: number
        projectId: string
        title: string
        verdict: string
        result: ExperimentResult
      }[] = []
      const notDue: {
        id: number
        projectId: string
        title: string
        dueOn: string
      }[] = []
      for (const e of running) {
        if (!isDue(e)) {
          notDue.push({
            id: e.id,
            projectId: e.projectId,
            title: e.title,
            dueOn: dueOn(e),
          })
          continue
        }
        const result = computeResult(ctx, e)
        const verdict = verdictFor(e.metric, result)
        patchRow(
          ctx,
          experiments,
          "experiment",
          e.id,
          { status: "evaluated", result: json(result), verdict },
          actor,
          "evaluate"
        )
        evaluated.push({
          id: e.id,
          projectId: e.projectId,
          title: e.title,
          verdict,
          result,
        })
      }
      return { date: yesterday(), evaluated, notDue }
    })
  }
}

import { Injectable } from "@nestjs/common"
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
import type { Ctx } from "../../core/db"
import {
  accounts,
  approvals,
  collectorRuns,
  experiments,
  kpiDaily,
  metricSnapshots,
  posts,
  projects,
} from "../../core/schema"
import { addDays, today, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import type { Funnel } from "../data/funnel.service"
import { DataBridge } from "./data-bridge"
import { type ProjectRow } from "./shared"

export type Light = "green" | "yellow" | "red"

/** Thresholds of the traffic light (contract §7.4). */
export const RED_DROP = 0.4
export const YELLOW_DROP = 0.2
export const ERROR_HOURS = 48
export const APPROVAL_DAYS = 3

const HOUR = 3_600_000

/** "2026-10-14" or ISO timestamp → "14.10." / "14.10. 06:02" */
function deDate(s: string) {
  const d = s.length > 10 ? new Date(s) : null
  const [, m, day] = s.slice(0, 10).split("-")
  if (!d || Number.isNaN(d.getTime())) return `${day}.${m}.`
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`
}

const fmt = (n: number) =>
  Number.isInteger(n)
    ? n.toLocaleString("de-DE")
    : n.toLocaleString("de-DE", { maximumFractionDigits: 2 })

function short(s: string | null, max = 160) {
  const t = (s ?? "unbekannter Fehler").replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export interface CollectorError {
  collector: string
  error: string
  at: string
}

/** Latest run per collector, when it failed within the last 48 h. */
export function collectorErrors(
  ctx: Ctx,
  projectId: string,
  now = Date.now()
): CollectorError[] {
  const since = new Date(now - ERROR_HOURS * HOUR).toISOString()
  const runs = ctx.db
    .select()
    .from(collectorRuns)
    .where(eq(collectorRuns.projectId, projectId))
    .orderBy(desc(collectorRuns.startedAt), desc(collectorRuns.id))
    .all()
  const seen = new Set<string>()
  const out: CollectorError[] = []
  for (const r of runs) {
    if (seen.has(r.collector)) continue
    seen.add(r.collector)
    const at = r.finishedAt ?? r.startedAt
    if (r.ok === false && at >= since)
      out.push({
        collector: r.collector,
        error: short(r.error ?? r.summary),
        at,
      })
  }
  return out
}

/** Last health:up value (dims '') of the project. */
export function lastHealth(ctx: Ctx, projectId: string) {
  return (
    ctx.db
      .select({ date: kpiDaily.date, value: kpiDaily.value })
      .from(kpiDaily)
      .where(
        and(
          eq(kpiDaily.projectId, projectId),
          eq(kpiDaily.source, "health"),
          eq(kpiDaily.metric, "up"),
          eq(kpiDaily.dims, "")
        )
      )
      .orderBy(desc(kpiDaily.date))
      .limit(1)
      .get() ?? null
  )
}

export function pendingApprovals(ctx: Ctx, projectId: string) {
  return ctx.db
    .select()
    .from(approvals)
    .where(
      and(eq(approvals.projectId, projectId), eq(approvals.status, "pending"))
    )
    .orderBy(asc(approvals.createdAt))
    .all()
}

/**
 * Traffic light with one German sentence per trigger: red when the last health check reports up=0
 * or a funnel stage with data is more than 40 % below the previous window; yellow at more than 20 %,
 * a failed collector run within 48 h or pending approvals older than 3 days.
 */
export function trafficLight(input: {
  funnel: Funnel
  days: number
  health: { date: string; value: number } | null
  errors: CollectorError[]
  pending: { createdAt: string }[]
  now?: number
}): { light: Light; reasons: string[] } {
  const red: string[] = []
  const yellow: string[] = []
  if (input.health && input.health.value === 0)
    red.push(
      `Website nicht erreichbar: der letzte Health-Check (${deDate(input.health.date)}) meldet up=0.`
    )
  const period =
    input.days === 7 ? "Vorwoche" : `Vorperiode (${input.days} Tage)`
  for (const s of input.funnel.stages) {
    if (!s.hasData || s.delta === null || s.value === null || s.prev === null)
      continue
    const pct = Math.round(-s.delta * 100)
    const text = `Funnel-Stufe „${s.label}“ liegt ${pct} % unter der ${period} (${fmt(s.value)} statt ${fmt(s.prev)}).`
    if (s.delta < -RED_DROP) red.push(text)
    else if (s.delta < -YELLOW_DROP) yellow.push(text)
  }
  for (const e of input.errors)
    yellow.push(
      `Collector ${e.collector} ist am ${deDate(e.at)} fehlgeschlagen: ${e.error}`
    )
  const cutoff = new Date(
    (input.now ?? Date.now()) - APPROVAL_DAYS * 24 * HOUR
  ).toISOString()
  const old = input.pending.filter((a) => a.createdAt < cutoff)
  if (old.length)
    yellow.push(
      old.length === 1
        ? `1 Freigabe wartet seit mehr als ${APPROVAL_DAYS} Tagen auf Max.`
        : `${old.length} Freigaben warten seit mehr als ${APPROVAL_DAYS} Tagen auf Max.`
    )
  return {
    light: red.length ? "red" : yellow.length ? "yellow" : "green",
    reasons: [...red, ...yellow],
  }
}

/** Shorts numbers of a project: accounts, posts posted in the last 7 days, plays gained in 7 days. */
export function shortsNumbers(ctx: Ctx, projectId: string, now = Date.now()) {
  const accs = ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.brandId, projectId))
    .all()
    .map((a) => a.id)
  if (!accs.length) return { accounts: 0, postsLast7d: 0, playsLast7d: 0 }
  const from = addDays(today(new Date(now)), -6)
  const postsLast7d = ctx.db
    .select({ postedAt: posts.postedAt, date: posts.date })
    .from(posts)
    .where(and(inArray(posts.accountId, accs), eq(posts.status, "posted")))
    .all()
    .filter((p) => (p.postedAt?.slice(0, 10) ?? p.date ?? "") >= from).length
  const snaps = ctx.db
    .select({
      tiktokId: metricSnapshots.tiktokId,
      pulledAt: metricSnapshots.pulledAt,
      plays: metricSnapshots.plays,
    })
    .from(metricSnapshots)
    .where(inArray(metricSnapshots.accountId, accs))
    .all()
  const cutoff = new Date(now - 7 * 24 * HOUR).toISOString()
  const byVideo = new Map<
    string,
    { latest: number; latestAt: string; base: number; baseAt: string }
  >()
  for (const s of snaps) {
    const v = byVideo.get(s.tiktokId) ?? {
      latest: 0,
      latestAt: "",
      base: 0,
      baseAt: "",
    }
    if (s.pulledAt > v.latestAt) {
      v.latest = s.plays
      v.latestAt = s.pulledAt
    }
    if (s.pulledAt <= cutoff && s.pulledAt > v.baseAt) {
      v.base = s.plays
      v.baseAt = s.pulledAt
    }
    byVideo.set(s.tiktokId, v)
  }
  let playsLast7d = 0
  for (const v of byVideo.values())
    playsLast7d += Math.max(0, v.latest - v.base)
  return { accounts: accs.length, postsLast7d, playsLast7d }
}

@Injectable()
export class OverviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly data: DataBridge
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  overview(days = 7) {
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new VGError("INVALID", `days muss 1–365 sein, war: ${days}`)
    return this.ctx.db
      .select()
      .from(projects)
      .where(ne(projects.status, "archived"))
      .orderBy(asc(projects.name))
      .all()
      .map((p) => this.row(p, days))
  }

  row(p: ProjectRow, days: number) {
    const ctx = this.ctx
    const funnel = this.data.funnel(p.id, days)
    const pending = pendingApprovals(ctx, p.id)
    const errors = collectorErrors(ctx, p.id)
    const { light, reasons } = trafficLight({
      funnel,
      days,
      health: lastHealth(ctx, p.id),
      errors,
      pending,
    })
    const running = ctx.db
      .select({ id: experiments.id })
      .from(experiments)
      .where(
        and(eq(experiments.projectId, p.id), eq(experiments.status, "running"))
      )
      .all().length
    const last = ctx.db
      .select({
        startedAt: collectorRuns.startedAt,
        finishedAt: collectorRuns.finishedAt,
      })
      .from(collectorRuns)
      .where(eq(collectorRuns.projectId, p.id))
      .orderBy(desc(collectorRuns.startedAt))
      .limit(1)
      .get()
    return {
      project: { id: p.id, name: p.name, url: p.url, kind: p.kind },
      funnel: {
        stages: funnel.stages.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          prev: s.prev,
          delta: s.delta,
        })),
      },
      weakest: funnel.weakest,
      light,
      reasons,
      pendingApprovals: pending.length,
      runningExperiments: running,
      lastCollect: last ? (last.finishedAt ?? last.startedAt) : null,
      collectorErrors: errors,
      shorts: shortsNumbers(ctx, p.id),
    }
  }
}

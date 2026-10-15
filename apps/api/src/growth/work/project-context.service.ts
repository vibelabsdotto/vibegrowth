import { Injectable } from "@nestjs/common"
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm"
import { listAccounts, listRules } from "../../core/catalog"
import { activeFormat } from "../../core/context"
import { listDecisions, listLearnings } from "../../core/knowledge"
import { horizon } from "../../core/plan"
import { approvals, experiments, kpiDaily } from "../../core/schema"
import { addDays, assertDate, today } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { approvalOut } from "./approvals.service"
import { BacklogService } from "./backlog.service"
import { ChangesService } from "./changes.service"
import { CONTENT_STATUS, ContentService } from "./content.service"
import { DataBridge } from "./data-bridge"
import {
  experimentOut,
  ExperimentsService,
  isDue,
  kpiAggregation,
} from "./experiments.service"
import { GeoService } from "./geo.service"
import {
  collectorErrors,
  lastHealth,
  pendingApprovals,
  trafficLight,
} from "./overview.service"
import { relChange, requireProject, round } from "./shared"
import { StoreService } from "./store.service"

/**
 * `context --project`: everything an agent run needs for one project in one call, read-only
 * (contract §7.6).
 */
@Injectable()
export class ProjectContextService {
  constructor(
    private readonly database: DatabaseService,
    private readonly data: DataBridge,
    private readonly content: ContentService,
    private readonly backlog: BacklogService,
    private readonly experiments: ExperimentsService,
    private readonly changes: ChangesService,
    private readonly geo: GeoService,
    private readonly store: StoreService
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Daily totals (dims '') per source/metric: 7 days up to `end` vs. the 7 days before. */
  kpiSummary(projectId: string, end: string, days = 7) {
    const from = addDays(end, -(days - 1))
    const prevTo = addDays(from, -1)
    const prevFrom = addDays(prevTo, -(days - 1))
    const rows = this.ctx.db
      .select()
      .from(kpiDaily)
      .where(
        and(
          eq(kpiDaily.projectId, projectId),
          eq(kpiDaily.dims, ""),
          gte(kpiDaily.date, prevFrom),
          lte(kpiDaily.date, end)
        )
      )
      .orderBy(kpiDaily.date)
      .all()
    const groups = new Map<string, typeof rows>()
    for (const r of rows) {
      const k = `${r.source}\u0000${r.metric}`
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    const agg = (list: typeof rows, how: "sum" | "avg" | "last") => {
      if (!list.length) return null
      if (how === "last") return list[list.length - 1].value
      const sum = list.reduce((a, r) => a + r.value, 0)
      return round(how === "avg" ? sum / list.length : sum)
    }
    return [...groups.entries()]
      .map(([k, list]) => {
        const [source, metric] = k.split("\u0000")
        const how = kpiAggregation(metric)
        const value = agg(
          list.filter((r) => r.date >= from),
          how
        )
        const prev = agg(
          list.filter((r) => r.date <= prevTo),
          how
        )
        return {
          source,
          metric,
          agg: how,
          value,
          prev,
          delta: round(relChange(value, prev)),
        }
      })
      .sort(
        (a, b) =>
          a.source.localeCompare(b.source) || a.metric.localeCompare(b.metric)
      )
  }

  build(projectId: string, date = today()) {
    const ctx = this.ctx
    assertDate(date, "date")
    const p = requireProject(ctx, projectId)
    const end = addDays(date, -1)
    const warnings: string[] = []

    const channels = this.data.channels(p.id)
    const collectors = this.data.collectors(p.id).map((c) => ({
      collector: c.collector,
      enabled: c.enabled,
      lastRun: c.lastRun,
    }))
    const funnel = this.data.funnel(p.id, 7, end)
    const kpiSummary = this.kpiSummary(p.id, end)
    const audit = this.data.audit(p.id)

    const pending = pendingApprovals(ctx, p.id).map(approvalOut)
    const since14 = addDays(date, -14)
    const recentDecisions = ctx.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.projectId, p.id),
          inArray(approvals.status, [
            "approved",
            "rejected",
            "changes_requested",
          ]),
          gte(approvals.decidedAt, since14)
        )
      )
      .orderBy(desc(approvals.decidedAt))
      .all()
      .map(approvalOut)

    const contentItems = this.content
      .list({ project: p.id })
      .filter((c) => c.status !== "discarded")
    const byStatus = Object.fromEntries(
      CONTENT_STATUS.map((s) => [
        s,
        this.content.list({ project: p.id, status: s }).length,
      ])
    )

    const backlogOpen = this.backlog.list({ project: p.id, status: "open" })
    const running = this.experiments
      .list({ project: p.id, status: "running" })
      .map((e) => ({ ...e, due: isDue(e) }))
    const recent = ctx.db
      .select()
      .from(experiments)
      .where(
        and(eq(experiments.projectId, p.id), ne(experiments.status, "running"))
      )
      .orderBy(desc(experiments.updatedAt), desc(experiments.id))
      .limit(10)
      .all()
      .map(experimentOut)
    const changes = this.changes.list({
      project: p.id,
      from: addDays(date, -28),
      to: date,
    })

    const geoSummary = this.geo.summary(p.id)
    const questions = this.geo.listQuestions({ project: p.id })
    const mentions = this.geo.listMentions({
      project: p.id,
      status: "new,contacted",
    })
    const store = {
      summary: this.store.summary(p.id, 28, end),
      recentReviews: this.store.reviews({ project: p.id, limit: 10 }),
    }

    const rules = listRules(ctx, {
      scopeType: "brand",
      scopeId: p.id,
      status: "active",
    })
    const learnings = [
      ...listLearnings(ctx, {
        scopeType: "brand",
        scopeId: p.id,
        status: "active",
      }),
      ...listLearnings(ctx, { scopeType: "global", status: "active" }),
      ...listLearnings(ctx, { scopeType: "growth", status: "active" }),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    const decisions = listDecisions(ctx)
      .filter(
        (d) =>
          (d.scopeType === "brand" && d.scopeId === p.id) ||
          d.scopeType === "global" ||
          d.scopeType === "growth"
      )
      .slice(0, 20)

    const shortsAccounts = listAccounts(ctx, { brandId: p.id }).map((a) => {
      const active = activeFormat(ctx, a.id, date)
      const h = horizon(ctx, a.id, date, 21)
      if (a.status === "active" && h.firstGap)
        warnings.push(
          `Shorts-Account ${a.id}: ${h.days - h.filledDays} freie Tage in den nächsten ${h.days} Tagen, erster ${h.firstGap}.`
        )
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        activeFormat: active.format
          ? {
              id: active.format.id,
              name: active.format.name,
              version: active.format.currentVersion,
              source: active.source,
            }
          : null,
        horizon: {
          filledDays: h.filledDays,
          days: h.days,
          firstGap: h.firstGap,
        },
      }
    })

    // Warnings: the traffic light reasons first, then gaps an agent can close.
    const light = trafficLight({
      funnel,
      days: 7,
      health: lastHealth(ctx, p.id),
      errors: collectorErrors(ctx, p.id),
      pending,
    })
    warnings.unshift(...light.reasons)
    if (!collectors.some((c) => c.enabled))
      warnings.push(
        'Kein Collector eingeschaltet. Mit "collectors set <collector> --project … --enable" einschalten.'
      )
    if (!funnel.stages.some((s) => s.hasData))
      warnings.push(
        `Keine Funnel-Daten für ${funnel.window.from} bis ${funnel.window.to}.`
      )
    const due = running.filter((e) => e.due)
    if (due.length)
      warnings.push(
        `${due.length} Experiment${due.length === 1 ? " ist" : "e sind"} fällig. Mit "exp eval --project ${p.id}" auswerten.`
      )
    if (audit.openErrors.length)
      warnings.push(`Letztes Audit: ${audit.openErrors.length} offene Fehler.`)
    if (!questions.length)
      warnings.push('Keine aktiven GEO-Fragen. Mit "geo question add" anlegen.')

    return {
      generatedAt: new Date().toISOString(),
      date,
      project: {
        ...p,
        config: (() => {
          try {
            return JSON.parse(p.config) as unknown
          } catch {
            return {}
          }
        })(),
      },
      light: light.light,
      channels,
      collectors,
      funnel,
      kpiSummary,
      search: { opportunities: this.data.opportunities(p.id, end, 20) },
      audit,
      approvals: { pending, recentDecisions },
      content: { byStatus, items: contentItems },
      backlog: { open: backlogOpen },
      experiments: { running, recent },
      changes,
      geo: { summary: geoSummary, questions },
      mentions,
      store,
      rules,
      learnings,
      decisions,
      shorts: { accounts: shortsAccounts },
      warnings,
    }
  }
}

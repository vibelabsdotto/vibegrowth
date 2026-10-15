import { Injectable, Logger } from "@nestjs/common"
import { and, asc, eq, inArray, ne } from "drizzle-orm"
import type { CollectorDefinition } from "../../collectors/collector"
import { CollectorRegistry } from "../../collectors/registry"
import { errorMessage, type CollectorResult } from "../../collectors/sources"
import { toolConfig } from "../../core/config"
import { channels, geoQuestions } from "../../core/schema"
import { nowIso, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { GeoService } from "../work/geo.service"
import { StoreService } from "../work/store.service"
import { AuditService } from "./audit.service"
import { collectorProject, CollectorsService } from "./collectors.service"
import { KpiService, type ReplaceWindow } from "./kpi.service"
import { requireProject, type ProjectRow } from "./rows"
import { SearchService } from "./search.service"
import { body, onlyKeys, optString } from "./validate"

export interface RunOutcome {
  id: number
  project: string
  collector: string
  ok: boolean
  summary: string
  stats: Record<string, unknown>
  error: string | null
  startedAt: string
  finishedAt: string
}

export interface CollectError {
  project: string | null
  collector: string | null
  error: string
}

export interface CollectResponse {
  runs: RunOutcome[]
  errors: CollectError[]
}

const DEFAULT_DAYS = 10
const MAX_DAYS = 480

function failed(def: CollectorDefinition, message: string): CollectorResult {
  return {
    ok: false,
    kpi: [],
    summary: `${def.label}: ${message}`,
    stats: {},
    errors: [message],
  }
}

/**
 * Runs collectors and writes their results through the growth services (CONTRACT §7.2, §7.5).
 * Network calls happen outside any transaction; the results of one run are written in one short
 * BEGIN IMMEDIATE transaction together with the collector_runs row and one history entry.
 */
@Injectable()
export class CollectService {
  private readonly logger = new Logger("CollectService")
  /** Same project+collector already running in this process: callers share that run. */
  private readonly inflight = new Map<string, Promise<RunOutcome>>()

  constructor(
    private readonly database: DatabaseService,
    private readonly registry: CollectorRegistry,
    private readonly collectors: CollectorsService,
    private readonly kpi: KpiService,
    private readonly search: SearchService,
    private readonly audit: AuditService,
    private readonly geo: GeoService,
    private readonly store: StoreService
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  /** POST /collect {project?, collector?, days?}: every enabled collector matching the filter, one after another. */
  async collect(raw: unknown, actor: string): Promise<CollectResponse> {
    const input = body(raw ?? {})
    onlyKeys(input, ["project", "collector", "days"])
    const projectId = optString(input, "project") ?? undefined
    const collector = optString(input, "collector") ?? undefined
    const days = this.days(input.days)
    if (projectId) requireProject(this.ctx, projectId)
    if (collector) this.registry.get(collector, "INVALID")
    const pairs = this.collectors.enabledPairs(projectId, collector)
    const errors: CollectError[] = []
    if (pairs.length === 0 && (projectId || collector)) {
      errors.push({
        project: projectId ?? null,
        collector: collector ?? null,
        error: collector
          ? `Collector ${collector} ist ${projectId ? `für ${projectId} ` : ""}nicht eingeschaltet`
          : `Für ${projectId} ist kein Collector eingeschaltet`,
      })
    }
    const runs: RunOutcome[] = []
    for (const p of pairs) {
      const run = await this.runOne(p.projectId, p.collector, days, actor)
      runs.push(run)
      if (!run.ok)
        errors.push({
          project: run.project,
          collector: run.collector,
          error: run.error ?? run.summary,
        })
    }
    return { runs, errors }
  }

  /** POST /health-check {project?}: collector health directly (project given: even when disabled). */
  async healthCheck(raw: unknown, actor: string): Promise<CollectResponse> {
    const input = body(raw ?? {})
    onlyKeys(input, ["project"])
    const projectId = optString(input, "project") ?? undefined
    const targets = projectId
      ? [requireProject(this.ctx, projectId).id]
      : this.collectors
          .enabledPairs(undefined, "health")
          .map((p) => p.projectId)
    const runs: RunOutcome[] = []
    const errors: CollectError[] = []
    for (const id of targets) {
      const run = await this.runOne(id, "health", 1, actor)
      runs.push(run)
      if (!run.ok)
        errors.push({
          project: id,
          collector: "health",
          error: run.error ?? run.summary,
        })
    }
    return { runs, errors }
  }

  /** POST /audit/run {project}: collector audit directly, then the audit with diff. */
  async auditRun(raw: unknown, actor: string) {
    const input = body(raw)
    onlyKeys(input, ["project"])
    const projectId = optString(input, "project")
    if (!projectId) throw new VGError("INVALID", "project fehlt")
    requireProject(this.ctx, projectId)
    const run = await this.runOne(projectId, "audit", 1, actor)
    return { run, audit: this.audit.show(projectId, true) }
  }

  private days(v: unknown): number {
    if (v === undefined || v === null) return DEFAULT_DAYS
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_DAYS)
      throw new VGError(
        "INVALID",
        `days muss eine ganze Zahl 1–${MAX_DAYS} sein`
      )
    return v
  }

  /** One collector for one project; concurrent identical requests share the running call. */
  runOne(
    projectId: string,
    collector: string,
    days: number,
    actor: string,
    extra: { limit?: number } = {}
  ): Promise<RunOutcome> {
    const key = `${projectId}\u0000${collector}\u0000${extra.limit ?? ""}`
    const running = this.inflight.get(key)
    if (running) return running
    const promise = this.execute(
      projectId,
      collector,
      days,
      actor,
      extra
    ).finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  private async execute(
    projectId: string,
    collector: string,
    days: number,
    actor: string,
    extra: { limit?: number } = {}
  ): Promise<RunOutcome> {
    const def = this.registry.get(collector, "INVALID")
    const project = requireProject(this.ctx, projectId)
    const startedAt = nowIso()
    const config = this.collectors.effectiveConfig(project, def)
    const { secretsDir } = toolConfig()
    let result: CollectorResult
    if (def.secrets && !secretsDir) {
      result = failed(
        def,
        "Zugänge fehlen: secretsDir nicht konfiguriert (VIBEGROWTH_SECRETS_DIR oder secretsDir in der Config)"
      )
    } else {
      try {
        result = await def.run(collectorProject(project), config, {
          days,
          actor,
          secretsDir,
          ...this.runInputs(project, def, extra),
        })
      } catch (e) {
        result = failed(def, errorMessage(e))
      }
    }
    const finishedAt = nowIso()
    const outcome = this.database.tx(() =>
      this.write(project, def, result, { startedAt, finishedAt, actor })
    )
    this.logger.log(
      `${projectId}/${collector} ${outcome.ok ? "ok" : "Fehler"}: ${outcome.summary.slice(0, 160)}`
    )
    return outcome
  }

  /** Extra run inputs from the DB, read before the network part (no open transaction). */
  private runInputs(
    project: ProjectRow,
    def: CollectorDefinition,
    extra: { limit?: number }
  ) {
    if (def.id !== "geo-chatgpt") return {}
    const questions = this.ctx.db
      .select({ id: geoQuestions.id, text: geoQuestions.text })
      .from(geoQuestions)
      .where(
        and(
          eq(geoQuestions.projectId, project.id),
          eq(geoQuestions.active, true)
        )
      )
      .orderBy(asc(geoQuestions.id))
      .all()
    const peers: Record<string, Record<string, unknown>> = {}
    for (const id of ["play", "asc"]) {
      const peer = this.registry.find(id)
      if (peer) peers[id] = this.collectors.effectiveConfig(project, peer)
    }
    return { questions, peers, limit: extra.limit }
  }

  /** The only channel of a kind the collector serves (e.g. the website), else null. */
  private channelFor(projectId: string, def: CollectorDefinition) {
    if (!def.channelKinds.length) return null
    const rows = this.ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(
        and(
          eq(channels.projectId, projectId),
          inArray(channels.kind, def.channelKinds),
          ne(channels.status, "paused")
        )
      )
      .all()
    return rows.length === 1 ? rows[0].id : null
  }

  /** Inside tx: kpi_daily, search_daily, audit tables, geo_checks, store_reviews, collector_runs + history. */
  private write(
    project: ProjectRow,
    def: CollectorDefinition,
    result: CollectorResult,
    meta: { startedAt: string; finishedAt: string; actor: string }
  ): RunOutcome {
    const written: Record<string, unknown> = {}
    const ok = result.ok && result.errors.length === 0
    if (result.kpi.length) {
      const channelId = this.channelFor(project.id, def)
      const breakdown = result.kpi.filter((r) => r.dims !== "")
      // Window of a complete answer: breakdown rows that disappeared at the source are removed
      // (growth.py replaces GA4 event parameters from `start` on). Partial runs only replace
      // the metrics they returned; an empty answer never deletes.
      let replace: ReplaceWindow[] = []
      if (result.window && breakdown.length) {
        const sources = [...new Set(breakdown.map((r) => r.source))]
        replace = sources.map((source) => ({
          source,
          from: result.window!.from,
          to: result.window!.to,
          metrics: ok
            ? undefined
            : [
                ...new Set(
                  breakdown
                    .filter((r) => r.source === source)
                    .map((r) => r.metric)
                ),
              ],
        }))
      }
      const rows = result.kpi.map((r) => ({ ...r, channelId }))
      let changed = 0
      let removed = 0
      if (replace.length) {
        for (const w of replace) {
          const part = this.kpi.writeRows(
            project.id,
            rows.filter((r) => r.source === w.source),
            w
          )
          changed += part.changed
          removed += part.removed
        }
        const rest = rows.filter(
          (r) => !replace.some((w) => w.source === r.source)
        )
        if (rest.length) changed += this.kpi.writeRows(project.id, rest).changed
      } else {
        changed = this.kpi.writeRows(project.id, rows).changed
      }
      written.kpi = { rows: rows.length, changed, removed, channel: channelId }
    }
    if (result.search?.length) {
      const replace =
        ok && result.window
          ? { source: def.id, from: result.window.from, to: result.window.to }
          : undefined
      written.search = this.search.writeRows(
        project.id,
        result.search,
        replace && result.search.every((r) => r.source === def.id)
          ? replace
          : undefined
      )
    }
    if (result.audit) {
      written.audit = this.audit.writeRun(
        project.id,
        meta.finishedAt,
        result.audit
      )
    }
    // GeoService/StoreService open their own transaction: nested inside this one it is a savepoint.
    if (result.geoChecks?.length) {
      const r = this.geo.recordChecks(
        result.geoChecks.map((c) => ({ ...c, projectId: project.id })),
        meta.actor
      )
      written.geo = {
        inserted: r.inserted,
        updated: r.updated,
        mentionTargets: {
          created: r.mentionTargets.created.length,
          updated: r.mentionTargets.updated,
        },
      }
    }
    if (result.storeReviews?.length) {
      written.reviews = this.store.upsertReviews(
        result.storeReviews.map((r) => ({ ...r, projectId: project.id })),
        meta.actor
      )
    }
    const error = result.errors.length ? result.errors.join("; ") : null
    const stats = {
      ...result.stats,
      ...(result.window ? { window: result.window } : {}),
      written,
    }
    const run = this.collectors.recordRun({
      projectId: project.id,
      collector: def.id,
      startedAt: meta.startedAt,
      finishedAt: meta.finishedAt,
      ok,
      summary: result.summary,
      error,
      stats,
      actor: meta.actor,
    })
    return {
      id: run.id,
      project: project.id,
      collector: def.id,
      ok,
      summary: result.summary,
      stats,
      error,
      startedAt: meta.startedAt,
      finishedAt: meta.finishedAt,
    }
  }
}

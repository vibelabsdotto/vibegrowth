import { Injectable } from "@nestjs/common"
import { and, desc, eq, type InferSelectModel } from "drizzle-orm"
import type {
  CollectorDefinition,
  CollectorProject,
} from "../../collectors/collector"
import { CollectorRegistry } from "../../collectors/registry"
import type { ConfigField } from "../../collectors/sources"
import { collectorRuns, collectors, projects } from "../../core/schema"
import { json, nowIso, recordHistory, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { requireProject, type ProjectRow } from "./rows"
import {
  body,
  isPlainObject,
  jsonObject,
  mergeConfig,
  onlyKeys,
  optBool,
  optObject,
} from "./validate"

type RunRow = InferSelectModel<typeof collectorRuns>

export function runView(r: RunRow) {
  return {
    id: r.id,
    project: r.projectId,
    collector: r.collector,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    ok: r.ok,
    summary: r.summary,
    error: r.error,
    stats: jsonObject(r.stats),
    actor: r.actor,
  }
}
export type RunView = ReturnType<typeof runView>

export interface LastRun {
  id: number
  startedAt: string
  finishedAt: string | null
  ok: boolean | null
  summary: string | null
  error: string | null
}

function lastRunView(r: RunRow | undefined): LastRun | null {
  if (!r) return null
  return {
    id: r.id,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    ok: r.ok,
    summary: r.summary,
    error: r.error,
  }
}

function typeOk(field: ConfigField, v: unknown): boolean {
  switch (field.type) {
    case "string":
      return typeof v === "string"
    case "number":
      return typeof v === "number" && Number.isFinite(v)
    case "string[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string")
    case "array":
      return Array.isArray(v)
    case "object":
      return isPlainObject(v)
  }
}

export function collectorProject(row: ProjectRow): CollectorProject {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind,
    language: row.language,
    workspace: row.workspace,
    config: jsonObject(row.config),
  }
}

/** Collector configuration per project and the run log (tables collectors, collector_runs). */
@Injectable()
export class CollectorsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: CollectorRegistry
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  private row(projectId: string, collector: string) {
    return this.ctx.db
      .select()
      .from(collectors)
      .where(
        and(
          eq(collectors.projectId, projectId),
          eq(collectors.collector, collector)
        )
      )
      .get()
  }

  lastRun(projectId: string, collector: string): LastRun | null {
    return lastRunView(
      this.ctx.db
        .select()
        .from(collectorRuns)
        .where(
          and(
            eq(collectorRuns.projectId, projectId),
            eq(collectorRuns.collector, collector)
          )
        )
        .orderBy(desc(collectorRuns.startedAt), desc(collectorRuns.id))
        .limit(1)
        .get()
    )
  }

  /** Stored config merged over the defaults derived from the project (e.g. url). */
  effectiveConfig(project: ProjectRow, def: CollectorDefinition) {
    const stored = jsonObject(this.row(project.id, def.id)?.config)
    return { ...(def.defaults?.(collectorProject(project)) ?? {}), ...stored }
  }

  isEnabled(projectId: string, collector: string): boolean {
    return this.row(projectId, collector)?.enabled ?? false
  }

  /** Enabled (project, collector) pairs; without projectId only projects that are not archived. */
  enabledPairs(projectId?: string, collector?: string) {
    const q = this.ctx.db
      .select({
        projectId: collectors.projectId,
        collector: collectors.collector,
        status: projects.status,
      })
      .from(collectors)
      .innerJoin(projects, eq(projects.id, collectors.projectId))
      .where(
        and(
          eq(collectors.enabled, true),
          projectId ? eq(collectors.projectId, projectId) : undefined,
          collector ? eq(collectors.collector, collector) : undefined
        )
      )
      .all()
    const order = this.registry.ids()
    return q
      .filter((p) => projectId || p.status !== "archived")
      .filter((p) => this.registry.find(p.collector))
      .sort(
        (a, b) =>
          a.projectId.localeCompare(b.projectId) ||
          order.indexOf(a.collector) - order.indexOf(b.collector)
      )
  }

  /** All collector types for one project (or every non-archived project) with config, schema and last run. */
  list(projectId?: string) {
    const rows = projectId
      ? [requireProject(this.ctx, projectId)]
      : this.ctx.db
          .select()
          .from(projects)
          .all()
          .filter((p) => p.status !== "archived")
          .sort((a, b) => a.id.localeCompare(b.id))
    return rows.flatMap((p) =>
      this.registry.list().map((def) => {
        const row = this.row(p.id, def.id)
        return {
          project: p.id,
          collector: def.id,
          label: def.label,
          channelKinds: def.channelKinds,
          enabled: row?.enabled ?? false,
          config: jsonObject(row?.config),
          defaults: def.defaults?.(collectorProject(p)) ?? {},
          configSchema: def.configSchema,
          secrets: def.secrets,
          lastRun: this.lastRun(p.id, def.id),
          updatedAt: row?.updatedAt ?? null,
        }
      })
    )
  }

  /** Short form for projects show: every type with enabled and last run. */
  summary(projectId: string) {
    return this.registry.list().map((def) => ({
      collector: def.id,
      label: def.label,
      enabled: this.row(projectId, def.id)?.enabled ?? false,
      lastRun: this.lastRun(projectId, def.id),
    }))
  }

  private validateConfig(
    def: CollectorDefinition,
    config: Record<string, unknown>
  ) {
    const schema = def.configSchema
    const unknown = Object.keys(config).filter((k) => !(k in schema))
    if (unknown.length)
      throw new VGError(
        "INVALID",
        `${def.id}: unbekannte Konfiguration ${unknown.join(", ")} (erlaubt: ${Object.keys(schema).join(", ") || "keine"})`
      )
    for (const [k, v] of Object.entries(config)) {
      if (v === null) continue
      if (!typeOk(schema[k], v))
        throw new VGError(
          "INVALID",
          `${def.id}: ${k} muss vom Typ ${schema[k].type} sein`
        )
    }
  }

  /** PUT /collectors/:project/:collector — config is merged, null removes a key. */
  set(projectId: string, collector: string, raw: unknown, actor: string) {
    const def = this.registry.get(collector)
    const input = body(raw)
    onlyKeys(input, ["enabled", "config"])
    const enabled = optBool(input, "enabled")
    const patch = optObject(input, "config")
    if (enabled === undefined && patch === undefined)
      throw new VGError("INVALID", "enabled oder config angeben")
    if (patch) this.validateConfig(def, patch)
    this.database.tx(() => {
      requireProject(this.ctx, projectId)
      const row = this.row(projectId, collector)
      const before = {
        enabled: row?.enabled ?? false,
        config: jsonObject(row?.config),
      }
      const after = {
        enabled: enabled ?? before.enabled,
        config: patch ? mergeConfig(before.config, patch) : before.config,
      }
      const changed: string[] = []
      if (after.enabled !== before.enabled) changed.push("enabled")
      if (json(after.config) !== json(before.config)) changed.push("config")
      if (row && changed.length === 0) return
      if (row) {
        this.ctx.db
          .update(collectors)
          .set({
            enabled: after.enabled,
            config: json(after.config),
            updatedAt: nowIso(),
          })
          .where(
            and(
              eq(collectors.projectId, projectId),
              eq(collectors.collector, collector)
            )
          )
          .run()
      } else {
        this.ctx.db
          .insert(collectors)
          .values({
            projectId,
            collector,
            enabled: after.enabled,
            config: json(after.config),
          })
          .run()
      }
      const pick = (o: Record<string, unknown>) =>
        Object.fromEntries(changed.map((k) => [k, o[k]]))
      recordHistory(this.ctx, {
        actor,
        entity: "collector",
        entityId: `${projectId}:${collector}`,
        action: row ? "update" : "create",
        before: row ? pick(before) : undefined,
        after: row ? pick(after) : after,
      })
    })
    return this.list(projectId).find((c) => c.collector === collector)!
  }

  runs(filter: {
    project?: string
    collector?: string
    limit: number
    ok?: boolean
  }): RunView[] {
    if (filter.project) requireProject(this.ctx, filter.project)
    if (filter.collector) this.registry.get(filter.collector, "INVALID")
    return this.ctx.db
      .select()
      .from(collectorRuns)
      .where(
        and(
          filter.project
            ? eq(collectorRuns.projectId, filter.project)
            : undefined,
          filter.collector
            ? eq(collectorRuns.collector, filter.collector)
            : undefined,
          filter.ok === undefined ? undefined : eq(collectorRuns.ok, filter.ok)
        )
      )
      .orderBy(desc(collectorRuns.startedAt), desc(collectorRuns.id))
      .limit(filter.limit)
      .all()
      .map(runView)
  }

  /** Inside the caller's tx: one collector_runs row plus exactly one history entry per run. */
  recordRun(run: {
    projectId: string
    collector: string
    startedAt: string
    finishedAt: string
    ok: boolean
    summary: string
    error: string | null
    stats: Record<string, unknown>
    actor: string
  }): RunView {
    const inserted = this.ctx.db
      .insert(collectorRuns)
      .values({ ...run, stats: json(run.stats) })
      .returning()
      .get()
    recordHistory(this.ctx, {
      actor: run.actor,
      entity: "collector_run",
      entityId: inserted.id,
      action: "collect",
      after: {
        project: run.projectId,
        collector: run.collector,
        ok: run.ok,
        summary: run.summary,
        error: run.error,
        written: run.stats.written,
      },
    })
    return runView(inserted)
  }
}

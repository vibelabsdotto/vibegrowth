import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Injectable } from "@nestjs/common"
import { and, eq, inArray, ne } from "drizzle-orm"
import { CollectorRegistry } from "../../collectors/registry"
import { addLearning } from "../../core/knowledge"
import {
  accounts,
  auditIssues,
  auditPages,
  auditRuns,
  backlogItems,
  changes,
  channels,
  collectorRuns,
  collectors,
  contentItems,
  experiments,
  geoChecks,
  geoQuestions,
  learnings,
  projects,
} from "../../core/schema"
import {
  json,
  nowIso,
  parseJson,
  patchRow,
  recordHistory,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { KpiService } from "../data/kpi.service"
import { SearchService } from "../data/search.service"
import { GeoService, type GeoCheckInput } from "../work/geo.service"
import { MAPPING } from "./mapping-manifest"
import {
  dimsKey,
  healthKpi,
  isoFromLocal,
  KpiBag,
  PLAY_OVERVIEW,
  PLAY_PERFORMANCE,
  PSI_METRICS,
  psiUrl,
  splitRun,
  type KpiOut,
  type SearchOut,
} from "./mapping"
import {
  GrowthDb,
  isObject,
  KNOWN_TABLES,
  num,
  parseJsonText,
  readReadme,
  readSites,
  str,
  strList,
  text,
  type Row,
  type SiteConfig,
} from "./source"
import { hash, parseBacklog, parseIdeas, parseLearnings } from "./workspace"

const SITE_KEYS = new Set([
  "name",
  "url",
  "language",
  "gsc_property",
  "ga4_property",
  "repo",
  "workspace",
  "coolify_app",
  "health_path",
  "key_paths",
  "brand_patterns",
  "brand_patterns_ambiguous",
  "brand_context",
  "ai_prompts",
  "seed_keywords",
  "audit_ignore",
  "app",
  "stores",
  "ga_event_params",
])
const APP_KEYS = new Set([
  "ga4_property",
  "firebase_project",
  "repo",
  "funnel_events",
  "key_events",
  "event_dimensions",
  "user_dimensions",
])
const STORE_KEYS: Record<string, Set<string>> = {
  google_play: new Set(["package", "gcs_bucket"]),
  app_store: new Set(["app_id", "provider_id", "asc_profile"]),
}

/** actions.kind → changes.kind (CONTRACT §6). */
const CHANGE_KIND: Record<string, string> = {
  deploy: "deploy",
  indexing: "seo",
  seo: "seo",
  analytics: "config",
  tracking: "config",
  config: "config",
  cron: "config",
  content: "content",
  store: "store",
  tooling: "other",
  system: "other",
  measure: "other",
  other: "other",
}

/** kpi source → channel kinds (like the collectors' channelKinds). */
const SOURCE_CHANNEL_KINDS: Record<string, string[]> = {
  gsc: ["website"],
  ga4: ["website"],
  bing: ["website"],
  psi: ["website"],
  health: ["website"],
  play: ["android"],
  asc: ["ios"],
  app: ["ios", "android"],
}

const SOURCE_LABEL = "Website-Growth README"

type Counter = Record<string, number>

class Report {
  imported: Counter = {}
  updated: Counter = {}
  unchanged: Counter = {}
  skipped: Record<string, Counter> = {}
  warnings: string[] = []
  sourceRows: Counter = {}

  add(map: Counter, table: string, n = 1) {
    if (n) map[table] = (map[table] ?? 0) + n
  }
  imp(table: string, n = 1) {
    this.add(this.imported, table, n)
  }
  upd(table: string, n = 1) {
    this.add(this.updated, table, n)
  }
  same(table: string, n = 1) {
    this.add(this.unchanged, table, n)
  }
  skip(table: string, reason: string, n = 1) {
    if (!n) return
    const t = (this.skipped[table] ??= {})
    t[reason] = (t[reason] ?? 0) + n
  }
  warn(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg)
  }
}

export interface ImportInput {
  db: string
  sites: string
  workspaceRoot?: string
}

function expand(p: string) {
  const t = p.trim()
  return path.resolve(
    t === "~"
      ? os.homedir()
      : t.startsWith("~/")
        ? path.join(os.homedir(), t.slice(2))
        : t
  )
}

function parseInput(raw: unknown): ImportInput {
  if (!isObject(raw))
    throw new VGError("INVALID", "Body muss ein JSON-Objekt sein")
  const extra = Object.keys(raw).filter(
    (k) => !["db", "sites", "workspaceRoot"].includes(k)
  )
  if (extra.length)
    throw new VGError(
      "INVALID",
      `Unbekannte Felder: ${extra.join(", ")} (erlaubt: db, sites, workspaceRoot)`
    )
  const db = str(raw.db)
  const sites = str(raw.sites)
  if (!db) throw new VGError("INVALID", "db fehlt (Pfad zu growth.db)")
  if (!sites) throw new VGError("INVALID", "sites fehlt (Pfad zu sites.json)")
  const input: ImportInput = { db: expand(db), sites: expand(sites) }
  if (!fs.existsSync(input.db))
    throw new VGError("NOT_FOUND", `growth.db nicht gefunden: ${input.db}`)
  if (!fs.existsSync(input.sites))
    throw new VGError("NOT_FOUND", `sites.json nicht gefunden: ${input.sites}`)
  if (raw.workspaceRoot !== undefined && raw.workspaceRoot !== null) {
    const root = str(raw.workspaceRoot)
    if (!root) throw new VGError("INVALID", "workspaceRoot muss ein Pfad sein")
    input.workspaceRoot = expand(root)
    if (
      !fs
        .statSync(input.workspaceRoot, { throwIfNoEntry: false })
        ?.isDirectory()
    )
      throw new VGError(
        "NOT_FOUND",
        `workspaceRoot ist kein Ordner: ${input.workspaceRoot}`
      )
  }
  return input
}

/**
 * Idempotent import of the website-growth system (CONTRACT §7, lane import-growth): sites.json →
 * projects/channels/collectors/geo_questions, growth.db → runs, kpi, search, audit, geo, changes,
 * experiments, workspace Markdown → backlog/content, README → learnings. Sources are only read.
 * Every row carries a deterministic source_key (or its natural key); existing rows are never
 * overwritten, except measurements in kpi_daily/search_daily (upsert on the primary key).
 */
@Injectable()
export class GrowthImportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly kpi: KpiService,
    private readonly search: SearchService,
    private readonly geo: GeoService,
    private readonly registry: CollectorRegistry
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  run(raw: unknown, actor: string) {
    const input = parseInput(raw)
    const sites = readSites(input.sites)
    const src = new GrowthDb(input.db)
    const report = new Report()
    try {
      for (const t of src.tables) {
        report.sourceRows[t.name] = t.rows
        const known = KNOWN_TABLES[t.name]
        if (!known) {
          report.warn(
            `Unbekannte Tabelle ${t.name} (${t.rows} Zeilen) in growth.db: nicht übernommen`
          )
          report.skip(t.name, "unbekannte Tabelle", t.rows)
          continue
        }
        const extra = t.columns.filter((c) => !known.includes(c))
        if (extra.length)
          report.warn(
            `Tabelle ${t.name}: unbekannte Spalten ${extra.join(", ")} nicht übernommen`
          )
      }
      this.database.tx(() => {
        this.importSites(sites, input, report, actor)
        this.importRuns(src, report, actor)
        this.importMeasurements(src, report, actor)
        const expIds = this.importExperiments(src, report, actor)
        this.importActions(src, expIds, report, actor)
        this.importAiChecks(src, sites, report, actor)
        if (input.workspaceRoot) {
          this.importWorkspaces(sites, input.workspaceRoot, report, actor)
          this.importLearnings(input.sites, sites, report, actor)
        }
        recordHistory(this.ctx, {
          actor,
          entity: "import",
          entityId: "growth",
          action: "import",
          after: {
            db: input.db,
            sites: input.sites,
            workspaceRoot: input.workspaceRoot ?? null,
            imported: report.imported,
            updated: report.updated,
            skipped: report.skipped,
            warnings: report.warnings.length,
          },
        })
      })
    } finally {
      src.close()
    }
    return {
      source: {
        db: input.db,
        sites: input.sites,
        workspaceRoot: input.workspaceRoot ?? null,
        rows: report.sourceRows,
      },
      imported: report.imported,
      updated: report.updated,
      unchanged: report.unchanged,
      skipped: report.skipped,
      warnings: report.warnings,
      mapping: MAPPING,
    }
  }

  // ---------- helpers ----------

  private projectExists(id: string) {
    return !!this.ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, id))
      .get()
  }

  /** The only non-paused channel of the given kinds (like CollectService.channelFor), else null. */
  private channelFor(projectId: string, kinds: string[] | undefined) {
    if (!kinds?.length) return null
    const rows = this.ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(
        and(
          eq(channels.projectId, projectId),
          inArray(channels.kind, kinds),
          ne(channels.status, "paused")
        )
      )
      .all()
    return rows.length === 1 ? rows[0].id : null
  }

  private siteProject(site: unknown, table: string, report: Report) {
    const id = str(site)
    if (id && this.projectExists(id)) return id
    report.skip(table, `Site ${id ?? "(leer)"} ohne Projekt`)
    return null
  }

  // ---------- sites.json ----------

  private importSites(
    sites: Record<string, SiteConfig>,
    input: ImportInput,
    report: Report,
    actor: string
  ) {
    for (const [id, s] of Object.entries(sites)) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
        report.warn(
          `sites.json: Site-Key ${id} ist keine gültige Projekt-ID, übersprungen`
        )
        report.skip("projects", "ungültiger Site-Key")
        continue
      }
      for (const k of Object.keys(s))
        if (!SITE_KEYS.has(k))
          report.warn(`sites.json ${id}.${k}: nicht zugeordnet`)
      const app = isObject(s.app) ? s.app : null
      const stores = isObject(s.stores) ? s.stores : null
      for (const k of Object.keys(app ?? {}))
        if (!APP_KEYS.has(k))
          report.warn(`sites.json ${id}.app.${k}: nicht zugeordnet`)
      for (const [store, cfg] of Object.entries(stores ?? {})) {
        const known = STORE_KEYS[store]
        if (!known)
          report.warn(`sites.json ${id}.stores.${store}: nicht zugeordnet`)
        else
          for (const k of Object.keys(isObject(cfg) ? cfg : {}))
            if (!known.has(k))
              report.warn(
                `sites.json ${id}.stores.${store}.${k}: nicht zugeordnet`
              )
      }
      this.upsertProject(id, s, app, stores, input, report, actor)
      this.upsertChannels(id, s, stores, report, actor)
      this.upsertCollectors(id, s, app, stores, report, actor)
      this.importQuestions(id, s, report, actor)
    }
  }

  private upsertProject(
    id: string,
    s: SiteConfig,
    app: Record<string, unknown> | null,
    stores: Record<string, unknown> | null,
    input: ImportInput,
    report: Report,
    actor: string
  ) {
    const url = str(s.url)
    if (url && !/^https?:\/\/[^/\s]+/.test(url))
      report.warn(`sites.json ${id}.url ist keine http(s)-URL: ${url}`)
    let workspace = str(s.workspace)
    if (!workspace && input.workspaceRoot) {
      const dir = path.join(input.workspaceRoot, id)
      if (fs.existsSync(dir)) workspace = dir
    }
    const config: Record<string, unknown> = {}
    const seeds = strList(s.seed_keywords)
    if (seeds.length) config.seedKeywords = seeds
    if (str(s.coolify_app)) config.coolifyApp = str(s.coolify_app)
    if (app && str(app.repo)) config.appRepo = str(app.repo)
    const values = {
      name: str(s.name) ?? id,
      url: url && /^https?:\/\//.test(url) ? url : null,
      kind: app || stores ? "app" : "website",
      language: str(s.language),
      repo: str(s.repo),
      workspace,
    }
    const row = this.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .get()
    if (!row) {
      this.ctx.db
        .insert(projects)
        .values({ id, ...values, status: "active", config: json(config) })
        .run()
      recordHistory(this.ctx, {
        actor,
        entity: "project",
        entityId: id,
        action: "create",
        after: { id, ...values, config },
      })
      report.imp("projects")
      return
    }
    const patch: Record<string, unknown> = {}
    for (const k of ["url", "language", "repo", "workspace"] as const)
      if (!row[k] && values[k]) patch[k] = values[k]
    const current = parseJson<Record<string, unknown>>(row.config, {})
    const missing = Object.fromEntries(
      Object.entries(config).filter(([k]) => current[k] === undefined)
    )
    if (Object.keys(missing).length)
      patch.config = json({ ...current, ...missing })
    if (Object.keys(patch).length) {
      patchRow(this.ctx, projects, "project", id, patch, actor)
      report.upd("projects")
    } else report.same("projects")
  }

  private upsertChannels(
    id: string,
    s: SiteConfig,
    stores: Record<string, unknown> | null,
    report: Report,
    actor: string
  ) {
    const name = str(s.name) ?? id
    const wanted: {
      id: string
      kind: string
      name: string
      url: string | null
      externalId: string | null
    }[] = []
    const url = str(s.url)
    if (url)
      wanted.push({
        id: `${id}-web`,
        kind: "website",
        name: `${name} Website`,
        url,
        externalId: null,
      })
    const ios = isObject(stores?.app_store) ? stores.app_store : null
    const appId = ios ? str(ios.app_id) : null
    if (appId)
      wanted.push({
        id: `${id}-ios`,
        kind: "ios",
        name: `${name} iOS`,
        url: `https://apps.apple.com/app/id${appId}`,
        externalId: appId,
      })
    const play = isObject(stores?.google_play) ? stores.google_play : null
    const pkg = play ? str(play.package) : null
    if (pkg)
      wanted.push({
        id: `${id}-android`,
        kind: "android",
        name: `${name} Android`,
        url: `https://play.google.com/store/apps/details?id=${pkg}`,
        externalId: pkg,
      })
    for (const w of wanted) {
      const row = this.ctx.db
        .select()
        .from(channels)
        .where(eq(channels.id, w.id))
        .get()
      if (!row) {
        const account = this.ctx.db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, w.id))
          .get()
        if (account) {
          report.warn(`Kanal ${w.id}: ID gehört einem Account, nicht angelegt`)
          report.skip("channels", "ID belegt (Account)")
          continue
        }
        const values = {
          ...w,
          projectId: id,
          status: "active",
          handle: null,
          notes: null,
        }
        this.ctx.db.insert(channels).values(values).run()
        recordHistory(this.ctx, {
          actor,
          entity: "channel",
          entityId: w.id,
          action: "create",
          after: values,
        })
        report.imp("channels")
        continue
      }
      if (row.projectId !== id) {
        report.warn(
          `Kanal ${w.id} gehört zu Projekt ${row.projectId}, nicht geändert`
        )
        report.skip("channels", "gehört zu anderem Projekt")
        continue
      }
      const patch: Record<string, unknown> = {}
      if (!row.name) patch.name = w.name
      if (!row.url && w.url) patch.url = w.url
      if (!row.externalId && w.externalId) patch.externalId = w.externalId
      if (Object.keys(patch).length) {
        patchRow(this.ctx, channels, "channel", w.id, patch, actor)
        report.upd("channels")
      } else report.same("channels")
    }
  }

  private upsertCollectors(
    id: string,
    s: SiteConfig,
    app: Record<string, unknown> | null,
    stores: Record<string, unknown> | null,
    report: Report,
    actor: string
  ) {
    const url = str(s.url)
    const play = isObject(stores?.google_play) ? stores.google_play : null
    const ios = isObject(stores?.app_store) ? stores.app_store : null
    const prompts = strList(s.ai_prompts)
    const eventParams = isObject(s.ga_event_params) ? s.ga_event_params : null
    const auditIgnore = Array.isArray(s.audit_ignore) ? s.audit_ignore : null
    const plan: {
      collector: string
      enabled: boolean
      config: Record<string, unknown>
    }[] = [
      {
        collector: "health",
        enabled: !!url,
        config: { url, path: str(s.health_path) },
      },
      {
        collector: "audit",
        enabled: !!url,
        config: {
          url,
          keyPaths: strList(s.key_paths).length ? strList(s.key_paths) : null,
          ignore: auditIgnore,
        },
      },
      {
        collector: "gsc",
        enabled: !!str(s.gsc_property),
        config: { property: str(s.gsc_property) },
      },
      {
        collector: "ga4",
        enabled: !!str(s.ga4_property),
        config: { property: str(s.ga4_property), eventParams },
      },
      {
        collector: "bing",
        enabled: !!url,
        config: { url: url ? psiUrl(url) : null },
      },
      { collector: "psi", enabled: !!url, config: { url } },
      {
        collector: "app",
        enabled: !!(app && str(app.ga4_property)),
        config: app
          ? {
              ga4Property: str(app.ga4_property),
              firebaseProject: str(app.firebase_project),
              funnelEvents: strList(app.funnel_events),
              keyEvents: strList(app.key_events),
              eventDimensions: strList(app.event_dimensions),
              userDimensions: strList(app.user_dimensions),
            }
          : {},
      },
      {
        collector: "play",
        enabled: !!(play && str(play.gcs_bucket) && str(play.package)),
        config: play
          ? { package: str(play.package), gcsBucket: str(play.gcs_bucket) }
          : {},
      },
      {
        collector: "asc",
        enabled: !!(ios && str(ios.asc_profile) && str(ios.app_id)),
        config: ios
          ? {
              appId: str(ios.app_id),
              providerId: str(ios.provider_id),
              profile: str(ios.asc_profile),
            }
          : {},
      },
      {
        collector: "geo-chatgpt",
        enabled: prompts.length > 0,
        config: {
          brandPatterns: strList(s.brand_patterns),
          brandPatternsAmbiguous: strList(s.brand_patterns_ambiguous),
          brandContext: str(s.brand_context),
        },
      },
    ]
    const unmapped: Record<string, Record<string, unknown>> = {}
    for (const p of plan) {
      const def = this.registry.find(p.collector)
      if (!def) {
        report.warn(
          `Collector ${p.collector} nicht registriert, Konfiguration nicht übernommen`
        )
        report.skip("collectors", "Collector nicht registriert")
        continue
      }
      const config: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(p.config)) {
        if (v === null || v === undefined || (Array.isArray(v) && !v.length))
          continue
        if (!(k in def.configSchema)) {
          ;(unmapped[p.collector] ??= {})[k] = v
          report.warn(
            `Collector ${p.collector}: Feld ${k} nicht im configSchema, in projects.config.collectorExtras abgelegt`
          )
          continue
        }
        config[k] = v
      }
      if (!Object.keys(config).length && !p.enabled) continue
      const row = this.ctx.db
        .select()
        .from(collectors)
        .where(
          and(
            eq(collectors.projectId, id),
            eq(collectors.collector, p.collector)
          )
        )
        .get()
      if (!row) {
        this.ctx.db
          .insert(collectors)
          .values({
            projectId: id,
            collector: p.collector,
            enabled: p.enabled,
            config: json(config),
          })
          .run()
        recordHistory(this.ctx, {
          actor,
          entity: "collector",
          entityId: `${id}:${p.collector}`,
          action: "create",
          after: { enabled: p.enabled, config },
        })
        report.imp("collectors")
        continue
      }
      const current = parseJson<Record<string, unknown>>(row.config, {})
      const missing = Object.fromEntries(
        Object.entries(config).filter(([k]) => current[k] === undefined)
      )
      if (!Object.keys(missing).length) {
        report.same("collectors")
        continue
      }
      const next = { ...current, ...missing }
      this.ctx.db
        .update(collectors)
        .set({ config: json(next), updatedAt: nowIso() })
        .where(
          and(
            eq(collectors.projectId, id),
            eq(collectors.collector, p.collector)
          )
        )
        .run()
      recordHistory(this.ctx, {
        actor,
        entity: "collector",
        entityId: `${id}:${p.collector}`,
        action: "update",
        before: { config: current },
        after: { config: next },
      })
      report.upd("collectors")
    }
    if (Object.keys(unmapped).length) {
      const row = this.ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .get()
      const current = parseJson<Record<string, unknown>>(row?.config, {})
      const extras = isObject(current.collectorExtras)
        ? current.collectorExtras
        : {}
      const next: Record<string, unknown> = { ...extras }
      let changed = false
      for (const [c, fields] of Object.entries(unmapped)) {
        const have = isObject(next[c]) ? next[c] : {}
        const add = Object.fromEntries(
          Object.entries(fields).filter(([k]) => have[k] === undefined)
        )
        if (Object.keys(add).length) {
          next[c] = { ...have, ...add }
          changed = true
        }
      }
      if (changed)
        patchRow(
          this.ctx,
          projects,
          "project",
          id,
          { config: json({ ...current, collectorExtras: next }) },
          actor
        )
    }
  }

  private importQuestions(
    id: string,
    s: SiteConfig,
    report: Report,
    actor: string
  ) {
    for (const text of strList(s.ai_prompts).map((t) => t.trim())) {
      const exists = this.ctx.db
        .select({ id: geoQuestions.id })
        .from(geoQuestions)
        .where(and(eq(geoQuestions.projectId, id), eq(geoQuestions.text, text)))
        .get()
      if (exists) {
        report.same("geo_questions")
        continue
      }
      this.geo.addQuestion(
        {
          projectId: id,
          text,
          active: true,
          sourceKey: `wg:sites:${id}:ai_prompts:${hash(text)}`,
        },
        actor
      )
      report.imp("geo_questions")
    }
  }

  // ---------- runs → collector_runs, audit ----------

  private importRuns(src: GrowthDb, report: Report, actor: string) {
    const runs = src.rows("runs", "id")
    const issues = src.rows("audit_issues")
    const pages = src.rows("audit_pages")
    const auditRunIds = new Set(
      runs.filter((r) => r.kind === "audit").map((r) => Number(r.id))
    )
    const orphanIssues = issues.filter(
      (i) => !auditRunIds.has(Number(i.run_id))
    ).length
    const orphanPages = pages.filter(
      (p) => !auditRunIds.has(Number(p.run_id))
    ).length
    report.skip("audit_issues", "Lauf fehlt in runs", orphanIssues)
    report.skip("audit_pages", "Lauf fehlt in runs", orphanPages)
    const perProject = new Map<string, { runs: number; audits: number }>()
    for (const r of runs) {
      const projectId = this.siteProject(r.site, "collector_runs", report)
      if (!projectId) continue
      const split = splitRun(r)
      if (split.unassignedErrors.length)
        report.warn(
          `runs #${String(r.id)}: Fehler ohne erkennbare Quelle allen Teilläufen zugeordnet: ${split.unassignedErrors.join("; ").slice(0, 160)}`
        )
      if (split.skipped) report.skip("collector_runs", split.skipped)
      const stat = perProject.get(projectId) ?? { runs: 0, audits: 0 }
      for (const run of split.runs) {
        const exists = this.ctx.db
          .select({ id: collectorRuns.id })
          .from(collectorRuns)
          .where(eq(collectorRuns.sourceKey, run.key))
          .get()
        if (exists) {
          report.same("collector_runs")
          continue
        }
        this.ctx.db
          .insert(collectorRuns)
          .values({
            projectId,
            collector: run.collector,
            startedAt: run.startedAt,
            finishedAt: run.startedAt,
            ok: run.ok,
            summary: run.summary,
            error: run.error,
            stats: json(run.stats),
            actor,
            sourceKey: run.key,
          })
          .run()
        report.imp("collector_runs")
        stat.runs++
      }
      if (r.kind === "audit") {
        const runId = Number(r.id)
        const key = `wg:runs:${runId}`
        const runIssues = issues.filter((i) => Number(i.run_id) === runId)
        const runPages = pages.filter((p) => Number(p.run_id) === runId)
        const exists = this.ctx.db
          .select({ id: auditRuns.id })
          .from(auditRuns)
          .where(eq(auditRuns.sourceKey, key))
          .get()
        if (exists) {
          report.same("audit_runs")
          report.same("audit_issues", runIssues.length)
          report.same("audit_pages", runPages.length)
          perProject.set(projectId, stat)
          continue
        }
        const summary = parseJsonText(r.summary, {})
        const at = isoFromLocal(r.ts)
        if (!at) {
          report.skip("audit_runs", "Zeitstempel ungültig")
          continue
        }
        const inserted = this.ctx.db
          .insert(auditRuns)
          .values({
            projectId,
            at,
            pages:
              (isObject(summary) ? num(summary.pages) : null) ??
              runPages.length,
            ok: Number(r.ok) === 1,
            sourceKey: key,
          })
          .returning({ id: auditRuns.id })
          .get()
        report.imp("audit_runs")
        stat.audits++
        for (const i of runIssues) {
          const raw = str(i.severity) ?? ""
          const severity = raw === "warn" ? "warning" : raw
          if (!["error", "warning", "info"].includes(severity)) {
            report.warn(`audit_issues: unbekannte severity ${raw}`)
            report.skip("audit_issues", `unbekannte severity ${raw}`)
            continue
          }
          this.ctx.db
            .insert(auditIssues)
            .values({
              runId: inserted.id,
              projectId,
              url: str(i.url) ?? "",
              code: str(i.code) ?? "",
              severity,
              detail: str(i.detail),
            })
            .run()
          report.imp("audit_issues")
        }
        const seen = new Set<string>()
        for (const p of runPages) {
          const url = str(p.url) ?? ""
          if (seen.has(url)) {
            report.skip("audit_pages", "doppelte URL im Lauf")
            continue
          }
          seen.add(url)
          const data = parseJsonText(p.data, {})
          this.ctx.db
            .insert(auditPages)
            .values({
              runId: inserted.id,
              projectId,
              url,
              data: json(isObject(data) ? data : {}),
            })
            .run()
          report.imp("audit_pages")
        }
      }
      perProject.set(projectId, stat)
    }
    for (const [projectId, stat] of perProject) {
      if (!stat.runs && !stat.audits) continue
      recordHistory(this.ctx, {
        actor,
        entity: "collector_runs",
        entityId: projectId,
        action: "import",
        after: {
          collectorRuns: stat.runs,
          auditRuns: stat.audits,
          source: "website-growth runs",
        },
      })
    }
  }

  // ---------- measurements → kpi_daily, search_daily ----------

  private importMeasurements(src: GrowthDb, report: Report, actor: string) {
    const direct = new Map<string, KpiBag>()
    const derived = new Map<string, KpiBag>()
    const search = new Map<string, Map<string, SearchOut>>()
    const bag = (m: Map<string, KpiBag>, p: string) => {
      const b = m.get(p) ?? new KpiBag()
      m.set(p, b)
      return b
    }
    const put = (p: string, r: SearchOut) => {
      const m = search.get(p) ?? new Map<string, SearchOut>()
      m.set(`${r.source}\u0000${r.date}\u0000${r.query}\u0000${r.page}`, r)
      search.set(p, m)
    }
    const value = (table: string, v: unknown) => {
      const n = num(v)
      if (n === null) report.skip(table, "Messwert leer")
      return n
    }

    for (const r of src.rows("gsc_totals")) {
      const p = this.siteProject(r.site, "gsc_totals", report)
      const date = str(r.date)
      if (!p || !date) continue
      for (const m of ["clicks", "impressions", "ctr", "position"]) {
        const v = value("gsc_totals", r[m])
        if (v !== null)
          bag(direct, p).set({
            source: "gsc",
            date,
            metric: m,
            dims: "",
            value: v,
          })
      }
    }
    for (const r of src.rows("gsc_daily")) {
      const p = this.siteProject(r.site, "gsc_daily", report)
      const date = str(r.date)
      if (!p || !date) continue
      put(p, {
        source: "gsc",
        date,
        query: typeof r.query === "string" ? r.query : "",
        page: typeof r.page === "string" ? r.page : "",
        clicks: num(r.clicks) ?? 0,
        impressions: num(r.impressions) ?? 0,
        ctr: num(r.ctr) ?? 0,
        position: num(r.position) ?? 0,
      })
    }
    for (const r of src.rows("bing_daily")) {
      const p = this.siteProject(r.site, "bing_daily", report)
      const date = str(r.date)
      if (!p || !date) continue
      for (const m of ["clicks", "impressions"]) {
        const v = value("bing_daily", r[m])
        if (v !== null)
          bag(direct, p).set({
            source: "bing",
            date,
            metric: m,
            dims: "",
            value: v,
          })
      }
    }
    for (const r of src.rows("bing_queries")) {
      const p = this.siteProject(r.site, "bing_queries", report)
      const date = str(r.date)
      if (!p || !date) continue
      const clicks = num(r.clicks) ?? 0
      const impressions = num(r.impressions) ?? 0
      put(p, {
        source: "bing",
        date,
        query: typeof r.query === "string" ? r.query : "",
        page: "",
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0,
        position: num(r.position) ?? 0,
      })
    }
    // GA4: sessions by channel × landing page; day totals derived (users only if unambiguous).
    const gaDays = new Map<string, Row[]>()
    for (const r of src.rows("ga_daily")) {
      const p = this.siteProject(r.site, "ga_daily", report)
      const date = str(r.date)
      if (!p || !date) continue
      const sessions = value("ga_daily", r.sessions)
      if (sessions !== null)
        bag(direct, p).set({
          source: "ga4",
          date,
          metric: "sessions",
          dims: dimsKey({
            channel: str(r.channel) ?? "",
            landing: str(r.landing) ?? "",
          }),
          value: sessions,
        })
      const k = `${p}\u0000${date}`
      gaDays.set(k, [...(gaDays.get(k) ?? []), r])
    }
    for (const [k, rows] of gaDays) {
      const [p, date] = k.split("\u0000")
      for (const m of ["sessions", "engaged", "key_events"]) {
        const vals = rows
          .map((r) => num(r[m]))
          .filter((v): v is number => v !== null)
        if (vals.length)
          bag(derived, p).set({
            source: "ga4",
            date,
            metric: m,
            dims: "",
            value: vals.reduce((a, b) => a + b, 0),
          })
      }
      const users = rows.length === 1 ? num(rows[0].users) : null
      if (users !== null)
        bag(derived, p).set({
          source: "ga4",
          date,
          metric: "users",
          dims: "",
          value: users,
        })
      else if (rows.length > 1)
        report.skip(
          "ga_daily",
          "users: Tag mit mehreren Kanal×Einstieg-Zeilen (Nutzer nicht addierbar)"
        )
    }
    for (const r of src.rows("ga_events")) {
      const p = this.siteProject(r.site, "ga_events", report)
      const date = str(r.date)
      const ev = str(r.event)
      if (!p || !date || !ev) continue
      const v = value("ga_events", r.count)
      if (v !== null)
        bag(direct, p).set({
          source: "ga4",
          date,
          metric: `event:${ev}`,
          dims: "",
          value: v,
        })
    }
    for (const r of src.rows("ga_event_params")) {
      const p = this.siteProject(r.site, "ga_event_params", report)
      const date = str(r.date)
      const ev = str(r.event)
      if (!p || !date || !ev) continue
      const v = value("ga_event_params", r.count)
      if (v !== null)
        bag(direct, p).set({
          source: "ga4",
          date,
          metric: `event:${ev}`,
          dims: dimsKey({
            param: str(r.param) ?? "",
            value: text(r.value),
          }),
          value: v,
        })
    }
    for (const r of src.rows("psi")) {
      const p = this.siteProject(r.site, "psi", report)
      const date = str(r.date)
      const url = str(r.url)
      if (!p || !date || !url) continue
      const dims = dimsKey({
        strategy: str(r.strategy) ?? "",
        url: psiUrl(url),
      })
      for (const m of PSI_METRICS) {
        const v = num(r[m])
        if (v === null) report.skip("psi", `${m} leer`)
        else
          bag(direct, p).set({ source: "psi", date, metric: m, dims, value: v })
      }
      const field = parseJsonText(r.field, {})
      if (isObject(field) && Object.keys(field).length)
        report.skip("psi", "field (CrUX-Kategorien, keine Kennzahl)")
    }
    this.mapStore(src, report, (p) => bag(direct, p))
    this.mapApp(
      src,
      report,
      (p) => bag(direct, p),
      (p) => bag(derived, p)
    )
    // health: last run per day, derived from runs.summary
    const runsBySite = new Map<string, Row[]>()
    for (const r of src.rows("runs", "id")) {
      if (r.kind !== "health") continue
      const site = str(r.site) ?? ""
      runsBySite.set(site, [...(runsBySite.get(site) ?? []), r])
    }
    for (const [site, rows] of runsBySite) {
      if (!this.projectExists(site)) continue
      for (const k of healthKpi(rows)) bag(derived, site).set(k)
    }

    for (const [p, b] of direct)
      if (b.collisions)
        report.warn(
          `kpi_daily ${p}: ${b.collisions} Quellzeilen mit gleichem Schlüssel (letzte gewinnt)`
        )
    const projectsWithKpi = new Set([
      ...direct.keys(),
      ...derived.keys(),
      ...search.keys(),
    ])
    for (const p of projectsWithKpi) {
      const stat = {
        kpiNew: 0,
        kpiUpdated: 0,
        kpiDerived: 0,
        searchNew: 0,
        searchUpdated: 0,
      }
      const exists = this.ctx.sqlite.prepare(
        "SELECT 1 FROM kpi_daily WHERE project_id = ? AND source = ? AND date = ? AND metric = ? AND dims = ?"
      )
      const withChannel = (rows: KpiOut[]) =>
        rows.map((r) => ({
          ...r,
          channelId: this.channelFor(p, SOURCE_CHANNEL_KINDS[r.source]),
        }))
      const d = direct.get(p)?.list() ?? []
      if (d.length) {
        const fresh = d.filter(
          (r) => !exists.get(p, r.source, r.date, r.metric, r.dims)
        ).length
        const { changed } = this.kpi.writeRows(p, withChannel(d))
        stat.kpiNew = fresh
        stat.kpiUpdated = changed - fresh
        report.imp("kpi_daily", fresh)
        report.upd("kpi_daily", changed - fresh)
        report.same("kpi_daily", d.length - changed)
      }
      const der = (derived.get(p)?.list() ?? []).filter((r) => {
        const has = !!exists.get(p, r.source, r.date, r.metric, r.dims)
        if (has)
          report.skip("kpi_daily", "abgeleiteter Tageswert existiert bereits")
        return !has
      })
      if (der.length) {
        this.kpi.writeRows(p, withChannel(der))
        stat.kpiDerived = der.length
        report.imp("kpi_daily", der.length)
      }
      const s = [...(search.get(p)?.values() ?? [])]
      if (s.length) {
        const has = this.ctx.sqlite.prepare(
          "SELECT 1 FROM search_daily WHERE project_id = ? AND source = ? AND date = ? AND query = ? AND page = ?"
        )
        const fresh = s.filter(
          (r) => !has.get(p, r.source, r.date, r.query, r.page)
        ).length
        const { changed } = this.search.writeRows(p, s)
        stat.searchNew = fresh
        stat.searchUpdated = changed - fresh
        report.imp("search_daily", fresh)
        report.upd("search_daily", changed - fresh)
        report.same("search_daily", s.length - changed)
      }
      if (Object.values(stat).every((n) => n === 0)) continue
      recordHistory(this.ctx, {
        actor,
        entity: "kpi_daily",
        entityId: p,
        action: "import",
        after: { ...stat, source: "website-growth growth.db" },
      })
    }
  }

  private mapStore(src: GrowthDb, report: Report, bag: (p: string) => KpiBag) {
    for (const r of src.rows("store_daily")) {
      const p = this.siteProject(r.site, "store_daily", report)
      const date = str(r.date)
      if (!p || !date) continue
      const store = str(r.store) ?? ""
      const reportName = str(r.report) ?? ""
      const metric = str(r.metric) ?? ""
      const v = num(r.value)
      if (v === null) {
        report.skip("store_daily", "Messwert leer")
        continue
      }
      if (store !== "google_play") {
        report.warn(
          `store_daily: Store ${store} ohne Abbildung, nicht übernommen`
        )
        report.skip("store_daily", `Store ${store} ohne Abbildung`)
        continue
      }
      const dimsRaw = parseJsonText(r.dims, {})
      const dims = isObject(dimsRaw) ? dimsRaw : {}
      const d = (k: string) => (typeof dims[k] === "string" ? dims[k] : "")
      if (reportName === "installs_overview") {
        if (!(metric in PLAY_OVERVIEW)) {
          report.warn(
            `store_daily installs_overview: unbekannte Metrik ${metric}`
          )
          report.skip("store_daily", "unbekannte Metrik")
          continue
        }
        const m = PLAY_OVERVIEW[metric]
        if (!m) {
          report.skip(
            "store_daily",
            `${metric}: vom Play-Collector nicht erhoben`
          )
          continue
        }
        bag(p).set({ source: "play", date, metric: m, dims: "", value: v })
      } else if (reportName === "store_performance_traffic_source") {
        const m = PLAY_PERFORMANCE[metric]
        if (!m) {
          report.warn(`store_daily ${reportName}: unbekannte Metrik ${metric}`)
          report.skip("store_daily", "unbekannte Metrik")
          continue
        }
        bag(p).add({
          source: "play",
          date,
          metric: m,
          dims: dimsKey({
            source: d("Traffic source"),
            utm_source: d("UTM source"),
            utm_campaign: d("UTM campaign"),
          }),
          value: v,
        })
      } else if (reportName === "store_performance_country") {
        const m = PLAY_PERFORMANCE[metric]
        if (!m) {
          report.warn(`store_daily ${reportName}: unbekannte Metrik ${metric}`)
          report.skip("store_daily", "unbekannte Metrik")
          continue
        }
        bag(p).add({
          source: "play",
          date,
          metric: m,
          dims: dimsKey({ country: d("Country / region") }),
          value: v,
        })
        bag(p).add({
          source: "play",
          date,
          metric: m === "installs" ? "store_acquisitions" : "store_visits",
          dims: "",
          value: v,
        })
      } else {
        report.warn(
          `store_daily: Bericht ${reportName} ohne Abbildung, nicht übernommen`
        )
        report.skip("store_daily", `Bericht ${reportName} ohne Abbildung`)
      }
    }
  }

  private mapApp(
    src: GrowthDb,
    report: Report,
    direct: (p: string) => KpiBag,
    derived: (p: string) => KpiBag
  ) {
    for (const r of src.rows("app_daily")) {
      const p = this.siteProject(r.site, "app_daily", report)
      const date = str(r.date)
      if (!p || !date) continue
      const platform = str(r.platform) ?? ""
      for (const m of ["active_users", "new_users"]) {
        const v = num(r[m])
        if (v === null) continue
        direct(p).set({
          source: "app",
          date,
          metric: m,
          dims: dimsKey({ platform }),
          value: v,
        })
        derived(p).add({ source: "app", date, metric: m, dims: "", value: v })
      }
    }
    for (const r of src.rows("app_events")) {
      const p = this.siteProject(r.site, "app_events", report)
      const date = str(r.date)
      const ev = str(r.event)
      if (!p || !date || !ev) continue
      const v = num(r.count)
      if (v === null) continue
      const platform = str(r.platform) ?? ""
      direct(p).set({
        source: "app",
        date,
        metric: `event:${ev}`,
        dims: dimsKey({ platform }),
        value: v,
      })
      derived(p).add({
        source: "app",
        date,
        metric: `event:${ev}`,
        dims: "",
        value: v,
      })
      if (num(r.users) !== null)
        report.skip("app_events", "users je Event (keine §7.1-Metrik)")
    }
    for (const r of src.rows("app_retention")) {
      const p = this.siteProject(r.site, "app_retention", report)
      const date = str(r.cohort_start)
      if (!p || !date) continue
      for (const [col, m] of [
        ["d1", "retention_d1"],
        ["d7", "retention_d7"],
        ["d28", "retention_d28"],
        ["users", "cohort_users"],
      ] as const) {
        const v = num(r[col])
        if (v === null) {
          report.skip("app_retention", `${col} leer (Kohorte noch nicht reif)`)
          continue
        }
        direct(p).set({ source: "app", date, metric: m, dims: "", value: v })
      }
    }
  }

  // ---------- experiments, actions ----------

  private importExperiments(src: GrowthDb, report: Report, actor: string) {
    const ids = new Map<number, number>()
    for (const r of src.rows("experiments", "id")) {
      const p = this.siteProject(r.site, "experiments", report)
      if (!p) continue
      const key = `wg:experiments:${String(r.id)}`
      const exists = this.ctx.db
        .select({ id: experiments.id })
        .from(experiments)
        .where(eq(experiments.sourceKey, key))
        .get()
      if (exists) {
        ids.set(Number(r.id), exists.id)
        report.same("experiments")
        continue
      }
      const title = str(r.title)
      const startDate = str(r.start_date)
      if (!title || !startDate) {
        report.skip("experiments", "Titel oder Startdatum fehlt")
        continue
      }
      const metric = str(r.metric) ?? "clicks"
      if (
        !/^(clicks|impressions|ctr|position)$/.test(metric) &&
        !/^[a-z0-9_-]+:.+$/i.test(metric)
      ) {
        report.warn(
          `experiments #${String(r.id)}: Metrik ${metric} unbekannt, nicht übernommen`
        )
        report.skip("experiments", "unbekannte Metrik")
        continue
      }
      const pages = (() => {
        const v = parseJsonText(r.pages, [])
        return Array.isArray(v) ? v.map(String).filter(Boolean) : []
      })()
      if (pages.length > 1)
        report.warn(
          `experiments #${String(r.id)}: ${pages.length} Seiten, nur ${pages[0]} als target`
        )
      const evalDays = num(r.eval_days) ?? 28
      const oldStatus = str(r.status) ?? "running"
      const status =
        oldStatus === "running"
          ? "running"
          : oldStatus === "done"
            ? "evaluated"
            : "stopped"
      const verdict = str(r.verdict)
      const result = this.experimentResult(
        metric,
        startDate,
        evalDays,
        parseJsonText(r.result, null)
      )
      const row = this.ctx.db
        .insert(experiments)
        .values({
          projectId: p,
          title,
          hypothesis: str(r.hypothesis),
          targetType: pages.length ? "page" : "other",
          target: pages[0] ?? null,
          metric,
          startDate,
          baselineDays: evalDays,
          evalDays,
          status,
          result: result ? json(result) : null,
          verdict:
            verdict &&
            ["win", "loss", "neutral", "inconclusive"].includes(verdict)
              ? verdict
              : null,
          actor,
          sourceKey: key,
        })
        .returning()
        .get()
      recordHistory(this.ctx, {
        actor,
        entity: "experiment",
        entityId: row.id,
        action: "create",
        after: row,
      })
      ids.set(Number(r.id), row.id)
      report.imp("experiments")
    }
    return ids
  }

  /** growth.py result {before, after} (gsc windows) → {metric, aggregation, baseline, after, change}. */
  private experimentResult(
    metric: string,
    start: string,
    n: number,
    raw: unknown
  ) {
    if (!isObject(raw) || !isObject(raw.before) || !isObject(raw.after))
      return null
    const day = (offset: number) => {
      const d = new Date(`${start}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + offset)
      return d.toISOString().slice(0, 10)
    }
    const sum = metric === "clicks" || metric === "impressions"
    const win = (w: Record<string, unknown>, from: string, to: string) => {
      const value = num(w[metric])
      return {
        from,
        to,
        days: n,
        daysWithData: n,
        value,
        perDay: value === null ? null : sum ? value / n : value,
        clicks: num(w.clicks) ?? 0,
        impressions: num(w.impressions) ?? 0,
      }
    }
    const baseline = win(raw.before, day(-n), day(-1))
    const after = win(raw.after, start, day(n - 1))
    const change =
      baseline.perDay && after.perDay !== null
        ? (after.perDay - baseline.perDay) / baseline.perDay
        : null
    return {
      metric,
      aggregation: "search",
      baseline,
      after,
      change,
      legacy: raw,
    }
  }

  private importActions(
    src: GrowthDb,
    expIds: Map<number, number>,
    report: Report,
    actor: string
  ) {
    for (const r of src.rows("actions", "id")) {
      const p = this.siteProject(r.site, "actions", report)
      if (!p) continue
      const key = `wg:actions:${String(r.id)}`
      const exists = this.ctx.db
        .select({ id: changes.id })
        .from(changes)
        .where(eq(changes.sourceKey, key))
        .get()
      if (exists) {
        report.same("changes")
        continue
      }
      const summary = str(r.summary)
      const ts = str(r.ts)
      if (!summary || !ts || !/^\d{4}-\d{2}-\d{2}/.test(ts)) {
        report.skip("changes", "summary oder ts fehlt")
        continue
      }
      const oldKind = str(r.kind) ?? "other"
      const kind = CHANGE_KIND[oldKind]
      if (!kind)
        report.warn(
          `actions #${String(r.id)}: kind ${oldKind} unbekannt → other`
        )
      let experimentId: number | null = null
      if (r.exp_id !== null && r.exp_id !== undefined) {
        experimentId = expIds.get(Number(r.exp_id)) ?? null
        if (experimentId === null)
          report.warn(
            `actions #${String(r.id)}: Experiment ${text(r.exp_id)} nicht gefunden, ohne Verknüpfung`
          )
      }
      const row = this.ctx.db
        .insert(changes)
        .values({
          projectId: p,
          channelId: null,
          date: ts.slice(0, 10),
          kind: kind ?? "other",
          summary,
          ref: str(r.ref),
          experimentId,
          actor,
          sourceKey: key,
        })
        .returning()
        .get()
      recordHistory(this.ctx, {
        actor,
        entity: "change",
        entityId: row.id,
        action: "create",
        after: row,
      })
      report.imp("changes")
    }
  }

  // ---------- ai_checks → geo ----------

  private importAiChecks(
    src: GrowthDb,
    sites: Record<string, SiteConfig>,
    report: Report,
    actor: string
  ) {
    const checks: GeoCheckInput[] = []
    for (const r of src.rows("ai_checks")) {
      const p = this.siteProject(r.site, "ai_checks", report)
      const date = str(r.date)
      const engine = str(r.engine)
      const prompt = str(r.prompt)
      if (!p || !date || !engine || !prompt) continue
      const key = `wg:ai_checks:${p}:${date}:${engine}:${hash(prompt)}`
      if (
        this.ctx.db
          .select({ id: geoChecks.id })
          .from(geoChecks)
          .where(eq(geoChecks.sourceKey, key))
          .get()
      ) {
        report.same("geo_checks")
        continue
      }
      let question = this.ctx.db
        .select()
        .from(geoQuestions)
        .where(
          and(eq(geoQuestions.projectId, p), eq(geoQuestions.text, prompt))
        )
        .get()
      if (!question) {
        const active = strList(sites[p]?.ai_prompts)
          .map((t) => t.trim())
          .includes(prompt)
        question = this.geo.addQuestion(
          {
            projectId: p,
            text: prompt,
            active,
            sourceKey: `wg:ai_checks:${p}:prompt:${hash(prompt)}`,
          },
          actor
        )
        report.imp("geo_questions")
        if (!active)
          report.warn(
            `geo_questions: Frage aus ai_checks ohne ai_prompts-Eintrag inaktiv angelegt: ${prompt.slice(0, 80)}`
          )
      }
      const existing = this.ctx.db
        .select({ id: geoChecks.id })
        .from(geoChecks)
        .where(
          and(
            eq(geoChecks.projectId, p),
            eq(geoChecks.questionId, question.id),
            eq(geoChecks.date, date),
            eq(geoChecks.engine, engine)
          )
        )
        .get()
      if (existing) {
        report.skip(
          "geo_checks",
          "Check (Frage, Datum, Engine) existiert bereits"
        )
        continue
      }
      const list = (v: unknown) => {
        const x = parseJsonText(v, [])
        return Array.isArray(x) ? (x as unknown[]) : []
      }
      const metaRaw = parseJsonText(r.meta, {})
      const meta = isObject(metaRaw) ? { ...metaRaw } : {}
      const evidence = list(r.evidence).map(String)
      const checkedAt = isoFromLocal(r.ts)
      if (checkedAt) meta.checkedAt = checkedAt
      if (evidence.length > 1) meta.evidenceFiles = evidence
      const status = str(r.status) ?? "ok"
      checks.push({
        projectId: p,
        questionId: question.id,
        date,
        engine,
        status: status === "error" ? "error" : "ok",
        mentioned: Number(r.mentioned) === 1,
        position: num(r.position),
        cited: Number(r.cited) === 1,
        inSources: meta.in_sources === true,
        brands: list(r.brands).map(String),
        competitors: list(r.competitors),
        links: list(r.links).map(String),
        citedUrls: list(r.cited_urls).map(String),
        sources: list(r.sources)
          .filter(isObject)
          .map((s) => ({
            url: text(s.url),
            title: typeof s.title === "string" ? s.title : null,
            domain: typeof s.domain === "string" ? s.domain : null,
          })),
        answer: str(r.answer) ?? str(r.excerpt),
        model: str(r.model),
        evidence: evidence[0] ?? str(r.evidence),
        meta,
        error: str(r.error),
        sourceKey: key,
      })
    }
    if (!checks.length) return
    const result = this.geo.recordChecks(checks, actor)
    report.imp("geo_checks", result.inserted)
    report.upd("geo_checks", result.updated)
    report.imp("mention_targets", result.mentionTargets.created.length)
    report.upd("mention_targets", result.mentionTargets.updated)
  }

  // ---------- workspace + README ----------

  private importWorkspaces(
    sites: Record<string, SiteConfig>,
    root: string,
    report: Report,
    actor: string
  ) {
    for (const id of Object.keys(sites)) {
      if (!this.projectExists(id)) continue
      const configured = str(sites[id].workspace)
      const dir =
        configured && path.resolve(configured).startsWith(root + path.sep)
          ? path.resolve(configured)
          : path.join(root, id)
      if (!fs.existsSync(dir)) {
        report.warn(`Workspace für ${id} fehlt: ${dir}`)
        continue
      }
      const backlogFile = path.join(dir, "backlog.md")
      if (fs.existsSync(backlogFile)) {
        report.sourceRows[`${id}/backlog.md`] = 0
        const { items, ignoredSections } = parseBacklog(
          fs.readFileSync(backlogFile, "utf8"),
          id
        )
        report.sourceRows[`${id}/backlog.md`] = items.length
        if (ignoredSections.length)
          report.skip(
            "backlog_items",
            `Abschnitte ohne Aufgaben (${ignoredSections.join(", ")})`,
            ignoredSections.length
          )
        for (const it of items) {
          if (
            this.ctx.db
              .select({ id: backlogItems.id })
              .from(backlogItems)
              .where(eq(backlogItems.sourceKey, it.key))
              .get()
          ) {
            report.same("backlog_items")
            continue
          }
          const row = this.ctx.db
            .insert(backlogItems)
            .values({
              projectId: id,
              title: it.title,
              detail: it.detail,
              kind: it.kind,
              impact: it.impact,
              effort: it.effort,
              status: it.status,
              source: `Website-Growth ${path.relative(root, backlogFile)}`,
              doneRef: it.doneRef,
              position: it.position,
              actor,
              sourceKey: it.key,
            })
            .returning()
            .get()
          recordHistory(this.ctx, {
            actor,
            entity: "backlog",
            entityId: row.id,
            action: "create",
            after: row,
          })
          report.imp("backlog_items")
        }
      }
      const postsDir = path.join(dir, "posts")
      const ideasFile = path.join(postsDir, "ideas.md")
      if (fs.existsSync(ideasFile)) {
        const items = parseIdeas(
          fs.readFileSync(ideasFile, "utf8"),
          id,
          postsDir
        )
        report.sourceRows[`${id}/posts/ideas.md`] = items.length
        const channelId = this.channelFor(id, ["website"])
        for (const it of items) {
          if (it.unknownStatus)
            report.warn(
              `ideas.md ${it.title}: Status „${it.statusText}“ unbekannt → idea`
            )
          if (["draft", "review", "live"].includes(it.status) && !it.draftPath)
            report.warn(
              `ideas.md ${it.title}: Status ${it.statusText}, aber keine Datei posts/<slug>.md gefunden`
            )
          if (
            this.ctx.db
              .select({ id: contentItems.id })
              .from(contentItems)
              .where(eq(contentItems.sourceKey, it.key))
              .get()
          ) {
            report.same("content_items")
            continue
          }
          const row = this.ctx.db
            .insert(contentItems)
            .values({
              projectId: id,
              channelId,
              kind: it.kind,
              title: it.title,
              keyword: it.keyword,
              intent: it.intent,
              brief: it.brief,
              status: it.status,
              draftPath: it.draftPath,
              urlPath: it.urlPath,
              notes: it.notes,
              position: it.position,
              actor,
              sourceKey: it.key,
            })
            .returning()
            .get()
          recordHistory(this.ctx, {
            actor,
            entity: "content",
            entityId: row.id,
            action: "create",
            after: row,
          })
          report.imp("content_items")
        }
        const drafts = fs
          .readdirSync(postsDir)
          .filter((f) => f.endsWith(".md") && f !== "ideas.md")
        const linked = new Set(items.map((i) => i.draftPath).filter(Boolean))
        const unlinked = drafts.filter(
          (f) => !linked.has(path.join(postsDir, f))
        )
        if (unlinked.length)
          report.warn(
            `posts/ in ${id}: Entwürfe ohne Thema in ideas.md: ${unlinked.join(", ")}`
          )
      }
      for (const sub of ["reports", "research"]) {
        const d = path.join(dir, sub)
        if (fs.existsSync(d))
          report.skip(
            "workspace",
            `${sub}/ bleibt Datei (über projects.workspace erreichbar)`,
            fs.readdirSync(d).length
          )
      }
      if (fs.existsSync(path.join(dir, "AGENTS.md")))
        report.skip("workspace", "AGENTS.md (Strategie) bleibt Datei")
    }
  }

  private importLearnings(
    sitesFile: string,
    sites: Record<string, SiteConfig>,
    report: Report,
    actor: string
  ) {
    const readme = readReadme(sitesFile)
    if (!readme) {
      report.warn(
        `README.md neben sites.json fehlt, keine Learnings übernommen`
      )
      return
    }
    const { found, items, unparsed } = parseLearnings(readme.text)
    if (!found) {
      report.warn("README.md: Abschnitt „Learnings“ fehlt")
      return
    }
    report.sourceRows["README.md#Learnings"] = items.length + unparsed
    report.skip(
      "learnings",
      "Eintrag nicht im Format Datum, Site: Text",
      unparsed
    )
    for (const it of items) {
      if (
        this.ctx.db
          .select({ id: learnings.id })
          .from(learnings)
          .where(eq(learnings.sourceKey, it.key))
          .get()
      ) {
        report.same("learnings")
        continue
      }
      const site = it.site.toLowerCase()
      // Site-wide website learnings apply to growth work, not to shortform accounts.
      let scopeType = "growth"
      let scopeId: string | null = null
      if (!["alle", "all", "global"].includes(site)) {
        const id =
          Object.keys(sites).find((k) => k.toLowerCase() === site) ?? site
        if (this.projectExists(id)) {
          scopeType = "brand"
          scopeId = id
        } else
          report.warn(
            `Learning ${it.date} (${it.site}): Site ohne Projekt, als growth übernommen`
          )
      }
      addLearning(
        this.ctx,
        {
          scopeType,
          scopeId,
          statement: it.statement,
          evidence:
            it.evidence ??
            `${SOURCE_LABEL}, Learnings ${it.date} (${it.site}): Eintrag ohne gesonderten Beleg`,
          date: it.date,
          source: SOURCE_LABEL,
          sourceKey: it.key,
        },
        actor
      )
      report.imp("learnings")
    }
    const noEvidence = items.filter((i) => !i.evidence).length
    if (noEvidence)
      report.warn(
        `${noEvidence} Learnings ohne Belegsatz: evidence verweist auf den README-Eintrag`
      )
  }
}

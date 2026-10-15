import { Injectable } from "@nestjs/common"
import {
  appSetup,
  bingSubmit,
  checkAsc,
  checkPlay,
  CollectorError,
  errorMessage,
  GEO_ENGINE,
  keywordSuggestions,
  sitemapSubmit,
  type AppConfig,
  type AscCheck,
  type PlayCheck,
} from "../../collectors/sources"
import { CollectorRegistry } from "../../collectors/registry"
import { ConfigError, toolConfig } from "../../core/config"
import { VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { ChangesService } from "../work/changes.service"
import { CollectService, type CollectResponse } from "./collect.service"
import { CollectorsService } from "./collectors.service"
import { requireProject, type ProjectRow } from "./rows"
import { body, onlyKeys, optBool, optString, reqString } from "./validate"

const ENGINES = [GEO_ENGINE] as const

/** CollectorError (sources) → VGError with the same contract code. */
function external<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => {
    if (e instanceof VGError || e instanceof ConfigError) throw e
    if (e instanceof CollectorError)
      throw e.code === "CONFIG"
        ? new ConfigError(e.message)
        : new VGError(e.code, e.message)
    throw new VGError("EXTERNAL", errorMessage(e))
  })
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null

/**
 * Actions from growth.py next to the collectors: geo run, sitemap/bing submit, keywords, GA4 app
 * setup, store access check. External calls run outside any transaction; every external write is
 * logged afterwards as one `changes` entry through ChangesService.
 */
@Injectable()
export class CollectorActionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: CollectorRegistry,
    private readonly collectors: CollectorsService,
    private readonly collect: CollectService,
    private readonly changes: ChangesService
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  private config(project: ProjectRow, collector: string) {
    return this.collectors.effectiveConfig(
      project,
      this.registry.get(collector)
    )
  }

  private secretsDir(): string {
    const { secretsDir } = toolConfig()
    if (!secretsDir)
      throw new ConfigError(
        "Zugänge fehlen: secretsDir nicht konfiguriert (VIBEGROWTH_SECRETS_DIR oder secretsDir in der Config)"
      )
    return secretsDir
  }

  private siteUrl(project: ProjectRow, collector?: string): string {
    const url =
      (collector ? str(this.config(project, collector).url) : null) ??
      str(project.url)
    if (!url)
      throw new VGError("INVALID", `Projekt ${project.id} hat keine URL`)
    return url
  }

  /** POST /geo/run {project, engine?, limit?}: collector geo-chatgpt for one project (also when disabled). */
  async geoRun(raw: unknown, actor: string): Promise<CollectResponse> {
    const input = body(raw)
    onlyKeys(input, ["project", "engine", "limit"])
    const project = requireProject(this.ctx, reqString(input, "project"))
    const engine = optString(input, "engine") ?? GEO_ENGINE
    if (!(ENGINES as readonly string[]).includes(engine))
      throw new VGError(
        "INVALID",
        `engine ${engine} unbekannt (erlaubt: ${ENGINES.join(", ")})`
      )
    const limit = input.limit
    if (
      limit !== undefined &&
      limit !== null &&
      (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1)
    )
      throw new VGError("INVALID", "limit muss eine ganze Zahl ≥ 1 sein")
    const run = await this.collect.runOne(project.id, "geo-chatgpt", 1, actor, {
      limit: typeof limit === "number" ? limit : undefined,
    })
    return {
      runs: [run],
      errors: run.ok
        ? []
        : [
            {
              project: run.project,
              collector: run.collector,
              error: run.error ?? run.summary,
            },
          ],
    }
  }

  /** POST /search/sitemap-submit {project}: <url>/sitemap.xml to Search Console (gsc.property). */
  async sitemapSubmit(raw: unknown, actor: string) {
    const input = body(raw)
    onlyKeys(input, ["project"])
    const project = requireProject(this.ctx, reqString(input, "project"))
    const property = str(this.config(project, "gsc").property)
    if (!property)
      throw new VGError(
        "INVALID",
        `Projekt ${project.id}: Collector gsc ohne property (collectors set gsc --project ${project.id} --config '{"property":"sc-domain:…"}')`
      )
    const siteUrl = this.siteUrl(project)
    const secretsDir = this.secretsDir()
    const sitemap = await external(() =>
      sitemapSubmit(property, siteUrl, { secretsDir })
    )
    const change = this.changes.add(
      {
        projectId: project.id,
        kind: "seo",
        summary: "Sitemap an Google Search Console übermittelt",
        ref: sitemap.path ?? `${siteUrl.replace(/\/+$/, "")}/sitemap.xml`,
      },
      actor
    )
    return { project: project.id, property, sitemap, change }
  }

  /** POST /search/bing-submit {project, urls?}: URLs (default: sitemap) after the quota check. */
  async bingSubmit(raw: unknown, actor: string) {
    const input = body(raw)
    onlyKeys(input, ["project", "urls"])
    const project = requireProject(this.ctx, reqString(input, "project"))
    let urls: string[] | undefined
    if (input.urls !== undefined && input.urls !== null) {
      if (
        !Array.isArray(input.urls) ||
        input.urls.some((u) => typeof u !== "string" || !/^https?:\/\//.test(u))
      )
        throw new VGError(
          "INVALID",
          "urls muss eine Liste absoluter URLs (http/https) sein"
        )
      urls = input.urls as string[]
    }
    const siteUrl = this.siteUrl(project, "bing")
    const secretsDir = this.secretsDir()
    const result = await external(() =>
      bingSubmit(siteUrl, urls, { secretsDir })
    )
    const base = result.siteUrl.replace(/\/+$/, "")
    const change = this.changes.add(
      {
        projectId: project.id,
        kind: "seo",
        summary: `Bing SubmitUrlBatch: ${result.submitted.length} URLs`,
        ref: result.submitted
          .map((u) => u.replace(base, "") || "/")
          .join(", ")
          .slice(0, 300),
      },
      actor
    )
    return { project: project.id, ...result, change }
  }

  /** GET /search/keywords?project=&seed=&fast=: Google autocomplete, read-only (no file). */
  async keywords(projectId: string, seeds: string[], fast: boolean) {
    const project = requireProject(this.ctx, projectId)
    let list = seeds.map((s) => s.trim()).filter(Boolean)
    if (!list.length) {
      const cfg = JSON.parse(project.config || "{}") as {
        seedKeywords?: unknown
      }
      list = Array.isArray(cfg.seedKeywords)
        ? cfg.seedKeywords.filter((s): s is string => typeof s === "string")
        : []
    }
    if (!list.length)
      throw new VGError(
        "INVALID",
        `Keine Seeds: seed angeben oder projects.config.seedKeywords für ${project.id} setzen`
      )
    const result = await external(() =>
      keywordSuggestions(list, project.language || "de", { fast })
    )
    return { project: project.id, ...result }
  }

  /** POST /collectors/app/setup {project, dryRun?}: GA4 Admin key events and custom dimensions. */
  async appSetup(raw: unknown, actor: string) {
    const input = body(raw)
    onlyKeys(input, ["project", "dryRun"])
    const project = requireProject(this.ctx, reqString(input, "project"))
    const dryRun = optBool(input, "dryRun") ?? false
    const config = this.config(project, "app") as AppConfig
    const secretsDir = this.secretsDir()
    const result = await external(() =>
      appSetup(config, { secretsDir }, dryRun)
    )
    const change =
      result.created.length && !dryRun
        ? this.changes.add(
            {
              projectId: project.id,
              kind: "config",
              summary: `GA4-App-Property: ${result.created.join(", ")}`,
              ref: result.property,
            },
            actor
          )
        : null
    return { project: project.id, ...result, change }
  }

  /** GET /collectors/stores/check?project=: which store sources are readable (growth.py stores). */
  async storesCheck(projectId: string) {
    const project = requireProject(this.ctx, projectId)
    const play = this.config(project, "play")
    const asc = this.config(project, "asc")
    const res: { google_play?: PlayCheck; app_store?: AscCheck } = {}
    if (str(play.package) || str(play.gcsBucket))
      res.google_play = await checkPlay(play)
    if (str(asc.appId)) res.app_store = await checkAsc(asc)
    const values = Object.values(res)
    return {
      project: project.id,
      ok: values.length > 0 && values.every((v) => v.ok),
      ...res,
    }
  }
}

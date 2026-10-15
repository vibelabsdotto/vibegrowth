import { Injectable } from "@nestjs/common"
import { asc, eq } from "drizzle-orm"
import { accounts, projects } from "../../core/schema"
import { json, patchRow, recordHistory, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { ChannelsService } from "./channels.service"
import { CollectorsService } from "./collectors.service"
import { funnelStages } from "./funnel.service"
import {
  findProject,
  PROJECT_KINDS,
  PROJECT_STATUSES,
  projectView,
  requireProject,
  type ProjectView,
} from "./rows"
import {
  assertId,
  body,
  jsonObject,
  mergeConfig,
  onlyKeys,
  optObject,
  optOneOf,
  optString,
  reqString,
} from "./validate"

const TEXT_FIELDS = [
  "url",
  "language",
  "repo",
  "workspace",
  "notionUrl",
  "notes",
] as const

function checkUrl(url: string | null | undefined) {
  if (url && !/^https?:\/\/[^/\s]+/.test(url))
    throw new VGError(
      "INVALID",
      `url muss mit http(s):// beginnen, war: ${url}`
    )
}

function checkConfig(config: Record<string, unknown>) {
  if (config.funnel !== undefined) funnelStages(config)
}

/** Projects (table projects, formerly brands). */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly channels: ChannelsService,
    private readonly collectors: CollectorsService
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  list(filter: { status?: string } = {}): ProjectView[] {
    if (filter.status) optOneOf(filter, "status", PROJECT_STATUSES)
    const q = this.ctx.db.select().from(projects)
    return (filter.status ? q.where(eq(projects.status, filter.status)) : q)
      .orderBy(asc(projects.id))
      .all()
      .map(projectView)
  }

  /** Project row view or NOT_FOUND. */
  get(id: string): ProjectView {
    return projectView(requireProject(this.ctx, id))
  }

  /** GET /projects/:id: with channels (incl. virtual TikTok channels), collectors and accounts. */
  show(id: string) {
    const project = this.get(id)
    const accountRows = this.ctx.db
      .select({
        id: accounts.id,
        name: accounts.name,
        handle: accounts.handle,
        platform: accounts.platform,
        status: accounts.status,
      })
      .from(accounts)
      .where(eq(accounts.brandId, id))
      .orderBy(asc(accounts.id))
      .all()
    return {
      ...project,
      channels: this.channels.list(id),
      collectors: this.collectors.summary(id),
      accounts: accountRows,
    }
  }

  create(raw: unknown, actor: string): ProjectView {
    const input = body(raw)
    onlyKeys(input, ["id", "name", "kind", "status", "config", ...TEXT_FIELDS])
    const id = assertId(reqString(input, "id"))
    const values = {
      id,
      name: reqString(input, "name"),
      kind: optOneOf(input, "kind", PROJECT_KINDS) ?? "app",
      status: optOneOf(input, "status", PROJECT_STATUSES) ?? "active",
      url: optString(input, "url") ?? null,
      language: optString(input, "language") ?? null,
      repo: optString(input, "repo") ?? null,
      workspace: optString(input, "workspace") ?? null,
      notionUrl: optString(input, "notionUrl") ?? null,
      notes: optString(input, "notes") ?? null,
      config: mergeConfig({}, optObject(input, "config") ?? {}),
    }
    checkUrl(values.url)
    checkConfig(values.config)
    return this.database.tx(() => {
      if (findProject(this.ctx, id))
        throw new VGError("CONFLICT", `Projekt ${id} existiert bereits`)
      this.ctx.db
        .insert(projects)
        .values({ ...values, config: json(values.config) })
        .run()
      recordHistory(this.ctx, {
        actor,
        entity: "project",
        entityId: id,
        action: "create",
        after: values,
      })
      return this.get(id)
    })
  }

  /** PATCH /projects/:id: fields given are set, null clears; config is merged (null removes a key). */
  update(id: string, raw: unknown, actor: string): ProjectView {
    const input = body(raw)
    onlyKeys(input, ["name", "kind", "status", "config", ...TEXT_FIELDS])
    const patch: Record<string, unknown> = {
      kind: optOneOf(input, "kind", PROJECT_KINDS),
      status: optOneOf(input, "status", PROJECT_STATUSES),
    }
    if (input.name !== undefined) patch.name = reqString(input, "name")
    for (const f of TEXT_FIELDS) patch[f] = optString(input, f)
    checkUrl(patch.url as string | null | undefined)
    const configPatch = optObject(input, "config")
    return this.database.tx(() => {
      const row = requireProject(this.ctx, id)
      if (configPatch) {
        const next = mergeConfig(jsonObject(row.config), configPatch)
        checkConfig(next)
        patch.config = json(next)
      }
      patchRow(this.ctx, projects, "project", id, patch, actor)
      return this.get(id)
    })
  }
}

import { asc, eq, type InferSelectModel } from "drizzle-orm"
import type { Ctx } from "../../core/db"
import { accounts, channels, projects } from "../../core/schema"
import { VGError } from "../../core/util"
import { jsonObject } from "./validate"

export type ProjectRow = InferSelectModel<typeof projects>
export type ChannelRow = InferSelectModel<typeof channels>

export const PROJECT_KINDS = ["app", "website", "tool", "other"] as const
export const PROJECT_STATUSES = ["active", "paused", "archived"] as const
export const CHANNEL_KINDS = [
  "website",
  "ios",
  "android",
  "youtube",
  "instagram",
  "other",
] as const
export const CHANNEL_STATUSES = ["active", "paused", "planned"] as const

export function projectView(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind,
    status: row.status,
    language: row.language,
    repo: row.repo,
    workspace: row.workspace,
    notionUrl: row.notionUrl,
    notes: row.notes,
    config: jsonObject(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
export type ProjectView = ReturnType<typeof projectView>

export function findProject(ctx: Ctx, id: string): ProjectRow | undefined {
  return ctx.db.select().from(projects).where(eq(projects.id, id)).get()
}

export function requireProject(ctx: Ctx, id: string): ProjectRow {
  const row = findProject(ctx, id)
  if (!row) throw new VGError("NOT_FOUND", `Projekt ${id} nicht gefunden`)
  return row
}

export interface ChannelView {
  id: string
  projectId: string
  kind: string
  name: string | null
  url: string | null
  handle: string | null
  externalId: string | null
  status: string
  notes: string | null
  virtual: boolean
  createdAt: string
  updatedAt: string
}

export function channelView(row: ChannelRow): ChannelView {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    url: row.url,
    handle: row.handle,
    externalId: row.externalId,
    status: row.status,
    notes: row.notes,
    virtual: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** TikTok accounts as virtual channels (CONTRACT §1), never stored in channels. */
export function virtualChannels(ctx: Ctx, projectId?: string): ChannelView[] {
  const q = ctx.db.select().from(accounts)
  const rows = (projectId ? q.where(eq(accounts.brandId, projectId)) : q)
    .orderBy(asc(accounts.brandId), asc(accounts.id))
    .all()
  return rows.map((a) => ({
    id: a.id,
    projectId: a.brandId,
    kind: a.platform || "tiktok",
    name: a.name,
    url: a.handle ? `https://www.tiktok.com/@${a.handle}` : null,
    handle: a.handle,
    externalId: null,
    status: a.status,
    notes: null,
    virtual: true,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }))
}

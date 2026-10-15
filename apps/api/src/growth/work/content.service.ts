import { Injectable } from "@nestjs/common"
import { and, asc, eq, gte, inArray, lte, type SQL } from "drizzle-orm"
import path from "node:path"
import {
  approvals,
  contentItems,
  kpiDaily,
  searchDaily,
} from "../../core/schema"
import {
  assertDate,
  getById,
  parseJson,
  patchRow,
  recordHistory,
  today,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import {
  checkChannel,
  daysBetween,
  listOf,
  oneOf,
  pathMatches,
  requireProject,
  round,
  urlPath,
  yesterday,
} from "./shared"

export const CONTENT_KINDS = ["blog", "landing", "store_text", "other"] as const
export const CONTENT_STATUS = [
  "idea",
  "approved",
  "draft",
  "review",
  "live",
  "discarded",
] as const

export type ContentRow = typeof contentItems.$inferSelect

export interface ContentInput {
  projectId: string
  channelId?: string | null
  kind?: string
  title: string
  keyword?: string | null
  intent?: string | null
  brief?: string | null
  status?: string
  draftPath?: string | null
  urlPath?: string | null
  liveDate?: string | null
  approvalId?: number | null
  notes?: string | null
  position?: number
  sourceKey?: string | null
}

export type ContentPatch = Partial<
  Omit<ContentInput, "projectId" | "sourceKey">
>

const STATUS_ORDER = new Map<string, number>(
  CONTENT_STATUS.map((s, i) => [s, i])
)

function cleanUrlPath(v: string | null | undefined) {
  if (v === undefined) return undefined
  if (v === null || v.trim() === "") return null
  return urlPath(v)
}

function cleanDraftPath(v: string | null | undefined) {
  if (v === undefined) return undefined
  if (v === null || v.trim() === "") return null
  if (!path.isAbsolute(v.trim()))
    throw new VGError("INVALID", `draftPath muss absolut sein, war: ${v}`)
  return v.trim()
}

@Injectable()
export class ContentService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  list(f: { project?: string; status?: string; kind?: string }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(contentItems.projectId, f.project))
    const statuses = listOf(f.status, CONTENT_STATUS, "status")
    if (statuses) conds.push(inArray(contentItems.status, statuses))
    const kinds = listOf(f.kind, CONTENT_KINDS, "kind")
    if (kinds) conds.push(inArray(contentItems.kind, kinds))
    return this.ctx.db
      .select()
      .from(contentItems)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(
        asc(contentItems.projectId),
        asc(contentItems.position),
        asc(contentItems.id)
      )
      .all()
      .sort(
        (a, b) =>
          a.projectId.localeCompare(b.projectId) ||
          (STATUS_ORDER.get(a.status) ?? 99) -
            (STATUS_ORDER.get(b.status) ?? 99) ||
          a.position - b.position ||
          a.id - b.id
      )
  }

  get(id: number) {
    const item = getById(this.ctx, contentItems, id, "Content")
    const linked = this.ctx.db
      .select()
      .from(approvals)
      .where(
        and(eq(approvals.refType, "content"), eq(approvals.refId, String(id)))
      )
      .all()
    const ids = new Set(linked.map((a) => a.id))
    if (item.approvalId && !ids.has(item.approvalId))
      linked.push(getById(this.ctx, approvals, item.approvalId, "Freigabe"))
    return {
      ...item,
      approvals: linked
        .sort((a, b) => a.id - b.id)
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          status: a.status,
          requestedBy: a.requestedBy,
          decidedBy: a.decidedBy,
          decidedAt: a.decidedAt,
          decisionNote: a.decisionNote,
        })),
      numbers: this.numbers(item),
    }
  }

  /**
   * Numbers since live_date for live items (contract §7.5): search_daily (gsc + bing) filtered by
   * page path suffix and kpi_daily ga4:sessions with dims {channel, landing}. null when not live.
   */
  numbers(item: ContentRow) {
    if (item.status !== "live" || !item.liveDate || !item.urlPath) return null
    const from = item.liveDate
    const to = yesterday()
    const days = Math.max(0, daysBetween(from, to) + 1)
    const target = item.urlPath
    const rows = this.ctx.db
      .select()
      .from(searchDaily)
      .where(
        and(
          eq(searchDaily.projectId, item.projectId),
          gte(searchDaily.date, from),
          lte(searchDaily.date, to)
        )
      )
      .all()
      .filter((r) => pathMatches(r.page, target))
    const bySource: Record<
      string,
      {
        clicks: number
        impressions: number
        posWeighted: number
        queries: Map<
          string,
          { clicks: number; impressions: number; posWeighted: number }
        >
      }
    > = {}
    for (const r of rows) {
      const s = (bySource[r.source] ??= {
        clicks: 0,
        impressions: 0,
        posWeighted: 0,
        queries: new Map(),
      })
      s.clicks += r.clicks
      s.impressions += r.impressions
      s.posWeighted += r.position * r.impressions
      const q = s.queries.get(r.query) ?? {
        clicks: 0,
        impressions: 0,
        posWeighted: 0,
      }
      q.clicks += r.clicks
      q.impressions += r.impressions
      q.posWeighted += r.position * r.impressions
      s.queries.set(r.query, q)
    }
    const search = Object.fromEntries(
      Object.entries(bySource).map(([source, s]) => [
        source,
        {
          clicks: s.clicks,
          impressions: s.impressions,
          ctr: s.impressions ? round(s.clicks / s.impressions) : null,
          position: s.impressions
            ? round(s.posWeighted / s.impressions, 1)
            : null,
          topQueries: [...s.queries.entries()]
            .map(([query, q]) => ({
              query,
              clicks: q.clicks,
              impressions: q.impressions,
              position: q.impressions
                ? round(q.posWeighted / q.impressions, 1)
                : null,
            }))
            .sort(
              (a, b) => b.clicks - a.clicks || b.impressions - a.impressions
            )
            .slice(0, 10),
        },
      ])
    )
    const sessionRows = this.ctx.db
      .select()
      .from(kpiDaily)
      .where(
        and(
          eq(kpiDaily.projectId, item.projectId),
          eq(kpiDaily.source, "ga4"),
          eq(kpiDaily.metric, "sessions"),
          gte(kpiDaily.date, from),
          lte(kpiDaily.date, to)
        )
      )
      .all()
    let sessions = 0
    let hasSessions = false
    const byChannel = new Map<string, number>()
    for (const r of sessionRows) {
      if (!r.dims) continue
      const d = parseJson<Record<string, string>>(r.dims, {})
      if (!d.landing || !pathMatches(d.landing, target)) continue
      hasSessions = true
      sessions += r.value
      const ch = d.channel ?? "(unbekannt)"
      byChannel.set(ch, (byChannel.get(ch) ?? 0) + r.value)
    }
    return {
      from,
      to,
      days,
      urlPath: target,
      search,
      sessions: hasSessions
        ? {
            total: sessions,
            byChannel: [...byChannel.entries()]
              .map(([channel, value]) => ({ channel, sessions: value }))
              .sort((a, b) => b.sessions - a.sessions),
          }
        : null,
    }
  }

  add(input: ContentInput, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, input.projectId)
      const title = input.title?.trim()
      if (!title) throw new VGError("INVALID", "title fehlt")
      const status = oneOf(input.status ?? "idea", CONTENT_STATUS, "status")
      const values = {
        projectId: project.id,
        channelId: checkChannel(ctx, project.id, input.channelId),
        kind: oneOf(input.kind ?? "blog", CONTENT_KINDS, "kind"),
        title,
        keyword: input.keyword ?? null,
        intent: input.intent ?? null,
        brief: input.brief ?? null,
        status,
        draftPath: cleanDraftPath(input.draftPath) ?? null,
        urlPath: cleanUrlPath(input.urlPath) ?? null,
        liveDate: input.liveDate
          ? assertDate(input.liveDate, "liveDate")
          : status === "live"
            ? today()
            : null,
        approvalId: input.approvalId
          ? getById(ctx, approvals, input.approvalId, "Freigabe").id
          : null,
        notes: input.notes ?? null,
        position: input.position ?? 0,
        actor,
        sourceKey: input.sourceKey ?? null,
      }
      const row = ctx.db.insert(contentItems).values(values).returning().get()
      recordHistory(ctx, {
        actor,
        entity: "content",
        entityId: row.id,
        action: "create",
        after: row,
      })
      return row
    })
  }

  update(id: number, p: ContentPatch, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const item = getById(ctx, contentItems, id, "Content")
      const patch: Record<string, unknown> = {}
      if (p.title !== undefined) {
        if (!p.title?.trim())
          throw new VGError("INVALID", "title darf nicht leer sein")
        patch.title = p.title.trim()
      }
      if (p.kind !== undefined)
        patch.kind = oneOf(p.kind, CONTENT_KINDS, "kind")
      if (p.status !== undefined)
        patch.status = oneOf(p.status, CONTENT_STATUS, "status")
      if (p.channelId !== undefined)
        patch.channelId = checkChannel(ctx, item.projectId, p.channelId)
      for (const k of ["keyword", "intent", "brief", "notes"] as const)
        if (p[k] !== undefined) patch[k] = p[k]
      if (p.draftPath !== undefined)
        patch.draftPath = cleanDraftPath(p.draftPath)
      if (p.urlPath !== undefined) patch.urlPath = cleanUrlPath(p.urlPath)
      if (p.liveDate !== undefined)
        patch.liveDate = p.liveDate ? assertDate(p.liveDate, "liveDate") : null
      if (p.approvalId !== undefined)
        patch.approvalId = p.approvalId
          ? getById(ctx, approvals, p.approvalId, "Freigabe").id
          : null
      if (p.position !== undefined) patch.position = p.position
      // Going live without a date: today.
      if (
        patch.status === "live" &&
        patch.liveDate === undefined &&
        !item.liveDate
      )
        patch.liveDate = today()
      return patchRow(ctx, contentItems, "content", id, patch, actor)
    })
  }
}

import { Injectable } from "@nestjs/common"
import { and, eq, inArray, type SQL } from "drizzle-orm"
import {
  backlogCategory,
  categoryFilter,
  categoryInput,
  withCategory,
} from "../../core/category"
import { backlogItems } from "../../core/schema"
import { getById, patchRow, recordHistory, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { listOf, oneOf, requireProject } from "./shared"

export const BACKLOG_KINDS = [
  "seo",
  "tech",
  "content",
  "store",
  "growth",
  "bug",
  "feature",
  "ux",
  "other",
] as const
export const BACKLOG_STATUS = ["open", "doing", "done", "dropped"] as const

export type BacklogRow = typeof backlogItems.$inferSelect

export interface BacklogInput {
  projectId: string
  title: string
  detail?: string | null
  kind?: string
  impact?: number
  effort?: number
  status?: string
  source?: string | null
  doneRef?: string | null
  position?: number
  sourceKey?: string | null
  category?: string | null
  notionUrl?: string | null
}

export type BacklogPatch = Partial<
  Omit<BacklogInput, "projectId" | "sourceKey">
>

const STATUS_ORDER = new Map<string, number>(
  BACKLOG_STATUS.map((s, i) => [s, i])
)

function scale(v: number, field: string) {
  if (!Number.isInteger(v) || v < 1 || v > 3)
    throw new VGError("INVALID", `${field} muss 1, 2 oder 3 sein, war: ${v}`)
  return v
}

/** Open work first: status, impact desc, effort asc, position. */
export function backlogOrder(a: BacklogRow, b: BacklogRow) {
  return (
    (STATUS_ORDER.get(a.status) ?? 9) - (STATUS_ORDER.get(b.status) ?? 9) ||
    b.impact - a.impact ||
    a.effort - b.effort ||
    a.position - b.position ||
    a.id - b.id
  )
}

/** Row with its effective category (stored or derived). */
export function backlogOut(r: BacklogRow) {
  return { ...r, category: backlogCategory(r) }
}

@Injectable()
export class BacklogService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  list(f: {
    project?: string
    status?: string
    kind?: string
    category?: string
  }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(backlogItems.projectId, f.project))
    const statuses = listOf(f.status, BACKLOG_STATUS, "status")
    if (statuses) conds.push(inArray(backlogItems.status, statuses))
    const kinds = listOf(f.kind, BACKLOG_KINDS, "kind")
    if (kinds) conds.push(inArray(backlogItems.kind, kinds))
    const rows = this.ctx.db
      .select()
      .from(backlogItems)
      .where(conds.length ? and(...conds) : undefined)
      .all()
      .sort(
        (a, b) => a.projectId.localeCompare(b.projectId) || backlogOrder(a, b)
      )
    return withCategory(rows, backlogCategory, categoryFilter(f.category))
  }

  get(id: number) {
    return backlogOut(getById(this.ctx, backlogItems, id, "Backlog-Eintrag"))
  }

  add(input: BacklogInput, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, input.projectId)
      const title = input.title?.trim()
      if (!title) throw new VGError("INVALID", "title fehlt")
      const row = ctx.db
        .insert(backlogItems)
        .values({
          projectId: project.id,
          title,
          detail: input.detail ?? null,
          kind: oneOf(input.kind ?? "other", BACKLOG_KINDS, "kind"),
          impact: scale(input.impact ?? 2, "impact"),
          effort: scale(input.effort ?? 2, "effort"),
          status: oneOf(input.status ?? "open", BACKLOG_STATUS, "status"),
          source: input.source ?? null,
          doneRef: input.doneRef ?? null,
          position: input.position ?? 0,
          actor,
          sourceKey: input.sourceKey ?? null,
          category: categoryInput(input.category) ?? null,
          notionUrl: input.notionUrl ?? null,
        })
        .returning()
        .get()
      recordHistory(ctx, {
        actor,
        entity: "backlog",
        entityId: row.id,
        action: "create",
        after: row,
      })
      return backlogOut(row)
    })
  }

  update(id: number, p: BacklogPatch, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      getById(ctx, backlogItems, id, "Backlog-Eintrag")
      const patch: Record<string, unknown> = {}
      if (p.title !== undefined) {
        if (!p.title?.trim())
          throw new VGError("INVALID", "title darf nicht leer sein")
        patch.title = p.title.trim()
      }
      if (p.kind !== undefined)
        patch.kind = oneOf(p.kind, BACKLOG_KINDS, "kind")
      if (p.status !== undefined)
        patch.status = oneOf(p.status, BACKLOG_STATUS, "status")
      if (p.impact !== undefined) patch.impact = scale(p.impact, "impact")
      if (p.effort !== undefined) patch.effort = scale(p.effort, "effort")
      for (const k of ["detail", "source", "doneRef", "notionUrl"] as const)
        if (p[k] !== undefined) patch[k] = p[k]
      if (p.position !== undefined) patch.position = p.position
      if (p.category !== undefined) patch.category = categoryInput(p.category)
      return backlogOut(
        patchRow(ctx, backlogItems, "backlog", id, patch, actor)
      )
    })
  }
}

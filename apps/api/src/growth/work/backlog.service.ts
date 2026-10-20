import fs from "node:fs"
import path from "node:path"
import { Injectable } from "@nestjs/common"
import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm"
import {
  backlogCategory,
  categoryFilter,
  categoryInput,
  withCategory,
} from "../../core/category"
import { resolveInDataDir } from "../../core/config"
import { backlogItems, taskComments } from "../../core/schema"
import {
  getById,
  isMax,
  json,
  nowIso,
  parseJson,
  patchRow,
  recordHistory,
  VGError,
} from "../../core/util"
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
/** testing = the assignee reported a result, max checks it ("Passt" → done, "Klappt nicht" → open). */
export const BACKLOG_STATUS = [
  "open",
  "doing",
  "testing",
  "done",
  "dropped",
] as const
export const ASSIGNEES = ["byte", "hunter", "echo", "max"] as const
/** Still in work: an inbox item with such a task waits (state tasks_open, replies held back). */
export const OPEN_TASK_STATUS = ["open", "doing", "testing"] as const
export const isOpenTask = (t: { status: string }) =>
  (OPEN_TASK_STATUS as readonly string[]).includes(t.status)
export const TASK_SOURCE_TYPES = ["feature_request", "review"] as const
export const COMMENT_KINDS = [
  "comment",
  "report",
  "feedback",
  "accept",
] as const

export interface TaskSource {
  type: (typeof TASK_SOURCE_TYPES)[number]
  id: string
}

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
  assignee?: string | null
  sources?: TaskSource[] | null
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

/** Row with its effective category (stored or derived) and parsed sources. */
export function backlogOut(r: BacklogRow) {
  return {
    ...r,
    category: backlogCategory(r),
    sources: parseJson<TaskSource[]>(r.sources, []),
  }
}

function assigneeInput(v: string | null | undefined) {
  if (v === undefined) return undefined
  if (v === null || v === "" || v === "none") return null
  return oneOf(v.toLowerCase(), ASSIGNEES, "assignee")
}

/** [{type, id}] with known types, deduplicated; null/[] = none. */
export function sourcesInput(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (!Array.isArray(v))
    throw new VGError("INVALID", "sources muss eine Liste sein")
  const seen = new Set<string>()
  const out: TaskSource[] = []
  v.forEach((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>
    const id =
      typeof o.id === "number"
        ? String(o.id)
        : typeof o.id === "string"
          ? o.id.trim()
          : ""
    if (typeof o.type !== "string" || !id)
      throw new VGError("INVALID", `sources[${i}] braucht type und id`)
    const type = oneOf(o.type, TASK_SOURCE_TYPES, `sources[${i}].type`)
    const key = `${type}|${id}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ type, id })
    }
  })
  return out.length ? json(out) : null
}

export type TaskCommentRow = typeof taskComments.$inferSelect

export function commentOut(c: TaskCommentRow) {
  return { ...c, attachments: parseJson<string[]>(c.attachments, []) }
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
    assignee?: string
  }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(backlogItems.projectId, f.project))
    if (f.assignee === "none") conds.push(isNull(backlogItems.assignee))
    else {
      const who = listOf(f.assignee, ASSIGNEES, "assignee")
      if (who) conds.push(inArray(backlogItems.assignee, who))
    }
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
    return withCategory(rows, backlogCategory, categoryFilter(f.category)).map(
      (r) => ({ ...r, sources: parseJson<TaskSource[]>(r.sources, []) })
    )
  }

  /** Item with its thread (oldest first). */
  get(id: number) {
    const row = getById(this.ctx, backlogItems, id, "Backlog-Eintrag")
    return { ...backlogOut(row), comments: this.comments(id) }
  }

  comments(id: number) {
    return this.ctx.db
      .select()
      .from(taskComments)
      .where(eq(taskComments.backlogItemId, id))
      .orderBy(asc(taskComments.id))
      .all()
      .map(commentOut)
  }

  /** Tasks linked to inbox items of these projects, key `${projectId}|${type}|${id}`. */
  linkedToInbox(projectIds: string[]) {
    const byItem = new Map<string, ReturnType<typeof backlogOut>[]>()
    if (!projectIds.length) return byItem
    const rows = this.ctx.db
      .select()
      .from(backlogItems)
      .where(inArray(backlogItems.projectId, projectIds))
      .all()
    for (const r of rows) {
      if (!r.sources) continue
      const out = backlogOut(r)
      for (const src of out.sources) {
        const key = `${r.projectId}|${src.type}|${src.id}`
        byItem.set(key, [...(byItem.get(key) ?? []), out])
      }
    }
    return byItem
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
          assignee: assigneeInput(input.assignee) ?? null,
          sources: sourcesInput(input.sources) ?? null,
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
      if (p.assignee !== undefined) patch.assignee = assigneeInput(p.assignee)
      if (p.sources !== undefined) patch.sources = sourcesInput(p.sources)
      return backlogOut(
        patchRow(ctx, backlogItems, "backlog", id, patch, actor)
      )
    })
  }

  /** Copy files into <dataDir>/growth/tasks/<id>/ and return their relative paths. */
  private storeAttachments(id: number, files: string[]) {
    const dataDir = this.ctx.config.dataDir
    const rel = path.join("growth", "tasks", String(id))
    const dir = resolveInDataDir(dataDir, rel)
    const stamp = nowIso().replace(/[-:]/g, "").replace(/\..*$/, "")
    return files.map((file, i) => {
      if (!path.isAbsolute(file))
        throw new VGError(
          "INVALID",
          `Anhang braucht einen absoluten Pfad: ${file}`
        )
      if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        throw new VGError("NOT_FOUND", `Anhang nicht gefunden: ${file}`)
      fs.mkdirSync(dir, { recursive: true })
      const name = `${stamp}-${i + 1}-${path.basename(file).replace(/[^\w.-]+/g, "_")}`
      fs.copyFileSync(file, path.join(dir, name))
      return path.join(rel, name)
    })
  }

  private insertComment(
    id: number,
    c: { kind: string; body: string; attachments?: string[] },
    actor: string
  ) {
    const ctx = this.ctx
    const body = c.body?.trim()
    if (!body) throw new VGError("INVALID", "body fehlt")
    const files = c.attachments?.length
      ? this.storeAttachments(id, c.attachments)
      : []
    const row = ctx.db
      .insert(taskComments)
      .values({
        backlogItemId: id,
        kind: oneOf(c.kind, COMMENT_KINDS, "kind"),
        body,
        attachments: files.length ? json(files) : null,
        actor,
      })
      .returning()
      .get()
    recordHistory(ctx, {
      actor,
      entity: "task_comment",
      entityId: row.id,
      action: "create",
      after: row,
    })
    return commentOut(row)
  }

  /** POST /backlog/:id/comments: note in the thread; attachments are absolute file paths. */
  comment(
    id: number,
    c: { body: string; attachments?: string[] },
    actor: string
  ) {
    return this.database.tx(() => {
      getById(this.ctx, backlogItems, id, "Backlog-Eintrag")
      this.insertComment(id, { kind: "comment", ...c }, actor)
      return this.get(id)
    })
  }

  /** POST /backlog/:id/report (assignee): result with test steps; status testing, done_ref = commit. */
  report(
    id: number,
    r: { body: string; attachments?: string[]; doneRef?: string | null },
    actor: string
  ) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const row = getById(ctx, backlogItems, id, "Backlog-Eintrag")
      if (row.status === "done" || row.status === "dropped")
        throw new VGError(
          "CONFLICT",
          `Aufgabe ${id} ist bereits ${row.status === "done" ? "erledigt" : "verworfen"}`
        )
      this.insertComment(id, { kind: "report", ...r }, actor)
      const patch: Record<string, unknown> = { status: "testing" }
      if (r.doneRef !== undefined) patch.doneRef = r.doneRef
      patchRow(ctx, backlogItems, "backlog", id, patch, actor, "report")
      return this.get(id)
    })
  }

  /** POST /backlog/:id/accept (max): "Passt" → done, accepted_at. */
  accept(id: number, c: { body?: string | null }, actor: string) {
    const ctx = this.ctx
    if (!isMax(actor))
      throw new VGError("LOCKED", "Nur max bestätigt eine Aufgabe")
    return this.database.tx(() => {
      const row = getById(ctx, backlogItems, id, "Backlog-Eintrag")
      if (row.status === "done" || row.status === "dropped")
        throw new VGError(
          "CONFLICT",
          `Aufgabe ${id} ist bereits ${row.status === "done" ? "erledigt" : "verworfen"}`
        )
      this.insertComment(
        id,
        { kind: "accept", body: c.body?.trim() || "Passt." },
        actor
      )
      patchRow(
        ctx,
        backlogItems,
        "backlog",
        id,
        { status: "done", acceptedAt: nowIso() },
        actor,
        "accept"
      )
      return this.get(id)
    })
  }

  /** POST /backlog/:id/reopen (max): "Klappt nicht" with the reason → open again. */
  reopen(
    id: number,
    c: { body: string; attachments?: string[] },
    actor: string
  ) {
    const ctx = this.ctx
    if (!isMax(actor))
      throw new VGError("LOCKED", "Nur max schickt eine Aufgabe zurück")
    return this.database.tx(() => {
      const row = getById(ctx, backlogItems, id, "Backlog-Eintrag")
      if (row.status === "dropped")
        throw new VGError("CONFLICT", `Aufgabe ${id} ist verworfen`)
      if (row.releasedVersion)
        throw new VGError(
          "CONFLICT",
          `Aufgabe ${id} ist schon in Version ${row.releasedVersion} ausgeliefert, bitte neue Aufgabe anlegen`
        )
      this.insertComment(id, { kind: "feedback", ...c }, actor)
      patchRow(
        ctx,
        backlogItems,
        "backlog",
        id,
        { status: "open", acceptedAt: null },
        actor,
        "reopen"
      )
      return this.get(id)
    })
  }

  /** POST /backlog/release: accepted, not yet shipped tasks of a project get the app version. */
  release(
    f: { projectId: string; version: string; ids?: number[] },
    actor: string
  ) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, f.projectId)
      const version = f.version?.trim()
      if (!version) throw new VGError("INVALID", "version fehlt")
      const rows = ctx.db
        .select()
        .from(backlogItems)
        .where(
          and(
            eq(backlogItems.projectId, project.id),
            eq(backlogItems.status, "done"),
            isNull(backlogItems.releasedVersion)
          )
        )
        .all()
        .filter((r) => r.acceptedAt && (!f.ids || f.ids.includes(r.id)))
      if (f.ids) {
        const missing = f.ids.filter((i) => !rows.some((r) => r.id === i))
        if (missing.length)
          throw new VGError(
            "INVALID",
            `Nicht bestätigt oder schon ausgeliefert: ${missing.join(", ")}`
          )
      }
      const at = nowIso()
      const out = rows.map((r) =>
        backlogOut(
          patchRow(
            ctx,
            backlogItems,
            "backlog",
            r.id,
            { releasedVersion: version, releasedAt: at },
            actor,
            "release"
          )
        )
      )
      return { project: project.id, version, released: out }
    })
  }
}

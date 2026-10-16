import { Injectable } from "@nestjs/common"
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm"
import {
  approvalCategory,
  categoryFilter,
  categoryInput,
} from "../../core/category"
import { getEntry as getPlanEntry, lockEntry } from "../../core/plan"
import {
  accounts,
  approvals,
  backlogItems,
  collectors,
  contentItems,
  experiments,
  featureRequests,
  formats,
  history,
  hooks,
  planEntries,
  storeReviews,
} from "../../core/schema"
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
import { BacklogService } from "./backlog.service"
import { listOf, oneOf, optOneOf, requireProject } from "./shared"

export const APPROVAL_KINDS = [
  "hook",
  "format",
  "blog_topic",
  "draft",
  "store_text",
  "strategy",
  "reply",
  "task",
  "other",
] as const
export const APPROVAL_REF_TYPES = [
  "plan_entry",
  "content",
  "format",
  "hook",
  "experiment",
  "backlog",
] as const
export const APPROVAL_STATUS = [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
  "withdrawn",
] as const

/** CLI flags --approve|--reject|--changes and the stored status names. */
const DECISIONS: Record<string, "approved" | "rejected" | "changes_requested"> =
  {
    approve: "approved",
    approved: "approved",
    reject: "rejected",
    rejected: "rejected",
    changes: "changes_requested",
    changes_requested: "changes_requested",
  }

export type ApprovalRow = typeof approvals.$inferSelect

export interface ApprovalInput {
  projectId: string
  accountId?: string | null
  kind?: string
  title: string
  body?: string | null
  payload?: Record<string, unknown>
  refType?: string | null
  refId?: string | number | null
  category?: string | null
}

/** Where a reply goes and how long it may be (Google Play: 350 characters). */
export const REPLY_TARGETS = ["featurama", "google_play", "app_store"] as const
export type ReplyTarget = (typeof REPLY_TARGETS)[number]
export const REPLY_MAX_LENGTH: Record<ReplyTarget, number> = {
  featurama: 10_000,
  google_play: 350,
  app_store: 5_970,
}
export const TASK_KINDS = ["bug", "feature", "ux", "store", "other"] as const

/** payload of kind reply (contract §7.8). */
export interface ReplyPayload {
  target: ReplyTarget
  /** Featurama project id, Play package or App Store app id */
  projectRef: string
  /** Featurama request id or store review id */
  itemId: string
  /** lastUserCommentAt (Featurama) or last_modified (review) the agent saw; null = no user comment */
  lastSeen: string | null
  text: string
  language: string | null
  /** set by app publish */
  published?: { at: string; ref: string | null; verified: boolean }
  publish?: { state: "stale" | "error"; at: string; reason: string }
  [key: string]: unknown
}

export function approvalOut(a: ApprovalRow) {
  return {
    ...a,
    category: approvalCategory(a),
    payload: parseJson<Record<string, unknown>>(a.payload, {}),
  }
}

export function replyText(
  target: ReplyTarget,
  text: unknown,
  field = "payload.text"
): string {
  if (typeof text !== "string" || !text.trim())
    throw new VGError("INVALID", `${field} fehlt`)
  const t = text.trim()
  const max = REPLY_MAX_LENGTH[target]
  if (t.length > max)
    throw new VGError(
      "INVALID",
      `${field} ist ${t.length} Zeichen lang, ${target} erlaubt höchstens ${max}`
    )
  return t
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : undefined

function scale(v: unknown, field: string, fallback: number) {
  if (v === undefined || v === null) return fallback
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 3)
    throw new VGError("INVALID", `${field} muss 1, 2 oder 3 sein`)
  return v
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly backlog: BacklogService
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  list(f: {
    project?: string
    status?: string
    kind?: string
    account?: string
    limit?: number
    category?: string
  }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(approvals.projectId, f.project))
    const status = f.status === "all" ? undefined : f.status
    const statuses = listOf(status, APPROVAL_STATUS, "status")
    if (statuses) conds.push(inArray(approvals.status, statuses))
    const kinds = listOf(f.kind, APPROVAL_KINDS, "kind")
    if (kinds) conds.push(inArray(approvals.kind, kinds))
    if (f.account) conds.push(eq(approvals.accountId, f.account))
    const cats = categoryFilter(f.category)
    const rows = this.ctx.db
      .select()
      .from(approvals)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(approvals.createdAt), desc(approvals.id))
      .all()
      .map(approvalOut)
      .filter((a) => !cats || cats.has(a.category))
    return f.limit ? rows.slice(0, f.limit) : rows
  }

  get(id: number) {
    const a = getById(this.ctx, approvals, id, "Freigabe")
    const hist = this.ctx.db
      .select()
      .from(history)
      .where(
        and(eq(history.entity, "approval"), eq(history.entityId, String(id)))
      )
      .orderBy(asc(history.id))
      .all()
      .map((h) => ({
        ...h,
        before: parseJson<unknown>(h.before, null),
        after: parseJson<unknown>(h.after, null),
      }))
    return { ...approvalOut(a), ref: this.refObject(a), history: hist }
  }

  /** The referenced row (null when it no longer exists or no ref is set). */
  private refObject(a: ApprovalRow): unknown {
    if (!a.refType || !a.refId) return null
    try {
      return this.loadRef(a.refType, a.refId)
    } catch {
      return null
    }
  }

  private loadRef(refType: string, refId: string): Record<string, unknown> {
    const ctx = this.ctx
    const num = Number(refId)
    const needNum = () => {
      if (!Number.isInteger(num))
        throw new VGError("INVALID", `refId muss für ${refType} eine Zahl sein`)
      return num
    }
    switch (refType) {
      case "plan_entry":
        return getPlanEntry(ctx, needNum())
      case "content":
        return getById(ctx, contentItems, needNum(), "Content")
      case "format":
        return getById(ctx, formats, refId, "Format")
      case "hook":
        return getById(ctx, hooks, needNum(), "Hook")
      case "experiment":
        return getById(ctx, experiments, needNum(), "Experiment")
      case "backlog":
        return getById(ctx, backlogItems, needNum(), "Backlog-Eintrag")
    }
    throw new VGError("INVALID", `refType unbekannt: ${refType}`)
  }

  add(input: ApprovalInput, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, input.projectId)
      const title = input.title?.trim()
      if (!title) throw new VGError("INVALID", "title fehlt")
      const kind = oneOf(input.kind ?? "other", APPROVAL_KINDS, "kind")
      if (input.accountId) {
        const acc = getById(ctx, accounts, input.accountId, "Account")
        if (acc.brandId !== project.id)
          throw new VGError(
            "INVALID",
            `Account ${acc.id} gehört zu Projekt ${acc.brandId}, nicht zu ${project.id}`
          )
      }
      const refType = optOneOf(input.refType, APPROVAL_REF_TYPES, "refType")
      const refId =
        input.refId === undefined || input.refId === null || input.refId === ""
          ? null
          : String(input.refId)
      if (refType && !refId)
        throw new VGError("INVALID", "refId fehlt zu refType")
      if (!refType && refId)
        throw new VGError("INVALID", "refType fehlt zu refId")
      if (refType && refId) {
        const ref = this.loadRef(refType, refId)
        const refProject = this.refProject(refType, ref)
        if (refProject && refProject !== project.id)
          throw new VGError(
            "INVALID",
            `${refType} ${refId} gehört zu Projekt ${refProject}, nicht zu ${project.id}`
          )
      }
      let payload: Record<string, unknown> = input.payload ?? {}
      if (kind === "reply") payload = this.replyPayload(project.id, payload)
      if (kind === "task") payload = this.taskPayload(payload, title)
      const row = ctx.db
        .insert(approvals)
        .values({
          projectId: project.id,
          accountId: input.accountId || null,
          kind,
          title,
          body: input.body ?? null,
          payload: json(payload),
          refType: refType ?? null,
          refId,
          status: "pending",
          requestedBy: actor,
          category:
            categoryInput(input.category) ??
            (kind === "reply" || kind === "task" ? "app" : null),
        })
        .returning()
        .get()
      recordHistory(ctx, {
        actor,
        entity: "approval",
        entityId: row.id,
        action: "create",
        after: { ...approvalOut(row) },
      })
      // Link the content item to its approval when it has none yet.
      if (refType === "content") {
        const item = getById(ctx, contentItems, Number(refId), "Content")
        if (!item.approvalId)
          patchRow(
            ctx,
            contentItems,
            "content",
            item.id,
            { approvalId: row.id },
            actor
          )
      }
      return approvalOut(row)
    })
  }

  /**
   * reply payload: target, projectRef, itemId, lastSeen, text, language. The item must be in the
   * mirror (feature_requests / store_reviews, i.e. collected first); projectRef and lastSeen default
   * to the mirror. One open reply per item: pending or approved and not yet published → CONFLICT.
   */
  private replyPayload(
    projectId: string,
    p: Record<string, unknown>
  ): ReplyPayload {
    const ctx = this.ctx
    const extra = Object.keys(p).filter(
      (k) =>
        ![
          "target",
          "projectRef",
          "itemId",
          "lastSeen",
          "text",
          "language",
        ].includes(k)
    )
    if (extra.length)
      throw new VGError(
        "INVALID",
        `payload: unbekannte Felder für reply: ${extra.join(", ")}`
      )
    const target: ReplyTarget = oneOf(
      str(p.target) ?? "",
      REPLY_TARGETS,
      "payload.target"
    )
    const itemId =
      str(p.itemId) ??
      (typeof p.itemId === "number" ? String(p.itemId) : undefined)
    if (!itemId) throw new VGError("INVALID", "payload.itemId fehlt")
    const text = replyText(target, p.text)
    let mirrorRef: string | null
    let mirrorSeen: string | null
    if (target === "featurama") {
      const fr = ctx.db
        .select()
        .from(featureRequests)
        .where(
          and(
            eq(featureRequests.projectId, projectId),
            eq(featureRequests.requestId, itemId)
          )
        )
        .get()
      if (!fr)
        throw new VGError(
          "NOT_FOUND",
          `Feature-Request ${itemId} ist für ${projectId} nicht erfasst (vorher collect --project ${projectId} --collector featurama)`
        )
      mirrorRef = fr.featuramaProjectId
      mirrorSeen = fr.lastUserCommentAt
    } else {
      const store = target
      const rv = ctx.db
        .select()
        .from(storeReviews)
        .where(
          and(
            eq(storeReviews.projectId, projectId),
            eq(storeReviews.store, store),
            eq(storeReviews.reviewId, itemId)
          )
        )
        .get()
      if (!rv)
        throw new VGError(
          "NOT_FOUND",
          `Bewertung ${itemId} (${store}) ist für ${projectId} nicht erfasst (vorher collect --project ${projectId} --collector reviews)`
        )
      mirrorSeen = rv.lastModified
      mirrorRef = this.storeRef(projectId, store)
    }
    const projectRef = str(p.projectRef) ?? mirrorRef
    if (!projectRef)
      throw new VGError(
        "INVALID",
        `payload.projectRef fehlt (${target === "google_play" ? "Paketname" : "App-ID"}; Collector reviews konfigurieren)`
      )
    if (mirrorRef && projectRef !== mirrorRef)
      throw new VGError(
        "INVALID",
        `payload.projectRef ${projectRef} passt nicht zu ${itemId} (${mirrorRef})`
      )
    const lastSeen =
      "lastSeen" in p
        ? p.lastSeen === null
          ? null
          : (str(p.lastSeen) ??
            (() => {
              throw new VGError(
                "INVALID",
                "payload.lastSeen muss ein Zeitstempel oder null sein"
              )
            })())
        : mirrorSeen
    const open = ctx.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.projectId, projectId),
          eq(approvals.kind, "reply"),
          inArray(approvals.status, ["pending", "approved"])
        )
      )
      .all()
      .find((a) => {
        const q = parseJson<Partial<ReplyPayload>>(a.payload, {})
        return (
          q.target === target &&
          q.itemId === itemId &&
          !q.published &&
          q.publish?.state !== "stale"
        )
      })
    if (open)
      throw new VGError(
        "CONFLICT",
        `Für ${target} ${itemId} gibt es schon eine offene Antwort (Freigabe ${open.id}, ${open.status})`
      )
    const language = str(p.language) ?? null
    return { target, projectRef, itemId, lastSeen, text, language }
  }

  /** Package (google_play) or app id (app_store) from the collector configs reviews, play, asc. */
  storeRef(projectId: string, store: "google_play" | "app_store") {
    const rows = this.ctx.db
      .select()
      .from(collectors)
      .where(eq(collectors.projectId, projectId))
      .all()
    const cfg = (id: string) =>
      parseJson<Record<string, unknown>>(
        rows.find((r) => r.collector === id)?.config,
        {}
      )
    const key = store === "google_play" ? "package" : "appId"
    const peer = store === "google_play" ? "play" : "asc"
    return str(cfg("reviews")[key]) ?? str(cfg(peer)[key]) ?? null
  }

  /** task payload: title, detail, kind (bug|feature|ux|store|other), impact, effort, sources [{type,id}]. */
  private taskPayload(p: Record<string, unknown>, title: string) {
    const sources = p.sources ?? []
    if (!Array.isArray(sources))
      throw new VGError("INVALID", "payload.sources muss eine Liste sein")
    const cleanSources = sources.map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>
      const type = str(o.type)
      const id =
        typeof o.id === "number" ? String(o.id) : (str(o.id) ?? undefined)
      if (!type || !id)
        throw new VGError(
          "INVALID",
          `payload.sources[${i}] braucht type und id`
        )
      return { type, id }
    })
    const detail = p.detail === undefined || p.detail === null ? null : p.detail
    if (detail !== null && typeof detail !== "string")
      throw new VGError("INVALID", "payload.detail muss Text sein")
    const extra = Object.keys(p).filter(
      (k) =>
        !["title", "detail", "kind", "impact", "effort", "sources"].includes(k)
    )
    if (extra.length)
      throw new VGError(
        "INVALID",
        `payload: unbekannte Felder für task: ${extra.join(", ")}`
      )
    return {
      title: str(p.title) ?? title,
      detail,
      kind: oneOf(str(p.kind) ?? "other", TASK_KINDS, "payload.kind"),
      impact: scale(p.impact, "payload.impact", 2),
      effort: scale(p.effort, "payload.effort", 2),
      sources: cleanSources,
    }
  }

  /** Project of a referenced row, null for rows without one (hooks via account). */
  private refProject(
    refType: string,
    ref: Record<string, unknown>
  ): string | null {
    if (typeof ref.projectId === "string") return ref.projectId
    if (typeof ref.brandId === "string") return ref.brandId
    const accountId =
      refType === "plan_entry" || refType === "hook" ? ref.accountId : null
    if (typeof accountId === "string") {
      const acc = this.ctx.db
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get()
      return acc?.brandId ?? null
    }
    return null
  }

  decide(
    id: number,
    input: { decision: string; note?: string | null; text?: string | null },
    actor: string
  ) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const a = getById(ctx, approvals, id, "Freigabe")
      if (!isMax(actor))
        throw new VGError(
          "LOCKED",
          `Freigabe ${id} (${a.title}) entscheidet nur Max, nicht ${actor}`
        )
      const status = DECISIONS[input.decision]
      if (!status)
        throw new VGError(
          "INVALID",
          `decision muss einer von approve, reject, changes sein, war: ${input.decision}`
        )
      if (a.status !== "pending")
        throw new VGError(
          "CONFLICT",
          `Freigabe ${id} ist nicht offen (Status ${a.status})`
        )
      const patch: Record<string, unknown> = {
        status,
        decidedBy: actor,
        decidedAt: nowIso(),
        decisionNote: input.note?.trim() || null,
      }
      if (input.text !== undefined && input.text !== null) {
        if (a.kind !== "reply")
          throw new VGError(
            "INVALID",
            `text gibt es nur bei Freigaben der Art reply, Freigabe ${id} ist ${a.kind}`
          )
        if (status !== "approved")
          throw new VGError(
            "INVALID",
            "text nur zusammen mit approve (Ändern & freigeben)"
          )
        const payload = parseJson<ReplyPayload>(a.payload, {} as ReplyPayload)
        const text = replyText(payload.target, input.text, "text")
        // The original text stays in history (before.payload).
        if (text !== payload.text)
          patch.payload = json({ ...payload, text, editedBy: actor })
      }
      const updated = patchRow(
        ctx,
        approvals,
        "approval",
        id,
        patch,
        actor,
        "decide"
      )
      const effects: { entity: string; id: string; change: string }[] = []
      if (patch.payload)
        effects.push({
          entity: "approval",
          id: String(id),
          change: "Antworttext geändert",
        })
      if (status === "approved" && a.kind === "task") {
        const t = parseJson<ReturnType<ApprovalsService["taskPayload"]>>(
          a.payload,
          {} as ReturnType<ApprovalsService["taskPayload"]>
        )
        const sourceKey = `approval:${id}`
        const existing = ctx.db
          .select()
          .from(backlogItems)
          .where(eq(backlogItems.sourceKey, sourceKey))
          .get()
        const item =
          existing ??
          this.backlog.add(
            {
              projectId: a.projectId,
              title: t.title || a.title,
              detail: t.detail ?? a.body ?? null,
              kind: t.kind ?? "other",
              impact: t.impact ?? 2,
              effort: t.effort ?? 2,
              source: [
                `Freigabe ${id}`,
                ...(t.sources ?? []).map((s) => `${s.type} ${s.id}`),
              ].join(", "),
              category: "app",
              sourceKey,
            },
            actor
          )
        patchRow(
          ctx,
          approvals,
          "approval",
          id,
          { refType: "backlog", refId: String(item.id) },
          actor
        )
        effects.push({
          entity: "backlog",
          id: String(item.id),
          change: existing ? "Aufgabe verknüpft" : "Aufgabe angelegt",
        })
        return {
          ...approvalOut(getById(ctx, approvals, id, "Freigabe")),
          effects,
        }
      }
      if (status === "approved" && a.refType && a.refId) {
        if (a.refType === "content") {
          const item = getById(ctx, contentItems, Number(a.refId), "Content")
          const patch: Record<string, unknown> = {}
          if (item.status === "idea") patch.status = "approved"
          if (!item.approvalId) patch.approvalId = id
          if (Object.keys(patch).length) {
            patchRow(ctx, contentItems, "content", item.id, patch, actor)
            if (patch.status)
              effects.push({
                entity: "content",
                id: String(item.id),
                change: "status idea → approved",
              })
          }
        } else if (a.refType === "plan_entry") {
          const entry = getById(
            ctx,
            planEntries,
            Number(a.refId),
            "Planeintrag"
          )
          if (!entry.locked) {
            lockEntry(ctx, entry.id, true, actor)
            effects.push({
              entity: "plan_entry",
              id: String(entry.id),
              change: "locked",
            })
          }
        }
      }
      return { ...approvalOut(updated), effects }
    })
  }

  withdraw(id: number, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const a = getById(ctx, approvals, id, "Freigabe")
      if (!isMax(actor) && actor !== a.requestedBy)
        throw new VGError(
          "LOCKED",
          `Freigabe ${id} kann nur ${a.requestedBy} oder Max zurückziehen`
        )
      if (a.status !== "pending" && a.status !== "changes_requested")
        throw new VGError(
          "CONFLICT",
          `Freigabe ${id} ist bereits entschieden (Status ${a.status})`
        )
      return approvalOut(
        patchRow(
          ctx,
          approvals,
          "approval",
          id,
          { status: "withdrawn" },
          actor,
          "withdraw"
        )
      )
    })
  }
}

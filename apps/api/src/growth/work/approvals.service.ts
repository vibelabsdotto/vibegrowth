import { Injectable } from "@nestjs/common"
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm"
import { getEntry as getPlanEntry, lockEntry } from "../../core/plan"
import {
  accounts,
  approvals,
  backlogItems,
  contentItems,
  experiments,
  formats,
  history,
  hooks,
  planEntries,
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
import { listOf, oneOf, optOneOf, requireProject } from "./shared"

export const APPROVAL_KINDS = [
  "hook",
  "format",
  "blog_topic",
  "draft",
  "store_text",
  "strategy",
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
}

export function approvalOut(a: ApprovalRow) {
  return { ...a, payload: parseJson<Record<string, unknown>>(a.payload, {}) }
}

@Injectable()
export class ApprovalsService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  list(f: {
    project?: string
    status?: string
    kind?: string
    account?: string
    limit?: number
  }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(approvals.projectId, f.project))
    const status = f.status === "all" ? undefined : f.status
    const statuses = listOf(status, APPROVAL_STATUS, "status")
    if (statuses) conds.push(inArray(approvals.status, statuses))
    const kinds = listOf(f.kind, APPROVAL_KINDS, "kind")
    if (kinds) conds.push(inArray(approvals.kind, kinds))
    if (f.account) conds.push(eq(approvals.accountId, f.account))
    const q = this.ctx.db
      .select()
      .from(approvals)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(approvals.createdAt), desc(approvals.id))
    return (f.limit ? q.limit(f.limit) : q).all().map(approvalOut)
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
      const row = ctx.db
        .insert(approvals)
        .values({
          projectId: project.id,
          accountId: input.accountId || null,
          kind,
          title,
          body: input.body ?? null,
          payload: json(input.payload ?? {}),
          refType: refType ?? null,
          refId,
          status: "pending",
          requestedBy: actor,
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
    input: { decision: string; note?: string | null },
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
      const updated = patchRow(
        ctx,
        approvals,
        "approval",
        id,
        {
          status,
          decidedBy: actor,
          decidedAt: nowIso(),
          decisionNote: input.note?.trim() || null,
        },
        actor,
        "decide"
      )
      const effects: { entity: string; id: string; change: string }[] = []
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

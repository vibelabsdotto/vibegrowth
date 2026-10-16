import { Injectable } from "@nestjs/common"
import { and, desc, eq, inArray, type SQL } from "drizzle-orm"
import type { FeatureRequestRow } from "../../collectors/sources/types"
import { approvals, featureRequests, storeReviews } from "../../core/schema"
import {
  json,
  nowIso,
  parseJson,
  patchRow,
  recordHistory,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { ApprovalsService } from "./approvals.service"
import { oneOf, requireProject } from "./shared"

export const INBOX_TYPES = ["feature_request", "review"] as const

export type FeatureRequestDbRow = typeof featureRequests.$inferSelect

export function featureRequestOut(r: FeatureRequestDbRow) {
  return { ...r, comments: parseJson<unknown[]>(r.comments, []) }
}

interface LinkedApproval {
  id: number
  kind: string
  status: string
  title: string
  published: unknown
  publish: unknown
}

/**
 * App inbox: Featurama requests (feature_requests) and store reviews with reply status. Written by
 * the collectors featurama/reviews and by `app publish`; read by GET /app/inbox.
 */
@Injectable()
export class AppInboxService {
  constructor(
    private readonly database: DatabaseService,
    private readonly approvalsService: ApprovalsService
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Upsert requests by (project, request_id); one history entry per call. comments null keeps the stored thread. */
  upsertFeatureRequests(
    projectId: string,
    rows: FeatureRequestRow[],
    actor: string
  ) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, projectId)
      let inserted = 0
      let updated = 0
      for (const r of rows) {
        if (!r.requestId) throw new VGError("INVALID", "requestId fehlt")
        const values = {
          featuramaProjectId: r.featuramaProjectId,
          title: r.title || "(ohne Titel)",
          body: r.body,
          status: r.status,
          votes: r.votes,
          approved: r.approved,
          platform: r.platform,
          appVersion: r.appVersion,
          requestedAt: r.requestedAt,
          lastUserCommentAt: r.lastUserCommentAt,
          lastDeveloperCommentAt: r.lastDeveloperCommentAt,
          needsReply: r.needsReply,
          commentCount: r.commentCount,
          url: r.url,
          ...(r.comments ? { comments: json(r.comments) } : {}),
        }
        const existing = ctx.db
          .select({ id: featureRequests.id })
          .from(featureRequests)
          .where(
            and(
              eq(featureRequests.projectId, project.id),
              eq(featureRequests.requestId, r.requestId)
            )
          )
          .get()
        if (existing) {
          ctx.db
            .update(featureRequests)
            .set({ ...values, updatedAt: nowIso() })
            .where(eq(featureRequests.id, existing.id))
            .run()
          updated++
        } else {
          ctx.db
            .insert(featureRequests)
            .values({
              projectId: project.id,
              requestId: r.requestId,
              ...values,
            })
            .run()
          inserted++
        }
      }
      const needsReply = rows.filter((r) => r.approved && r.needsReply).length
      recordHistory(ctx, {
        actor,
        entity: "feature_requests",
        entityId: project.id,
        action: "import",
        after: { rows: rows.length, inserted, updated, needsReply },
      })
      return { inserted, updated, needsReply }
    })
  }

  findFeatureRequest(projectId: string, requestId: string) {
    return (
      this.ctx.db
        .select()
        .from(featureRequests)
        .where(
          and(
            eq(featureRequests.projectId, projectId),
            eq(featureRequests.requestId, requestId)
          )
        )
        .get() ?? null
    )
  }

  /** After `app publish`: developer comment on the request (inside the caller's transaction). */
  markFeatureReplied(
    projectId: string,
    requestId: string,
    comment: {
      id: string
      content: string
      createdAt: string
      author: string | null
    },
    actor: string
  ) {
    const row = this.findFeatureRequest(projectId, requestId)
    if (!row) return null
    const comments = parseJson<unknown[]>(row.comments, [])
    return patchRow(
      this.ctx,
      featureRequests,
      "feature_request",
      row.id,
      {
        needsReply: false,
        lastDeveloperCommentAt: comment.createdAt,
        commentCount: row.commentCount + 1,
        comments: json([...comments, { ...comment, role: "developer" }]),
      },
      actor,
      "reply"
    )
  }

  /** reply/task approvals per inbox item (reply: payload.itemId, task: payload.sources). */
  private linked(projectIds: string[]) {
    const byItem = new Map<string, LinkedApproval[]>()
    if (!projectIds.length) return byItem
    const rows = this.ctx.db
      .select()
      .from(approvals)
      .where(
        and(
          inArray(approvals.projectId, projectIds),
          inArray(approvals.kind, ["reply", "task"])
        )
      )
      .orderBy(desc(approvals.id))
      .all()
    const add = (
      key: string,
      a: (typeof rows)[number],
      p: Record<string, unknown>
    ) =>
      byItem.set(key, [
        ...(byItem.get(key) ?? []),
        {
          id: a.id,
          kind: a.kind,
          status: a.status,
          title: a.title,
          published: p.published ?? null,
          publish: p.publish ?? null,
        },
      ])
    for (const a of rows) {
      const p = parseJson<Record<string, unknown>>(a.payload, {})
      if (a.kind === "reply" && typeof p.itemId === "string") {
        const type = p.target === "featurama" ? "feature_request" : "review"
        add(`${a.projectId}|${type}|${p.itemId}`, a, p)
      }
      if (a.kind === "task" && Array.isArray(p.sources))
        for (const s of p.sources as { type?: string; id?: string }[])
          if (s?.type && s.id) add(`${a.projectId}|${s.type}|${s.id}`, a, p)
    }
    return byItem
  }

  inbox(f: {
    project?: string
    type?: string
    needsReply?: boolean
    limit?: number
  }) {
    const ctx = this.ctx
    const project = f.project ? requireProject(ctx, f.project) : null
    const type = f.type ? oneOf(f.type, INBOX_TYPES, "type") : undefined
    const limit = f.limit ?? 200
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
      throw new VGError("INVALID", `limit muss 1–5000 sein, war: ${limit}`)

    const frConds: SQL[] = []
    if (project) frConds.push(eq(featureRequests.projectId, project.id))
    const requests = ctx.db
      .select()
      .from(featureRequests)
      .where(frConds.length ? and(...frConds) : undefined)
      .all()
    const rvConds: SQL[] = []
    if (project) rvConds.push(eq(storeReviews.projectId, project.id))
    const reviews = ctx.db
      .select()
      .from(storeReviews)
      .where(rvConds.length ? and(...rvConds) : undefined)
      .all()
    const textReviews = reviews.filter((r) => r.title || r.body)

    const projectIds = [
      ...new Set([
        ...requests.map((r) => r.projectId),
        ...reviews.map((r) => r.projectId),
      ]),
    ]
    const links = this.linked(projectIds)
    const refs = new Map<string, string | null>()
    const storeRef = (
      projectId: string,
      store: "google_play" | "app_store"
    ) => {
      const k = `${projectId}|${store}`
      if (!refs.has(k))
        refs.set(k, this.approvalsService.storeRef(projectId, store))
      return refs.get(k)!
    }

    const items: ({ needsReply: boolean; lastActivity: string } & Record<
      string,
      unknown
    >)[] = []
    if (type !== "review")
      for (const r of requests) {
        // Featurama counts needsReply on approved requests; pending ones wait for approval there.
        const needs = r.approved && r.needsReply
        if (f.needsReply !== undefined && needs !== f.needsReply) continue
        items.push({
          type: "feature_request",
          target: "featurama",
          itemId: r.requestId,
          projectRef: r.featuramaProjectId,
          lastSeen: r.lastUserCommentAt,
          ...featureRequestOut(r),
          needsReply: needs,
          lastActivity:
            [r.lastUserCommentAt, r.lastDeveloperCommentAt, r.requestedAt]
              .filter(Boolean)
              .sort()
              .pop() ?? r.createdAt,
          approvals:
            links.get(`${r.projectId}|feature_request|${r.requestId}`) ?? [],
        })
      }
    if (type !== "feature_request")
      for (const r of textReviews) {
        if (f.needsReply !== undefined && r.needsReply !== f.needsReply)
          continue
        const store = r.store as "google_play" | "app_store"
        items.push({
          type: "review",
          target: store,
          itemId: r.reviewId,
          projectRef: storeRef(r.projectId, store),
          lastSeen: r.lastModified,
          ...r,
          lastActivity:
            [r.lastModified, r.replyAt, r.date].filter(Boolean).sort().pop() ??
            r.createdAt,
          approvals: links.get(`${r.projectId}|review|${r.reviewId}`) ?? [],
        })
      }
    items.sort(
      (a, b) =>
        Number(b.needsReply) - Number(a.needsReply) ||
        b.lastActivity.localeCompare(a.lastActivity)
    )
    const count = (list: { needsReply: boolean }[]) => ({
      total: list.length,
      needsReply: list.filter((r) => r.needsReply).length,
    })
    return {
      project: project?.id ?? null,
      counts: {
        featureRequests: {
          total: requests.length,
          needsReply: requests.filter((r) => r.approved && r.needsReply).length,
          pending: requests.filter((r) => !r.approved).length,
        },
        reviews: {
          ...count(textReviews),
          ratingsOnly: reviews.length - textReviews.length,
          google_play: count(
            textReviews.filter((r) => r.store === "google_play")
          ),
          app_store: count(textReviews.filter((r) => r.store === "app_store")),
        },
      },
      items: items.slice(0, limit),
    }
  }
}

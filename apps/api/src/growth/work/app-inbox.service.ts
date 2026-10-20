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
import { ApprovalsService, noReplyActive } from "./approvals.service"
import { BacklogService, isOpenTask, type backlogOut } from "./backlog.service"
import { listOf, oneOf, requireProject } from "./shared"

export const INBOX_TYPES = ["feature_request", "review"] as const
/** Reply state of an inbox item (contract §7.8), in sort order. */
export const INBOX_STATES = [
  "open",
  "proposal",
  "error",
  "stale",
  "approved",
  "tasks_open",
  "answered",
  "no_reply",
] as const
export type InboxState = (typeof INBOX_STATES)[number]

export type FeatureRequestDbRow = typeof featureRequests.$inferSelect

export function featureRequestOut(r: FeatureRequestDbRow) {
  return { ...r, comments: parseJson<unknown[]>(r.comments, []) }
}

interface LinkedApproval {
  id: number
  kind: string
  status: string
  title: string
  createdAt: string
  published: unknown
  publish: unknown
}

type LinkedTask = ReturnType<typeof backlogOut>

/** Follow-up reply a linked task makes due (contract §7.8). */
export type ReplyDue = "accepted" | "released"

/**
 * accepted: every active linked task is confirmed ("Passt"), released: every one shipped. Due until
 * a reply (not rejected/withdrawn) or a no-reply decision exists from after that moment.
 */
export function replyDue(
  tasks: LinkedTask[],
  linked: LinkedApproval[],
  noReplyAt: string | null
): ReplyDue | null {
  const active = tasks.filter((t) => t.status !== "dropped")
  if (!active.length) return null
  const covered = (ts: string) =>
    linked.some(
      (a) =>
        a.kind === "reply" &&
        !["rejected", "withdrawn"].includes(a.status) &&
        a.createdAt >= ts
    ) ||
    (!!noReplyAt && noReplyAt >= ts)
  const latest = (vals: (string | null)[]) =>
    vals
      .filter((v): v is string => !!v)
      .sort()
      .pop()!
  if (active.every((t) => t.releasedAt)) {
    const ts = latest(active.map((t) => t.releasedAt))
    return covered(ts) ? null : "released"
  }
  // done without "Passt" (closed by an agent) counts as accepted at its last change
  const accepted = (t: LinkedTask) =>
    t.acceptedAt ?? (t.status === "done" ? t.updatedAt : null)
  if (active.every((t) => accepted(t))) {
    const ts = latest(active.map(accepted))
    return covered(ts) ? null : "accepted"
  }
  return null
}

const taskBrief = (t: LinkedTask) => ({
  id: t.id,
  title: t.title,
  kind: t.kind,
  status: t.status,
  assignee: t.assignee,
  acceptedAt: t.acceptedAt,
  releasedVersion: t.releasedVersion,
})

/**
 * App inbox: Featurama requests (feature_requests) and store reviews with reply status. Written by
 * the collectors featurama/reviews and by `app publish`; read by GET /app/inbox.
 */
@Injectable()
export class AppInboxService {
  constructor(
    private readonly database: DatabaseService,
    private readonly approvalsService: ApprovalsService,
    private readonly backlog: BacklogService
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
          createdAt: a.createdAt,
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

  /**
   * State from the mirror and the newest reply approval: no_reply while lastSeen is unchanged,
   * pending → proposal, approved and unpublished → approved (error/stale after a failed run;
   * stale only while the item still needs a reply), else open or answered.
   */
  private state(
    needs: boolean,
    r: { noReplyAt: string | null; noReplyLastSeen: string | null },
    lastSeen: string | null,
    linked: LinkedApproval[]
  ): InboxState {
    if (noReplyActive({ ...r, lastSeen })) return "no_reply"
    const reply = linked.find(
      (a) =>
        a.kind === "reply" &&
        ["pending", "approved"].includes(a.status) &&
        !a.published
    )
    if (reply?.status === "pending") return "proposal"
    if (reply) {
      const st = (reply.publish as { state?: string } | null)?.state
      if (st === "error") return "error"
      if (st === "stale") {
        if (needs) return "stale"
      } else return "approved"
    }
    return needs ? "open" : "answered"
  }

  /** POST /app/inbox/reply (max): own reply, goes out with the next app publish. */
  reply(
    input: { project: string; target: string; itemId: string; text: string },
    actor: string
  ) {
    return this.approvalsService.ownReply(input, actor)
  }

  /** POST /app/inbox/no-reply (max): "no reply needed" until new user activity. */
  noReply(
    input: { project: string; target: string; itemId: string },
    actor: string
  ) {
    return this.approvalsService.noReply(input, actor)
  }

  inbox(f: {
    project?: string
    type?: string
    needsReply?: boolean
    state?: string
    limit?: number
  }) {
    const ctx = this.ctx
    const project = f.project ? requireProject(ctx, f.project) : null
    const type = f.type ? oneOf(f.type, INBOX_TYPES, "type") : undefined
    const states = listOf(f.state, INBOX_STATES, "state")
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
    const taskLinks = this.backlog.linkedToInbox(projectIds)
    /**
     * Open linked tasks hold the item back (tasks_open: no reply yet, not in Wartet auf Max);
     * a due follow-up reopens answered/no_reply items; approved replies stay.
     */
    const withDue = (
      state: InboxState,
      due: ReplyDue | null,
      tasks: LinkedTask[]
    ): InboxState => {
      if (
        tasks.some(isOpenTask) &&
        ["open", "proposal", "answered", "no_reply"].includes(state)
      )
        return "tasks_open"
      return due && ["open", "answered", "no_reply"].includes(state)
        ? "open"
        : state
    }
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

    const items: ({
      needsReply: boolean
      lastActivity: string
      state: InboxState
      type: string
    } & Record<string, unknown>)[] = []
    if (type !== "review")
      for (const r of requests) {
        // Featurama counts needsReply on approved requests; pending ones wait for approval there
        // (state open, needsReply false).
        const linked =
          links.get(`${r.projectId}|feature_request|${r.requestId}`) ?? []
        const tasks =
          taskLinks.get(`${r.projectId}|feature_request|${r.requestId}`) ?? []
        const due = replyDue(tasks, linked, r.noReplyAt)
        const state = withDue(
          this.state(r.needsReply, r, r.lastUserCommentAt, linked),
          due,
          tasks
        )
        const needs = state === "open" && (r.approved || !!due)
        items.push({
          type: "feature_request",
          target: "featurama",
          itemId: r.requestId,
          projectRef: r.featuramaProjectId,
          lastSeen: r.lastUserCommentAt,
          ...featureRequestOut(r),
          state,
          needsReply: needs,
          lastActivity:
            [r.lastUserCommentAt, r.lastDeveloperCommentAt, r.requestedAt]
              .filter(Boolean)
              .sort()
              .pop() ?? r.createdAt,
          approvals: linked,
          tasks: tasks.map(taskBrief),
          replyDue: due,
        })
      }
    if (type !== "feature_request")
      for (const r of textReviews) {
        const linked = links.get(`${r.projectId}|review|${r.reviewId}`) ?? []
        const tasks = taskLinks.get(`${r.projectId}|review|${r.reviewId}`) ?? []
        const due = replyDue(tasks, linked, r.noReplyAt)
        const state = withDue(
          this.state(r.needsReply, r, r.lastModified, linked),
          due,
          tasks
        )
        const store = r.store as "google_play" | "app_store"
        items.push({
          type: "review",
          target: store,
          itemId: r.reviewId,
          projectRef: storeRef(r.projectId, store),
          lastSeen: r.lastModified,
          ...r,
          state,
          needsReply: state === "open",
          lastActivity:
            [r.lastModified, r.replyAt, r.date].filter(Boolean).sort().pop() ??
            r.createdAt,
          approvals: linked,
          tasks: tasks.map(taskBrief),
          replyDue: due,
        })
      }
    const rank = (s: InboxState) =>
      Math.min(INBOX_STATES.indexOf(s), INBOX_STATES.indexOf("answered"))
    items.sort(
      (a, b) =>
        Number(b.needsReply) - Number(a.needsReply) ||
        rank(a.state) - rank(b.state) ||
        b.lastActivity.localeCompare(a.lastActivity)
    )
    const byState = (list: { state: InboxState }[]) =>
      Object.fromEntries(
        INBOX_STATES.map((s) => [s, list.filter((i) => i.state === s).length])
      )
    const frItems = items.filter((i) => i.type === "feature_request")
    const rvItems = items.filter((i) => i.type === "review")
    const count = (list: { needsReply: boolean; state: InboxState }[]) => ({
      total: list.length,
      needsReply: list.filter((r) => r.needsReply).length,
      byState: byState(list),
    })
    const filtered = items.filter(
      (i) =>
        (f.needsReply === undefined || i.needsReply === f.needsReply) &&
        (!states || (states as string[]).includes(i.state))
    )
    return {
      project: project?.id ?? null,
      counts: {
        featureRequests: {
          total: requests.length,
          needsReply: frItems.filter((r) => r.needsReply).length,
          pending: requests.filter((r) => !r.approved).length,
          byState: byState(frItems),
        },
        reviews: {
          ...count(rvItems),
          ratingsOnly: reviews.length - textReviews.length,
          google_play: count(rvItems.filter((r) => r.target === "google_play")),
          app_store: count(rvItems.filter((r) => r.target === "app_store")),
        },
      },
      items: filtered.slice(0, limit),
    }
  }
}

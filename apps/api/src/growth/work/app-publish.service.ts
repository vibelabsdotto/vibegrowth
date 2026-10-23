import { Injectable, Logger } from "@nestjs/common"
import { and, eq } from "drizzle-orm"
import {
  addDeveloperComment,
  listComments,
  requestUrl,
  threadState,
  type RawComment,
} from "../../collectors/sources/featurama"
import {
  appStoreRespond,
  appStoreResponse,
  playReply,
  playReview,
} from "../../collectors/sources/reviews"
import { errorMessage } from "../../collectors/sources/types"
import { approvals, collectors, storeReviews } from "../../core/schema"
import {
  getById,
  json,
  nowIso,
  parseJson,
  patchRow,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import type { ApprovalRow, ReplyPayload } from "./approvals.service"
import { AppInboxService } from "./app-inbox.service"
import { ChangesService } from "./changes.service"
import { replyLanguageProblem } from "./reply-language"
import { requireProject } from "./shared"
import { StoreService } from "./store.service"

type State =
  "would_post" | "published" | "already_published" | "stale" | "error"

export interface PublishResult {
  approvalId: number
  project: string
  target: string
  itemId: string
  state: State
  reason?: string
  ref?: string | null
  verified?: boolean
  text?: string
  request?: Record<string, unknown>
}

interface Fresh {
  state: "open" | "stale" | "already"
  reason?: string
  ref?: string | null
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim() === (b ?? "").trim()

/** Timestamps equal to the second (CSV millis vs. API seconds+nanos); both null counts as equal. */
function sameTime(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return !a && !b
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b
  return Math.floor(ta / 1000) === Math.floor(tb / 1000)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * `app publish`: posts approved, not yet published reply approvals (contract §7.8). Per approval:
 * fresh read of the target (still unanswered, lastSeen unchanged, else stale), post, read back,
 * then one short transaction: payload.published, changes entry (kind reply), mirror row updated.
 * No retry within a run; a failed approval keeps payload.publish {state:"error"} and is tried again
 * in the next run, where an identical existing reply counts as already published.
 */
@Injectable()
export class AppPublishService {
  private readonly logger = new Logger("AppPublish")
  private running = false

  constructor(
    private readonly database: DatabaseService,
    private readonly changes: ChangesService,
    private readonly inbox: AppInboxService,
    private readonly store: StoreService
  ) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Approved reply approvals without published and not stale. */
  pending(projectId?: string) {
    return this.ctx.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.kind, "reply"),
          eq(approvals.status, "approved"),
          ...(projectId ? [eq(approvals.projectId, projectId)] : [])
        )
      )
      .all()
      .filter((a) => {
        const p = parseJson<Partial<ReplyPayload>>(a.payload, {})
        return !p.published && p.publish?.state !== "stale"
      })
  }

  private ascProfile(projectId: string) {
    const row = this.ctx.db
      .select()
      .from(collectors)
      .where(
        and(
          eq(collectors.projectId, projectId),
          eq(collectors.collector, "reviews")
        )
      )
      .get()
    const v = parseJson<Record<string, unknown>>(row?.config, {}).ascProfile
    return typeof v === "string" && v.trim() ? v.trim() : null
  }

  async publish(input: { project?: string; dryRun?: boolean }, actor: string) {
    const dryRun = Boolean(input.dryRun)
    if (input.project) requireProject(this.ctx, input.project)
    if (this.running) throw new VGError("CONFLICT", "app publish läuft bereits")
    this.running = true
    try {
      const results: PublishResult[] = []
      const errors: { approvalId: number; error: string }[] = []
      for (const a of this.pending(input.project)) {
        const r = await this.one(a, dryRun, actor)
        results.push(r)
        if (r.state === "error")
          errors.push({ approvalId: a.id, error: r.reason ?? "Fehler" })
      }
      return { dryRun, results, errors }
    } finally {
      this.running = false
    }
  }

  private describe(p: ReplyPayload): Record<string, unknown> {
    const chars = `${p.text.length} Zeichen`
    if (p.target === "featurama")
      return {
        via: "featurama tool call addFeatureRequestComment",
        args: { projectId: p.projectRef, requestId: p.itemId, content: chars },
      }
    if (p.target === "google_play")
      return {
        via: "Play Developer API (ersetzt eine bestehende Antwort)",
        method: "POST",
        url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${p.projectRef}/reviews/${p.itemId}:reply`,
        body: { replyText: chars },
      }
    return {
      via: "asc reviews respond",
      args: ["--review-id", p.itemId, "--response", chars],
    }
  }

  private async one(
    a: ApprovalRow,
    dryRun: boolean,
    actor: string
  ): Promise<PublishResult> {
    const p = parseJson<ReplyPayload>(a.payload, {} as ReplyPayload)
    const base = {
      approvalId: a.id,
      project: a.projectId,
      target: p.target,
      itemId: p.itemId,
    }
    // Store replies only in the review's language, and only with a declared language.
    const wrongLanguage = this.languageProblem(a.projectId, p)
    if (wrongLanguage) {
      if (!dryRun)
        this.mark(
          a.id,
          p,
          { publish: { state: "error", at: nowIso(), reason: wrongLanguage } },
          actor
        )
      return { ...base, state: "error", reason: wrongLanguage }
    }
    try {
      const fresh = await this.freshRead(a.projectId, p)
      if (dryRun)
        return {
          ...base,
          state:
            fresh.state === "open"
              ? "would_post"
              : fresh.state === "already"
                ? "already_published"
                : "stale",
          ...(fresh.reason ? { reason: fresh.reason } : {}),
          text: p.text,
          request: this.describe(p),
        }
      if (fresh.state === "stale") {
        this.mark(
          a.id,
          p,
          {
            publish: {
              state: "stale",
              at: nowIso(),
              reason: fresh.reason ?? "",
            },
          },
          actor
        )
        return { ...base, state: "stale", reason: fresh.reason }
      }
      if (fresh.state === "already") {
        this.record(
          a,
          p,
          { ref: fresh.ref ?? null, verified: true, posted: false },
          actor
        )
        return {
          ...base,
          state: "already_published",
          ref: fresh.ref ?? null,
          reason: "gleiche Antwort ist schon da",
        }
      }
      const posted = await this.post(a.projectId, p)
      this.record(a, p, { ...posted, posted: true }, actor)
      return {
        ...base,
        state: "published",
        ref: posted.ref,
        verified: posted.verified,
      }
    } catch (e) {
      const reason = errorMessage(e)
      this.logger.warn(`Freigabe ${a.id}: ${reason}`)
      if (!dryRun)
        this.mark(
          a.id,
          p,
          { publish: { state: "error", at: nowIso(), reason } },
          actor
        )
      return { ...base, state: "error", reason }
    }
  }

  private languageProblem(projectId: string, p: ReplyPayload): string | null {
    if (p.target === "featurama") return null
    const rv = this.ctx.db
      .select({ language: storeReviews.language })
      .from(storeReviews)
      .where(
        and(
          eq(storeReviews.projectId, projectId),
          eq(storeReviews.store, p.target),
          eq(storeReviews.reviewId, p.itemId)
        )
      )
      .get()
    const problem = replyLanguageProblem(rv?.language, p.language, p.text, true)
    return problem
      ? `${problem}. Nicht gepostet; Text in der Freigabe ändern (Wieder öffnen).`
      : null
  }

  /** Fresh state of the target: still unanswered and lastSeen unchanged → open. */
  private async freshRead(projectId: string, p: ReplyPayload): Promise<Fresh> {
    if (p.target === "featurama") {
      let comments: RawComment[]
      try {
        comments = await listComments(p.projectRef, p.itemId)
      } catch (e) {
        if (/not found|nicht gefunden/i.test(errorMessage(e)))
          return { state: "stale", reason: "Request nicht mehr vorhanden" }
        throw e
      }
      const dup = comments.find(
        (c) => c.authorRole === "developer" && same(c.content, p.text)
      )
      if (dup) return { state: "already", ref: dup.id }
      const t = threadState(comments)
      if (!t.needsReply)
        return {
          state: "stale",
          reason: `inzwischen beantwortet (${t.lastDeveloperCommentAt})`,
        }
      if (!sameTime(t.lastUserCommentAt, p.lastSeen))
        return {
          state: "stale",
          reason: `neuer Nutzerkommentar (${t.lastUserCommentAt ?? "keiner"} statt ${p.lastSeen ?? "keiner"})`,
        }
      return { state: "open" }
    }
    if (p.target === "google_play") {
      const rv = await playReview(p.projectRef, p.itemId)
      if (!rv)
        return { state: "stale", reason: "Bewertung bei Google nicht gefunden" }
      if (rv.reply && same(rv.reply, p.text))
        return { state: "already", ref: p.itemId }
      // A review changed after the reply needs a new one; Google replaces the old reply.
      const changedAfter = Boolean(
        rv.reply &&
        rv.lastModified &&
        rv.replyAt &&
        rv.lastModified > rv.replyAt
      )
      if (rv.reply && !changedAfter)
        return { state: "stale", reason: "hat schon eine Antwort" }
      if (p.lastSeen && !sameTime(rv.lastModified, p.lastSeen))
        return {
          state: "stale",
          reason: `Bewertung geändert (${rv.lastModified} statt ${p.lastSeen})`,
        }
      return { state: "open" }
    }
    const resp = await appStoreResponse(p.itemId, this.ascProfile(projectId))
    if (resp)
      return same(resp.body, p.text)
        ? { state: "already", ref: resp.id }
        : { state: "stale", reason: "hat schon eine Antwort" }
    return { state: "open" }
  }

  /** Post and read back. Readback failure after a successful post: verified false, never a second post. */
  private async post(
    projectId: string,
    p: ReplyPayload
  ): Promise<{
    ref: string | null
    verified: boolean
    at: string
    state?: string | null
    author?: string | null
  }> {
    if (p.target === "featurama") {
      const c = await addDeveloperComment(p.projectRef, p.itemId, p.text)
      const back = await listComments(p.projectRef, p.itemId).catch(
        () => [] as RawComment[]
      )
      const verified = back.some(
        (x) => x.id === c.id && same(x.content, p.text)
      )
      return {
        ref: c.id,
        verified,
        at: c.createdAt ?? nowIso(),
        author: c.authorName ?? null,
      }
    }
    if (p.target === "google_play") {
      await playReply(p.projectRef, p.itemId, p.text)
      for (let i = 0; i < 8; i++) {
        try {
          const rv = await playReview(p.projectRef, p.itemId)
          if (rv?.reply && same(rv.reply, p.text))
            return { ref: p.itemId, verified: true, at: rv.replyAt ?? nowIso() }
        } catch {
          /* read again */
        }
        await sleep(3000)
      }
      return { ref: p.itemId, verified: false, at: nowIso() }
    }
    const profile = this.ascProfile(projectId)
    const res = await appStoreRespond(p.itemId, p.text, profile)
    const back = await appStoreResponse(p.itemId, profile).catch(() => null)
    return {
      ref: back?.id ?? res.data?.id ?? null,
      verified: Boolean(back && same(back.body, p.text)),
      at: back?.at ?? nowIso(),
      state: back?.state ?? res.data?.attributes?.state ?? null,
    }
  }

  /** Merge keys into the approval payload (history keeps before/after). */
  private mark(
    id: number,
    p: ReplyPayload,
    extra: Record<string, unknown>,
    actor: string
  ) {
    const ctx = this.ctx
    this.database.tx(() => {
      getById(ctx, approvals, id, "Freigabe")
      patchRow(
        ctx,
        approvals,
        "approval",
        id,
        { payload: json({ ...p, ...extra }) },
        actor,
        "publish"
      )
    })
  }

  /** Published: payload.published, changes entry (only when posted now), mirror row answered. */
  private record(
    a: ApprovalRow,
    p: ReplyPayload,
    r: {
      ref: string | null
      verified: boolean
      posted: boolean
      at?: string
      state?: string | null
      author?: string | null
    },
    actor: string
  ) {
    const at = r.at ?? nowIso()
    this.database.tx(() => {
      const rest: Record<string, unknown> = { ...p }
      delete rest.publish
      patchRow(
        this.ctx,
        approvals,
        "approval",
        a.id,
        {
          payload: json({
            ...rest,
            published: { at: nowIso(), ref: r.ref, verified: r.verified },
          }),
        },
        actor,
        "publish"
      )
      if (p.target === "featurama")
        this.inbox.markFeatureReplied(
          a.projectId,
          p.itemId,
          {
            id: r.ref ?? "",
            content: p.text,
            createdAt: at,
            author: r.author ?? null,
          },
          actor
        )
      else
        this.store.markReplied(
          a.projectId,
          p.target,
          p.itemId,
          { text: p.text, at, state: r.state ?? null },
          actor
        )
      if (r.posted) {
        const where =
          p.target === "featurama"
            ? `Featurama-Request ${this.inbox.findFeatureRequest(a.projectId, p.itemId)?.title ?? p.itemId}`
            : `${p.target === "google_play" ? "Google-Play" : "App-Store"}-Bewertung ${p.itemId}`
        this.changes.add(
          {
            projectId: a.projectId,
            kind: "reply",
            summary: `Antwort veröffentlicht (Freigabe ${a.id}): ${where}${r.verified ? "" : " (Rücklesen ohne Bestätigung)"}`,
            ref:
              p.target === "featurama"
                ? requestUrl(p.projectRef, p.itemId)
                : (r.ref ?? p.itemId),
            category: "app",
          },
          actor
        )
      }
    })
  }
}

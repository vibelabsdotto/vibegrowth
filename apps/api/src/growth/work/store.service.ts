import { Injectable } from "@nestjs/common"
import { and, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm"
import { kpiDaily, storeReviews } from "../../core/schema"
import {
  addDays,
  assertDate,
  nowIso,
  parseJson,
  patchRow,
  recordHistory,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import {
  oneOf,
  optOneOf,
  relChange,
  requireProject,
  round,
  yesterday,
} from "./shared"

export const STORES = ["app_store", "google_play"] as const

/** kpi source per store and the metrics summed in the window (rating: last value). */
const STORE_SOURCES = {
  google_play: {
    source: "play",
    sums: ["installs", "store_visits", "uninstalls"],
    campaign: ["utm_campaign", "source"],
  },
  app_store: {
    source: "asc",
    sums: ["installs", "impressions", "product_page_views"],
    campaign: ["campaign", "source"],
  },
} as const

/** Text review without reply; Google also when the review changed after the reply. */
export function reviewNeedsReply(r: {
  store: string
  title?: string | null
  body?: string | null
  reply?: string | null
  replyState?: string | null
  replyAt?: string | null
  lastModified?: string | null
}) {
  if (!r.title && !r.body) return false
  if (!r.reply && !r.replyState) return true
  return Boolean(
    r.store === "google_play" &&
    r.lastModified &&
    r.replyAt &&
    r.lastModified > r.replyAt
  )
}

export interface ReviewInput {
  projectId: string
  store: string
  reviewId: string
  date?: string | null
  rating?: number | null
  title?: string | null
  body?: string | null
  language?: string | null
  version?: string | null
  reply?: string | null
  lastModified?: string | null
  replyAt?: string | null
  replyState?: string | null
  needsReply?: boolean
  legacyId?: string | null
}

@Injectable()
export class StoreService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Installs, rating and campaigns per store from kpi_daily (play/asc), window vs. previous window. */
  summary(projectId: string, days = 28, end = yesterday()) {
    const ctx = this.ctx
    const project = requireProject(ctx, projectId)
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new VGError("INVALID", `days muss 1–365 sein, war: ${days}`)
    assertDate(end, "end")
    const from = addDays(end, -(days - 1))
    const prevTo = addDays(from, -1)
    const prevFrom = addDays(prevTo, -(days - 1))
    const rows = ctx.db
      .select()
      .from(kpiDaily)
      .where(
        and(
          eq(kpiDaily.projectId, project.id),
          inArray(kpiDaily.source, ["play", "asc"]),
          gte(kpiDaily.date, prevFrom),
          lte(kpiDaily.date, end)
        )
      )
      .all()
    const lastRatings = ctx.db
      .select()
      .from(kpiDaily)
      .where(
        and(
          eq(kpiDaily.projectId, project.id),
          inArray(kpiDaily.source, ["play", "asc"]),
          eq(kpiDaily.metric, "rating"),
          eq(kpiDaily.dims, ""),
          lte(kpiDaily.date, end)
        )
      )
      .orderBy(desc(kpiDaily.date))
      .all()
    const stores: Record<string, unknown> = {}
    const campaigns: {
      store: string
      campaign: string
      source: string | null
      installs: number
    }[] = []
    const total = { installs: 0, prev: 0, hasData: false, hasPrev: false }
    for (const [store, cfg] of Object.entries(STORE_SOURCES)) {
      const own = rows.filter((r) => r.source === cfg.source)
      const totals = own.filter((r) => r.dims === "")
      const sum = (metric: string, a: string, b: string) => {
        const list = totals.filter(
          (r) => r.metric === metric && r.date >= a && r.date <= b
        )
        return list.length ? list.reduce((s, r) => s + r.value, 0) : null
      }
      const metrics: Record<string, unknown> = {}
      for (const m of cfg.sums) {
        const value = sum(m, from, end)
        const prev = sum(m, prevFrom, prevTo)
        metrics[m] = { value, prev, delta: round(relChange(value, prev)) }
      }
      const rating = lastRatings.find((r) => r.source === cfg.source)
      const installs = metrics.installs as {
        value: number | null
        prev: number | null
      }
      if (installs.value !== null) {
        total.installs += installs.value
        total.hasData = true
      }
      if (installs.prev !== null) {
        total.prev += installs.prev
        total.hasPrev = true
      }
      stores[store] = {
        source: cfg.source,
        hasData: own.length > 0,
        ...metrics,
        rating: rating ? { value: rating.value, date: rating.date } : null,
      }
      const byCampaign = new Map<
        string,
        { source: string | null; installs: number }
      >()
      for (const r of own) {
        if (r.metric !== "installs" || !r.dims || r.date < from) continue
        const d = parseJson<Record<string, string>>(r.dims, {})
        const campaign = d[cfg.campaign[0]]
        if (!campaign) continue
        const source = d[cfg.campaign[1]] ?? null
        const key = `${campaign}|${source ?? ""}`
        const c = byCampaign.get(key) ?? { source, installs: 0 }
        c.installs += r.value
        byCampaign.set(key, c)
      }
      for (const [key, c] of byCampaign)
        campaigns.push({
          store,
          campaign: key.split("|")[0],
          source: c.source,
          installs: c.installs,
        })
    }
    const reviews = ctx.db
      .select()
      .from(storeReviews)
      .where(eq(storeReviews.projectId, project.id))
      .all()
    const inWin = reviews.filter(
      (r) => r.date && r.date.slice(0, 10) >= from && r.date.slice(0, 10) <= end
    )
    const avg = (list: typeof reviews) => {
      const rated = list.filter((r) => r.rating !== null)
      return rated.length
        ? round(rated.reduce((s, r) => s + r.rating!, 0) / rated.length, 2)
        : null
    }
    return {
      project: project.id,
      window: { from, to: end },
      prevWindow: { from: prevFrom, to: prevTo },
      installs: {
        value: total.hasData ? total.installs : null,
        prev: total.hasPrev ? total.prev : null,
        delta:
          total.hasData && total.hasPrev
            ? round(relChange(total.installs, total.prev))
            : null,
      },
      stores,
      campaigns: campaigns.sort((a, b) => b.installs - a.installs),
      reviews: {
        total: reviews.length,
        avgRating: avg(reviews),
        window: { count: inWin.length, avgRating: avg(inWin) },
      },
    }
  }

  reviews(f: {
    project: string
    store?: string
    rating?: number
    limit?: number
    needsReply?: boolean
  }) {
    const project = requireProject(this.ctx, f.project)
    const conds: SQL[] = [eq(storeReviews.projectId, project.id)]
    if (f.needsReply !== undefined)
      conds.push(eq(storeReviews.needsReply, f.needsReply))
    const store = optOneOf(f.store, STORES, "store")
    if (store) conds.push(eq(storeReviews.store, store))
    if (f.rating !== undefined) conds.push(eq(storeReviews.rating, f.rating))
    return this.ctx.db
      .select()
      .from(storeReviews)
      .where(and(...conds))
      .orderBy(desc(storeReviews.date), desc(storeReviews.id))
      .limit(f.limit ?? 50)
      .all()
  }

  /**
   * Upsert reviews by (project, store, review_id); one history entry per project and call. Merges
   * instead of overwriting: empty fields keep the stored value, the newer reply wins, and
   * needs_reply is recomputed from the merged row. A row with `legacyId` takes over the stored
   * row with that id (play CSV rows before the real review id was read).
   */
  upsertReviews(rows: ReviewInput[], actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      let inserted = 0
      let updated = 0
      let renamed = 0
      let merged = 0
      const projectsSeen = new Set<string>()
      const find = (projectId: string, store: string, reviewId: string) =>
        ctx.db
          .select()
          .from(storeReviews)
          .where(
            and(
              eq(storeReviews.projectId, projectId),
              eq(storeReviews.store, store),
              eq(storeReviews.reviewId, reviewId)
            )
          )
          .get()
      for (const r of rows) {
        const project = requireProject(ctx, r.projectId)
        const store = oneOf(r.store, STORES, "store")
        if (!r.reviewId) throw new VGError("INVALID", "reviewId fehlt")
        let existing = find(project.id, store, r.reviewId)
        const legacy =
          r.legacyId && r.legacyId !== r.reviewId
            ? find(project.id, store, r.legacyId)
            : undefined
        if (legacy && !existing) {
          ctx.db
            .update(storeReviews)
            .set({ reviewId: r.reviewId, updatedAt: nowIso() })
            .where(eq(storeReviews.id, legacy.id))
            .run()
          existing = { ...legacy, reviewId: r.reviewId }
          renamed++
        } else if (legacy && existing && legacy.id !== existing.id) {
          ctx.db
            .delete(storeReviews)
            .where(eq(storeReviews.id, legacy.id))
            .run()
          merged++
        }
        const keep = <T>(v: T | null | undefined, old: T | null | undefined) =>
          v === undefined || v === null ? (old ?? null) : v
        const later = (a?: string | null, b?: string | null) =>
          !a ? (b ?? null) : !b ? a : a > b ? a : b
        const newerReply =
          Boolean(r.reply) &&
          (!existing?.replyAt || !r.replyAt || r.replyAt >= existing.replyAt)
        const values = {
          date: keep(r.date, existing?.date) ?? r.lastModified ?? null,
          rating: keep(r.rating, existing?.rating),
          title: keep(r.title, existing?.title),
          body: keep(r.body, existing?.body),
          language: keep(r.language, existing?.language),
          version: keep(r.version, existing?.version),
          reply: newerReply ? r.reply! : (existing?.reply ?? r.reply ?? null),
          replyAt: newerReply
            ? (r.replyAt ?? existing?.replyAt ?? null)
            : (existing?.replyAt ?? null),
          replyState: newerReply
            ? (r.replyState ?? null)
            : keep(existing?.replyState, r.replyState),
          lastModified: later(r.lastModified, existing?.lastModified),
        }
        const needsReply = reviewNeedsReply({ store, ...values })
        if (existing) {
          ctx.db
            .update(storeReviews)
            .set({ ...values, needsReply, updatedAt: nowIso() })
            .where(eq(storeReviews.id, existing.id))
            .run()
          updated++
        } else {
          ctx.db
            .insert(storeReviews)
            .values({
              projectId: project.id,
              store,
              reviewId: r.reviewId,
              ...values,
              needsReply,
            })
            .run()
          inserted++
        }
        projectsSeen.add(project.id)
      }
      for (const p of projectsSeen)
        recordHistory(ctx, {
          actor,
          entity: "store_reviews",
          entityId: p,
          action: "import",
          after: {
            rows: rows.filter((r) => r.projectId === p).length,
            inserted,
            updated,
            ...(renamed ? { renamed } : {}),
            ...(merged ? { merged } : {}),
          },
        })
      return { inserted, updated, renamed, merged }
    })
  }

  /** After `app publish`: the reply is on the review (inside the caller's transaction). */
  markReplied(
    projectId: string,
    store: string,
    reviewId: string,
    reply: { text: string; at: string; state?: string | null },
    actor: string
  ) {
    const ctx = this.ctx
    const row = ctx.db
      .select()
      .from(storeReviews)
      .where(
        and(
          eq(storeReviews.projectId, projectId),
          eq(storeReviews.store, store),
          eq(storeReviews.reviewId, reviewId)
        )
      )
      .get()
    if (!row) return null
    return patchRow(
      ctx,
      storeReviews,
      "store_review",
      row.id,
      {
        reply: reply.text,
        replyAt: reply.at,
        replyState: reply.state ?? null,
        needsReply: false,
      },
      actor,
      "reply"
    )
  }
}

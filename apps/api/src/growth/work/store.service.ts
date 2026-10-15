import { Injectable } from "@nestjs/common"
import { and, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm"
import { kpiDaily, storeReviews } from "../../core/schema"
import {
  addDays,
  assertDate,
  nowIso,
  parseJson,
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
  }) {
    const project = requireProject(this.ctx, f.project)
    const conds: SQL[] = [eq(storeReviews.projectId, project.id)]
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

  /** Upsert reviews by (project, store, review_id). For the play/asc collectors; one history entry per call. */
  upsertReviews(rows: ReviewInput[], actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      let inserted = 0
      let updated = 0
      const projectsSeen = new Set<string>()
      for (const r of rows) {
        const project = requireProject(ctx, r.projectId)
        const store = oneOf(r.store, STORES, "store")
        if (!r.reviewId) throw new VGError("INVALID", "reviewId fehlt")
        const values = {
          date: r.date ?? null,
          rating: r.rating ?? null,
          title: r.title ?? null,
          body: r.body ?? null,
          language: r.language ?? null,
          version: r.version ?? null,
          reply: r.reply ?? null,
        }
        const existing = ctx.db
          .select({ id: storeReviews.id })
          .from(storeReviews)
          .where(
            and(
              eq(storeReviews.projectId, project.id),
              eq(storeReviews.store, store),
              eq(storeReviews.reviewId, r.reviewId)
            )
          )
          .get()
        if (existing) {
          ctx.db
            .update(storeReviews)
            .set({ ...values, updatedAt: nowIso() })
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
          },
        })
      return { inserted, updated }
    })
  }
}

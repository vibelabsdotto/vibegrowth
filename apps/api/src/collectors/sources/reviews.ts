/**
 * Collector `reviews`: store reviews with reply status for the app inbox (port of Hunter's
 * store-reviews scan, without its ledger).
 *
 * Google Play: Play Developer API reviews.list (only text reviews created or changed in the last
 * 7 days) plus the monthly review CSVs from the Play bucket (history, 2–7 days lag). Same review
 * id in both (CSV `Review Link`), the API wins. Scope androidpublisher (read) and
 * devstorage.read_only, service account like `play`.
 * App Store: `asc reviews list --include-response` (asc CLI profile). No language and no app
 * version at Apple: `language` holds the territory (ISO-3, e.g. DEU).
 *
 * needs_reply: text review without developer reply, or (Google) the review changed after it.
 */
import { execFile } from "node:child_process"
import { httpFetch } from "./http.js"
import {
  decodeExport,
  months,
  parseCsv,
  playReviewRows,
  REVIEWS,
} from "./play.js"
import { gcs, serviceAccountToken } from "./service-account.js"
import {
  addDays,
  CollectorError,
  errorMessage,
  finish,
  redact,
  resolveToday,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type FetchFn,
  type StoreReviewRow,
} from "./types.js"

export const ANDROIDPUBLISHER_SCOPE =
  "https://www.googleapis.com/auth/androidpublisher"
const PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3"

export interface ReviewsConfig {
  /** Play package (default: play.package) */
  package?: string | null
  /** Play bucket for the review CSVs (default: play.gcsBucket); empty = API only (7 days) */
  gcsBucket?: string | null
  /** App Store app id (default: asc.appId) */
  appId?: string | null
  /** asc CLI profile for reviews; empty = the asc default profile */
  ascProfile?: string | null
  /** Months of review CSVs to read (default 3) */
  csvMonths?: number
  /** Stored Google reviews with a reply: review id → reply time (skip the confirmation GET) */
  answered?: Record<string, string | null>
}

/** Confirmation GETs per run (Play quota: 200 GET per hour and app). */
const MAX_CONFIRM = 60

export const configSchema: ConfigSchema = {
  package: {
    description: "Google-Play-Paket (Standard: play.package)",
    required: false,
    type: "string",
  },
  gcsBucket: {
    description:
      "Play-Bucket für die Bewertungs-CSVs (Standard: play.gcsBucket); leer = nur API (7 Tage)",
    required: false,
    type: "string",
  },
  appId: {
    description: "App-Store-App-ID (Standard: asc.appId)",
    required: false,
    type: "string",
  },
  ascProfile: {
    description:
      "asc-CLI-Profil für Bewertungen; leer = Standardprofil der asc-CLI",
    required: false,
    type: "string",
  },
  csvMonths: {
    description: "Monate Bewertungs-CSVs (Standard 3)",
    required: false,
    type: "number",
    default: 3,
  },
}

interface PlayApiReview {
  reviewId: string
  comments?: {
    userComment?: {
      text?: string
      lastModified?: { seconds?: string | number; nanos?: number }
      starRating?: number
      reviewerLanguage?: string
      appVersionName?: string
    }
    developerComment?: {
      text?: string
      lastModified?: { seconds?: string | number; nanos?: number }
    }
  }[]
}

const tsIso = (t?: { seconds?: string | number; nanos?: number }) => {
  const s = Number(t?.seconds)
  if (!Number.isFinite(s) || s <= 0) return null
  return new Date(s * 1000 + Math.floor((t?.nanos ?? 0) / 1e6)).toISOString()
}

/** Play API review → row (title and text are one field, split at the first tab). */
export function playApiRow(r: PlayApiReview): StoreReviewRow {
  const user = r.comments?.find((c) => c.userComment)?.userComment
  const dev = r.comments?.find((c) => c.developerComment)?.developerComment
  const raw = user?.text ?? ""
  const tab = raw.indexOf("\t")
  const title = tab >= 0 ? raw.slice(0, tab).trim() || null : null
  const body = (tab >= 0 ? raw.slice(tab + 1) : raw).trim() || null
  const lastModified = tsIso(user?.lastModified)
  const replyAt = dev ? tsIso(dev.lastModified) : null
  const reply = dev?.text?.trim() || null
  return {
    store: "google_play",
    reviewId: r.reviewId,
    date: null,
    rating: user?.starRating ?? null,
    title,
    body,
    language: user?.reviewerLanguage ?? null,
    version: user?.appVersionName ?? null,
    reply,
    lastModified,
    replyAt,
    needsReply:
      Boolean(title || body) &&
      (!reply || Boolean(lastModified && replyAt && lastModified > replyAt)),
  }
}

async function playGet<T>(
  url: string,
  fetchImpl: FetchFn
): Promise<{ status: number; data: T | null; text: string }> {
  const token = await serviceAccountToken(ANDROIDPUBLISHER_SCOPE, fetchImpl)
  let r = await httpFetch(
    url,
    { headers: { Authorization: `Bearer ${token}` }, timeoutS: 30 },
    fetchImpl
  )
  // Quota per app is 200 GET/h; back off once on 429.
  if (r.status === 429) {
    await new Promise((res) => setTimeout(res, 5000))
    r = await httpFetch(
      url,
      { headers: { Authorization: `Bearer ${token}` }, timeoutS: 30 },
      fetchImpl
    )
  }
  const text = redact(r.text().slice(0, 300), [token])
  return {
    status: r.status,
    data: r.status === 200 ? r.json<T>() : null,
    text,
  }
}

/** One Play review by id (fresh read before publishing). null when Google does not know it. */
export async function playReview(
  pkg: string,
  reviewId: string,
  fetchImpl: FetchFn = fetch
): Promise<StoreReviewRow | null> {
  const r = await playGet<PlayApiReview>(
    `${PLAY_API}/applications/${encodeURIComponent(pkg)}/reviews/${encodeURIComponent(reviewId)}`,
    fetchImpl
  )
  if (r.status === 404) return null
  if (r.status !== 200)
    throw new CollectorError(
      "EXTERNAL",
      `Google Play Review ${reviewId}: HTTP ${r.status} ${r.text}`
    )
  return playApiRow(r.data!)
}

/** Reply to a Play review (overwrites an existing reply; callers check first). */
export async function playReply(
  pkg: string,
  reviewId: string,
  text: string,
  fetchImpl: FetchFn = fetch
) {
  const token = await serviceAccountToken(ANDROIDPUBLISHER_SCOPE, fetchImpl)
  const r = await httpFetch(
    `${PLAY_API}/applications/${encodeURIComponent(pkg)}/reviews/${encodeURIComponent(reviewId)}:reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyText: text }),
      timeoutS: 30,
      retries: 0,
    },
    fetchImpl
  )
  if (r.status !== 200)
    throw new CollectorError(
      "EXTERNAL",
      redact(
        `Google Play Antwort auf ${reviewId}: HTTP ${r.status} ${r.text().slice(0, 300)}`,
        [token]
      )
    )
  return r.json<{ result?: { replyText?: string; lastEdited?: unknown } }>()
}

async function playApiReviews(pkg: string, fetchImpl: FetchFn) {
  const out: StoreReviewRow[] = []
  let token: string | undefined
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ maxResults: "100" })
    if (token) q.set("token", token)
    const r = await playGet<{
      reviews?: PlayApiReview[]
      tokenPagination?: { nextPageToken?: string }
    }>(
      `${PLAY_API}/applications/${encodeURIComponent(pkg)}/reviews?${q.toString()}`,
      fetchImpl
    )
    if (r.status !== 200)
      throw new CollectorError(
        "EXTERNAL",
        `Google Play reviews.list: HTTP ${r.status} ${r.text}`
      )
    out.push(...(r.data?.reviews ?? []).map(playApiRow))
    token = r.data?.tokenPagination?.nextPageToken
    if (!token) break
  }
  return out
}

// ---------- App Store (asc CLI) ----------

/** asc CLI with JSON on stdout (stderr kept apart). */
export function ascJson<T>(
  args: string[],
  profile: string | null | undefined,
  timeoutMs = 180_000
): Promise<T> {
  const cmd = [...args, ...(profile ? ["--profile", profile] : [])]
  return new Promise((resolve, reject) => {
    execFile(
      process.env.VIBEGROWTH_ASC_BIN || "asc",
      cmd,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT")
            return reject(
              new CollectorError(
                "CONFIG",
                "asc-CLI nicht gefunden (brew install asc)"
              )
            )
          return reject(
            new CollectorError(
              "EXTERNAL",
              `asc ${args.slice(0, 2).join(" ")}: ${(stderr || stdout || err.message).trim().slice(0, 300)}`
            )
          )
        }
        try {
          resolve(JSON.parse(stdout) as T)
        } catch {
          reject(
            new CollectorError(
              "EXTERNAL",
              `asc ${args.slice(0, 2).join(" ")}: Antwort ist kein JSON`
            )
          )
        }
      }
    )
  })
}

interface AscReview {
  id: string
  attributes?: {
    rating?: number
    title?: string
    body?: string
    createdDate?: string
    territory?: string
  }
  relationships?: { response?: { data?: { id?: string } | null } }
}

interface AscResponse {
  id?: string
  attributes?: {
    responseBody?: string
    lastModifiedDate?: string
    state?: string
  }
}

const iso = (s?: string | null) => {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? s : new Date(t).toISOString()
}

export async function appStoreReviews(
  appId: string,
  profile: string | null | undefined
): Promise<StoreReviewRow[]> {
  const r = await ascJson<{ data?: AscReview[]; included?: AscResponse[] }>(
    [
      "reviews",
      "list",
      "--app",
      appId,
      "--paginate",
      "--include-response",
      "--output",
      "json",
    ],
    profile
  )
  const responses = new Map(
    (r.included ?? []).filter((x) => x.id).map((x) => [x.id!, x])
  )
  return (r.data ?? []).map((rv) => {
    const a = rv.attributes ?? {}
    const respId = rv.relationships?.response?.data?.id
    const resp = respId ? responses.get(respId) : undefined
    const reply = resp?.attributes?.responseBody?.trim() || null
    const hasResponse = Boolean(respId)
    return {
      store: "app_store" as const,
      reviewId: rv.id,
      date: a.createdDate ?? null,
      rating: a.rating ?? null,
      title: a.title?.trim() || null,
      body: a.body?.trim() || null,
      language: a.territory ?? null,
      version: null,
      reply,
      lastModified: iso(a.createdDate),
      replyAt: iso(resp?.attributes?.lastModifiedDate),
      replyState: resp?.attributes?.state ?? (hasResponse ? "UNKNOWN" : null),
      needsReply: !hasResponse,
    }
  })
}

/** Current response of an App Store review (fresh read before/after publishing). */
export async function appStoreResponse(
  reviewId: string,
  profile: string | null | undefined
): Promise<{
  id: string
  body: string
  state: string | null
  at: string | null
} | null> {
  let r: { data?: AscResponse | null }
  try {
    r = await ascJson<{ data?: AscResponse | null }>(
      [
        "reviews",
        "response",
        "for-review",
        "--review-id",
        reviewId,
        "--output",
        "json",
      ],
      profile
    )
  } catch (e) {
    if (/404|NOT_FOUND|not found/i.test(errorMessage(e))) return null
    throw e
  }
  const d = r.data
  if (!d?.id) return null
  return {
    id: d.id,
    body: d.attributes?.responseBody?.trim() ?? "",
    state: d.attributes?.state ?? null,
    at: iso(d.attributes?.lastModifiedDate),
  }
}

/** Post an App Store response (new response only; Apple has no edit). */
export function appStoreRespond(
  reviewId: string,
  text: string,
  profile: string | null | undefined
) {
  return ascJson<{ data?: AscResponse }>(
    [
      "reviews",
      "respond",
      "--review-id",
      reviewId,
      "--response",
      text,
      "--output",
      "json",
    ],
    profile
  )
}

// ---------- collector ----------

export async function collectReviews(
  config: ReviewsConfig,
  ctx: CollectorContext
): Promise<CollectorResult> {
  const fetchImpl = ctx.fetch ?? fetch
  const today = resolveToday(ctx)
  const errors: string[] = []
  const stats: Record<string, unknown> = {}
  const rows: StoreReviewRow[] = []
  const pkg = config.package?.trim() || null
  const appId = config.appId?.trim() || null
  if (!pkg && !appId) {
    const msg =
      'reviews: weder "package" (Google Play) noch "appId" (App Store) konfiguriert (auch nicht bei play/asc)'
    return finish({ kpi: [], summary: msg, stats, errors: [msg] })
  }
  if (pkg) {
    const byId = new Map<string, StoreReviewRow>()
    const g: Record<string, unknown> = { package: pkg }
    if (config.gcsBucket) {
      try {
        const monthsBack = Math.max(1, Math.min(36, config.csvMonths ?? 3))
        let files = 0
        for (const ym of months(
          addDays(today, -31 * (monthsBack - 1)),
          today
        )) {
          const raw = (await gcs(
            config.gcsBucket,
            REVIEWS.replace("{pkg}", pkg).replace("{ym}", ym),
            { media: true, fetch: fetchImpl }
          )) as Buffer | null
          if (!raw) continue
          files++
          for (const r of playReviewRows(parseCsv(decodeExport(raw))))
            byId.set(r.reviewId, r)
        }
        g.csvFiles = files
        g.csvRows = byId.size
      } catch (e) {
        errors.push(`google_play csv: ${errorMessage(e)}`)
      }
    }
    const fromApi = new Set<string>()
    const merge = (r: StoreReviewRow) => {
      const csv = byId.get(r.reviewId)
      // API is fresher; the CSV adds submit date and legacy id.
      byId.set(r.reviewId, {
        ...csv,
        ...r,
        date: csv?.date ?? r.date,
        legacyId: csv?.legacyId ?? null,
        version: r.version ?? csv?.version ?? null,
      })
      fromApi.add(r.reviewId)
    }
    try {
      const api = await playApiReviews(pkg, fetchImpl)
      g.apiRows = api.length
      for (const r of api) merge(r)
    } catch (e) {
      errors.push(`google_play api: ${errorMessage(e)}`)
    }
    // The CSVs do not pick up replies posted later: confirm every CSV row without reply by id
    // (Hunter's scan does the same). Rows already answered in VibeGrowth and unchanged since are
    // skipped to save the 200 GET/h quota.
    const answered = config.answered ?? {}
    const candidates = [...byId.values()].filter(
      (r) =>
        r.needsReply &&
        !fromApi.has(r.reviewId) &&
        !(
          r.reviewId in answered &&
          (!r.lastModified || (answered[r.reviewId] ?? "") >= r.lastModified)
        )
    )
    let confirmed = 0
    for (const c of candidates.slice(0, MAX_CONFIRM)) {
      try {
        const r = await playReview(pkg, c.reviewId, fetchImpl)
        if (r) {
          merge(r)
          confirmed++
        }
      } catch (e) {
        errors.push(`google_play ${c.reviewId}: ${errorMessage(e)}`)
        break
      }
    }
    g.confirmed = confirmed
    if (candidates.length > MAX_CONFIRM)
      g.unconfirmed = candidates.length - MAX_CONFIRM
    const list = [...byId.values()]
    g.reviews = list.length
    g.needsReply = list.filter((r) => r.needsReply).length
    stats.google_play = g
    rows.push(...list)
  }
  if (appId) {
    try {
      const list = await appStoreReviews(appId, config.ascProfile)
      stats.app_store = {
        appId,
        reviews: list.length,
        needsReply: list.filter((r) => r.needsReply).length,
      }
      rows.push(...list)
    } catch (e) {
      errors.push(`app_store: ${errorMessage(e)}`)
    }
  }
  const open = rows.filter((r) => r.needsReply).length
  const summary = errors.length
    ? `Bewertungen: ${rows.length} gelesen, ${errors.length} Fehler (${errors.join("; ").slice(0, 200)})`
    : `Bewertungen: ${rows.length} gelesen, ${open} ohne Antwort`
  return finish({ kpi: [], storeReviews: rows, summary, stats, errors })
}

/**
 * Collector `play`: Google Play monthly exports from the developer account's Cloud Storage bucket,
 * port of store_attribution.py `collect_play` (+ ratings overview and reviews, which the Python
 * version did not read). Auth: Play service account, scope devstorage.read_only (read-only).
 *
 * KPI (dims ''): installs (Daily User Installs), uninstalls (Daily User Uninstalls),
 * active_installs (Active Device Installs), store_visits / store_acquisitions (store listing
 * visitors / acquisitions over all countries), rating (Total Average Rating).
 * Breakdowns: installs + store_visits by {"source","utm_source","utm_campaign"} (traffic source
 * report, search terms summed) and by {"country"}.
 * Reviews: reviews/reviews_<pkg>_<YYYYMM>.csv → store_reviews (store google_play).
 * Files lag 2–7 days; Play folds low-volume sources into "Other".
 */
import {
  addDays,
  dateWindow,
  dimsKey,
  errorMessage,
  finish,
  requireString,
  resolveToday,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type FetchFn,
  type KpiRow,
  type SourceCollector,
  type StoreReviewRow,
} from "./types.js"
import { gcs } from "./service-account.js"

export interface PlayConfig {
  package: string
  gcsBucket: string
}

export const id = "play"
export const label = "Google Play Console"
export const channelKinds: ChannelKind[] = ["android"]
export const configSchema: ConfigSchema = {
  package: {
    description: "Paketname der App, z. B. com.max.mannstein.dazeforprivate",
    required: true,
    type: "string",
  },
  gcsBucket: {
    description:
      "Cloud-Storage-Bucket der Play-Berichte (pubsite_prod_…; Play Console → Berichte herunterladen → Cloud-Storage-URI kopieren)",
    required: true,
    type: "string",
  },
}

/** report → object path; {pkg} and {ym} (YYYYMM) are filled in (store_attribution.py PLAY_REPORTS + ratings). */
export const PLAY_REPORTS = {
  store_performance_traffic_source:
    "stats/store_performance/store_performance_{pkg}_{ym}_traffic_source.csv",
  store_performance_country:
    "stats/store_performance/store_performance_{pkg}_{ym}_country.csv",
  installs_overview: "stats/installs/installs_{pkg}_{ym}_overview.csv",
  ratings_overview: "stats/ratings/ratings_{pkg}_{ym}_overview.csv",
} as const
const REVIEWS = "reviews/reviews_{pkg}_{ym}.csv"

type Report = keyof typeof PLAY_REPORTS
type CsvRow = Record<string, string>

/** Play exports are UTF-16 with BOM; tolerate UTF-8 (store_attribution.py `_decode`). */
export function decodeExport(raw: Buffer): string {
  if (raw[0] === 0xff && raw[1] === 0xfe)
    return raw.subarray(2).toString("utf16le")
  if (raw[0] === 0xfe && raw[1] === 0xff) {
    const le = Buffer.from(raw.subarray(2))
    le.swap16()
    return le.toString("utf16le")
  }
  const text = raw.toString("utf8")
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** RFC 4180 CSV → objects keyed by the header row (Python csv.DictReader). */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [head, ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ""))
  if (!head) return []
  return body.map((r) =>
    Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))
  )
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Column lookup ignoring case ("Package name" vs "Package Name"). */
function col(row: CsvRow, name: string): string | undefined {
  if (name in row) return row[name]
  const key = Object.keys(row).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  )
  return key === undefined ? undefined : row[key]
}

export function months(start: string, end: string): string[] {
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const ey = Number(end.slice(0, 4))
  const em = Number(end.slice(5, 7))
  const out: string[] = []
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, "0")}`)
    if (m === 12) {
      y++
      m = 1
    } else m++
  }
  return out
}

/** Sum KPI rows with the same (date, metric, dims). */
class KpiSum {
  private readonly map = new Map<string, KpiRow>()
  add(date: string, metric: string, dims: string, value: number | null) {
    if (value === null || !date) return
    const key = `${date}\u0000${metric}\u0000${dims}`
    const row = this.map.get(key)
    if (row) row.value += value
    else this.map.set(key, { source: "play", date, metric, dims, value })
  }
  set(date: string, metric: string, value: number | null) {
    if (value === null || !date) return
    this.map.set(`${date}\u0000${metric}\u0000`, {
      source: "play",
      date,
      metric,
      dims: "",
      value,
    })
  }
  rows() {
    return [...this.map.values()]
  }
}

/** Rows of one report file → KPI (see header comment). */
export function playReportRows(report: Report, rows: CsvRow[], sum: KpiSum) {
  for (const r of rows) {
    const date = col(r, "Date") ?? ""
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (report === "store_performance_traffic_source") {
      const dims = dimsKey({
        source: col(r, "Traffic source") ?? "",
        utm_source: col(r, "UTM source") ?? "",
        utm_campaign: col(r, "UTM campaign") ?? "",
      })
      sum.add(date, "installs", dims, num(col(r, "Store listing acquisitions")))
      sum.add(date, "store_visits", dims, num(col(r, "Store listing visitors")))
    } else if (report === "store_performance_country") {
      const dims = dimsKey({ country: col(r, "Country / region") ?? "" })
      const acq = num(col(r, "Store listing acquisitions"))
      const vis = num(col(r, "Store listing visitors"))
      sum.add(date, "installs", dims, acq)
      sum.add(date, "store_visits", dims, vis)
      sum.add(date, "store_acquisitions", "", acq)
      sum.add(date, "store_visits", "", vis)
    } else if (report === "installs_overview") {
      sum.set(date, "installs", num(col(r, "Daily User Installs")))
      sum.set(date, "uninstalls", num(col(r, "Daily User Uninstalls")))
      sum.set(date, "active_installs", num(col(r, "Active Device Installs")))
    } else if (report === "ratings_overview") {
      const total = num(col(r, "Total Average Rating"))
      if (total) sum.set(date, "rating", total)
    }
  }
}

/** reviews_<pkg>_<ym>.csv → store reviews. The export has no review id: submit time + device are stable. */
export function playReviewRows(rows: CsvRow[]): StoreReviewRow[] {
  const out: StoreReviewRow[] = []
  for (const r of rows) {
    const millis = col(r, "Review Submit Millis Since Epoch")?.trim()
    const submitted = col(r, "Review Submit Date and Time")?.trim()
    if (!millis && !submitted) continue
    const text = (v: string | undefined) => (v?.trim() ? v.trim() : null)
    out.push({
      store: "google_play",
      reviewId: `${millis || submitted}:${col(r, "Device")?.trim() ?? ""}`,
      date: submitted || null,
      rating: num(col(r, "Star Rating")),
      title: text(col(r, "Review Title")),
      body: text(col(r, "Review Text")),
      language: text(col(r, "Reviewer Language")),
      version: text(col(r, "App Version Name")),
      reply: text(col(r, "Developer Reply Text")),
    })
  }
  return out
}

export async function collectPlay(
  config: PlayConfig,
  ctx: CollectorContext
): Promise<CollectorResult> {
  const today = resolveToday(ctx)
  const { start, end } = dateWindow(ctx.days, today)
  const stats: Record<string, unknown> = { range: [start, end] }
  const errors: string[] = []
  let pkg: string
  let bucket: string
  try {
    const c = config as unknown as Record<string, unknown>
    pkg = requireString(c, "package", "play")
    bucket = requireString(c, "gcsBucket", "play")
  } catch (e) {
    return finish({
      kpi: [],
      summary: errorMessage(e),
      stats,
      errors: [errorMessage(e)],
    })
  }
  const sum = new KpiSum()
  const reports: Record<string, unknown> = {}
  const dates: string[] = []
  const fill = (pattern: string, ym: string) =>
    pattern.replace("{pkg}", pkg).replace("{ym}", ym)
  const get = (p: string, f?: FetchFn) =>
    gcs(bucket, p, { media: true, fetch: f }) as Promise<Buffer | null>
  for (const [report, pattern] of Object.entries(PLAY_REPORTS) as [
    Report,
    string,
  ][]) {
    let files = 0
    let rows = 0
    let last: string | null = null
    try {
      for (const ym of months(start, end)) {
        const raw = await get(fill(pattern, ym), ctx.fetch)
        if (!raw) continue
        files++
        const parsed = parseCsv(decodeExport(raw))
        rows += parsed.length
        playReportRows(report, parsed, sum)
        for (const r of parsed) {
          const d = col(r, "Date") ?? ""
          if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            dates.push(d)
            if (!last || d > last) last = d
          }
        }
      }
      reports[report] = { files, rows, last_date: last }
    } catch (e) {
      errors.push(`play ${report}: ${errorMessage(e)}`)
      // The same access error would repeat for every report.
      if (errors.length === 1 && /Zugang/.test(errorMessage(e))) break
    }
  }
  stats.reports = reports
  const storeReviews: StoreReviewRow[] = []
  if (!errors.length) {
    try {
      for (const ym of months(start, end)) {
        const raw = await get(fill(REVIEWS, ym), ctx.fetch)
        if (raw)
          storeReviews.push(...playReviewRows(parseCsv(decodeExport(raw))))
      }
      stats.reviews = storeReviews.length
    } catch (e) {
      errors.push(`play reviews: ${errorMessage(e)}`)
    }
  }
  const kpi = sum.rows()
  // Last 7 days of store listing traffic per UTM campaign (store_attribution.py utm_campaign_7d).
  const since = addDays(end, -6)
  const camp: Record<string, Record<string, number>> = {}
  for (const r of kpi) {
    if (!r.dims || r.date < since) continue
    const d = JSON.parse(r.dims) as Record<string, string>
    const c = d.utm_campaign
    if (
      c === undefined ||
      ["Other", "No UTM campaign specified", ""].includes(c)
    )
      continue
    camp[c] = camp[c] ?? {}
    camp[c][r.metric] = (camp[c][r.metric] ?? 0) + r.value
  }
  stats.utm_campaign_7d = camp
  const sorted = [...new Set(dates)].sort()
  const window = sorted.length
    ? { from: sorted[0], to: sorted[sorted.length - 1] }
    : undefined
  const installs = kpi
    .filter((r) => r.metric === "installs" && r.dims === "" && r.date >= start)
    .reduce((a, r) => a + r.value, 0)
  const summary = errors.length
    ? `Google Play: ${errors.length} Fehler (${errors.join("; ").slice(0, 200)})`
    : `Google Play ${window ? `${window.from}–${window.to}` : "ohne Daten"}: ${installs} Installationen seit ${start}, ${kpi.length} KPI-Zeilen, ${storeReviews.length} Bewertungen`
  return finish({
    kpi,
    storeReviews,
    window: errors.length ? undefined : window,
    summary,
    stats,
    errors,
  })
}

export interface PlayCheck {
  ok: boolean
  files?: number
  latest?: { name: string; updated: string } | null
  error?: string
}

/** store_attribution.py `check` for Google Play: list the store_performance exports. */
export async function checkPlay(
  config: Partial<PlayConfig>,
  fetchImpl?: FetchFn
): Promise<PlayCheck> {
  try {
    const c = config as Record<string, unknown>
    const pkg = requireString(c, "package", "play")
    const bucket = requireString(c, "gcsBucket", "play")
    const items: { name: string; updated: string }[] = []
    let token: string | undefined
    do {
      const page = ((await gcs(bucket, "", {
        params: {
          prefix: `stats/store_performance/store_performance_${pkg}_`,
          maxResults: "1000",
          ...(token ? { pageToken: token } : {}),
        },
        fetch: fetchImpl,
      })) ?? {}) as {
        items?: { name: string; updated: string }[]
        nextPageToken?: string
      }
      items.push(...(page.items ?? []))
      token = page.nextPageToken
    } while (token)
    const latest = items.length
      ? items.reduce((a, b) => (b.updated > a.updated ? b : a))
      : null
    return {
      ok: items.length > 0,
      files: items.length,
      latest: latest && {
        name: latest.name.split("/").pop() ?? latest.name,
        updated: latest.updated.slice(0, 16),
      },
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e).slice(0, 300) }
  }
}

export const playCollector: SourceCollector<PlayConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectPlay,
}

/** Labels and formatters for the growth views. Pure, usable on server and client. */

export const STAGE_LABEL: Record<string, string> = {
  impression: "Impressionen",
  click: "Klicks",
  visit: "Besuche",
  download_click: "Download-Klicks",
  install: "Installationen",
  first_entry: "Erster Eintrag",
  active_d7: "Aktiv D7",
  active_d28: "Aktiv D28",
}

export const LIGHT_LABEL: Record<string, string> = {
  green: "Im Plan",
  yellow: "Beobachten",
  red: "Handeln",
}

export const APPROVAL_KIND_LABEL: Record<string, string> = {
  hook: "Hook",
  format: "Format",
  blog_topic: "Blog-Thema",
  draft: "Entwurf",
  store_text: "Store-Text",
  strategy: "Strategie",
  other: "Sonstiges",
}

export const APPROVAL_STATUS_LABEL: Record<string, string> = {
  pending: "offen",
  approved: "freigegeben",
  rejected: "abgelehnt",
  changes_requested: "Änderung gewünscht",
  withdrawn: "zurückgezogen",
}

export const CONTENT_KIND_LABEL: Record<string, string> = {
  blog: "Blog",
  landing: "Landingpage",
  store_text: "Store-Text",
  other: "Sonstiges",
}

export const BACKLOG_KIND_LABEL: Record<string, string> = {
  seo: "SEO",
  tech: "Technik",
  content: "Content",
  store: "Store",
  growth: "Growth",
  other: "Sonstiges",
}

export const EXPERIMENT_STATUS_LABEL: Record<string, string> = {
  running: "läuft",
  evaluated: "ausgewertet",
  stopped: "gestoppt",
}

export const VERDICT_LABEL: Record<string, string> = {
  win: "Gewinn",
  loss: "Verlust",
  neutral: "neutral",
  inconclusive: "unklar",
}

export const CHANGE_KIND_LABEL: Record<string, string> = {
  deploy: "Deploy",
  content: "Content",
  seo: "SEO",
  store: "Store",
  config: "Konfiguration",
  shorts: "Shorts",
  other: "Sonstiges",
}

export const CHANNEL_KIND_LABEL: Record<string, string> = {
  website: "Website",
  ios: "iOS-App",
  android: "Android-App",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  other: "Sonstiges",
}

export const PROJECT_KIND_LABEL: Record<string, string> = {
  app: "App",
  website: "Website",
  tool: "Tool",
  other: "Sonstiges",
}

export const MENTION_STATUS_LABEL: Record<string, string> = {
  new: "neu",
  contacted: "angefragt",
  listed: "gelistet",
  rejected: "abgelehnt",
  ignored: "ignoriert",
}

export const MENTION_KIND_LABEL: Record<string, string> = {
  app_store: "App Store",
  comparison: "Vergleich",
  guide: "Ratgeber",
  forum: "Forum",
  press: "Presse",
  vendor: "Anbieter",
  other: "Sonstiges",
}

export const COLLECTOR_LABEL: Record<string, string> = {
  health: "Erreichbarkeit",
  audit: "SEO-Audit",
  gsc: "Search Console",
  ga4: "Google Analytics",
  bing: "Bing Webmaster",
  psi: "PageSpeed",
  app: "App-Analytics",
  play: "Google Play",
  asc: "App Store Connect",
  "geo-chatgpt": "ChatGPT-Nennungen",
}

export const STORE_LABEL: Record<string, string> = {
  app_store: "App Store",
  google_play: "Google Play",
}

export const METRIC_LABEL: Record<string, string> = {
  clicks: "Klicks",
  impressions: "Impressionen",
  ctr: "CTR",
  position: "Position",
  "gsc:clicks": "Klicks (GSC)",
  "gsc:impressions": "Impressionen (GSC)",
  "ga4:sessions": "Besuche (GA4)",
  "ga4:event:download_click": "Download-Klicks",
  "play:installs": "Installationen (Play)",
  "asc:installs": "Installationen (App Store)",
  "app:active_users": "Aktive Nutzer",
}

/** Format a metric value: ctr as percent, position with one decimal. */
export function fmtMetric(metric: string, v: number | null | undefined) {
  if (metric === "ctr" || metric.endsWith(":ctr")) return fmtPct(v)
  if (metric.includes("retention")) return fmtPct(v)
  return fmtNum(v)
}

export const lowerIsBetter = (metric: string) =>
  metric === "position" || metric.endsWith(":position")

export function label(map: Record<string, string>, key: string | null) {
  if (!key) return "–"
  return map[key] ?? key
}

/** JSON column that may already be parsed. */
export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === "") return fallback
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

const intFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 })
const decFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 })

export function fmtNum(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–"
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return intFmt.format(v)
  return decFmt.format(v)
}

/** Compact number for tight cells: 12,3 Tsd. */
export function fmtCompact(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–"
  if (Math.abs(v) >= 10_000)
    return new Intl.NumberFormat("de-DE", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v)
  return fmtNum(v)
}

/** Share 0–1 as percent. */
export function fmtPct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–"
  return new Intl.NumberFormat("de-DE", {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(v)
}

/** Relative change (0.12 → "+12 %"). */
export function fmtDelta(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–"
  const pct = new Intl.NumberFormat("de-DE", {
    style: "percent",
    maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0,
    signDisplay: "exceptZero",
  }).format(v)
  return pct
}

export type Tone = "good" | "warn" | "bad" | "neutral"

/** Tone of a relative change. For metrics where lower is better pass invert. */
export function deltaTone(v: number | null | undefined, invert = false): Tone {
  if (v === null || v === undefined || Number.isNaN(v)) return "neutral"
  const x = invert ? -v : v
  if (x <= -0.4) return "bad"
  if (x <= -0.2) return "warn"
  if (x >= 0.05) return "good"
  return "neutral"
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})
const shortDateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
})
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

/** YYYY-MM-DD (local) or ISO timestamp. */
function toDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v)
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return "–"
  const d = toDate(v)
  return Number.isNaN(d.getTime()) ? v : dateFmt.format(d)
}

export function fmtShortDate(v: string | null | undefined) {
  if (!v) return "–"
  const d = toDate(v)
  return Number.isNaN(d.getTime()) ? v : shortDateFmt.format(d)
}

export function fmtDateTime(v: string | null | undefined) {
  if (!v) return "–"
  const d = toDate(v)
  return Number.isNaN(d.getTime()) ? v : dateTimeFmt.format(d)
}

/** "vor 3 Std." relative to `now` (pass a fixed now on the server). */
export function fmtAgo(v: string | null | undefined, now: number) {
  if (!v) return "nie"
  const t = toDate(v).getTime()
  if (Number.isNaN(t)) return v
  const min = Math.round((now - t) / 60_000)
  if (min < 1) return "gerade eben"
  if (min < 60) return `vor ${min} Min.`
  const h = Math.round(min / 60)
  if (h < 36) return `vor ${h} Std.`
  const d = Math.round(h / 24)
  return `vor ${d} Tagen`
}

export function actorLabel(actor: string | null | undefined) {
  if (!actor) return "–"
  if (actor === "max") return "Max"
  return actor
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function localToday() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

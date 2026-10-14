export const PLAN_STATUS_LABEL: Record<string, string> = {
  idea: "Idee",
  planned: "geplant",
  in_production: "in Produktion",
  delivered: "geliefert",
  posted: "gepostet",
  skipped: "übersprungen",
}

export const POST_STATUS_LABEL: Record<string, string> = {
  produced: "produziert",
  delivered: "geliefert",
  posted: "gepostet",
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: "aktiv",
  paused: "pausiert",
  planned: "geplant",
}

export const GUIDE_LABEL = "Leitfaden (Slide-Aufbau, Produktion, Abnahme)"

export const FORMAT_SOURCE_LABEL: Record<string, string> = {
  plan: "heute aus dem Planeintrag",
  account: "Account",
}

export const CTA_LABEL: Record<string, string> = {
  none: "kein CTA",
  engagement: "nur Engagement",
  app: "App-CTA",
}

export const RULE_KIND_LABEL: Record<string, string> = {
  hook: "Hook",
  copy: "Copy",
  image: "Bild",
  caption: "Caption",
  cta: "CTA",
  production: "Produktion",
  other: "Sonstiges",
}

export const INSPO_TYPE_LABEL: Record<string, string> = {
  format: "Format",
  hook: "Hook",
  sound: "Sound",
  visual: "Visual",
  topic: "Thema",
  trend: "Trend",
}

export const INSPO_STATUS_LABEL: Record<string, string> = {
  new: "neu",
  analyzed: "analysiert",
  adapted: "adaptiert",
  discarded: "verworfen",
}

export const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})
const numFmt = new Intl.NumberFormat("de-DE")

/** "2026-10-14" -> "14.10.2026" without timezone shifts */
export function fmtDate(d: string | null | undefined) {
  if (!d) return "–"
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-")
    return `${day}.${m}.${y}`
  }
  const t = Date.parse(d)
  return Number.isNaN(t) ? d : dateFmt.format(t)
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "–"
  const t = Date.parse(d)
  return Number.isNaN(t) ? d : dateTimeFmt.format(t)
}

export function fmtNum(n: number | null | undefined) {
  return n === null || n === undefined ? "–" : numFmt.format(n)
}

export function fmtPct(n: number | null | undefined) {
  return n === null || n === undefined
    ? "–"
    : `${(n * 100).toFixed(1).replace(".", ",")} %`
}

export function actorLabel(a: string) {
  if (a === "max") return "Max"
  if (a === "import") return "Import"
  return a.charAt(0).toUpperCase() + a.slice(1)
}

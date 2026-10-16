/** Labels and small helpers for the app inbox pages. Pure, usable on server and client. */

/** Featurama request status (Featurama's own wording mapped to German). */
export const FEATURAMA_STATUS_LABEL: Record<string, string> = {
  Requested: "Angefragt",
  Roadmap: "Roadmap",
  Planned: "Geplant",
  "In Progress": "In Arbeit",
  InProgress: "In Arbeit",
  Done: "Erledigt",
  Declined: "Abgelehnt",
}

export function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`
}

const languageNames = new Intl.DisplayNames(["de"], { type: "language" })

/**
 * Google Play sends a language code (de, en), the App Store a territory (DEU, USA).
 * Returns the visible text and an accessible description.
 */
export function localeLabel(v: string | null | undefined) {
  if (!v) return null
  if (/^[A-Z]{3}$/.test(v)) return { text: v, title: `Land ${v}` }
  try {
    const name = languageNames.of(v)
    if (name && name !== v) return { text: name, title: `Sprache ${name}` }
  } catch {
    // Unknown code: show it as stored.
  }
  return { text: v, title: `Sprache ${v}` }
}

const stampFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/** Date with year and time, for thread entries that can be years old. */
export function fmtStamp(v: string | null | undefined) {
  if (!v) return "–"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : stampFmt.format(d)
}

/** "/approvals" filter that shows the given approval status. */
export function approvalsHref(status: string) {
  return status === "pending"
    ? "/approvals?status=pending"
    : "/approvals?status=all"
}

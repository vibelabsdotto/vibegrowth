/** Labels and small helpers for the app inbox pages. Pure, usable on server and client. */

import type {
  InboxItem,
  InboxState,
  InboxStateCounts,
} from "@/lib/growth-types"

/** Item state (contract §7.8) in German. */
export const INBOX_STATE_LABEL: Record<InboxState, string> = {
  open: "offen",
  proposal: "Vorschlag wartet",
  approved: "freigegeben",
  answered: "beantwortet",
  no_reply: "keine Antwort nötig",
  stale: "veraltet",
  error: "Fehler",
}

/** States shown by the default filter „Offen + Vorschlag“. */
export const ACTIVE_STATES: readonly InboxState[] = ["open", "proposal"]

export type InboxFilter = "open" | "all"

/**
 * ?filter= of the inbox pages. Only "all" widens the list; everything else, including
 * old values such as "needs-reply", falls back to the default „Offen + Vorschlag“.
 */
export function inboxFilter(v: string | undefined): InboxFilter {
  return v === "all" ? "all" : "open"
}

export function isActiveState(state: InboxState) {
  return ACTIVE_STATES.includes(state)
}

/** Open plus proposal from the API counts, counted from the items when the API has none. */
export function activeCount(
  byState: InboxStateCounts | undefined,
  items: InboxItem[]
) {
  if (byState)
    return ACTIVE_STATES.reduce((sum, s) => sum + (byState[s] ?? 0), 0)
  return items.filter((i) => isActiveState(i.state)).length
}

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

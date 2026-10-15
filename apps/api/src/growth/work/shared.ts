import { and, eq } from "drizzle-orm"
import type { Ctx } from "../../core/db"
import { accounts, channels, projects } from "../../core/schema"
import { addDays, assertDate, getById, today, VGError } from "../../core/util"

export type ProjectRow = typeof projects.$inferSelect

/** Whitelist check for enums (contract §6: whitelists in the service, INVALID otherwise). */
export function oneOf<T extends readonly string[]>(
  value: string,
  allowed: T,
  field: string
): T[number] {
  if (!(allowed as readonly string[]).includes(value))
    throw new VGError(
      "INVALID",
      `${field} muss einer von ${allowed.join(", ")} sein, war: ${value}`
    )
  return value
}

export function optOneOf<T extends readonly string[]>(
  value: string | undefined | null,
  allowed: T,
  field: string
): T[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined
  return oneOf(value, allowed, field)
}

/** Comma separated filter value ("open,doing") validated against a whitelist. */
export function listOf<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  field: string
): T[number][] | undefined {
  if (!value) return undefined
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => oneOf(v, allowed, field))
}

export function requireProject(ctx: Ctx, id: string | undefined | null) {
  if (!id) throw new VGError("INVALID", "project fehlt")
  return getById(ctx, projects, id, "Projekt")
}

/** Channel must exist and belong to the project. TikTok accounts count as virtual channels. */
export function checkChannel(
  ctx: Ctx,
  projectId: string,
  channelId: string | null | undefined
) {
  if (!channelId) return null
  const ch = ctx.db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .get()
  if (ch) {
    if (ch.projectId !== projectId)
      throw new VGError(
        "INVALID",
        `Kanal ${channelId} gehört zu Projekt ${ch.projectId}, nicht zu ${projectId}`
      )
    return channelId
  }
  const acc = ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, channelId), eq(accounts.brandId, projectId)))
    .get()
  if (acc) return channelId
  throw new VGError("NOT_FOUND", `Kanal ${channelId} nicht gefunden`)
}

export function intParam(
  v: string | number | undefined | null,
  field: string,
  fallback?: number
): number | undefined {
  if (v === undefined || v === null || v === "") return fallback
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isInteger(n))
    throw new VGError(
      "INVALID",
      `${field} muss eine ganze Zahl sein, war: ${v}`
    )
  return n
}

export function idParam(v: string, label: string): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0)
    throw new VGError("INVALID", `${label}-ID muss eine Zahl sein, war: ${v}`)
  return n
}

export function boolParam(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes"
}

export function optDate(v: string | undefined | null, field: string) {
  if (v === undefined || v === null || v === "") return undefined
  return assertDate(v, field)
}

export const yesterday = () => addDays(today(), -1)

/** Days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

/** Relative change, null when there is no base. */
export function relChange(value: number | null, prev: number | null) {
  if (value === null || prev === null || prev === 0) return null
  return (value - prev) / prev
}

export function round(n: number | null, digits = 4) {
  if (n === null || !Number.isFinite(n)) return null
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** Path of a URL or path without query, hash and trailing slash ("/" for the root). */
export function urlPath(u: string): string {
  let p = u.trim()
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname
    } catch {
      /* keep as is */
    }
  }
  p = p.split(/[?#]/)[0]
  try {
    p = decodeURI(p)
  } catch {
    /* keep encoded */
  }
  if (!p.startsWith("/")) p = `/${p}`
  if (p.length > 1) p = p.replace(/\/+$/, "")
  return p || "/"
}

/** Page matches a target by path suffix (contract §7.5: Pfad-Suffix-Vergleich). */
export function pathMatches(page: string, target: string) {
  if (!page) return false
  const p = urlPath(page)
  const t = urlPath(target)
  if (t === "/") return p === "/"
  return p === t || p.endsWith(t)
}

/** Host without www., lower case; accepts URLs and bare domains. */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return ""
  let s = input.trim().toLowerCase()
  if (!s) return ""
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`
  try {
    const h = new URL(s).hostname.replace(/\.$/, "")
    return h.startsWith("www.") ? h.slice(4) : h
  } catch {
    return ""
  }
}

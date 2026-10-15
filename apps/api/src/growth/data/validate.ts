import { addDays, isDate, parseJson, today, VGError } from "../../core/util"

/** Request body as sent by CLI/web; validated field by field in the services (CONTRACT §6: enums are service whitelists). */
export type Body = Record<string, unknown>

export function body(value: unknown): Body {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new VGError("INVALID", "Body muss ein JSON-Objekt sein")
  return value as Body
}

/** Rejects fields the endpoint does not know (typos must not be dropped silently). */
export function onlyKeys(input: Body, allowed: readonly string[]) {
  const extra = Object.keys(input).filter((k) => !allowed.includes(k))
  if (extra.length)
    throw new VGError(
      "INVALID",
      `Unbekannte Felder: ${extra.join(", ")} (erlaubt: ${allowed.join(", ")})`
    )
}

export function reqString(input: Body, key: string): string {
  const v = input[key]
  if (typeof v !== "string" || !v.trim())
    throw new VGError("INVALID", `${key} fehlt`)
  return v.trim()
}

/** undefined = not given, null = clear, string = set (empty string counts as clear). */
export function optString(input: Body, key: string): string | null | undefined {
  const v = input[key]
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string")
    throw new VGError("INVALID", `${key} muss ein Text sein`)
  return v.trim() || null
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new VGError(
      "INVALID",
      `${field} muss einer von ${allowed.join("|")} sein, war: ${String(value)}`
    )
  return value as T
}

export function optOneOf<T extends string>(
  input: Body,
  key: string,
  allowed: readonly T[]
): T | undefined {
  return input[key] === undefined ? undefined : oneOf(input[key], allowed, key)
}

export function optBool(input: Body, key: string): boolean | undefined {
  const v = input[key]
  if (v === undefined) return undefined
  if (typeof v !== "boolean")
    throw new VGError("INVALID", `${key} muss true oder false sein`)
  return v
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Object field or undefined; null is allowed only when allowNull. */
export function optObject(
  input: Body,
  key: string
): Record<string, unknown> | undefined {
  const v = input[key]
  if (v === undefined) return undefined
  if (!isPlainObject(v))
    throw new VGError("INVALID", `${key} muss ein JSON-Objekt sein`)
  return v
}

/** Shallow merge: keys with null are removed, everything else overwrites (CONTRACT §7.5 collectors set). */
export function mergeConfig(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k]
    else next[k] = v
  }
  return next
}

export function jsonObject(s: string | null | undefined) {
  const v = parseJson<unknown>(s, {})
  return isPlainObject(v) ? v : {}
}

/** Lowercase id with digits and hyphens (chrono, chrono-web). */
export function assertId(id: string, field = "id") {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id))
    throw new VGError(
      "INVALID",
      `${field} darf nur a-z, 0-9 und - enthalten, war: ${id}`
    )
  return id
}

/** Query string → positive integer with default and upper bound. */
export function queryInt(
  value: string | undefined,
  field: string,
  fallback: number,
  max = 3650
): number {
  if (value === undefined || value === "") return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new VGError("INVALID", `${field} muss eine ganze Zahl 1–${max} sein`)
  return n
}

export function queryBool(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", ""].includes(value)
}

export function queryDate(value: string | undefined, field: string) {
  if (value === undefined || value === "") return undefined
  if (!isDate(value))
    throw new VGError(
      "INVALID",
      `${field} muss YYYY-MM-DD sein, war: ${String(value)}`
    )
  return value
}

export const yesterday = () => addDays(today(), -1)

/** Inclusive window of `days` days ending at `end`. */
export function windowEnding(end: string, days: number) {
  return { from: addDays(end, -(days - 1)), to: end }
}

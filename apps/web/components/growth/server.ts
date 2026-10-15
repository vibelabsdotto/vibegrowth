import "server-only"
import { ApiError, apiFetch } from "@/lib/api"

type Query = Record<string, string | number | boolean | null | undefined>

export type Loaded<T> = { data: T; error: null } | { data: null; error: string }

/** GET from apps/api without throwing; pages show the error next to the section that needs it. */
export async function load<T>(path: string, query?: Query): Promise<Loaded<T>> {
  try {
    return { data: await apiFetch<T>(path, { query }), error: null }
  } catch (e) {
    return { data: null, error: errorText(e) }
  }
}

export function errorText(e: unknown) {
  if (e instanceof ApiError) return `${e.message} (${e.code})`
  const cause = (e as { cause?: { code?: string } })?.cause?.code
  if (cause === "ECONNREFUSED") return "API nicht erreichbar"
  return e instanceof Error ? e.message : String(e)
}

/** Lists may come bare or wrapped ({items|rows|…: […]}). */
export function list<T>(v: unknown, ...keys: string[]): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v && typeof v === "object") {
    for (const k of [...keys, "items", "rows", "data"]) {
      const x = (v as Record<string, unknown>)[k]
      if (Array.isArray(x)) return x as T[]
    }
  }
  return []
}

/** Request time for "vor X Std." labels; server components render once per request. */
export function requestTime() {
  return Date.now()
}

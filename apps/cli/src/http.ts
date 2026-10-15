/** HTTP client against apps/api. No auth, loopback only; the actor travels in X-Actor. */

/** VIBEGROWTH_<name>, falling back to the old VIBESHORTS_<name>. */
export function env(name: string): string | undefined {
  return process.env[`VIBEGROWTH_${name}`] ?? process.env[`VIBESHORTS_${name}`]
}

/** Same codes as the API error body; API = server not reachable. */
export class CliError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export function apiUrl() {
  return (env("API_URL") || "http://127.0.0.1:4311").replace(/\/+$/, "")
}

export type Query = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  query?: Query
  body?: unknown
  actor: string
  /** Render, metrics pull and collector runs take minutes. */
  timeoutMs?: number
}

function unreachable(base: string): never {
  throw new CliError(
    "API",
    `VibeGrowth-API nicht erreichbar unter ${base}. Starten mit: vibegrowth serve`
  )
}

export async function request(
  path: string,
  { method = "GET", query, body, actor, timeoutMs = 600_000 }: RequestOptions
): Promise<unknown> {
  const base = apiUrl()
  let target = `${base}/api${path}`
  if (query) {
    const qs = new URLSearchParams()
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === false) continue
      if (value === "") continue
      qs.set(name, String(value))
    }
    if (qs.size) target += `?${qs}`
  }
  const signal = AbortSignal.timeout(timeoutMs)
  let res: Response
  let text: string
  try {
    res = await fetch(target, {
      method,
      headers: {
        Accept: "application/json",
        "X-Actor": actor,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
      signal,
    })
    text = await res.text()
  } catch {
    if (signal.aborted)
      throw new CliError(
        "API",
        `VibeGrowth-API antwortet nicht innerhalb von ${Math.round(timeoutMs / 1000)} s (${base})`
      )
    unreachable(base)
  }
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (res.ok)
        throw new CliError("ERROR", `Antwort der API ist kein JSON (${path})`)
      data = null
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: unknown; message?: unknown } })
      ?.error
    if (err && typeof err.code === "string")
      throw new CliError(
        err.code,
        typeof err.message === "string" ? err.message : `HTTP ${res.status}`
      )
    throw new CliError("ERROR", `HTTP ${res.status} von ${path}`)
  }
  return data
}

/** Encode one path segment (ids may be folder names). */
export const seg = (v: string | number) => encodeURIComponent(String(v))

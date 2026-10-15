import "server-only"

/** Base URL of apps/api (contract §3). Server-side only; the browser goes through the /api rewrite. */
export function apiUrl() {
  return (
    process.env.VIBEGROWTH_API_URL ??
    process.env.VIBESHORTS_API_URL ??
    "http://127.0.0.1:4311"
  ).replace(/\/$/, "")
}

/** The web app is Max's surface; every write from the browser is attributed to him. */
export const WEB_ACTOR = "max"

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== false) params.set(k, String(v))
  const qs = params.toString()
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path
}

/**
 * Call apps/api. `path` without the /api prefix, e.g. apiFetch("/accounts").
 * Throws ApiError with the contract error code ({"error":{"code","message"}}).
 */
export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query } = {}
): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST")
  const headers: Record<string, string> = { "X-Actor": WEB_ACTOR }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  const res = await fetch(`${apiUrl()}/api${withQuery(path, opts.query)}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } })
      ?.error
    throw new ApiError(
      res.status,
      err?.code ?? "ERROR",
      err?.message ?? res.statusText
    )
  }
  return data as T
}

export function mediaUrl(rel: string | null | undefined) {
  return rel ? `/media?path=${encodeURIComponent(rel)}` : null
}

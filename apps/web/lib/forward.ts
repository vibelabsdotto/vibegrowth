import "server-only"
import { apiUrl } from "./api"

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
const PASS_REQUEST = ["accept", "content-type", "range", "x-actor"]
const PASS_RESPONSE = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
]

/**
 * Browser request → apps/api, resolved per request. A `rewrites` entry would bake the API
 * URL of the build shell into the build, so a build with a dev VIBEGROWTH_API_URL broke
 * every image. The host check replaces proxy.ts, whose matcher skips /api and /media.
 */
export async function forward(req: Request, apiPath: string) {
  const host = req.headers.get("host") ?? ""
  if (!LOOPBACK.test(host))
    return new Response("VibeGrowth läuft nur lokal.", { status: 403 })
  const src = new URL(req.url)
  const headers = new Headers()
  for (const h of PASS_REQUEST) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  let res: Response
  try {
    res = await fetch(`${apiUrl()}${apiPath}${src.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    })
  } catch {
    return new Response("API nicht erreichbar", { status: 502 })
  }
  const out = new Headers()
  for (const h of PASS_RESPONSE) {
    const v = res.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(res.body, { status: res.status, headers: out })
}

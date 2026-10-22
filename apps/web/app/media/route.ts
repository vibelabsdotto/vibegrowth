import { forward } from "@/lib/forward"

export const dynamic = "force-dynamic"

/** Images and videos from the data dir (API /api/media, path guard there). */
export function GET(req: Request) {
  return forward(req, "/api/media")
}

export function HEAD(req: Request) {
  return forward(req, "/api/media")
}

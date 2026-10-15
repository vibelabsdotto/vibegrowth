import { NextResponse, type NextRequest } from "next/server"
import {
  PROJECT_COOKIE,
  PROJECT_COOKIE_MAX_AGE,
} from "@/lib/project-scope-cookie"

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
const COOKIE_OPTS = {
  path: "/",
  sameSite: "lax" as const,
  maxAge: PROJECT_COOKIE_MAX_AGE,
}

/**
 * VibeGrowth has no login and must only be reachable from this machine.
 * The server binds to 127.0.0.1; this also rejects foreign Host headers (DNS rebinding).
 *
 * Project scope (sidebar switcher, cookie vg_project) is the single source of truth for
 * project filters. Two ways set it besides the switcher:
 * - `?project=<id>` on any page link (`all` or empty = alle Projekte): stored, then redirected
 *   to the same URL without the parameter, so links and agents can deep-link into a project.
 * - opening a cockpit `/projects/<id>` selects that project.
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? ""
  if (!LOOPBACK.test(host))
    return new NextResponse("VibeGrowth läuft nur lokal.", { status: 403 })

  const { pathname, searchParams } = req.nextUrl
  if (req.method === "GET" && searchParams.has("project")) {
    const raw = searchParams.get("project") ?? ""
    const id = raw === "all" ? "" : raw
    const url = req.nextUrl.clone()
    url.searchParams.delete("project")
    const res = NextResponse.redirect(url)
    if (id) res.cookies.set(PROJECT_COOKIE, id, COOKIE_OPTS)
    else res.cookies.delete(PROJECT_COOKIE)
    return res
  }

  const cockpit = pathname.match(/^\/projects\/([^/]+)/)
  if (cockpit) {
    const id = decodeURIComponent(cockpit[1])
    if (req.cookies.get(PROJECT_COOKIE)?.value !== id) {
      // Also on the request, so this render already sees the new scope.
      req.cookies.set(PROJECT_COOKIE, id)
      const res = NextResponse.next({ request: { headers: req.headers } })
      res.cookies.set(PROJECT_COOKIE, id, COOKIE_OPTS)
      return res
    }
  }
  return NextResponse.next()
}

// Pages only: API, media and Next assets go straight through (the API keeps its own guard).
export const config = {
  matcher: "/((?!api/|media|_next/|favicon.ico).*)",
}

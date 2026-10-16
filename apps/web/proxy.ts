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
 * - `/projects/<id>` (old cockpit URL) selects that project and redirects to the Übersicht,
 *   which shows the cockpit whenever a project is chosen.
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

  // The cockpit is the Übersicht with a project chosen: /projects/<id> selects it and opens /.
  const cockpit = pathname.match(/^\/projects\/([^/]+)/)
  if (cockpit) {
    const id = decodeURIComponent(cockpit[1])
    const url = req.nextUrl.clone()
    url.pathname = "/"
    const res = NextResponse.redirect(url)
    res.cookies.set(PROJECT_COOKIE, id, COOKIE_OPTS)
    return res
  }
  // Renamed pages: Backlog is now Aufgaben, the format list lives under Strategien (Shortform).
  if (pathname === "/backlog" || pathname === "/formats") {
    const url = req.nextUrl.clone()
    if (pathname === "/backlog") url.pathname = "/tasks"
    else {
      url.pathname = "/strategies"
      url.searchParams.set("category", "shortform")
    }
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

// Pages only: API, media and Next assets go straight through (the API keeps its own guard).
export const config = {
  matcher: "/((?!api/|media|_next/|favicon.ico).*)",
}

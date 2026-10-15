import { NextResponse, type NextRequest } from "next/server"

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/**
 * VibeGrowth has no login and must only be reachable from this machine.
 * The server binds to 127.0.0.1; this also rejects foreign Host headers (DNS rebinding).
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? ""
  if (!LOOPBACK.test(host))
    return new NextResponse("VibeGrowth läuft nur lokal.", { status: 403 })
  return NextResponse.next()
}

export const config = { matcher: "/:path*" }

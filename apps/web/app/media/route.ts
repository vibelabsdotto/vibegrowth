import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { NextResponse, type NextRequest } from "next/server"
import { resolveInDataDir } from "@/core/config"
import { ctx } from "@/lib/server"

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
}

/** Serve images and videos from the data dir. Only paths inside it, only media types. */
export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path")
  if (!rel) return new NextResponse("path fehlt", { status: 400 })
  let abs: string
  try {
    abs = resolveInDataDir(ctx().config.dataDir, rel)
  } catch {
    return new NextResponse("Pfad außerhalb des Datenordners", { status: 403 })
  }
  const type = TYPES[path.extname(abs).toLowerCase()]
  if (!type) return new NextResponse("Dateityp nicht erlaubt", { status: 415 })
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    return new NextResponse("Nicht gefunden", { status: 404 })
  }
  const range = req.headers.get("range")
  if (range && type === "video/mp4") {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    const start = m?.[1] ? Number(m[1]) : 0
    const end = m?.[2] ? Number(m[2]) : stat.size - 1
    const stream = Readable.toWeb(
      fs.createReadStream(abs, { start, end })
    ) as ReadableStream
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
      },
    })
  }
  return new NextResponse(fs.readFileSync(abs), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=60",
    },
  })
}

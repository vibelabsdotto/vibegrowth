import fs from "node:fs"
import path from "node:path"
import { Controller, Get, Query, Req, Res } from "@nestjs/common"
import type { Request, Response } from "express"
import { resolveInDataDir } from "../core/config"
import { DatabaseService } from "../database/database.service"

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
}

function text(res: Response, status: number, body: string): void {
  res.status(status).type("text/plain; charset=utf-8").send(body)
}

/** Serve images and videos from the data dir. Only paths inside it, only media types (port of app/media/route.ts). */
@Controller("media")
export class MediaController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  media(
    @Query("path") rel: unknown,
    @Req() req: Request,
    @Res() res: Response
  ): void {
    if (typeof rel !== "string" || !rel) return text(res, 400, "path fehlt")
    let abs: string
    try {
      abs = resolveInDataDir(this.db.ctx.config.dataDir, rel)
    } catch {
      return text(res, 403, "Pfad außerhalb des Datenordners")
    }
    const type = TYPES[path.extname(abs).toLowerCase()]
    if (!type) return text(res, 415, "Dateityp nicht erlaubt")
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      return text(res, 404, "Nicht gefunden")
    }
    const range = req.headers.range
    if (range && type === "video/mp4") {
      const m = range.match(/bytes=(\d*)-(\d*)/)
      const start = m?.[1] ? Number(m[1]) : 0
      const end = m?.[2] ? Number(m[2]) : stat.size - 1
      res.status(206).set({
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
      })
      fs.createReadStream(abs, { start, end }).pipe(res)
      return
    }
    res
      .status(200)
      .set({
        "Content-Type": type,
        "Content-Length": String(stat.size),
        "Cache-Control": "private, max-age=60",
      })
      .end(fs.readFileSync(abs))
  }
}

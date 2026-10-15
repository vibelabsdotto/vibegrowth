import fs from "node:fs"
import path from "node:path"
import { Controller, Get } from "@nestjs/common"
import { appRoot } from "./core/db"
import { DatabaseService } from "./database/database.service"

function apiVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(appRoot(), "package.json"), "utf8")
  ) as { version?: string }
  return pkg.version ?? "0.0.0"
}

@Controller("health")
export class HealthController {
  private readonly version = apiVersion()

  constructor(private readonly database: DatabaseService) {}

  @Get()
  health() {
    this.database.ping()
    const { dbPath, dataDir } = this.database.ctx.config
    return { ok: true, dbPath, dataDir, version: this.version }
  }
}

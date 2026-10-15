import {
  Controller,
  Get,
  HttpCode,
  Next,
  Post,
  Query as Q,
  Res,
} from "@nestjs/common"
import type { NextFunction, Response } from "express"
import { buildContext } from "../core/context"
import { importContent } from "../core/import"
import { DatabaseService } from "../database/database.service"
import { Input, need, type Query } from "./params"

const IMPORT_KEY = "import.accounts_json"

@Controller()
export class ContextController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * `context --account`. The same path serves `context --project` in the growth
   * module: without account but with project, hand over to the next route.
   */
  @Get("context")
  context(
    @Q() q: Query,
    @Res() res: Response,
    @Next() next: NextFunction
  ): void {
    if (!q.account && q.project) return next()
    res.json(buildContext(this.db.ctx, need(q.account, "account"), q.date))
  }

  /** `import`: remembers --accounts-json in settings, import runs its own transaction. */
  @Post("import")
  @HttpCode(200)
  import(@Input() body: { accountsJson?: string }) {
    const c = this.db.ctx
    const stored = c.sqlite
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(IMPORT_KEY) as { value: string } | undefined
    const accountsJson = body.accountsJson ?? stored?.value ?? null
    if (body.accountsJson)
      c.sqlite
        .prepare(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
        )
        .run(IMPORT_KEY, body.accountsJson)
    return importContent(c, { accountsJson })
  }
}

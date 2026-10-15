import { Injectable, OnModuleDestroy } from "@nestjs/common"
import { resolveConfig } from "../core/config"
import { openDb, tx, type Ctx } from "../core/db"

/**
 * Holds the shared Ctx from core/db.ts: opens the SQLite file (WAL, foreign keys)
 * and applies pending migrations from apps/api/drizzle with the core migrator (ledger _migrations).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly ctx: Ctx = openDb(resolveConfig())

  /** Run fn in a BEGIN IMMEDIATE transaction. Every write goes through here. */
  tx<T>(fn: () => T): T {
    return tx(this.ctx, fn)
  }

  ping(): void {
    this.ctx.sqlite.prepare("SELECT 1").get()
  }

  onModuleDestroy(): void {
    if (this.ctx.sqlite.open) this.ctx.sqlite.close()
  }
}

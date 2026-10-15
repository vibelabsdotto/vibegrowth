import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { env, resolveConfig, type VibeGrowthConfig } from "./config"
import * as schema from "./schema"

export type DB = BetterSQLite3Database<typeof schema>

export interface Ctx {
  db: DB
  sqlite: Database.Database
  config: VibeGrowthConfig
}

/** Repo root (contains drizzle/ and renderer/). */
export function appRoot(): string {
  const starts = [env("APP_ROOT"), process.cwd()]
  try {
    starts.push(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    // import.meta.url is not a file URL inside some bundles
  }
  for (const start of starts) {
    if (!start) continue
    // Local app: never deployed, whole-project tracing does not matter.
    let dir = path.resolve(/*turbopackIgnore: true*/ start)
    for (;;) {
      if (fs.existsSync(path.join(dir, "drizzle", "meta", "_journal.json")))
        return dir
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error(
    "VibeGrowth-Repo (drizzle/) nicht gefunden. VIBEGROWTH_APP_ROOT auf das Repo setzen."
  )
}

/**
 * Applies drizzle-kit SQL migrations inside one IMMEDIATE transaction, so several
 * processes opening a fresh database at the same time cannot both run them.
 */
function migrate(sqlite: Database.Database) {
  const dir = path.join(appRoot(), "drizzle")
  const journal = JSON.parse(
    fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")
  ) as {
    entries: { tag: string }[]
  }
  const run = sqlite.transaction(() => {
    sqlite.exec(
      "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    const applied = new Set(
      (
        sqlite.prepare("SELECT tag FROM _migrations").all() as { tag: string }[]
      ).map((r) => r.tag)
    )
    for (const { tag } of journal.entries) {
      if (applied.has(tag)) continue
      const statements = fs
        .readFileSync(path.join(dir, `${tag}.sql`), "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean)
      for (const stmt of statements) sqlite.exec(stmt)
      sqlite
        .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
        .run(tag, new Date().toISOString())
    }
  })
  run.immediate()
}

export function openDb(config: VibeGrowthConfig = resolveConfig()): Ctx {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
  const sqlite = new Database(config.dbPath)
  sqlite.pragma("busy_timeout = 15000")
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("synchronous = NORMAL")
  sqlite.pragma("foreign_keys = ON")
  migrate(sqlite)
  return { db: drizzle(sqlite, { schema }), sqlite, config }
}

const g = globalThis as unknown as { __vibegrowth?: Ctx }

/** Process-wide context (web server). The CLI opens its own per run. */
export function getCtx(): Ctx {
  if (!g.__vibegrowth) g.__vibegrowth = openDb()
  return g.__vibegrowth
}

/** Run fn in a BEGIN IMMEDIATE transaction: writers queue on busy_timeout instead of failing mid-way. */
export function tx<T>(ctx: Ctx, fn: () => T): T {
  return ctx.sqlite.transaction(fn).immediate()
}

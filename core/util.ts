import { eq, type InferSelectModel } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import type { Ctx } from "./db"
import { history } from "./schema"

export class VSError extends Error {
  constructor(
    public code: "NOT_FOUND" | "LOCKED" | "INVALID" | "CONFLICT" | "EXTERNAL",
    message: string
  ) {
    super(message)
  }
}

export const MAX = "max"
export const isMax = (actor: string) => actor.toLowerCase() === MAX

export function pad(n: number) {
  return String(n).padStart(2, "0")
}

/** Local calendar date (system timezone) as YYYY-MM-DD. */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

export function isDate(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s))
  )
}

export function assertDate(s: string, field = "date") {
  if (!isDate(s))
    throw new VSError("INVALID", `${field} muss YYYY-MM-DD sein, war: ${s}`)
  return s
}

/** "13.10.2026" -> "2026-10-13" */
export function germanDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  return m ? `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}` : null
}

export function json(v: unknown) {
  return JSON.stringify(v)
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

export function nowIso() {
  return new Date().toISOString()
}

export function recordHistory(
  ctx: Ctx,
  e: {
    actor: string
    entity: string
    entityId: string | number
    action: string
    before?: unknown
    after?: unknown
  }
) {
  ctx.db
    .insert(history)
    .values({
      actor: e.actor,
      entity: e.entity,
      entityId: String(e.entityId),
      action: e.action,
      before: e.before === undefined ? null : json(e.before),
      after: e.after === undefined ? null : json(e.after),
    })
    .run()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

/** Read one row by primary key column "id" or throw NOT_FOUND. */
export function getById<T extends SQLiteTable>(
  ctx: Ctx,
  table: T,
  id: string | number,
  label: string
) {
  const idCol = (table as unknown as { id: Parameters<typeof eq>[0] }).id
  const row = (ctx.db.select().from(table as Loose) as Loose)
    .where(eq(idCol, id))
    .get() as InferSelectModel<T> | undefined
  if (!row) throw new VSError("NOT_FOUND", `${label} ${id} nicht gefunden`)
  return row
}

/** Update a row by id, bump updated_at when present and write a history entry with only the changed fields. */
export function patchRow<T extends SQLiteTable>(
  ctx: Ctx,
  table: T,
  entity: string,
  id: string | number,
  patch: Record<string, unknown>,
  actor: string,
  action = "update"
): InferSelectModel<T> {
  const before = getById(ctx, table, id, entity) as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && before[k] !== v) clean[k] = v
  }
  if (Object.keys(clean).length === 0) return before as InferSelectModel<T>
  if ("updatedAt" in before) clean.updatedAt = nowIso()
  const idCol = (table as unknown as { id: Parameters<typeof eq>[0] }).id
  const updater = ctx.db.update(table as Loose) as Loose
  updater.set(clean).where(eq(idCol, id)).run()
  const after = getById(ctx, table, id, entity) as Record<string, unknown>
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const k of Object.keys(clean)) {
    if (k === "updatedAt") continue
    b[k] = before[k]
    a[k] = after[k]
  }
  recordHistory(ctx, {
    actor,
    entity,
    entityId: id,
    action,
    before: b,
    after: a,
  })
  return after as InferSelectModel<T>
}

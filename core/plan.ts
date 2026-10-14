import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm"
import type { Ctx } from "./db"
import { oneOf } from "./catalog"
import {
  accounts,
  formats,
  hooks,
  inspirations,
  planEntries,
  posts,
} from "./schema"
import {
  addDays,
  assertDate,
  getById,
  isMax,
  patchRow,
  recordHistory,
  today,
  VSError,
} from "./util"

export const PLAN_STATUS = [
  "idea",
  "planned",
  "in_production",
  "delivered",
  "posted",
  "skipped",
] as const
const PRODUCTION_STATUS = new Set(["in_production", "delivered", "posted"])

export type PlanEntry = typeof planEntries.$inferSelect

export interface PlanFilter {
  accountId?: string
  accountIds?: string[]
  brandId?: string
  from?: string
  to?: string
  status?: string
  ideas?: boolean
}

export function listPlan(ctx: Ctx, f: PlanFilter = {}) {
  const conds = []
  let ids = f.accountIds ?? (f.accountId ? [f.accountId] : undefined)
  if (f.brandId) {
    const brandAccounts = ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.brandId, f.brandId))
      .all()
      .map((a) => a.id)
    ids = ids ? ids.filter((i) => brandAccounts.includes(i)) : brandAccounts
  }
  if (ids)
    conds.push(inArray(planEntries.accountId, ids.length ? ids : ["__none__"]))
  if (f.ideas) conds.push(isNull(planEntries.date))
  else {
    conds.push(isNotNull(planEntries.date))
    if (f.from) conds.push(gte(planEntries.date, assertDate(f.from, "from")))
    if (f.to) conds.push(lte(planEntries.date, assertDate(f.to, "to")))
  }
  if (f.status) conds.push(eq(planEntries.status, f.status))
  return ctx.db
    .select()
    .from(planEntries)
    .where(and(...conds))
    .orderBy(
      asc(planEntries.date),
      asc(planEntries.accountId),
      asc(planEntries.position),
      asc(planEntries.id)
    )
    .all()
}

export function getEntry(ctx: Ctx, id: number) {
  const e = getById(ctx, planEntries, id, "Planeintrag")
  const post =
    ctx.db.select().from(posts).where(eq(posts.planEntryId, id)).get() ?? null
  return { ...e, post }
}

export function isProtected(e: PlanEntry) {
  return e.locked || e.origin === "max"
}

function guard(e: PlanEntry, actor: string, what: string) {
  if (!isMax(actor) && isProtected(e)) {
    throw new VSError(
      "LOCKED",
      `Eintrag ${e.id} (${e.date ?? "Idee"}, ${e.topic}) ist ${e.locked ? "gesperrt" : "von Max angelegt"}. ${what} ist nur Max erlaubt.`
    )
  }
}

export interface EntryInput {
  accountId: string
  date?: string | null
  formatId?: string | null
  topic: string
  angle?: string | null
  hookDirection?: string | null
  hook?: string | null
  rationale?: string | null
  status?: string
  locked?: boolean
  inspirationId?: number | null
  hookId?: number | null
  comment?: string | null
  position?: number
  sourceKey?: string
}

function validateRefs(ctx: Ctx, input: Partial<EntryInput>) {
  if (input.date) assertDate(input.date)
  oneOf(input.status, PLAN_STATUS, "status")
  if (input.formatId) getById(ctx, formats, input.formatId, "Format")
  if (input.inspirationId)
    getById(ctx, inspirations, input.inspirationId, "Inspiration")
  if (input.hookId) getById(ctx, hooks, input.hookId, "Hook")
}

export function addEntry(ctx: Ctx, input: EntryInput, actor: string) {
  const account = getById(ctx, accounts, input.accountId, "Account")
  if (!input.topic?.trim())
    throw new VSError("INVALID", "Planeintrag braucht ein Thema (--topic)")
  validateRefs(ctx, input)
  const max = isMax(actor)
  if (!max && !input.rationale?.trim() && input.date) {
    throw new VSError(
      "INVALID",
      "Agent-Einträge mit Datum brauchen eine Begründung (--rationale)"
    )
  }
  const row = ctx.db
    .insert(planEntries)
    .values({
      accountId: account.id,
      date: input.date ?? null,
      formatId: input.formatId ?? account.defaultFormatId,
      topic: input.topic.trim(),
      angle: input.angle ?? null,
      hookDirection: input.hookDirection ?? null,
      hook: input.hook ?? null,
      rationale: input.rationale ?? null,
      origin: max ? "max" : "agent",
      locked: input.locked ?? false,
      status: input.status ?? (input.date ? "planned" : "idea"),
      inspirationId: input.inspirationId ?? null,
      hookId: input.hookId ?? null,
      comment: input.comment ?? null,
      position: input.position ?? 0,
      createdBy: actor,
      sourceKey: input.sourceKey ?? null,
    })
    .returning()
    .get()
  recordHistory(ctx, {
    actor,
    entity: "plan_entry",
    entityId: row.id,
    action: "create",
    after: row,
  })
  if (input.inspirationId) {
    const insp = getById(ctx, inspirations, input.inspirationId, "Inspiration")
    if (insp.status === "new" || insp.status === "analyzed") {
      patchRow(
        ctx,
        inspirations,
        "inspiration",
        insp.id,
        { status: "adapted" },
        actor,
        "status"
      )
    }
  }
  return row
}

export type EntryPatch = Partial<
  Omit<EntryInput, "accountId" | "sourceKey" | "locked">
>

export function updateEntry(
  ctx: Ctx,
  id: number,
  patch: EntryPatch,
  actor: string
) {
  const e = getById(ctx, planEntries, id, "Planeintrag")
  const keys = Object.keys(patch).filter(
    (k) => patch[k as keyof EntryPatch] !== undefined
  )
  const productionOnly =
    keys.length === 1 &&
    keys[0] === "status" &&
    PRODUCTION_STATUS.has(String(patch.status))
  if (!productionOnly) guard(e, actor, "Ändern")
  validateRefs(ctx, patch)
  const next: Record<string, unknown> = { ...patch }
  if (patch.date === null && e.date) next.status = patch.status ?? "idea"
  if (patch.date && !e.date && !patch.status && e.status === "idea")
    next.status = "planned"
  return patchRow(
    ctx,
    planEntries,
    "plan_entry",
    id,
    next,
    actor,
    productionOnly ? "status" : "update"
  )
}

export function moveEntry(ctx: Ctx, id: number, date: string, actor: string) {
  const e = getById(ctx, planEntries, id, "Planeintrag")
  guard(e, actor, "Verschieben")
  assertDate(date)
  return patchRow(
    ctx,
    planEntries,
    "plan_entry",
    id,
    { date, status: e.status === "idea" ? "planned" : e.status },
    actor,
    "move"
  )
}

export function lockEntry(
  ctx: Ctx,
  id: number,
  locked: boolean,
  actor: string
) {
  const e = getById(ctx, planEntries, id, "Planeintrag")
  if (!locked && !isMax(actor))
    throw new VSError("LOCKED", `Nur Max kann Eintrag ${e.id} entsperren`)
  return patchRow(
    ctx,
    planEntries,
    "plan_entry",
    id,
    { locked },
    actor,
    locked ? "lock" : "unlock"
  )
}

export function skipEntry(
  ctx: Ctx,
  id: number,
  reason: string | undefined,
  actor: string
) {
  const e = getById(ctx, planEntries, id, "Planeintrag")
  guard(e, actor, "Überspringen")
  const comment = reason
    ? [e.comment, `Übersprungen (${actor}): ${reason}`]
        .filter(Boolean)
        .join("\n")
    : e.comment
  return patchRow(
    ctx,
    planEntries,
    "plan_entry",
    id,
    { status: "skipped", comment },
    actor,
    "skip"
  )
}

export function deleteEntry(ctx: Ctx, id: number, actor: string) {
  const e = getById(ctx, planEntries, id, "Planeintrag")
  guard(e, actor, "Löschen")
  const linked = ctx.db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.planEntryId, id))
    .get()
  if (linked)
    throw new VSError(
      "CONFLICT",
      `Eintrag ${id} hat schon einen Post (${linked.id}). Statt löschen überspringen.`
    )
  ctx.db.delete(planEntries).where(eq(planEntries.id, id)).run()
  recordHistory(ctx, {
    actor,
    entity: "plan_entry",
    entityId: id,
    action: "delete",
    before: e,
  })
  return { deleted: id }
}

/** Entry of the day for an account; null when nothing is planned (the agent then picks from the idea pool). */
export function nextEntry(ctx: Ctx, accountId: string, date = today()) {
  getById(ctx, accounts, accountId, "Account")
  const entries = ctx.db
    .select()
    .from(planEntries)
    .where(
      and(
        eq(planEntries.accountId, accountId),
        eq(planEntries.date, assertDate(date))
      )
    )
    .orderBy(asc(planEntries.position), asc(planEntries.id))
    .all()
    .filter((e) => e.status !== "skipped")
  const open = entries.find(
    (e) =>
      e.status === "planned" ||
      e.status === "in_production" ||
      e.status === "idea"
  )
  return { date, entry: open ?? null, all: entries }
}

function ideaPool(ctx: Ctx, accountId: string) {
  return ctx.db
    .select()
    .from(planEntries)
    .where(
      and(
        eq(planEntries.accountId, accountId),
        isNull(planEntries.date),
        eq(planEntries.status, "idea")
      )
    )
    .orderBy(asc(planEntries.position), asc(planEntries.id))
    .all()
}

export function freeDays(
  ctx: Ctx,
  accountId: string,
  from: string,
  days: number
) {
  const account = getById(ctx, accounts, accountId, "Account")
  const to = addDays(from, days - 1)
  const counts = new Map<string, number>()
  for (const e of listPlan(ctx, { accountId, from, to }))
    counts.set(e.date!, (counts.get(e.date!) ?? 0) + 1)
  const out: { date: string; free: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i)
    const free = account.postsPerDay - (counts.get(d) ?? 0)
    if (free > 0) out.push({ date: d, free })
  }
  return out
}

/**
 * Fill the horizon. Writes only free days (a skipped entry keeps its day occupied),
 * never touches existing entries. Source: entries passed by the agent, else the
 * agent's own ideas from the pool (Max's ideas stay where they are).
 */
export function fillPlan(
  ctx: Ctx,
  accountId: string,
  opts: {
    weeks?: number
    from?: string
    entries?: Omit<EntryInput, "accountId" | "date">[]
  },
  actor: string
) {
  const weeks = opts.weeks ?? 3
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12)
    throw new VSError("INVALID", "weeks muss zwischen 1 und 12 liegen")
  const from = opts.from ? assertDate(opts.from, "from") : today()
  const slots = freeDays(ctx, accountId, from, weeks * 7).flatMap((d) =>
    Array.from({ length: d.free }, () => d.date)
  )
  const filled: PlanEntry[] = []
  if (opts.entries?.length) {
    for (const input of opts.entries) {
      const date = slots.shift()
      if (!date) break
      filled.push(addEntry(ctx, { ...input, accountId, date }, actor))
    }
  } else {
    const pool = ideaPool(ctx, accountId).filter((e) => !isProtected(e))
    for (const idea of pool) {
      const date = slots.shift()
      if (!date) break
      filled.push(
        patchRow(
          ctx,
          planEntries,
          "plan_entry",
          idea.id,
          {
            date,
            status: "planned",
            rationale:
              idea.rationale ?? "Aus dem Ideen-Pool per plan fill eingeplant",
          },
          actor,
          "fill"
        )
      )
    }
  }
  return {
    accountId,
    from,
    to: addDays(from, weeks * 7 - 1),
    filled,
    stillFree: slots,
  }
}

/** Number of days with at least one non-skipped entry in [from, from+days). */
export function horizon(
  ctx: Ctx,
  accountId: string,
  from = today(),
  days = 21
) {
  const free = freeDays(ctx, accountId, from, days)
  const firstGap = free[0]?.date ?? null
  return {
    from,
    days,
    filledDays: days - free.length,
    freeDays: free.map((f) => f.date),
    firstGap,
  }
}

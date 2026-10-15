import { and, desc, eq, inArray, or } from "drizzle-orm"
import type { Ctx } from "./db"
import { getFormat, oneOf } from "./catalog"
import {
  accounts,
  brands,
  decisions,
  history,
  hooks,
  inspirations,
  learnings,
  planEntries,
  posts,
} from "./schema"
import {
  assertDate,
  getById,
  json,
  parseJson,
  patchRow,
  recordHistory,
  today,
  VSError,
} from "./util"

export const LEARNING_SCOPES = ["account", "brand", "format", "global"] as const
export const INSPO_TYPES = [
  "format",
  "hook",
  "sound",
  "visual",
  "topic",
  "trend",
] as const
export const INSPO_STATUS = ["new", "analyzed", "adapted", "discarded"] as const

function checkScope(
  ctx: Ctx,
  scopeType: string,
  scopeId: string | null | undefined
) {
  oneOf(scopeType, LEARNING_SCOPES, "scope")
  if (scopeType === "global") return null
  if (!scopeId)
    throw new VSError(
      "INVALID",
      `scope ${scopeType} braucht eine ID (--scope-id oder --account)`
    )
  if (scopeType === "account") getById(ctx, accounts, scopeId, "Account")
  if (scopeType === "brand") getById(ctx, brands, scopeId, "Brand")
  return scopeId
}

/**
 * Scopes that apply to an account: the account itself, its brand, its format and global.
 * formatId overrides the account's active format (e.g. the format of today's plan entry).
 */
export function scopesFor(
  ctx: Ctx,
  accountId: string,
  formatId?: string | null
) {
  const a = getById(ctx, accounts, accountId, "Account")
  const format = formatId === undefined ? a.defaultFormatId : formatId
  return [
    { scopeType: "account", scopeId: a.id },
    { scopeType: "brand", scopeId: a.brandId },
    ...(format ? [{ scopeType: "format", scopeId: format }] : []),
    { scopeType: "global", scopeId: null },
  ]
}

const formatLabel = (f: { name: string; currentVersion: number } | null) =>
  f ? `${f.name} (Version ${f.currentVersion})` : "keins"

/**
 * Switch an account's active format. A switch is a pivot: the reason is required
 * and stored as a decision next to the change.
 */
export function setActiveFormat(
  ctx: Ctx,
  accountId: string,
  formatId: string | null,
  reason: string | null | undefined,
  actor: string
) {
  const a = getById(ctx, accounts, accountId, "Account")
  if (formatId === a.defaultFormatId) return null
  const next = formatId ? getFormat(ctx, formatId) : null
  if (!reason?.trim())
    throw new VSError(
      "INVALID",
      "Ein Wechsel des aktiven Formats braucht eine Begründung (--reason). Er wird als Pivot gespeichert."
    )
  const prev = a.defaultFormatId ? getFormat(ctx, a.defaultFormatId) : null
  patchRow(
    ctx,
    accounts,
    "account",
    accountId,
    { defaultFormatId: formatId },
    actor,
    "format"
  )
  return addDecision(
    ctx,
    {
      kind: "pivot",
      scopeType: "account",
      scopeId: accountId,
      title: `Aktives Format: ${formatLabel(prev)} → ${formatLabel(next)}`,
      rationale: reason,
      source: "Formatwechsel",
    },
    actor
  )
}

// ---------- learnings ----------

export function listLearnings(
  ctx: Ctx,
  f: {
    accountId?: string
    /** with accountId: use this format instead of the account's active one */
    formatId?: string | null
    status?: string
    scopeType?: string
    scopeId?: string
  } = {}
) {
  const conds = []
  if (f.status) conds.push(eq(learnings.status, f.status))
  if (f.accountId) {
    conds.push(
      or(
        ...scopesFor(ctx, f.accountId, f.formatId).map((s) =>
          s.scopeId
            ? and(
                eq(learnings.scopeType, s.scopeType),
                eq(learnings.scopeId, s.scopeId)
              )
            : eq(learnings.scopeType, "global")
        )
      )
    )
  } else if (f.scopeType) {
    conds.push(eq(learnings.scopeType, f.scopeType))
    if (f.scopeId) conds.push(eq(learnings.scopeId, f.scopeId))
  }
  return ctx.db
    .select()
    .from(learnings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(learnings.date), desc(learnings.id))
    .all()
    .map((l) => ({
      ...l,
      evidencePostIds: parseJson<number[]>(l.evidencePostIds, []),
    }))
}

export function addLearning(
  ctx: Ctx,
  input: {
    scopeType: string
    scopeId?: string | null
    statement: string
    evidence: string
    evidencePostIds?: number[]
    date?: string
    source?: string | null
    sourceKey?: string
  },
  actor: string
) {
  const scopeId = checkScope(ctx, input.scopeType, input.scopeId)
  if (!input.statement?.trim())
    throw new VSError("INVALID", "Learning braucht eine Aussage")
  if (!input.evidence?.trim())
    throw new VSError(
      "INVALID",
      "Learning braucht einen Beleg (--evidence, z. B. Posts und Zahlen)"
    )
  if (input.evidencePostIds?.length) {
    const found = ctx.db
      .select({ id: posts.id })
      .from(posts)
      .where(inArray(posts.id, input.evidencePostIds))
      .all()
    if (found.length !== input.evidencePostIds.length)
      throw new VSError("NOT_FOUND", "Unbekannter Post im Beleg")
  }
  const row = ctx.db
    .insert(learnings)
    .values({
      scopeType: input.scopeType,
      scopeId,
      statement: input.statement.trim(),
      evidence: input.evidence.trim(),
      evidencePostIds: json(input.evidencePostIds ?? []),
      date: input.date ? assertDate(input.date) : today(),
      actor,
      source: input.source ?? null,
      sourceKey: input.sourceKey ?? null,
    })
    .returning()
    .get()
  recordHistory(ctx, {
    actor,
    entity: "learning",
    entityId: row.id,
    action: "create",
    after: row,
  })
  return row
}

export function setLearningStatus(
  ctx: Ctx,
  id: number,
  status: "active" | "outdated",
  actor: string
) {
  oneOf(status, ["active", "outdated"] as const, "status")
  return patchRow(
    ctx,
    learnings,
    "learning",
    id,
    { status },
    actor,
    status === "outdated" ? "outdate" : "reactivate"
  )
}

// ---------- decisions ----------

export function listDecisions(
  ctx: Ctx,
  f: { accountId?: string; formatId?: string | null } = {}
) {
  const where = f.accountId
    ? or(
        ...scopesFor(ctx, f.accountId, f.formatId).map((s) =>
          s.scopeId
            ? and(
                eq(decisions.scopeType, s.scopeType),
                eq(decisions.scopeId, s.scopeId)
              )
            : eq(decisions.scopeType, "global")
        )
      )
    : undefined
  return ctx.db
    .select()
    .from(decisions)
    .where(where)
    .orderBy(desc(decisions.date), desc(decisions.id))
    .all()
}

export function addDecision(
  ctx: Ctx,
  input: {
    title: string
    rationale: string
    kind?: string
    scopeType: string
    scopeId?: string | null
    date?: string
    supersedesId?: number | null
    source?: string | null
    sourceKey?: string
  },
  actor: string
) {
  const scopeId = checkScope(ctx, input.scopeType, input.scopeId)
  oneOf(input.kind ?? "decision", ["decision", "pivot"] as const, "kind")
  if (!input.title?.trim())
    throw new VSError("INVALID", "Entscheidung braucht einen Titel")
  if (!input.rationale?.trim())
    throw new VSError(
      "INVALID",
      "Entscheidung braucht eine Begründung (--rationale)"
    )
  if (input.supersedesId)
    getById(ctx, decisions, input.supersedesId, "Entscheidung")
  const row = ctx.db
    .insert(decisions)
    .values({
      kind: input.kind ?? "decision",
      title: input.title.trim(),
      rationale: input.rationale.trim(),
      date: input.date ? assertDate(input.date) : today(),
      actor,
      scopeType: input.scopeType,
      scopeId,
      supersedesId: input.supersedesId ?? null,
      source: input.source ?? null,
      sourceKey: input.sourceKey ?? null,
    })
    .returning()
    .get()
  recordHistory(ctx, {
    actor,
    entity: "decision",
    entityId: row.id,
    action: "create",
    after: row,
  })
  return row
}

// ---------- hooks ----------

export function listHooks(
  ctx: Ctx,
  f: { accountId?: string; winners?: boolean } = {}
) {
  const conds = []
  if (f.accountId) conds.push(eq(hooks.accountId, f.accountId))
  if (f.winners) conds.push(eq(hooks.winner, true))
  const rows = ctx.db
    .select()
    .from(hooks)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(hooks.winner), desc(hooks.id))
    .all()
  const variants = new Map<number, typeof rows>()
  for (const h of rows)
    if (h.parentId)
      variants.set(h.parentId, [...(variants.get(h.parentId) ?? []), h])
  return rows
    .filter((h) => !h.parentId)
    .map((h) => ({ ...h, variants: variants.get(h.id) ?? [] }))
}

export function addHook(
  ctx: Ctx,
  input: {
    accountId: string
    text: string
    mechanism?: string | null
    originPostId?: number | null
    winner?: boolean
    parentId?: number | null
    source?: string | null
    sourceKey?: string
  },
  actor: string
) {
  getById(ctx, accounts, input.accountId, "Account")
  if (!input.text?.trim()) throw new VSError("INVALID", "Hook-Text fehlt")
  if (input.originPostId) getById(ctx, posts, input.originPostId, "Post")
  if (input.parentId) {
    const parent = getById(ctx, hooks, input.parentId, "Hook")
    const count = ctx.db
      .select({ id: hooks.id })
      .from(hooks)
      .where(eq(hooks.parentId, parent.id))
      .all().length
    if (count >= 3)
      throw new VSError("CONFLICT", `Hook ${parent.id} hat schon 3 Varianten`)
  }
  const row = ctx.db
    .insert(hooks)
    .values({
      accountId: input.accountId,
      text: input.text.trim(),
      mechanism: input.mechanism ?? null,
      originPostId: input.originPostId ?? null,
      winner: input.winner ?? false,
      parentId: input.parentId ?? null,
      actor,
      source: input.source ?? null,
      sourceKey: input.sourceKey ?? null,
    })
    .returning()
    .get()
  recordHistory(ctx, {
    actor,
    entity: "hook",
    entityId: row.id,
    action: "create",
    after: row,
  })
  return row
}

export function setHookWinner(
  ctx: Ctx,
  id: number,
  winner: boolean,
  actor: string
) {
  return patchRow(
    ctx,
    hooks,
    "hook",
    id,
    { winner },
    actor,
    winner ? "winner" : "unwinner"
  )
}

/** Add a variant (same mechanism, other topic) to a winner hook. */
export function addHookVariant(
  ctx: Ctx,
  parentId: number,
  text: string,
  actor: string,
  mechanism?: string | null
) {
  const parent = getById(ctx, hooks, parentId, "Hook")
  return addHook(
    ctx,
    {
      accountId: parent.accountId,
      text,
      mechanism: mechanism ?? parent.mechanism,
      parentId,
    },
    actor
  )
}

// ---------- inspiration ----------

export function detectPlatform(url: string) {
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return ""
    }
  })()
  if (host.includes("tiktok")) return "tiktok"
  if (host.includes("instagram")) return "instagram"
  if (host.includes("youtube") || host.includes("youtu.be")) return "youtube"
  if (host === "x.com" || host.includes("twitter")) return "x"
  if (host.includes("pinterest")) return "pinterest"
  return host || null
}

export function listInspirations(
  ctx: Ctx,
  f: {
    accountId?: string
    brandId?: string
    status?: string
    type?: string
  } = {}
) {
  const conds = []
  if (f.accountId) conds.push(eq(inspirations.accountId, f.accountId))
  if (f.brandId) conds.push(eq(inspirations.brandId, f.brandId))
  if (f.status) conds.push(eq(inspirations.status, f.status))
  if (f.type) conds.push(eq(inspirations.type, f.type))
  const rows = ctx.db
    .select()
    .from(inspirations)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(inspirations.createdAt), desc(inspirations.id))
    .all()
  const ids = rows.map((r) => r.id)
  const entries = ids.length
    ? ctx.db
        .select()
        .from(planEntries)
        .where(inArray(planEntries.inspirationId, ids))
        .all()
    : []
  return rows.map((r) => ({
    ...r,
    tags: parseJson<string[]>(r.tags, []),
    files: parseJson<string[]>(r.files, []),
    planEntries: entries
      .filter((e) => e.inspirationId === r.id)
      .map((e) => ({
        id: e.id,
        date: e.date,
        topic: e.topic,
        accountId: e.accountId,
        status: e.status,
      })),
  }))
}

export function getInspiration(ctx: Ctx, id: number) {
  const r = getById(ctx, inspirations, id, "Inspiration")
  return listInspirations(ctx).find((x) => x.id === r.id)!
}

export function addInspiration(
  ctx: Ctx,
  input: {
    url: string
    type?: string
    note?: string | null
    tags?: string[]
    brandId?: string | null
    accountId?: string | null
    status?: string
    files?: string[]
    briefingPath?: string | null
    sourceKey?: string
  },
  actor: string
) {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    throw new VSError("INVALID", `Keine gültige URL: ${input.url}`)
  }
  oneOf(input.type ?? "format", INSPO_TYPES, "type")
  oneOf(input.status, INSPO_STATUS, "status")
  let brandId = input.brandId ?? null
  if (input.accountId)
    brandId =
      brandId ?? getById(ctx, accounts, input.accountId, "Account").brandId
  if (brandId) getById(ctx, brands, brandId, "Brand")
  const existing = ctx.db
    .select()
    .from(inspirations)
    .where(eq(inspirations.url, url.toString()))
    .get()
  if (existing)
    throw new VSError(
      "CONFLICT",
      `Link ist schon gespeichert (Inspiration ${existing.id})`
    )
  const row = ctx.db
    .insert(inspirations)
    .values({
      url: url.toString(),
      platform: detectPlatform(url.toString()),
      type: input.type ?? "format",
      note: input.note ?? null,
      tags: json(input.tags ?? []),
      brandId,
      accountId: input.accountId ?? null,
      status: input.status ?? "new",
      files: json(input.files ?? []),
      briefingPath: input.briefingPath ?? null,
      actor,
      sourceKey: input.sourceKey ?? null,
    })
    .returning()
    .get()
  recordHistory(ctx, {
    actor,
    entity: "inspiration",
    entityId: row.id,
    action: "create",
    after: row,
  })
  return getInspiration(ctx, row.id)
}

export function updateInspiration(
  ctx: Ctx,
  id: number,
  patch: {
    status?: string
    type?: string
    note?: string | null
    tags?: string[]
    accountId?: string | null
    briefingPath?: string | null
    files?: string[]
  },
  actor: string
) {
  oneOf(patch.status, INSPO_STATUS, "status")
  oneOf(patch.type, INSPO_TYPES, "type")
  const { tags, files, ...rest } = patch
  const p: Record<string, unknown> = { ...rest }
  if (tags) p.tags = json(tags)
  if (files) p.files = json(files)
  if (patch.accountId)
    p.brandId = getById(ctx, accounts, patch.accountId, "Account").brandId
  patchRow(ctx, inspirations, "inspiration", id, p, actor)
  return getInspiration(ctx, id)
}

// ---------- history ----------

export function listHistory(
  ctx: Ctx,
  f: { entity?: string; entityId?: string; actor?: string; limit?: number } = {}
) {
  const conds = []
  if (f.entity) conds.push(eq(history.entity, f.entity))
  if (f.entityId) conds.push(eq(history.entityId, f.entityId))
  if (f.actor) conds.push(eq(history.actor, f.actor))
  return ctx.db
    .select()
    .from(history)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(history.at), desc(history.id))
    .limit(f.limit ?? 200)
    .all()
    .map((h) => ({
      ...h,
      before: parseJson<unknown>(h.before, null),
      after: parseJson<unknown>(h.after, null),
    }))
}

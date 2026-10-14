import fs from "node:fs"
import { and, asc, eq, inArray } from "drizzle-orm"
import { resolveInDataDir, toRelative } from "./config"
import type { Ctx } from "./db"
import {
  accounts,
  brands,
  characters,
  formats,
  formatVersions,
  imageErrors,
  rules,
} from "./schema"
import {
  getById,
  json,
  parseJson,
  patchRow,
  recordHistory,
  slugify,
  today,
  VSError,
} from "./util"

export const ACCOUNT_STATUS = ["active", "paused", "planned"] as const
export const CTA_RULES = ["none", "engagement", "app"] as const
export const RULE_KINDS = [
  "hook",
  "copy",
  "image",
  "caption",
  "cta",
  "production",
  "other",
] as const
export const SCOPES = ["format", "account", "brand"] as const

export function oneOf<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  field: string
): T[number] | undefined {
  if (value === undefined) return undefined
  if (!(allowed as readonly string[]).includes(value)) {
    throw new VSError(
      "INVALID",
      `${field} muss einer von ${allowed.join(", ")} sein, war: ${value}`
    )
  }
  return value as T[number]
}

// ---------- brands ----------

export function listBrands(ctx: Ctx) {
  return ctx.db.select().from(brands).orderBy(asc(brands.name)).all()
}

export function upsertBrand(
  ctx: Ctx,
  b: {
    id: string
    name: string
    notionUrl?: string | null
    notes?: string | null
  },
  actor: string
) {
  const existing = ctx.db.select().from(brands).where(eq(brands.id, b.id)).get()
  if (existing) return existing
  ctx.db
    .insert(brands)
    .values({
      id: b.id,
      name: b.name,
      notionUrl: b.notionUrl ?? null,
      notes: b.notes ?? null,
    })
    .run()
  const row = getById(ctx, brands, b.id, "Brand")
  recordHistory(ctx, {
    actor,
    entity: "brand",
    entityId: b.id,
    action: "create",
    after: row,
  })
  return row
}

// ---------- characters ----------

export type CharacterRow = typeof characters.$inferSelect

export function listCharacters(ctx: Ctx) {
  return ctx.db
    .select()
    .from(characters)
    .orderBy(asc(characters.name))
    .all()
    .map(withImages)
}

function withImages(c: CharacterRow) {
  return { ...c, referenceImages: parseJson<string[]>(c.referenceImages, []) }
}

export function getCharacter(ctx: Ctx, id: string) {
  return withImages(getById(ctx, characters, id, "Charakter"))
}

export interface CharacterInput {
  id?: string
  name: string
  brandId?: string | null
  persona?: string | null
  voice?: string | null
  look?: string | null
  dos?: string | null
  donts?: string | null
  referenceImages?: string[]
  sourceKey?: string
}

export function createCharacter(
  ctx: Ctx,
  input: CharacterInput,
  actor: string
) {
  const id = input.id ?? slugify(input.name)
  if (!id) throw new VSError("INVALID", "Charakter braucht einen Namen")
  if (ctx.db.select().from(characters).where(eq(characters.id, id)).get()) {
    throw new VSError("CONFLICT", `Charakter ${id} existiert schon`)
  }
  ctx.db
    .insert(characters)
    .values({
      id,
      name: input.name,
      brandId: input.brandId ?? null,
      persona: input.persona ?? null,
      voice: input.voice ?? null,
      look: input.look ?? null,
      dos: input.dos ?? null,
      donts: input.donts ?? null,
      referenceImages: json(input.referenceImages ?? []),
      sourceKey: input.sourceKey ?? null,
    })
    .run()
  const row = getCharacter(ctx, id)
  recordHistory(ctx, {
    actor,
    entity: "character",
    entityId: id,
    action: "create",
    after: row,
  })
  return row
}

export function updateCharacter(
  ctx: Ctx,
  id: string,
  patch: Partial<Omit<CharacterInput, "id" | "sourceKey">>,
  actor: string
) {
  const { referenceImages, ...rest } = patch
  const p: Record<string, unknown> = { ...rest }
  if (referenceImages) p.referenceImages = json(referenceImages)
  patchRow(ctx, characters, "character", id, p, actor)
  return getCharacter(ctx, id)
}

/** Attach a reference image. Absolute paths must lie inside the data dir and are stored relative. */
export function addCharacterImage(
  ctx: Ctx,
  id: string,
  imagePath: string,
  actor: string
) {
  const c = getCharacter(ctx, id)
  const rel = imagePath.startsWith("/")
    ? toRelative(ctx.config.dataDir, imagePath)
    : imagePath
  if (!fs.existsSync(resolveInDataDir(ctx.config.dataDir, rel)))
    throw new VSError("NOT_FOUND", `Bild nicht gefunden: ${rel}`)
  if (c.referenceImages.includes(rel)) return c
  return updateCharacter(
    ctx,
    id,
    { referenceImages: [...c.referenceImages, rel] },
    actor
  )
}

// ---------- formats ----------

export type FormatRow = typeof formats.$inferSelect

export function listFormats(ctx: Ctx) {
  return ctx.db.select().from(formats).orderBy(asc(formats.name)).all()
}

export function getFormat(ctx: Ctx, id: string) {
  const f = getById(ctx, formats, id, "Format")
  const versions = ctx.db
    .select()
    .from(formatVersions)
    .where(eq(formatVersions.formatId, id))
    .orderBy(asc(formatVersions.version))
    .all()
    .map((v) => ({
      ...v,
      rendererParams: parseJson<Record<string, unknown>>(v.rendererParams, {}),
    }))
  const current = versions.find((v) => v.version === f.currentVersion) ?? null
  return { ...f, current, versions }
}

export interface FormatInput {
  id?: string
  name: string
  description?: string | null
  brandId?: string | null
  slideStructure?: string | null
  rendererParams?: Record<string, unknown>
}

export function createFormat(ctx: Ctx, input: FormatInput, actor: string) {
  const id = input.id ?? slugify(input.name)
  if (ctx.db.select().from(formats).where(eq(formats.id, id)).get()) {
    throw new VSError("CONFLICT", `Format ${id} existiert schon`)
  }
  ctx.db
    .insert(formats)
    .values({
      id,
      name: input.name,
      description: input.description ?? null,
      brandId: input.brandId ?? null,
    })
    .run()
  ctx.db
    .insert(formatVersions)
    .values({
      formatId: id,
      version: 1,
      description: input.description ?? null,
      slideStructure: input.slideStructure ?? null,
      rendererParams: json(input.rendererParams ?? {}),
      changeNote: "Erste Version",
      actor,
    })
    .run()
  const row = getFormat(ctx, id)
  recordHistory(ctx, {
    actor,
    entity: "format",
    entityId: id,
    action: "create",
    after: row,
  })
  return row
}

/**
 * New format version. The previous version stays readable; its active rules are
 * carried over to the new version unless carryRules is false.
 */
export function newFormatVersion(
  ctx: Ctx,
  id: string,
  input: {
    changeNote: string
    description?: string | null
    slideStructure?: string | null
    rendererParams?: Record<string, unknown>
    carryRules?: boolean
  },
  actor: string
) {
  if (!input.changeNote?.trim())
    throw new VSError(
      "INVALID",
      "Eine neue Formatversion braucht eine Begründung (--note)"
    )
  const f = getFormat(ctx, id)
  const prev = f.current
  const version = Math.max(0, ...f.versions.map((v) => v.version)) + 1
  ctx.db
    .insert(formatVersions)
    .values({
      formatId: id,
      version,
      description: input.description ?? prev?.description ?? null,
      slideStructure: input.slideStructure ?? prev?.slideStructure ?? null,
      rendererParams: json(input.rendererParams ?? prev?.rendererParams ?? {}),
      changeNote: input.changeNote,
      actor,
    })
    .run()
  if (input.carryRules !== false && prev) {
    const active = ctx.db
      .select()
      .from(rules)
      .where(
        and(
          eq(rules.scopeType, "format"),
          eq(rules.scopeId, id),
          eq(rules.formatVersion, prev.version),
          eq(rules.status, "active")
        )
      )
      .all()
    for (const r of active) {
      ctx.db
        .insert(rules)
        .values({
          scopeType: "format",
          scopeId: id,
          formatVersion: version,
          kind: r.kind,
          text: r.text,
          source: r.source,
          actor: r.actor,
          date: r.date,
        })
        .run()
    }
  }
  patchRow(
    ctx,
    formats,
    "format",
    id,
    {
      currentVersion: version,
      description: input.description ?? f.description,
    },
    actor,
    "version"
  )
  return getFormat(ctx, id)
}

export function updateFormat(
  ctx: Ctx,
  id: string,
  patch: { name?: string; description?: string | null },
  actor: string
) {
  patchRow(ctx, formats, "format", id, patch, actor)
  return getFormat(ctx, id)
}

// ---------- rules ----------

export type RuleRow = typeof rules.$inferSelect

export function listRules(
  ctx: Ctx,
  f: {
    scopeType?: string
    scopeId?: string
    status?: string
    formatVersion?: number
  } = {}
) {
  const conds = []
  if (f.scopeType) conds.push(eq(rules.scopeType, f.scopeType))
  if (f.scopeId) conds.push(eq(rules.scopeId, f.scopeId))
  if (f.status) conds.push(eq(rules.status, f.status))
  if (f.formatVersion !== undefined)
    conds.push(eq(rules.formatVersion, f.formatVersion))
  return ctx.db
    .select()
    .from(rules)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(rules.scopeType), asc(rules.scopeId), asc(rules.id))
    .all()
}

export interface RuleInput {
  scopeType: string
  scopeId: string
  kind?: string
  text: string
  source: string
  date?: string
  sourceKey?: string
}

export function addRule(ctx: Ctx, input: RuleInput, actor: string) {
  oneOf(input.scopeType, SCOPES, "scope")
  oneOf(input.kind ?? "other", RULE_KINDS, "kind")
  if (!input.text?.trim()) throw new VSError("INVALID", "Regeltext fehlt")
  if (!input.source?.trim())
    throw new VSError("INVALID", "Regel braucht eine Quelle (--source)")
  let formatVersion: number | null = null
  if (input.scopeType === "format")
    formatVersion = getFormat(ctx, input.scopeId).currentVersion
  if (input.scopeType === "account")
    getById(ctx, accounts, input.scopeId, "Account")
  if (input.scopeType === "brand") getById(ctx, brands, input.scopeId, "Brand")
  const res = ctx.db
    .insert(rules)
    .values({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      formatVersion,
      kind: input.kind ?? "other",
      text: input.text.trim(),
      source: input.source,
      actor,
      date: input.date ?? today(),
      sourceKey: input.sourceKey ?? null,
    })
    .returning()
    .get()
  recordHistory(ctx, {
    actor,
    entity: "rule",
    entityId: res.id,
    action: "create",
    after: res,
  })
  return res
}

/** Replace a rule: the old one stays readable with status=replaced and a pointer to the new one. */
export function replaceRule(
  ctx: Ctx,
  id: number,
  input: { text: string; source: string; kind?: string },
  actor: string
) {
  const old = getById(ctx, rules, id, "Regel")
  if (old.status !== "active")
    throw new VSError("CONFLICT", `Regel ${id} ist bereits ersetzt`)
  const next = addRule(
    ctx,
    {
      scopeType: old.scopeType,
      scopeId: old.scopeId,
      kind: input.kind ?? old.kind,
      text: input.text,
      source: input.source,
    },
    actor
  )
  patchRow(
    ctx,
    rules,
    "rule",
    id,
    { status: "replaced", replacedBy: next.id },
    actor,
    "replace"
  )
  return next
}

export function retireRule(ctx: Ctx, id: number, actor: string) {
  return patchRow(
    ctx,
    rules,
    "rule",
    id,
    { status: "replaced" },
    actor,
    "retire"
  )
}

// ---------- image errors ----------

export function listImageErrors(
  ctx: Ctx,
  f: { formatId?: string; status?: string } = {}
) {
  const rows = ctx.db
    .select()
    .from(imageErrors)
    .where(f.status ? eq(imageErrors.status, f.status) : undefined)
    .orderBy(asc(imageErrors.id))
    .all()
    .map((r) => ({ ...r, formatIds: parseJson<string[]>(r.formatIds, []) }))
  return f.formatId
    ? rows.filter(
        (r) => r.formatIds.length === 0 || r.formatIds.includes(f.formatId!)
      )
    : rows
}

export interface ImageErrorInput {
  title: string
  countermeasure: string
  detection?: string | null
  formatIds?: string[]
  exampleImage?: string | null
  source: string
  sourceKey?: string
}

export function addImageError(ctx: Ctx, input: ImageErrorInput, actor: string) {
  if (!input.title?.trim() || !input.countermeasure?.trim())
    throw new VSError("INVALID", "Bildfehler braucht Titel und Gegenmaßnahme")
  if (!input.source?.trim())
    throw new VSError("INVALID", "Bildfehler braucht eine Quelle (--source)")
  if (input.formatIds?.length) {
    const found = ctx.db
      .select({ id: formats.id })
      .from(formats)
      .where(inArray(formats.id, input.formatIds))
      .all()
    if (found.length !== input.formatIds.length)
      throw new VSError(
        "NOT_FOUND",
        `Unbekanntes Format in ${input.formatIds.join(", ")}`
      )
  }
  const row = ctx.db
    .insert(imageErrors)
    .values({
      title: input.title.trim(),
      countermeasure: input.countermeasure.trim(),
      detection: input.detection ?? null,
      formatIds: json(input.formatIds ?? []),
      exampleImage: input.exampleImage ?? null,
      source: input.source,
      actor,
      sourceKey: input.sourceKey ?? null,
    })
    .returning()
    .get()
  recordHistory(ctx, {
    actor,
    entity: "image_error",
    entityId: row.id,
    action: "create",
    after: row,
  })
  return { ...row, formatIds: input.formatIds ?? [] }
}

export function updateImageError(
  ctx: Ctx,
  id: number,
  patch: {
    title?: string
    countermeasure?: string
    detection?: string | null
    formatIds?: string[]
    status?: string
  },
  actor: string
) {
  const { formatIds, ...rest } = patch
  const p: Record<string, unknown> = { ...rest }
  if (formatIds) p.formatIds = json(formatIds)
  oneOf(patch.status, ["active", "resolved"] as const, "status")
  const row = patchRow(ctx, imageErrors, "image_error", id, p, actor)
  return { ...row, formatIds: parseJson<string[]>(row.formatIds, []) }
}

// ---------- accounts ----------

export type AccountRow = typeof accounts.$inferSelect

export function listAccounts(
  ctx: Ctx,
  f: { brandId?: string; status?: string } = {}
) {
  const conds = []
  if (f.brandId) conds.push(eq(accounts.brandId, f.brandId))
  if (f.status) conds.push(eq(accounts.status, f.status))
  return ctx.db
    .select()
    .from(accounts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(accounts.brandId), asc(accounts.name))
    .all()
}

export function getAccount(ctx: Ctx, id: string) {
  return getById(ctx, accounts, id, "Account")
}

export interface AccountInput {
  id?: string
  brandId: string
  name: string
  handle?: string | null
  platform?: string
  language?: string | null
  status?: string
  dir?: string
  defaultFormatId?: string | null
  mode?: string | null
  ctaRule?: string
  postsPerDay?: number
  characterId?: string | null
  notionContextId?: string | null
  notes?: string | null
}

/** Creates the account and its folder structure (posts, persona, analysis, pulls). Never moves files. */
export function createAccount(
  ctx: Ctx,
  input: AccountInput,
  actor: string,
  opts: { createFolders?: boolean } = {}
) {
  const id = input.id ?? slugify(input.name)
  if (!id) throw new VSError("INVALID", "Account braucht einen Namen")
  oneOf(input.status, ACCOUNT_STATUS, "status")
  oneOf(input.ctaRule, CTA_RULES, "cta")
  getById(ctx, brands, input.brandId, "Brand")
  if (input.defaultFormatId)
    getById(ctx, formats, input.defaultFormatId, "Format")
  if (input.characterId)
    getById(ctx, characters, input.characterId, "Charakter")
  if (ctx.db.select().from(accounts).where(eq(accounts.id, id)).get())
    throw new VSError("CONFLICT", `Account ${id} existiert schon`)
  const dir = input.dir ?? `${input.brandId}/${id}`
  const abs = resolveInDataDir(ctx.config.dataDir, dir)
  if (opts.createFolders !== false) {
    for (const sub of ["posts", "persona", "analysis", "pulls"])
      fs.mkdirSync(`${abs}/${sub}`, { recursive: true })
  }
  ctx.db
    .insert(accounts)
    .values({
      id,
      brandId: input.brandId,
      name: input.name,
      handle: input.handle?.replace(/^@/, "") ?? null,
      platform: input.platform ?? "tiktok",
      language: input.language ?? null,
      status: input.status ?? "planned",
      dir,
      defaultFormatId: input.defaultFormatId ?? null,
      mode: input.mode ?? null,
      ctaRule: input.ctaRule ?? "engagement",
      postsPerDay: input.postsPerDay ?? 1,
      characterId: input.characterId ?? null,
      notionContextId: input.notionContextId ?? null,
      notes: input.notes ?? null,
    })
    .run()
  const row = getAccount(ctx, id)
  recordHistory(ctx, {
    actor,
    entity: "account",
    entityId: id,
    action: "create",
    after: row,
  })
  return row
}

export function updateAccount(
  ctx: Ctx,
  id: string,
  patch: Partial<Omit<AccountInput, "id" | "brandId">>,
  actor: string
) {
  oneOf(patch.status, ACCOUNT_STATUS, "status")
  oneOf(patch.ctaRule, CTA_RULES, "cta")
  if (patch.defaultFormatId)
    getById(ctx, formats, patch.defaultFormatId, "Format")
  if (patch.characterId)
    getById(ctx, characters, patch.characterId, "Charakter")
  if (
    patch.postsPerDay !== undefined &&
    (!Number.isInteger(patch.postsPerDay) || patch.postsPerDay < 1)
  ) {
    throw new VSError("INVALID", "posts-per-day muss eine ganze Zahl ab 1 sein")
  }
  const p = {
    ...patch,
    handle:
      patch.handle === undefined
        ? undefined
        : (patch.handle?.replace(/^@/, "") ?? null),
  }
  return patchRow(ctx, accounts, "account", id, p, actor)
}

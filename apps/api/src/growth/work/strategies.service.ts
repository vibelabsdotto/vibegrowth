import { Injectable } from "@nestjs/common"
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
} from "drizzle-orm"
import { categoryFilter } from "../../core/category"
import {
  accounts,
  formats,
  formatVersions,
  planEntries,
  strategies,
} from "../../core/schema"
import {
  addDays,
  isMax,
  json,
  parseJson,
  patchRow,
  recordHistory,
  slugify,
  today,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { listOf, oneOf, requireProject } from "./shared"

/** Stored strategies; shortform strategies are the formats (read view, kind "format"). */
export const STRATEGY_CATEGORIES = ["web", "app", "general"] as const
export const STRATEGY_STATUS = ["active", "paused", "retired"] as const

export type StrategyRow = typeof strategies.$inferSelect

export interface StrategyInput {
  id?: string
  projectId?: string | null
  category: string
  name: string
  summary?: string | null
  guide?: string | null
  status?: string
  skills?: string[]
  source?: string | null
}

export type StrategyPatch = Partial<Omit<StrategyInput, "id">>

export function strategyOut(s: StrategyRow) {
  return {
    kind: "strategy" as const,
    ...s,
    skills: parseJson<string[]>(s.skills, []),
  }
}

/** Days of plan overrides that count for "active on a format" (Echo: next 7 days). */
const PLAN_DAYS = 7

function checkSkills(v: unknown) {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.some((s) => typeof s !== "string"))
    throw new VGError("INVALID", "skills muss eine Liste von Texten sein")
  return (v as string[]).map((s) => s.trim()).filter(Boolean)
}

function checkCategory(v: string) {
  if (v === "shortform")
    throw new VGError(
      "INVALID",
      'Shortform-Strategien sind die Formate. Neues Format: "formats add", Wechsel: "accounts update --format"'
    )
  return oneOf(v, STRATEGY_CATEGORIES, "category")
}

@Injectable()
export class StrategiesService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  /**
   * Accounts working with a format: default_format_id (source "account") plus plan entries of the
   * next 7 days that set this format (source "plan"). Read here, not from `formats show`.
   */
  private formatAccounts(formatIds: string[], date = today()) {
    const out = new Map<
      string,
      {
        id: string
        name: string
        status: string
        source: string
        dates?: string[]
      }[]
    >()
    if (!formatIds.length) return out
    const ctx = this.ctx
    for (const a of ctx.db
      .select()
      .from(accounts)
      .where(inArray(accounts.defaultFormatId, formatIds))
      .orderBy(asc(accounts.id))
      .all())
      out.set(a.defaultFormatId!, [
        ...(out.get(a.defaultFormatId!) ?? []),
        { id: a.id, name: a.name, status: a.status, source: "account" },
      ])
    const plan = ctx.db
      .select({
        accountId: planEntries.accountId,
        formatId: planEntries.formatId,
        date: planEntries.date,
        name: accounts.name,
        status: accounts.status,
      })
      .from(planEntries)
      .innerJoin(accounts, eq(accounts.id, planEntries.accountId))
      .where(
        and(
          inArray(planEntries.formatId, formatIds),
          gte(planEntries.date, date),
          lte(planEntries.date, addDays(date, PLAN_DAYS - 1))
        )
      )
      .orderBy(asc(planEntries.date))
      .all()
    for (const p of plan) {
      const list = out.get(p.formatId!) ?? []
      let entry = list.find((e) => e.id === p.accountId && e.source === "plan")
      if (!entry) {
        if (list.some((e) => e.id === p.accountId && e.source === "account"))
          continue
        entry = {
          id: p.accountId,
          name: p.name,
          status: p.status,
          source: "plan",
          dates: [],
        }
        list.push(entry)
      }
      entry.dates!.push(p.date!)
      out.set(p.formatId!, list)
    }
    return out
  }

  /** Formats as shortform strategies (kind "format"), optionally of one project. */
  private formatViews(projectId?: string, withGuide = false) {
    const ctx = this.ctx
    const rows = ctx.db
      .select()
      .from(formats)
      .where(projectId ? eq(formats.brandId, projectId) : undefined)
      .orderBy(asc(formats.id))
      .all()
    const users = this.formatAccounts(rows.map((f) => f.id))
    return rows.map((f) => {
      const v = ctx.db
        .select()
        .from(formatVersions)
        .where(
          and(
            eq(formatVersions.formatId, f.id),
            eq(formatVersions.version, f.currentVersion)
          )
        )
        .get()
      return {
        kind: "format" as const,
        id: f.id,
        projectId: f.brandId,
        category: "shortform" as const,
        name: f.name,
        summary: v?.description ?? f.description,
        ...(withGuide ? { guide: v?.guide ?? null } : {}),
        status: "active" as const,
        skills: parseJson<string[]>(v?.skills, []),
        version: f.currentVersion,
        accounts: users.get(f.id) ?? [],
        url: `/formats/${encodeURIComponent(f.id)}`,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }
    })
  }

  list(f: { project?: string; category?: string; status?: string }) {
    const ctx = this.ctx
    if (f.project) requireProject(ctx, f.project)
    const cats = categoryFilter(f.category)
    const statuses = listOf(f.status, STRATEGY_STATUS, "status")
    const conds: SQL[] = []
    if (f.project)
      conds.push(
        or(eq(strategies.projectId, f.project), isNull(strategies.projectId))!
      )
    if (statuses) conds.push(inArray(strategies.status, statuses))
    const stored = ctx.db
      .select()
      .from(strategies)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(strategies.category), asc(strategies.name))
      .all()
      .map(strategyOut)
      .filter((s) => !cats || cats.has(s.category))
    const withFormats =
      (!cats || cats.has("shortform")) &&
      (!statuses || statuses.includes("active"))
    return [...stored, ...(withFormats ? this.formatViews(f.project) : [])]
  }

  /** Active strategies of a project grouped by category (context --project). */
  activeByCategory(projectId: string) {
    const all = this.list({ project: projectId, status: "active" })
    const by: Record<string, unknown[]> = {
      web: [],
      app: [],
      general: [],
      shortform: [],
    }
    for (const s of all) by[s.category].push(s)
    return by
  }

  /** Strategy by id, else the format with that id as shortform view (with guide). */
  get(id: string) {
    const ctx = this.ctx
    const row = ctx.db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id))
      .get()
    if (row) return strategyOut(row)
    const f = ctx.db.select().from(formats).where(eq(formats.id, id)).get()
    if (f)
      return this.formatViews(f.brandId ?? undefined, true).find(
        (v) => v.id === id
      )!
    throw new VGError("NOT_FOUND", `Strategie ${id} nicht gefunden`)
  }

  add(input: StrategyInput, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const name = input.name?.trim()
      if (!name) throw new VGError("INVALID", "name fehlt")
      const category = checkCategory(input.category)
      const projectId = input.projectId
        ? requireProject(ctx, input.projectId).id
        : null
      const id = input.id?.trim() || slugify(name)
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
        throw new VGError(
          "INVALID",
          `id muss klein mit Bindestrich sein (a-z, 0-9, -), war: ${id}`
        )
      if (ctx.db.select().from(strategies).where(eq(strategies.id, id)).get())
        throw new VGError(
          "CONFLICT",
          `Strategie ${id} gibt es schon (andere id mit --id wählen)`
        )
      if (ctx.db.select().from(formats).where(eq(formats.id, id)).get())
        throw new VGError(
          "CONFLICT",
          `${id} ist schon ein Format (andere id mit --id wählen)`
        )
      const row = ctx.db
        .insert(strategies)
        .values({
          id,
          projectId,
          category,
          name,
          summary: input.summary ?? null,
          guide: input.guide ?? null,
          status: oneOf(input.status ?? "active", STRATEGY_STATUS, "status"),
          skills: json(checkSkills(input.skills) ?? []),
          source: input.source ?? null,
          actor,
        })
        .returning()
        .get()
      recordHistory(ctx, {
        actor,
        entity: "strategy",
        entityId: row.id,
        action: "create",
        after: row,
      })
      return strategyOut(row)
    })
  }

  update(id: string, p: StrategyPatch, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const row = ctx.db
        .select()
        .from(strategies)
        .where(eq(strategies.id, id))
        .get()
      if (!row) {
        if (ctx.db.select().from(formats).where(eq(formats.id, id)).get())
          throw new VGError(
            "INVALID",
            `${id} ist ein Format. Ändern über "formats update ${id}" oder "formats version ${id}"`
          )
        throw new VGError("NOT_FOUND", `Strategie ${id} nicht gefunden`)
      }
      if (isMax(row.actor) && !isMax(actor))
        throw new VGError(
          "LOCKED",
          `Strategie ${id} hat Max angelegt, ändern darf sie nur Max`
        )
      const patch: Record<string, unknown> = {}
      if (p.name !== undefined) {
        if (!p.name?.trim())
          throw new VGError("INVALID", "name darf nicht leer sein")
        patch.name = p.name.trim()
      }
      if (p.category !== undefined) patch.category = checkCategory(p.category)
      if (p.status !== undefined)
        patch.status = oneOf(p.status, STRATEGY_STATUS, "status")
      if (p.projectId !== undefined)
        patch.projectId = p.projectId
          ? requireProject(ctx, p.projectId).id
          : null
      for (const k of ["summary", "guide", "source"] as const)
        if (p[k] !== undefined) patch[k] = p[k]
      const skills = checkSkills(p.skills)
      if (skills !== undefined) patch.skills = json(skills)
      return strategyOut(
        patchRow(ctx, strategies, "strategy", id, patch, actor)
      )
    })
  }
}

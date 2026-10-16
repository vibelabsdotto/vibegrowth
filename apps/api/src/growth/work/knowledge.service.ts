import { Injectable } from "@nestjs/common"
import { desc } from "drizzle-orm"
import {
  categoryFilter,
  categoryInput,
  knowledgeCategory,
} from "../../core/category"
import { accounts, decisions, formats, learnings } from "../../core/schema"
import { getById, isMax, parseJson, patchRow, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { oneOf, requireProject } from "./shared"

export const KNOWLEDGE_TYPES = ["learning", "decision"] as const

/**
 * Growth read view of learnings and decisions with category (GET /knowledge). The shorts routes
 * (/learnings, /decisions) keep their JSON without category.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Project of a scope: brand directly, account/format via their project; null for global/growth. */
  private projectResolver() {
    const ctx = this.ctx
    const acc = new Map(
      ctx.db
        .select({ id: accounts.id, p: accounts.brandId })
        .from(accounts)
        .all()
        .map((a) => [a.id, a.p])
    )
    const fmt = new Map(
      ctx.db
        .select({ id: formats.id, p: formats.brandId })
        .from(formats)
        .all()
        .map((f) => [f.id, f.p])
    )
    return (scopeType: string, scopeId: string | null): string | null => {
      if (!scopeId) return null
      if (scopeType === "brand") return scopeId
      if (scopeType === "account") return acc.get(scopeId) ?? null
      if (scopeType === "format") return fmt.get(scopeId) ?? null
      return null
    }
  }

  list(f: {
    project?: string
    category?: string
    type?: string
    status?: string
  }) {
    const ctx = this.ctx
    if (f.project) requireProject(ctx, f.project)
    const type = f.type ? oneOf(f.type, KNOWLEDGE_TYPES, "type") : undefined
    const cats = categoryFilter(f.category)
    const status = f.status ?? "active"
    if (status !== "all")
      oneOf(status, ["active", "outdated"] as const, "status")
    const projectOf = this.projectResolver()
    // Project view: rows of the project plus the cross-project scopes global and growth.
    const inProject = (scopeType: string, projectId: string | null) =>
      !f.project ||
      projectId === f.project ||
      scopeType === "global" ||
      scopeType === "growth"
    const out: ({ type: string; date: string; id: number } & Record<
      string,
      unknown
    >)[] = []
    if (type !== "decision")
      for (const l of ctx.db
        .select()
        .from(learnings)
        .orderBy(desc(learnings.date), desc(learnings.id))
        .all()) {
        if (status !== "all" && l.status !== status) continue
        const projectId = projectOf(l.scopeType, l.scopeId)
        if (!inProject(l.scopeType, projectId)) continue
        out.push({
          type: "learning",
          ...l,
          evidencePostIds: parseJson<number[]>(l.evidencePostIds, []),
          projectId,
          category: knowledgeCategory(l),
        })
      }
    if (type !== "learning")
      for (const d of ctx.db
        .select()
        .from(decisions)
        .orderBy(desc(decisions.date), desc(decisions.id))
        .all()) {
        const projectId = projectOf(d.scopeType, d.scopeId)
        if (!inProject(d.scopeType, projectId)) continue
        out.push({
          type: "decision",
          ...d,
          projectId,
          category: knowledgeCategory(d),
        })
      }
    return out
      .filter((r) => !cats || cats.has(r.category as string))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          a.type.localeCompare(b.type) ||
          b.id - a.id
      )
  }

  /** Set (or clear with null) the category of a learning or decision. Rows by max: only max. */
  setCategory(
    type: string,
    id: number,
    category: string | null | undefined,
    actor: string
  ) {
    const ctx = this.ctx
    const t = oneOf(type, KNOWLEDGE_TYPES, "type")
    if (category === undefined) throw new VGError("INVALID", "category fehlt")
    const value = categoryInput(category)
    return this.database.tx(() => {
      const table = t === "learning" ? learnings : decisions
      const label = t === "learning" ? "Learning" : "Entscheidung"
      const row = getById(ctx, table, id, label)
      if (isMax(row.actor) && !isMax(actor))
        throw new VGError(
          "LOCKED",
          `${label} ${id} hat Max angelegt, ändern darf es nur Max`
        )
      const updated = patchRow(ctx, table, t, id, { category: value }, actor)
      return {
        type: t,
        ...updated,
        ...("evidencePostIds" in updated
          ? {
              evidencePostIds: parseJson<number[]>(
                updated.evidencePostIds as string,
                []
              ),
            }
          : {}),
        projectId: this.projectResolver()(updated.scopeType, updated.scopeId),
        category: knowledgeCategory(updated),
      }
    })
  }
}

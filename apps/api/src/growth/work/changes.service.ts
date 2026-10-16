import { Injectable } from "@nestjs/common"
import { and, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm"
import {
  categoryFilter,
  categoryInput,
  changeCategory,
} from "../../core/category"
import { changes, experiments } from "../../core/schema"
import {
  assertDate,
  getById,
  recordHistory,
  today,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { checkChannel, listOf, oneOf, optDate, requireProject } from "./shared"

export const CHANGE_KINDS = [
  "deploy",
  "content",
  "seo",
  "store",
  "config",
  "shorts",
  "reply",
  "other",
] as const

export type ChangeRow = typeof changes.$inferSelect

export interface ChangeInput {
  projectId: string
  channelId?: string | null
  date?: string
  kind?: string
  summary: string
  ref?: string | null
  experimentId?: number | null
  sourceKey?: string | null
  category?: string | null
}

/** Row with its effective category (stored or derived). */
export function changeOut(r: ChangeRow) {
  return { ...r, category: changeCategory(r) }
}

@Injectable()
export class ChangesService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  list(f: {
    project?: string
    from?: string
    to?: string
    kind?: string
    experiment?: number
    limit?: number
    category?: string
  }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(changes.projectId, f.project))
    const from = optDate(f.from, "from")
    const to = optDate(f.to, "to")
    if (from) conds.push(gte(changes.date, from))
    if (to) conds.push(lte(changes.date, to))
    const kinds = listOf(f.kind, CHANGE_KINDS, "kind")
    if (kinds) conds.push(inArray(changes.kind, kinds))
    if (f.experiment) conds.push(eq(changes.experimentId, f.experiment))
    const cats = categoryFilter(f.category)
    const rows = this.ctx.db
      .select()
      .from(changes)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(changes.date), desc(changes.id))
      .all()
      .map(changeOut)
      .filter((r) => !cats || cats.has(r.category))
    return f.limit ? rows.slice(0, f.limit) : rows
  }

  add(input: ChangeInput, actor: string) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, input.projectId)
      const summary = input.summary?.trim()
      if (!summary) throw new VGError("INVALID", "summary fehlt")
      let experimentId: number | null = null
      if (input.experimentId) {
        const exp = getById(ctx, experiments, input.experimentId, "Experiment")
        if (exp.projectId !== project.id)
          throw new VGError(
            "INVALID",
            `Experiment ${exp.id} gehört zu Projekt ${exp.projectId}, nicht zu ${project.id}`
          )
        experimentId = exp.id
      }
      const row = ctx.db
        .insert(changes)
        .values({
          projectId: project.id,
          channelId: checkChannel(ctx, project.id, input.channelId),
          date: input.date ? assertDate(input.date, "date") : today(),
          kind: oneOf(input.kind ?? "other", CHANGE_KINDS, "kind"),
          summary,
          ref: input.ref ?? null,
          experimentId,
          actor,
          sourceKey: input.sourceKey ?? null,
          category: categoryInput(input.category) ?? null,
        })
        .returning()
        .get()
      recordHistory(ctx, {
        actor,
        entity: "change",
        entityId: row.id,
        action: "create",
        after: row,
      })
      return changeOut(row)
    })
  }
}

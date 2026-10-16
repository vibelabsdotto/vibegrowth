import { Injectable } from "@nestjs/common"
import { and, eq, gte, isNotNull, lte } from "drizzle-orm"
import { categoryFilter, contentCategory } from "../../core/category"
import { accounts, contentItems, planEntries } from "../../core/schema"
import { addDays, assertDate, today, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { requireProject } from "./shared"

/**
 * GET /calendar: everything with a date in one list. Shortform plan entries (category shortform)
 * and content items with planned_date or live_date (live: live_date, otherwise planned_date).
 * Read only; the shorts plan routes stay unchanged.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly database: DatabaseService) {}

  calendar(f: {
    project?: string
    from?: string
    to?: string
    category?: string
  }) {
    const ctx = this.ctx
    const project = f.project ? requireProject(ctx, f.project) : null
    const from = f.from ? assertDate(f.from, "from") : addDays(today(), -14)
    const to = f.to ? assertDate(f.to, "to") : addDays(from, 56)
    if (to < from) throw new VGError("INVALID", "to liegt vor from")
    const cats = categoryFilter(f.category)
    const items: ({ date: string; type: string; id: number } & Record<
      string,
      unknown
    >)[] = []

    if (!cats || cats.has("shortform")) {
      const accs = new Map(
        ctx.db
          .select({ id: accounts.id, name: accounts.name, p: accounts.brandId })
          .from(accounts)
          .all()
          .map((a) => [a.id, a])
      )
      for (const e of ctx.db
        .select()
        .from(planEntries)
        .where(
          and(
            isNotNull(planEntries.date),
            gte(planEntries.date, from),
            lte(planEntries.date, to)
          )
        )
        .all()) {
        const acc = accs.get(e.accountId)
        const projectId = acc?.p ?? null
        if (project && projectId !== project.id) continue
        items.push({
          date: e.date!,
          type: "plan_entry",
          category: "shortform",
          id: e.id,
          projectId,
          accountId: e.accountId,
          accountName: acc?.name ?? null,
          title: e.topic,
          status: e.status,
          formatId: e.formatId,
          locked: e.locked,
          origin: e.origin,
        })
      }
    }

    for (const c of ctx.db
      .select()
      .from(contentItems)
      .where(project ? eq(contentItems.projectId, project.id) : undefined)
      .all()) {
      if (c.status === "discarded") continue
      const live = c.status === "live" && !!c.liveDate
      const date = live ? c.liveDate : (c.plannedDate ?? c.liveDate)
      if (!date || date < from || date > to) continue
      const category = contentCategory(c)
      if (cats && !cats.has(category)) continue
      items.push({
        date,
        type: "content",
        category,
        id: c.id,
        projectId: c.projectId,
        accountId: null,
        title: c.title,
        status: c.status,
        kind: c.kind,
        dateKind: live || !c.plannedDate ? "live" : "planned",
        plannedDate: c.plannedDate,
        liveDate: c.liveDate,
        urlPath: c.urlPath,
        approvalId: c.approvalId,
      })
    }
    items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.type.localeCompare(b.type) ||
        a.id - b.id
    )
    return { project: project?.id ?? null, from, to, items }
  }

  private get ctx() {
    return this.database.ctx
  }
}

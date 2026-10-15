import { Injectable } from "@nestjs/common"
import { desc, eq } from "drizzle-orm"
import type { AuditResult } from "../../collectors/sources"
import { auditIssues, auditPages, auditRuns } from "../../core/schema"
import { json } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import { requireProject } from "./rows"

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 }

interface IssueView {
  url: string
  code: string
  severity: string
  detail: string | null
}

const key = (i: { url: string; code: string }) => `${i.url}\u0000${i.code}`

const sortIssues = (a: IssueView, b: IssueView) =>
  (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
  a.code.localeCompare(b.code) ||
  a.url.localeCompare(b.url)

/** audit_runs / audit_issues / audit_pages (technical site audit). */
@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Inside the caller's tx: one audit run with its findings and page data. */
  writeRun(projectId: string, at: string, audit: AuditResult) {
    const run = this.ctx.db
      .insert(auditRuns)
      .values({ projectId, at, pages: audit.pages, ok: audit.ok })
      .returning({ id: auditRuns.id })
      .get()
    for (const i of audit.issues) {
      this.ctx.db
        .insert(auditIssues)
        .values({
          runId: run.id,
          projectId,
          url: i.url,
          code: i.code,
          severity: i.severity,
          detail: i.detail || null,
        })
        .run()
    }
    const seen = new Set<string>()
    for (const p of audit.pageData) {
      if (seen.has(p.url)) continue
      seen.add(p.url)
      this.ctx.db
        .insert(auditPages)
        .values({ runId: run.id, projectId, url: p.url, data: json(p.data) })
        .run()
    }
    return { runId: run.id, issues: audit.issues.length, pages: seen.size }
  }

  private runs(projectId: string, limit: number) {
    return this.ctx.db
      .select()
      .from(auditRuns)
      .where(eq(auditRuns.projectId, projectId))
      .orderBy(desc(auditRuns.at), desc(auditRuns.id))
      .limit(limit)
      .all()
  }

  private issues(runId: number): IssueView[] {
    return this.ctx.db
      .select({
        url: auditIssues.url,
        code: auditIssues.code,
        severity: auditIssues.severity,
        detail: auditIssues.detail,
      })
      .from(auditIssues)
      .where(eq(auditIssues.runId, runId))
      .all()
      .sort(sortIssues)
  }

  /** Latest run with findings; diff: new/fixed findings (key url+code) against the previous run. */
  show(projectId: string, diff = false) {
    requireProject(this.ctx, projectId)
    const [run, previous] = this.runs(projectId, 2)
    if (!run)
      return {
        project: projectId,
        run: null,
        counts: { error: 0, warning: 0, info: 0 },
        issues: [],
        previous: null,
        ...(diff ? { diff: { new: null, fixed: [] } } : {}),
      }
    const issues = this.issues(run.id)
    const counts = { error: 0, warning: 0, info: 0 } as Record<string, number>
    for (const i of issues) counts[i.severity] = (counts[i.severity] ?? 0) + 1
    let diffOut: { new: IssueView[] | null; fixed: IssueView[] } | undefined
    if (diff) {
      if (!previous) diffOut = { new: null, fixed: [] }
      else {
        const prevIssues = this.issues(previous.id)
        const prevKeys = new Set(prevIssues.map(key))
        const curKeys = new Set(issues.map(key))
        diffOut = {
          new: issues.filter((i) => !prevKeys.has(key(i))),
          fixed: prevIssues.filter((i) => !curKeys.has(key(i))),
        }
      }
    }
    return {
      project: projectId,
      run: { id: run.id, at: run.at, pages: run.pages, ok: run.ok },
      counts,
      issues,
      previous: previous
        ? {
            id: previous.id,
            at: previous.at,
            pages: previous.pages,
            ok: previous.ok,
          }
        : null,
      ...(diffOut ? { diff: diffOut } : {}),
    }
  }

  /** Last run and open error findings (for context/overview). */
  latest(projectId: string) {
    const [run] = this.runs(projectId, 1)
    if (!run) return { lastRun: null, openErrors: [] as IssueView[] }
    return {
      lastRun: { id: run.id, at: run.at, pages: run.pages, ok: run.ok },
      openErrors: this.issues(run.id).filter((i) => i.severity === "error"),
    }
  }
}

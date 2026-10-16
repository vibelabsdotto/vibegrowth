/** Response shapes of GET /search and GET /audit (docs/CONTRACT.md §7.5). */

export type SearchRow = {
  source: string
  query: string
  page: string
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
}

export type SearchResult = {
  project: string
  source: string | null
  window: { from: string; to: string }
  opportunities: boolean
  total: number
  totals: { clicks: number; impressions: number }
  rows: SearchRow[]
}

export type AuditIssue = {
  url: string
  code: string
  severity: "error" | "warning" | "info" | string
  detail: string | null
}

export type AuditRun = { id: number; at: string; pages: number; ok: boolean }

export type AuditResult = {
  project: string
  run: AuditRun | null
  counts: { error: number; warning: number; info: number }
  issues: AuditIssue[]
  previous?: AuditRun | null
  /** new is null without a previous run */
  diff?: { new: AuditIssue[] | null; fixed: AuditIssue[] }
}

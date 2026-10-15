/**
 * Response shapes of the growth endpoints (docs/CONTRACT.md §6, §7).
 * Rows mirror the drizzle tables (camelCase). JSON columns may arrive parsed or as
 * strings; read them through `json()` from components/growth/format.ts.
 */

export type Light = "green" | "yellow" | "red"

export type Project = {
  id: string
  name: string
  url: string | null
  kind: string
  status: string
  language?: string | null
  repo?: string | null
  workspace?: string | null
  notes?: string | null
  notionUrl?: string | null
  config?: unknown
}

export type Channel = {
  id: string
  projectId?: string
  kind: string
  name?: string | null
  url?: string | null
  handle?: string | null
  externalId?: string | null
  status?: string
  notes?: string | null
  virtual?: boolean
}

export type CollectorRun = {
  id: number
  projectId: string
  collector: string
  startedAt: string
  finishedAt: string | null
  ok: boolean | null
  summary: string | null
  error: string | null
  stats?: unknown
  actor: string
}

/** One config field of a collector (configSchema is a key → field map). */
export type ConfigField = {
  description?: string
  required?: boolean
  type?: "string" | "number" | "string[]" | "object" | "array" | string
  default?: unknown
  example?: unknown
}

export type CollectorState = {
  collector: string
  id?: string
  label?: string
  projectId?: string
  enabled: boolean
  config: unknown
  lastRun: CollectorRun | null
  configSchema?: Record<string, ConfigField>
  /** values derived from the project, overridden by config */
  defaults?: Record<string, unknown>
  channelKinds?: string[]
  secrets?: boolean
}

export type AccountLite = {
  id: string
  name: string
  handle?: string | null
  status?: string
  platform?: string | null
}

export type ProjectDetail = Project & {
  channels?: Channel[]
  collectors?: CollectorState[]
  accounts?: AccountLite[]
}

export type FunnelStage = {
  key: string
  label?: string
  value: number | null
  prev: number | null
  delta: number | null
  conversion?: number | null
  prevConversion?: number | null
  hasData?: boolean
}

export type Funnel = {
  project: string
  window: { from: string; to: string }
  prevWindow: { from: string; to: string }
  stages: FunnelStage[]
  weakest: string | null
}

export type OverviewRow = {
  project: { id: string; name: string; url: string | null; kind: string }
  funnel: { stages: FunnelStage[] }
  weakest: string | null
  light: Light
  reasons: string[]
  pendingApprovals: number
  runningExperiments: number
  lastCollect: string | null
  collectorErrors: { collector: string; error: string; at: string }[]
  shorts: { accounts: number; postsLast7d: number; playsLast7d: number }
}

export type ApprovalStatus =
  "pending" | "approved" | "rejected" | "changes_requested" | "withdrawn"

export type Approval = {
  id: number
  projectId: string
  accountId: string | null
  kind: string
  title: string
  body: string | null
  payload?: unknown
  refType: string | null
  refId: string | null
  status: ApprovalStatus
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  updatedAt?: string
}

export type ContentItem = {
  id: number
  projectId: string
  channelId: string | null
  kind: string
  title: string
  keyword: string | null
  intent: string | null
  brief: string | null
  status: string
  draftPath: string | null
  urlPath: string | null
  liveDate: string | null
  approvalId: number | null
  notes: string | null
  position: number
  actor: string
  createdAt?: string
  updatedAt?: string
}

export type SearchNumbers = {
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
  topQueries: {
    query: string
    clicks: number
    impressions: number
    position: number | null
  }[]
}

/** GET /content/:id */
export type ContentDetail = ContentItem & {
  approvals?: Pick<
    Approval,
    | "id"
    | "kind"
    | "title"
    | "status"
    | "requestedBy"
    | "decidedBy"
    | "decidedAt"
    | "decisionNote"
  >[]
  /** numbers since live_date, null when not live */
  numbers?: {
    from: string
    to: string
    days: number
    urlPath: string
    search: Record<string, SearchNumbers>
    sessions: {
      total: number
      byChannel: { channel: string; sessions: number }[]
    } | null
  } | null
}

export type BacklogItem = {
  id: number
  projectId: string
  title: string
  detail: string | null
  kind: string
  impact: number
  effort: number
  status: string
  source: string | null
  doneRef: string | null
  position: number
  actor: string
  createdAt?: string
  updatedAt?: string
}

export type Change = {
  id: number
  projectId: string
  channelId: string | null
  date: string
  kind: string
  summary: string
  ref: string | null
  experimentId: number | null
  actor: string
}

export type ExperimentWindow = {
  from: string
  to: string
  days?: number
  daysWithData?: number
  value: number | null
  perDay: number | null
  clicks?: number
  impressions?: number
}

export type ExperimentResult = {
  metric?: string
  aggregation?: string
  baseline: ExperimentWindow
  after: ExperimentWindow
  /** relative change (per day for summed metrics) */
  change: number | null
}

export type Experiment = {
  id: number
  projectId: string
  channelId: string | null
  title: string
  hypothesis: string | null
  targetType: string
  target: string | null
  metric: string
  startDate: string
  baselineDays: number
  evalDays: number
  status: string
  result: ExperimentResult | null
  verdict: string | null
  actor: string
  createdAt?: string
  windows?: {
    baseline: { from: string; to: string }
    after: { from: string; to: string }
  }
  dueOn?: string
}

/** GET /experiments/:id */
export type ExperimentDetail = Experiment & {
  due?: boolean
  /** running: result so far, not stored */
  interim?: ExperimentResult | null
  series?: {
    date: string
    value: number | null
    clicks?: number
    impressions?: number
  }[]
  changes?: Change[]
}

export type KpiRow = {
  projectId?: string
  source: string
  date: string
  metric: string
  dims?: string
  value: number
}

export type GeoQuestion = {
  id: number
  projectId: string
  text: string
  active: boolean
}

export type GeoCheck = {
  id: number
  projectId: string
  questionId: number
  date: string
  engine: string
  status: string
  mentioned: boolean
  position: number | null
  cited: boolean
  inSources: boolean
  competitors?: unknown
  sources?: unknown
  citedUrls?: unknown
  error: string | null
}

export type MentionTarget = {
  id: number
  projectId: string
  domain: string
  url: string | null
  kind: string
  seenCount: number
  citedCount: number
  firstSeen: string | null
  lastSeen: string | null
  status: string
  contact: string | null
  notes: string | null
}

export type StoreReview = {
  id: number
  projectId: string
  store: string
  reviewId: string
  date: string | null
  rating: number | null
  title: string | null
  body: string | null
  language: string | null
  version: string | null
  reply: string | null
}

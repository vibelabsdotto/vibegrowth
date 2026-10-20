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
  /** Last day of the stage window when its sources lag behind window.to */
  asOf?: string
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
  /** stored or derived (contract §7.9) */
  category?: string
  createdAt: string
  updatedAt?: string
}

/** Payload of an approval with kind reply (contract §7.8). */
export type ReplyPayload = {
  target: "featurama" | "google_play" | "app_store" | string
  projectRef?: string
  itemId: string
  lastSeen?: string | null
  text: string
  language?: string | null
  /** 1–2 sentences: what happened */
  summary?: string | null
  /** optional next step, becomes a task on approve */
  task?: TaskPayload | null
  editedBy?: string
  /** set by `app publish` */
  published?: { at: string; ref: string | null; verified?: boolean } | null
  publish?: {
    state: "stale" | "error" | string
    at: string
    reason: string
  } | null
}

/** Payload of an approval with kind task (contract §7.8). */
export type TaskPayload = {
  title?: string
  detail?: string | null
  kind?: string
  impact?: number
  effort?: number
  sources?: { type: string; id: string }[]
}

/** Payload of an approval with kind strategy (contract §7.10). */
export type StrategyPayload = {
  id?: string
  category: string
  name: string
  summary?: string | null
  guide?: string | null
  skills?: string[]
}

/** One change caused by a decision (POST /approvals/:id/decide, /app/inbox/*). */
export type ApprovalEffect = {
  entity: string
  id: string | number | null
  change: string
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
  /** YYYY-MM-DD, shown in the calendar */
  plannedDate?: string | null
  approvalId: number | null
  notes: string | null
  position: number
  actor: string
  category?: string
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
  notionUrl?: string | null
  /** byte | hunter | echo | max, null = niemand */
  assignee?: string | null
  /** Inbox items this task answers */
  sources?: TaskSource[]
  acceptedAt?: string | null
  releasedVersion?: string | null
  releasedAt?: string | null
  position: number
  actor: string
  category?: string
  createdAt?: string
  updatedAt?: string
}

export type TaskSource = { type: "feature_request" | "review"; id: string }

export type TaskComment = {
  id: number
  backlogItemId: number
  /** comment | report | feedback | accept */
  kind: string
  body: string
  /** paths relative to the data dir, see mediaUrl */
  attachments: string[]
  actor: string
  createdAt: string
}

/** GET /backlog/:id */
export type BacklogDetail = BacklogItem & { comments: TaskComment[] }

/** Task linked to an inbox item (GET /app/inbox) */
export type InboxTask = {
  id: number
  title: string
  kind: string
  status: string
  assignee: string | null
  acceptedAt: string | null
  releasedVersion: string | null
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
  category?: string
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
  category?: string
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
  lastModified?: string | null
  replyAt?: string | null
  replyState?: string | null
  needsReply?: boolean
}

/** Approval linked to an inbox item (GET /app/inbox, items[].approvals). */
export type InboxApproval = {
  id: number
  kind: string
  status: string
  title: string
  published: ReplyPayload["published"]
  publish: ReplyPayload["publish"]
}

/** Inbox item state (contract §7.8). */
export type InboxState =
  "open" | "proposal" | "approved" | "answered" | "no_reply" | "stale" | "error"

export type InboxStateCounts = Partial<Record<InboxState, number>>

type InboxBase = {
  target: "featurama" | "google_play" | "app_store" | string
  itemId: string
  projectRef: string | null
  lastSeen: string | null
  state: InboxState
  noReplyLastSeen?: string | null
  noReplyAt?: string | null
  needsReply: boolean
  lastActivity: string | null
  approvals: InboxApproval[]
  tasks?: InboxTask[]
  /** follow-up reply due because linked tasks were accepted or released */
  replyDue?: "accepted" | "released" | null
  id: number
  projectId: string
  createdAt?: string
  updatedAt?: string
}

export type FeatureRequestComment = {
  id: string
  role: "user" | "developer" | string
  author: string | null
  content: string
  createdAt: string
}

export type InboxFeatureRequest = InboxBase & {
  type: "feature_request"
  featuramaProjectId: string
  requestId: string
  title: string
  body: string | null
  status: string | null
  votes: number
  approved: boolean
  platform: string | null
  appVersion: string | null
  requestedAt: string | null
  lastUserCommentAt: string | null
  lastDeveloperCommentAt: string | null
  commentCount: number
  comments: FeatureRequestComment[]
  url: string | null
}

export type InboxReview = InboxBase &
  Omit<StoreReview, "id" | "projectId" | "needsReply"> & {
    type: "review"
  }

export type InboxItem = InboxFeatureRequest | InboxReview

/** GET /app/inbox */
export type AppInbox = {
  project: string | null
  counts: {
    featureRequests: {
      total: number
      needsReply: number
      pending: number
      byState?: InboxStateCounts
    }
    reviews: {
      total: number
      needsReply: number
      byState?: InboxStateCounts
      ratingsOnly: number
      google_play?: {
        total: number
        needsReply: number
        byState?: InboxStateCounts
      }
      app_store?: {
        total: number
        needsReply: number
        byState?: InboxStateCounts
      }
    }
  }
  items: InboxItem[]
}

/** GET /strategies: stored strategy (kind strategy) or a format (kind format, category shortform). */
export type StrategyAccount = {
  id: string
  name: string
  status: string
  source: "account" | "plan" | string
  dates?: string[]
}

export type Strategy = {
  kind: "strategy" | "format"
  id: string
  projectId: string | null
  category: string
  name: string
  summary: string | null
  guide?: string | null
  status: string
  skills: string[]
  source?: string | null
  actor?: string
  version?: number
  url?: string
  accounts?: StrategyAccount[]
  createdAt?: string
  updatedAt?: string
}

/** GET /knowledge: learning or decision with project and category. */
export type KnowledgeItem = {
  type: "learning" | "decision"
  id: number
  scopeType: string
  scopeId: string | null
  /** project of the scope, null for global/growth */
  projectId: string | null
  /** decisions with scope account: the account, else null */
  accountId?: string | null
  category: string
  date: string
  actor: string
  source: string | null
  createdAt?: string
  updatedAt?: string
  // learning
  statement?: string
  evidence?: string
  evidencePostIds?: string[]
  status?: string
  // decision
  kind?: string
  title?: string
  rationale?: string
  supersedesId?: number | null
}

/** One run in GET /geo/summary (all checks of a date and engine). */
export type GeoRunSummary = {
  date: string
  engine: string
  checks: number
  ok: number
  errors: number
  mentioned: number
  mentionRate: number | null
  avgPosition: number | null
  citedRate: number | null
  inSourcesRate: number | null
}

/** GET /geo/summary?project= (fields the web reads). */
export type GeoSummary = {
  project: string
  questions: { total: number; active: number }
  latest: string | null
  runs: GeoRunSummary[]
}

export type WindowValue = {
  value: number | null
  prev: number | null
  delta: number | null
}

/** GET /store/summary?project=&days= (fields the web reads). */
export type StoreSummary = {
  project: string
  window: { from: string; to: string }
  installs: WindowValue
  stores: Record<
    string,
    {
      source: string
      hasData: boolean
      installs: WindowValue
      rating: { value: number; date: string } | null
    }
  >
  reviews: {
    total: number
    avgRating: number | null
    window: { count: number; avgRating: number | null }
  }
}

/** GET /calendar item: shortform plan entry or web content with a date. */
export type CalendarItem =
  | {
      type: "plan_entry"
      date: string
      category: string
      id: number
      projectId: string | null
      accountId: string
      accountName: string | null
      title: string | null
      status: string
      formatId: string | null
      locked: boolean
      origin: string
    }
  | {
      type: "content"
      date: string
      category: string
      id: number
      projectId: string
      title: string
      dateKind: "planned" | "live"
      kind: string
      status: string
      plannedDate: string | null
      liveDate: string | null
      urlPath: string | null
      approvalId: number | null
    }

export type CalendarResponse = {
  project: string | null
  from: string
  to: string
  items: CalendarItem[]
}

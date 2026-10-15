// Response shapes of the shorts API (contract §5). Plain TS mirror of the rows and
// return values in apps/api/src/core; the web app imports nothing from there.

export type ProjectRow = {
  id: string
  name: string
  notionUrl: string | null
  notes: string | null
  url: string | null
  kind: string
  status: string
  language: string | null
  repo: string | null
  workspace: string | null
  createdAt: string
  updatedAt: string
}

export type AccountRow = {
  id: string
  brandId: string
  name: string
  handle: string | null
  platform: string
  language: string | null
  status: string
  dir: string
  defaultFormatId: string | null
  mode: string | null
  ctaRule: string
  postsPerDay: number
  characterId: string | null
  notionContextId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type CharacterRow = {
  id: string
  name: string
  brandId: string | null
  persona: string | null
  voice: string | null
  look: string | null
  dos: string | null
  donts: string | null
  referenceImages: string[]
  sourceKey: string | null
  createdAt: string
  updatedAt: string
}

export type FormatRow = {
  id: string
  name: string
  description: string | null
  brandId: string | null
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export type FormatVersionRow = {
  id: number
  formatId: string
  version: number
  description: string | null
  guide: string | null
  rendererParams: Record<string, unknown>
  skills: string[]
  examples: string[]
  changeNote: string | null
  actor: string
  createdAt: string
}

export type FormatFull = FormatRow & {
  current: FormatVersionRow | null
  versions: FormatVersionRow[]
}

export type RuleRow = {
  id: number
  scopeType: string
  scopeId: string
  formatVersion: number | null
  kind: string
  text: string
  source: string
  actor: string
  status: string
  replacedBy: number | null
  date: string
  sourceKey: string | null
  createdAt: string
}

export type ImageErrorRow = {
  id: number
  title: string
  detection: string | null
  countermeasure: string
  formatIds: string[]
  exampleImage: string | null
  source: string
  actor: string
  status: string
  sourceKey: string | null
  createdAt: string
  updatedAt: string
}

export type PlanEntryRow = {
  id: number
  date: string | null
  accountId: string
  formatId: string | null
  topic: string
  angle: string | null
  hookDirection: string | null
  hook: string | null
  rationale: string | null
  origin: string
  locked: boolean
  status: string
  inspirationId: number | null
  hookId: number | null
  comment: string | null
  position: number
  createdBy: string
  sourceKey: string | null
  createdAt: string
  updatedAt: string
}

export type PostRow = {
  id: number
  accountId: string
  planEntryId: number | null
  dir: string
  slug: string
  date: string | null
  hook: string | null
  caption: string | null
  angle: string | null
  slideCount: number | null
  slides: string[]
  contactSheet: string | null
  mp4: string | null
  zip: string | null
  deliveredAt: string | null
  tiktokId: string | null
  tiktokUrl: string | null
  postedAt: string | null
  status: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** Post row as stored (slides as JSON text), e.g. getEntry().post. */
export type PostRowRaw = Omit<PostRow, "slides"> & { slides: string }

export type PlanEntryFull = PlanEntryRow & { post: PostRowRaw | null }

export type Snapshot = {
  id: number
  accountId: string
  postId: number | null
  tiktokId: string
  url: string | null
  liveSince: string | null
  pulledAt: string
  ageH: number
  plays: number
  likes: number
  saves: number
  comments: number
  shares: number
  reposts: number
  slides: number | null
  description: string | null
  matchDist: number | null
}

export type PostStats = {
  tiktokId: string
  url: string | null
  liveSince: string | null
  postId: number | null
  latest: Snapshot
  plays24: number | null
  plays48: number | null
  plays7d: number | null
  likeRate: number | null
  saveRate: number | null
  winner: boolean
  snapshots: number
}

export type AccountStats = {
  accountId: string
  median: number | null
  winnerThreshold: number | null
  lastPull: string | null
  posts: PostStats[]
}

export type PostMetrics = {
  median: number | null
  stats: PostStats | null
  history: Snapshot[]
}

export type LearningRow = {
  id: number
  scopeType: string
  scopeId: string | null
  statement: string
  evidence: string
  evidencePostIds: number[]
  date: string
  actor: string
  source: string | null
  status: string
  sourceKey: string | null
  createdAt: string
  updatedAt: string
}

export type DecisionRow = {
  id: number
  kind: string
  title: string
  rationale: string
  date: string
  actor: string
  scopeType: string
  scopeId: string | null
  supersedesId: number | null
  source: string | null
  sourceKey: string | null
  createdAt: string
}

export type HookBase = {
  id: number
  accountId: string
  text: string
  mechanism: string | null
  originPostId: number | null
  winner: boolean
  parentId: number | null
  actor: string
  source: string | null
  sourceKey: string | null
  createdAt: string
}

export type HookRow = HookBase & { variants: HookBase[] }

export type InspirationRow = {
  id: number
  url: string
  platform: string | null
  type: string
  note: string | null
  tags: string[]
  brandId: string | null
  accountId: string | null
  status: string
  files: string[]
  briefingPath: string | null
  actor: string
  sourceKey: string | null
  createdAt: string
  updatedAt: string
  planEntries: {
    id: number
    date: string | null
    topic: string
    accountId: string
    status: string
  }[]
}

export type HistoryRow = {
  id: number
  at: string
  actor: string
  entity: string
  entityId: string
  action: string
  before: unknown
  after: unknown
}

export type Horizon = {
  from: string
  days: number
  filledDays: number
  freeDays: string[]
  firstGap: string | null
}

export type DayEntries = {
  date: string
  entry: PlanEntryRow | null
  all: PlanEntryRow[]
}

/** GET /accounts/:id, composed like `accounts show`. */
export type AccountShow = AccountRow & {
  activeFormat: {
    id: string
    name: string
    version: number
    source: "plan" | "account"
  } | null
  character: CharacterRow | null
  rules: RuleRow[]
  learnings: LearningRow[]
  stats: AccountStats
  unregisteredPostDirs: string[]
}

/** GET /formats/:id, composed like `formats show`. */
export type FormatShow = FormatFull & {
  activeAccounts: {
    id: string
    name: string
    status: string
    source: "plan" | "account"
  }[]
  rules: RuleRow[]
  imageErrors: ImageErrorRow[]
}

/** GET /posts/:id, composed like `post show`. */
export type PostShow = PostRow & {
  metrics: PostMetrics
  planEntry: PlanEntryFull | null
}

export type CalendarPost = {
  id: number
  accountId: string
  date: string
  hook: string | null
  slug: string
  status: string
}

export type Lite = { id: string; name: string }
export type InspoLite = { id: number; label: string }

import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
const createdAt = () => text("created_at").notNull().default(now)
const updatedAt = () => text("updated_at").notNull().default(now)

/** Project = brand/product (Chrono, Amelie, …). Was the table brands; the shorts module keeps calling it brand/brandId. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  notes: text("notes"),
  url: text("url"),
  /** app | website | tool | other */
  kind: text("kind").notNull().default("app"),
  /** active | paused | archived */
  status: text("status").notNull().default("active"),
  language: text("language"),
  repo: text("repo"),
  workspace: text("workspace"),
  /** JSON object, optional funnel override */
  config: text("config").notNull().default("{}"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Old name, kept so the shorts code keeps compiling. Same table. */
export const brands = projects

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brandId: text("brand_id").references(() => projects.id),
  persona: text("persona"),
  voice: text("voice"),
  look: text("look"),
  dos: text("dos"),
  donts: text("donts"),
  /** JSON array of paths relative to the data dir */
  referenceImages: text("reference_images").notNull().default("[]"),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const formats = sqliteTable("formats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  brandId: text("brand_id").references(() => projects.id),
  currentVersion: integer("current_version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const formatVersions = sqliteTable(
  "format_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    formatId: text("format_id")
      .notNull()
      .references(() => formats.id),
    version: integer("version").notNull(),
    description: text("description"),
    /** Markdown guide: slide structure, production, acceptance */
    guide: text("guide"),
    /** JSON object passed to the renderer, e.g. {"style":"native","text_scale":1.2} */
    rendererParams: text("renderer_params").notNull().default("{}"),
    /** JSON array of tool skills an agent must load, e.g. ["bg-removal"] */
    skills: text("skills").notNull().default("[]"),
    /** JSON array of confirmed example posts, paths relative to the data dir */
    examples: text("examples").notNull().default("[]"),
    changeNote: text("change_note"),
    actor: text("actor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("format_versions_format_version").on(t.formatId, t.version),
  ]
)

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  brandId: text("brand_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  handle: text("handle"),
  platform: text("platform").notNull().default("tiktok"),
  language: text("language"),
  /** active | paused | planned */
  status: text("status").notNull().default("planned"),
  /** folder relative to the data dir, e.g. amelie/jule */
  dir: text("dir").notNull(),
  defaultFormatId: text("default_format_id").references(() => formats.id),
  mode: text("mode"),
  /** none | engagement | app */
  ctaRule: text("cta_rule").notNull().default("engagement"),
  postsPerDay: integer("posts_per_day").notNull().default(1),
  characterId: text("character_id").references(() => characters.id),
  notionContextId: text("notion_context_id"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const rules = sqliteTable(
  "rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** format | account | brand */
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    /** only for format rules: the format version the rule belongs to */
    formatVersion: integer("format_version"),
    /** hook | copy | image | caption | cta | production | other */
    kind: text("kind").notNull().default("other"),
    text: text("text").notNull(),
    source: text("source").notNull(),
    actor: text("actor").notNull(),
    /** active | replaced */
    status: text("status").notNull().default("active"),
    replacedBy: integer("replaced_by"),
    date: text("date").notNull(),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("rules_scope").on(t.scopeType, t.scopeId)]
)

export const imageErrors = sqliteTable("image_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  detection: text("detection"),
  countermeasure: text("countermeasure").notNull(),
  /** JSON array of format ids; empty = all formats */
  formatIds: text("format_ids").notNull().default("[]"),
  exampleImage: text("example_image"),
  source: text("source").notNull(),
  actor: text("actor").notNull(),
  /** active | resolved */
  status: text("status").notNull().default("active"),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const inspirations = sqliteTable("inspirations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull().unique(),
  platform: text("platform"),
  /** format | hook | sound | visual | topic | trend */
  type: text("type").notNull().default("format"),
  note: text("note"),
  tags: text("tags").notNull().default("[]"),
  brandId: text("brand_id").references(() => projects.id),
  accountId: text("account_id").references(() => accounts.id),
  /** new | analyzed | adapted | discarded */
  status: text("status").notNull().default("new"),
  files: text("files").notNull().default("[]"),
  briefingPath: text("briefing_path"),
  actor: text("actor").notNull(),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const hooks = sqliteTable("hooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  text: text("text").notNull(),
  mechanism: text("mechanism"),
  originPostId: integer("origin_post_id"),
  winner: integer("winner", { mode: "boolean" }).notNull().default(false),
  parentId: integer("parent_id"),
  actor: text("actor").notNull(),
  source: text("source"),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
})

export const planEntries = sqliteTable(
  "plan_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** YYYY-MM-DD; null = idea pool */
    date: text("date"),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    formatId: text("format_id").references(() => formats.id),
    topic: text("topic").notNull(),
    angle: text("angle"),
    hookDirection: text("hook_direction"),
    hook: text("hook"),
    rationale: text("rationale"),
    /** agent | max */
    origin: text("origin").notNull().default("agent"),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    /** idea | planned | in_production | delivered | posted | skipped */
    status: text("status").notNull().default("planned"),
    inspirationId: integer("inspiration_id").references(() => inspirations.id),
    hookId: integer("hook_id").references(() => hooks.id),
    comment: text("comment"),
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").notNull(),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("plan_entries_account_date").on(t.accountId, t.date)]
)

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  planEntryId: integer("plan_entry_id").references(() => planEntries.id),
  /** folder relative to the data dir */
  dir: text("dir").notNull().unique(),
  slug: text("slug").notNull(),
  date: text("date"),
  hook: text("hook"),
  caption: text("caption"),
  angle: text("angle"),
  slideCount: integer("slide_count"),
  slides: text("slides").notNull().default("[]"),
  contactSheet: text("contact_sheet"),
  mp4: text("mp4"),
  zip: text("zip"),
  deliveredAt: text("delivered_at"),
  tiktokId: text("tiktok_id").unique(),
  tiktokUrl: text("tiktok_url"),
  postedAt: text("posted_at"),
  /** produced | delivered | posted */
  status: text("status").notNull().default("produced"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const metricSnapshots = sqliteTable(
  "metric_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    postId: integer("post_id").references(() => posts.id),
    tiktokId: text("tiktok_id").notNull(),
    url: text("url"),
    liveSince: text("live_since"),
    pulledAt: text("pulled_at").notNull(),
    ageH: real("age_h").notNull(),
    plays: integer("plays").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    reposts: integer("reposts").notNull().default(0),
    slides: integer("slides"),
    description: text("description"),
    matchDist: integer("match_dist"),
  },
  (t) => [
    uniqueIndex("metric_snapshots_tiktok_pulled").on(t.tiktokId, t.pulledAt),
    index("metric_snapshots_post").on(t.postId),
  ]
)

export const learnings = sqliteTable("learnings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** account | brand | format | global */
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id"),
  statement: text("statement").notNull(),
  evidence: text("evidence").notNull(),
  evidencePostIds: text("evidence_post_ids").notNull().default("[]"),
  date: text("date").notNull(),
  actor: text("actor").notNull(),
  source: text("source"),
  /** active | outdated */
  status: text("status").notNull().default("active"),
  /** web | shortform | app | general; null = derived (growth/work/category.ts) */
  category: text("category"),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const decisions = sqliteTable("decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** decision | pivot */
  kind: text("kind").notNull().default("decision"),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  date: text("date").notNull(),
  actor: text("actor").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id"),
  supersedesId: integer("supersedes_id"),
  source: text("source"),
  /** web | shortform | app | general; null = derived (growth/work/category.ts) */
  category: text("category"),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
})

export const history = sqliteTable(
  "history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: text("at").notNull().default(now),
    actor: text("actor").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    /** create | update | delete | move | lock | unlock | skip | import */
    action: text("action").notNull(),
    before: text("before"),
    after: text("after"),
  },
  (t) => [
    index("history_entity").on(t.entity, t.entityId),
    index("history_at").on(t.at),
  ]
)

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

// ---------- growth ----------
// Enums are whitelists in the services, no CHECK constraints. channel_id has no
// foreign key: TikTok channels are the accounts and only exist virtually.

const projectId = () =>
  text("project_id")
    .notNull()
    .references(() => projects.id)

export const channels = sqliteTable(
  "channels",
  {
    /** e.g. chrono-web */
    id: text("id").primaryKey(),
    projectId: projectId(),
    /** website | ios | android | youtube | instagram | other */
    kind: text("kind").notNull(),
    name: text("name"),
    url: text("url"),
    handle: text("handle"),
    externalId: text("external_id"),
    /** active | paused | planned */
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("channels_project").on(t.projectId)]
)

export const collectors = sqliteTable(
  "collectors",
  {
    projectId: projectId(),
    /** health | audit | gsc | ga4 | bing | psi | app | play | asc | geo-chatgpt */
    collector: text("collector").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    /** JSON object, collector specific */
    config: text("config").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.collector] })]
)

export const collectorRuns = sqliteTable(
  "collector_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    collector: text("collector").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    ok: integer("ok", { mode: "boolean" }),
    summary: text("summary"),
    error: text("error"),
    /** JSON object */
    stats: text("stats").notNull().default("{}"),
    actor: text("actor").notNull(),
    /** Set by the website-growth import (runs.id), null for own runs */
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("collector_runs_project_collector").on(
      t.projectId,
      t.collector,
      t.startedAt
    ),
    index("collector_runs_started").on(t.startedAt),
  ]
)

export const kpiDaily = sqliteTable(
  "kpi_daily",
  {
    projectId: projectId(),
    /** gsc | bing | ga4 | psi | app | play | asc | health | … */
    source: text("source").notNull(),
    date: text("date").notNull(),
    /** e.g. clicks, sessions, event:download_click */
    metric: text("metric").notNull(),
    /** '' = daily total, otherwise stable JSON with sorted keys */
    dims: text("dims").notNull().default(""),
    value: real("value").notNull(),
    channelId: text("channel_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      columns: [t.projectId, t.source, t.date, t.metric, t.dims],
    }),
    index("kpi_daily_project_date").on(t.projectId, t.date),
    index("kpi_daily_project_metric").on(
      t.projectId,
      t.source,
      t.metric,
      t.date
    ),
  ]
)

export const searchDaily = sqliteTable(
  "search_daily",
  {
    projectId: projectId(),
    /** gsc | bing */
    source: text("source").notNull(),
    date: text("date").notNull(),
    query: text("query").notNull(),
    /** '' when the source has no page */
    page: text("page").notNull().default(""),
    clicks: real("clicks").notNull().default(0),
    impressions: real("impressions").notNull().default(0),
    ctr: real("ctr").notNull().default(0),
    position: real("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      columns: [t.projectId, t.source, t.date, t.query, t.page],
    }),
    index("search_daily_project_date").on(t.projectId, t.date),
    index("search_daily_project_page").on(t.projectId, t.page),
  ]
)

export const auditRuns = sqliteTable(
  "audit_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    at: text("at").notNull(),
    pages: integer("pages").notNull().default(0),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),
    /** Set by the website-growth import (runs.id), null for own runs */
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("audit_runs_project_at").on(t.projectId, t.at)]
)

export const auditIssues = sqliteTable(
  "audit_issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => auditRuns.id),
    projectId: projectId(),
    url: text("url").notNull(),
    code: text("code").notNull(),
    /** error | warning | info */
    severity: text("severity").notNull(),
    detail: text("detail"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("audit_issues_run").on(t.runId),
    index("audit_issues_project").on(t.projectId),
  ]
)

export const auditPages = sqliteTable(
  "audit_pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => auditRuns.id),
    projectId: projectId(),
    url: text("url").notNull(),
    /** JSON object */
    data: text("data").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("audit_pages_run_url").on(t.runId, t.url),
    index("audit_pages_project").on(t.projectId),
  ]
)

export const experiments = sqliteTable(
  "experiments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    channelId: text("channel_id"),
    title: text("title").notNull(),
    hypothesis: text("hypothesis"),
    /** page | post | store | other */
    targetType: text("target_type").notNull().default("page"),
    target: text("target"),
    /** clicks | impressions | ctr | position | <source>:<metric> */
    metric: text("metric").notNull(),
    startDate: text("start_date").notNull(),
    baselineDays: integer("baseline_days").notNull().default(28),
    evalDays: integer("eval_days").notNull().default(28),
    /** running | evaluated | stopped */
    status: text("status").notNull().default("running"),
    /** JSON {baseline, after, change} */
    result: text("result"),
    /** win | loss | neutral | inconclusive */
    verdict: text("verdict"),
    /** web | shortform | app | general; null = derived (growth/work/category.ts) */
    category: text("category"),
    actor: text("actor").notNull(),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("experiments_project_status").on(t.projectId, t.status),
    index("experiments_start").on(t.startDate),
  ]
)

export const changes = sqliteTable(
  "changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    channelId: text("channel_id"),
    date: text("date").notNull(),
    /** deploy | content | seo | store | config | shorts | other */
    kind: text("kind").notNull().default("other"),
    summary: text("summary").notNull(),
    ref: text("ref"),
    experimentId: integer("experiment_id").references(() => experiments.id),
    /** web | shortform | app | general; null = derived (growth/work/category.ts) */
    category: text("category"),
    actor: text("actor").notNull(),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("changes_project_date").on(t.projectId, t.date),
    index("changes_experiment").on(t.experimentId),
  ]
)

export const approvals = sqliteTable(
  "approvals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    accountId: text("account_id").references(() => accounts.id),
    /** hook | format | blog_topic | draft | store_text | strategy | other */
    kind: text("kind").notNull().default("other"),
    title: text("title").notNull(),
    /** Markdown */
    body: text("body"),
    /** JSON object */
    payload: text("payload").notNull().default("{}"),
    /** plan_entry | content | format | hook | experiment | backlog */
    refType: text("ref_type"),
    refId: text("ref_id"),
    /** pending | approved | rejected | changes_requested | withdrawn */
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    /** web | shortform | app | general; null = derived (growth/work/category.ts) */
    category: text("category"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("approvals_project_status").on(t.projectId, t.status),
    index("approvals_status").on(t.status),
    index("approvals_ref").on(t.refType, t.refId),
  ]
)

export const contentItems = sqliteTable(
  "content_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    channelId: text("channel_id"),
    /** blog | landing | store_text | other */
    kind: text("kind").notNull().default("blog"),
    title: text("title").notNull(),
    keyword: text("keyword"),
    intent: text("intent"),
    brief: text("brief"),
    /** idea | approved | draft | review | live | discarded */
    status: text("status").notNull().default("idea"),
    /** absolute path, may lie outside the data dir (reference only) */
    draftPath: text("draft_path"),
    /** e.g. /blog/ueberstunden */
    urlPath: text("url_path"),
    liveDate: text("live_date"),
    approvalId: integer("approval_id").references(() => approvals.id),
    notes: text("notes"),
    /** web | shortform | app | general; null = derived (growth/work/category.ts) */
    category: text("category"),
    position: integer("position").notNull().default(0),
    actor: text("actor").notNull(),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_items_project_status").on(t.projectId, t.status)]
)

export const backlogItems = sqliteTable(
  "backlog_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    title: text("title").notNull(),
    detail: text("detail"),
    /** seo | tech | content | store | growth | other */
    kind: text("kind").notNull().default("other"),
    /** 1–3 */
    impact: integer("impact").notNull().default(2),
    /** 1–3 */
    effort: integer("effort").notNull().default(2),
    /** open | doing | done | dropped */
    status: text("status").notNull().default("open"),
    source: text("source"),
    doneRef: text("done_ref"),
    /** web | shortform | app | general; null = derived (growth/work/category.ts) */
    category: text("category"),
    /** Notion ticket of an app task (bug/feature), set by the agent that created it */
    notionUrl: text("notion_url"),
    position: integer("position").notNull().default(0),
    actor: text("actor").notNull(),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("backlog_items_project_status").on(t.projectId, t.status)]
)

export const geoQuestions = sqliteTable(
  "geo_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    text: text("text").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("geo_questions_project_text").on(t.projectId, t.text)]
)

export const geoChecks = sqliteTable(
  "geo_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    questionId: integer("question_id")
      .notNull()
      .references(() => geoQuestions.id),
    date: text("date").notNull(),
    /** e.g. chatgpt-web */
    engine: text("engine").notNull(),
    /** ok | error */
    status: text("status").notNull().default("ok"),
    mentioned: integer("mentioned", { mode: "boolean" })
      .notNull()
      .default(false),
    position: integer("position"),
    cited: integer("cited", { mode: "boolean" }).notNull().default(false),
    inSources: integer("in_sources", { mode: "boolean" })
      .notNull()
      .default(false),
    brands: text("brands").notNull().default("[]"),
    competitors: text("competitors").notNull().default("[]"),
    links: text("links").notNull().default("[]"),
    citedUrls: text("cited_urls").notNull().default("[]"),
    sources: text("sources").notNull().default("[]"),
    answer: text("answer"),
    model: text("model"),
    /** path to the evidence file */
    evidence: text("evidence"),
    meta: text("meta").notNull().default("{}"),
    error: text("error"),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("geo_checks_project_question_date_engine").on(
      t.projectId,
      t.questionId,
      t.date,
      t.engine
    ),
    index("geo_checks_project_date").on(t.projectId, t.date),
  ]
)

export const mentionTargets = sqliteTable(
  "mention_targets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    domain: text("domain").notNull(),
    url: text("url"),
    /** app_store | comparison | guide | forum | press | vendor | other */
    kind: text("kind").notNull().default("other"),
    seenCount: integer("seen_count").notNull().default(0),
    citedCount: integer("cited_count").notNull().default(0),
    firstSeen: text("first_seen"),
    lastSeen: text("last_seen"),
    /** new | contacted | listed | rejected | ignored */
    status: text("status").notNull().default("new"),
    contact: text("contact"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("mention_targets_project_domain").on(t.projectId, t.domain),
  ]
)

export const storeReviews = sqliteTable(
  "store_reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    /** app_store | google_play */
    store: text("store").notNull(),
    reviewId: text("review_id").notNull(),
    date: text("date"),
    rating: integer("rating"),
    title: text("title"),
    body: text("body"),
    language: text("language"),
    version: text("version"),
    reply: text("reply"),
    /** Last change of the user review (Google lastModified, Apple createdDate) */
    lastModified: text("last_modified"),
    /** Last change of the developer reply */
    replyAt: text("reply_at"),
    /** Apple response state (PUBLISHED, PENDING_PUBLISH), null for Google */
    replyState: text("reply_state"),
    /** Text review without reply, or changed after the reply */
    needsReply: integer("needs_reply", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("store_reviews_project_store_review").on(
      t.projectId,
      t.store,
      t.reviewId
    ),
    index("store_reviews_project_date").on(t.projectId, t.date),
  ]
)

/** Growth strategies per project and category. Shortform strategies are the formats (read view). */
export const strategies = sqliteTable(
  "strategies",
  {
    /** slug */
    id: text("id").primaryKey(),
    /** null = for every project */
    projectId: text("project_id").references(() => projects.id),
    /** web | app | general */
    category: text("category").notNull(),
    name: text("name").notNull(),
    summary: text("summary"),
    /** Markdown: approach, signals, acceptance */
    guide: text("guide"),
    /** active | paused | retired */
    status: text("status").notNull().default("active"),
    /** JSON array of skills an agent loads for this strategy */
    skills: text("skills").notNull().default("[]"),
    source: text("source"),
    actor: text("actor").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("strategies_project_category").on(t.projectId, t.category)]
)

/** Mirror of Featurama feature requests (collector featurama, read only). No e-mail addresses. */
export const featureRequests = sqliteTable(
  "feature_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    featuramaProjectId: text("featurama_project_id").notNull(),
    requestId: text("request_id").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Featurama status: Requested | Roadmap | InProgress | Done | Declined */
    status: text("status"),
    votes: integer("votes").notNull().default(0),
    /** Approved in the Featurama inbox (public) */
    approved: integer("approved", { mode: "boolean" }).notNull().default(false),
    platform: text("platform"),
    appVersion: text("app_version"),
    /** Featurama createdAt of the request */
    requestedAt: text("requested_at"),
    lastUserCommentAt: text("last_user_comment_at"),
    lastDeveloperCommentAt: text("last_developer_comment_at"),
    /** Featurama needsReply: no developer comment, or a user comment after the last one */
    needsReply: integer("needs_reply", { mode: "boolean" })
      .notNull()
      .default(false),
    commentCount: integer("comment_count").notNull().default(0),
    /** JSON [{id, role, author (developers only), content, createdAt}] */
    comments: text("comments").notNull().default("[]"),
    url: text("url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("feature_requests_project_request").on(
      t.projectId,
      t.requestId
    ),
    index("feature_requests_project_needs_reply").on(t.projectId, t.needsReply),
  ]
)

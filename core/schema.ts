import { sql } from "drizzle-orm"
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
const createdAt = () => text("created_at").notNull().default(now)
const updatedAt = () => text("updated_at").notNull().default(now)

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brandId: text("brand_id").references(() => brands.id),
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
  brandId: text("brand_id").references(() => brands.id),
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
    slideStructure: text("slide_structure"),
    /** JSON object passed to the renderer, e.g. {"style":"native","text_scale":1.2} */
    rendererParams: text("renderer_params").notNull().default("{}"),
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
    .references(() => brands.id),
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
  brandId: text("brand_id").references(() => brands.id),
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

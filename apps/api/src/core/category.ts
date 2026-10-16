import { VGError } from "./util"

/** Areas of VibeGrowth. Every growth row has one, stored or derived. */
export const CATEGORIES = ["web", "shortform", "app", "general"] as const
export type Category = (typeof CATEGORIES)[number]

/** Validate a category from a request body; undefined = not given, null/"" = clear (derive again). */
export function categoryInput(
  v: string | null | undefined
): Category | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === "") return null
  if (!(CATEGORIES as readonly string[]).includes(v))
    throw new VGError(
      "INVALID",
      `category muss einer von ${CATEGORIES.join(", ")} sein, war: ${v}`
    )
  return v as Category
}

/** Comma separated filter (?category=web,app) → set, undefined when not given. */
export function categoryFilter(v: string | undefined): Set<string> | undefined {
  if (!v) return undefined
  const list = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  for (const c of list) categoryInput(c)
  return list.length ? new Set(list) : undefined
}

const stored = (c: string | null | undefined) =>
  c && (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : null

/** learnings/decisions: account|format|brand → shortform, growth → web, global → general. */
export function knowledgeCategory(r: {
  category?: string | null
  scopeType: string
}): Category {
  const c = stored(r.category)
  if (c) return c
  if (["account", "format", "brand"].includes(r.scopeType)) return "shortform"
  if (r.scopeType === "growth") return "web"
  return "general"
}

/** experiments: target_type post → shortform, store → app, else web. */
export function experimentCategory(r: {
  category?: string | null
  targetType: string
}): Category {
  return (
    stored(r.category) ??
    (r.targetType === "post"
      ? "shortform"
      : r.targetType === "store"
        ? "app"
        : "web")
  )
}

/** backlog: store and the app task kinds (bug, feature, ux) → app, else web. */
export function backlogCategory(r: {
  category?: string | null
  kind: string
}): Category {
  return (
    stored(r.category) ??
    (["store", "bug", "feature", "ux"].includes(r.kind) ? "app" : "web")
  )
}

/** approvals: hook|format or a shortform ref/account → shortform, store_text|reply|task → app, else web. */
export function approvalCategory(r: {
  category?: string | null
  kind: string
  accountId?: string | null
  refType?: string | null
}): Category {
  const c = stored(r.category)
  if (c) return c
  if (["store_text", "reply", "task"].includes(r.kind)) return "app"
  if (
    ["hook", "format"].includes(r.kind) ||
    r.accountId ||
    ["plan_entry", "hook", "format"].includes(r.refType ?? "")
  )
    return "shortform"
  return "web"
}

/** changes: shorts → shortform, store|reply → app, else web. */
export function changeCategory(r: {
  category?: string | null
  kind: string
}): Category {
  return (
    stored(r.category) ??
    (r.kind === "shorts"
      ? "shortform"
      : ["store", "reply"].includes(r.kind)
        ? "app"
        : "web")
  )
}

/** content: store_text → app, else web. */
export function contentCategory(r: {
  category?: string | null
  kind: string
}): Category {
  return stored(r.category) ?? (r.kind === "store_text" ? "app" : "web")
}

/** Rows with their effective category, optionally filtered. */
export function withCategory<T>(
  rows: T[],
  derive: (r: T) => Category,
  filter?: Set<string>
): (T & { category: Category })[] {
  const out = rows.map((r) => ({ ...r, category: derive(r) }))
  return filter ? out.filter((r) => filter.has(r.category)) : out
}

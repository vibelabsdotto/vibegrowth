"use server"

import { revalidatePath } from "next/cache"
import { ApiError, apiFetch } from "@/lib/api"
import type {
  Approval,
  ApprovalEffect,
  BacklogDetail,
  BacklogItem,
  Change,
  ContentDetail,
  ContentItem,
  MentionTarget,
  Strategy,
} from "@/lib/growth-types"

/** Same shape as app/actions.ts. Every call goes to apps/api with X-Actor: max. */
export type GrowthResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; code?: string }

async function call<T>(
  path: string,
  method: string,
  body?: unknown,
  revalidate = true
): Promise<GrowthResult<T>> {
  try {
    const data = await apiFetch<T>(path, { method, body })
    if (revalidate) revalidatePath("/", "layout")
    return { ok: true, data }
  } catch (e) {
    if (e instanceof ApiError)
      return { ok: false, error: e.message, code: e.code }
    const refused =
      (e as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED"
    return {
      ok: false,
      error: refused
        ? "API nicht erreichbar"
        : e instanceof Error
          ? e.message
          : String(e),
    }
  }
}

type Values = Record<string, unknown>

/** Form value → trimmed string, null for empty, undefined when absent. */
const s = (v: unknown) => {
  if (v === undefined) return undefined
  if (v === null) return null
  const t = String(v).trim()
  return t === "" ? null : t
}
const n = (v: unknown) =>
  v === undefined || v === null || v === "" ? undefined : Number(v)

function compact(o: Values) {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined)
  )
}

// ---------- approvals ----------

export type Decision = "approved" | "rejected" | "changes_requested"

/**
 * `text` only for kind reply with approved: replaces payload.text (original stays in history).
 * `noReply` only for kind reply with rejected: marks the inbox item as "keine Antwort nötig".
 */
export async function decideApproval(
  id: number,
  decision: Decision,
  note?: string,
  text?: string,
  noReply?: boolean
) {
  return call<Approval & { effects?: ApprovalEffect[] }>(
    `/approvals/${id}/decide`,
    "POST",
    {
      decision,
      note: note?.trim() ? note.trim() : undefined,
      text: text?.trim() ? text.trim() : undefined,
      noReply: noReply ? true : undefined,
    }
  )
}

/** Confirmed, not yet carried out reply/other back to pending: Max can change and confirm again. */
export async function reopenApproval(id: number) {
  return call<Approval>(`/approvals/${id}/reopen`, "POST", {})
}

// ---------- app inbox ----------

export type InboxTarget = { project: string; target: string; itemId: string }

/** Own reply by Max: an approved reply approval, posted by the next app publish run. */
export async function replyToInboxItem(item: InboxTarget, text: string) {
  return call<Approval & { effects?: ApprovalEffect[] }>(
    "/app/inbox/reply",
    "POST",
    { ...item, text: text.trim() }
  )
}

/** "Keine Antwort nötig" until the user writes again. */
export async function markInboxNoReply(item: InboxTarget) {
  return call<{ state: string; effects?: ApprovalEffect[] }>(
    "/app/inbox/no-reply",
    "POST",
    item
  )
}

// ---------- collectors ----------

export async function setCollector(
  project: string,
  collector: string,
  patch: { enabled?: boolean; config?: Record<string, unknown> }
) {
  return call(
    `/collectors/${encodeURIComponent(project)}/${encodeURIComponent(collector)}`,
    "PUT",
    patch
  )
}

export type CollectResult = {
  runs: {
    project: string
    collector: string
    ok: boolean
    summary: string | null
    stats?: unknown
    error: string | null
  }[]
  errors: unknown[]
}

export async function collectNow(project: string, collector: string) {
  return call<CollectResult>("/collect", "POST", { project, collector })
}

// ---------- content ----------

function contentFields(v: Values) {
  return compact({
    title: s(v.title) ?? undefined,
    kind: s(v.kind) ?? undefined,
    status: s(v.status) ?? undefined,
    keyword: s(v.keyword),
    intent: s(v.intent),
    brief: s(v.brief),
    urlPath: s(v.urlPath),
    liveDate: s(v.liveDate),
    plannedDate: s(v.plannedDate),
    draftPath: s(v.draftPath),
    notes: s(v.notes),
  })
}

export async function createContent(v: Values) {
  return call<ContentItem>("/content", "POST", {
    projectId: s(v.project),
    ...contentFields(v),
  })
}

export async function updateContent(id: number, v: Values) {
  return call<ContentItem>(`/content/${id}`, "PATCH", contentFields(v))
}

export async function getContent(id: number) {
  return call<ContentDetail>(`/content/${id}`, "GET", undefined, false)
}

// ---------- backlog ----------

function backlogFields(v: Values) {
  return compact({
    title: s(v.title) ?? undefined,
    detail: s(v.detail),
    kind: s(v.kind) ?? undefined,
    status: s(v.status) ?? undefined,
    impact: n(v.impact),
    effort: n(v.effort),
    source: s(v.source),
    doneRef: s(v.doneRef),
    category: s(v.category) ?? undefined,
    notionUrl: s(v.notionUrl),
    // "none" in the select = nobody assigned
    assignee:
      v.assignee === undefined
        ? undefined
        : s(v.assignee) === "none"
          ? null
          : s(v.assignee),
  })
}

export async function createBacklog(v: Values) {
  return call<BacklogItem>("/backlog", "POST", {
    projectId: s(v.project),
    ...backlogFields(v),
  })
}

/** "Aufgabe erstellen" from an inbox item: app task linked to the feature request or review. */
export async function createInboxTask(
  source: { projectId: string; type: "feature_request" | "review"; id: string },
  v: Values
) {
  return call<BacklogItem>("/backlog", "POST", {
    projectId: source.projectId,
    ...backlogFields(v),
    category: "app",
    source: "max",
    sources: [{ type: source.type, id: source.id }],
  })
}

export async function updateBacklog(id: number, v: Values) {
  return call<BacklogItem>(`/backlog/${id}`, "PATCH", backlogFields(v))
}

/** Task with its thread, for the task sheet (read only, no revalidation). */
export async function loadTask(id: number) {
  return call<BacklogDetail>(`/backlog/${id}`, "GET", undefined, false)
}

export async function commentTask(id: number, body: string) {
  return call<BacklogDetail>(`/backlog/${id}/comments`, "POST", { body })
}

/** "Passt" */
export async function acceptTask(id: number, body?: string) {
  return call<BacklogDetail>(`/backlog/${id}/accept`, "POST", {
    body: body?.trim() || null,
  })
}

/** "Klappt nicht" with the reason */
export async function reopenTask(id: number, body: string) {
  return call<BacklogDetail>(`/backlog/${id}/reopen`, "POST", { body })
}

// ---------- changes, experiments ----------

export async function addChange(v: Values) {
  return call<Change>(
    "/changes",
    "POST",
    compact({
      projectId: s(v.project),
      kind: s(v.kind) ?? "other",
      summary: s(v.summary),
      ref: s(v.ref),
      date: s(v.date) ?? undefined,
      experimentId: n(v.experimentId),
    })
  )
}

export async function updateExperimentStatus(id: number, status: string) {
  return call(`/experiments/${id}`, "PATCH", { status })
}

// ---------- strategies ----------

/** Skills as a comma or line separated list. */
const skillList = (v: unknown) =>
  v === undefined
    ? undefined
    : String(v ?? "")
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean)

function strategyFields(v: Values) {
  return compact({
    name: s(v.name) ?? undefined,
    category: s(v.category) ?? undefined,
    status: s(v.status) ?? undefined,
    summary: s(v.summary),
    guide: s(v.guide),
    source: s(v.source),
    skills: skillList(v.skills),
  })
}

/** projectId "" = für alle Projekte (null). */
export async function createStrategy(v: Values) {
  return call<Strategy>("/strategies", "POST", {
    ...strategyFields(v),
    projectId: s(v.project) ?? undefined,
  })
}

export async function updateStrategy(id: string, v: Values) {
  return call<Strategy>(
    `/strategies/${encodeURIComponent(id)}`,
    "PATCH",
    compact({
      ...strategyFields(v),
      projectId: v.project === undefined ? undefined : s(v.project),
    })
  )
}

export async function setStrategyStatus(id: string, status: string) {
  return call<Strategy>(`/strategies/${encodeURIComponent(id)}`, "PATCH", {
    status,
  })
}

// ---------- knowledge ----------

/** category null = wieder ableiten. */
export async function setKnowledgeCategory(
  type: "learning" | "decision",
  id: number,
  category: string | null
) {
  return call(`/knowledge/${type}/${id}`, "PATCH", { category })
}

// ---------- geo ----------

export async function updateMention(id: number, v: Values) {
  return call<MentionTarget>(
    `/mentions/${id}`,
    "PATCH",
    compact({
      status: s(v.status) ?? undefined,
      contact: s(v.contact),
      notes: s(v.notes),
    })
  )
}

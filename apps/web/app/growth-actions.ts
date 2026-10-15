"use server"

import { revalidatePath } from "next/cache"
import { ApiError, apiFetch } from "@/lib/api"
import type {
  Approval,
  BacklogItem,
  Change,
  ContentDetail,
  ContentItem,
  MentionTarget,
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

export async function decideApproval(
  id: number,
  decision: Decision,
  note?: string
) {
  return call<Approval>(`/approvals/${id}/decide`, "POST", {
    decision,
    note: note?.trim() ? note.trim() : undefined,
  })
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
  })
}

export async function createBacklog(v: Values) {
  return call<BacklogItem>("/backlog", "POST", {
    projectId: s(v.project),
    ...backlogFields(v),
  })
}

export async function updateBacklog(id: number, v: Values) {
  return call<BacklogItem>(`/backlog/${id}`, "PATCH", backlogFields(v))
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

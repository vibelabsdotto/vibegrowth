"use server"

import { revalidatePath } from "next/cache"
import { ApiError, apiFetch } from "@/lib/api"
import type { CharacterRow, PlanEntryFull } from "@/lib/types"

export type ActionResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; code?: string }

class InputError extends Error {
  code = "INVALID"
}

/** Run API calls for one action; errors become {ok:false} with the API's message and code. */
async function act<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn()
    revalidatePath("/", "layout")
    return { ok: true, data: (data ?? null) as T }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code:
        e instanceof ApiError || e instanceof InputError ? e.code : undefined,
    }
  }
}

const api = <T = unknown>(
  method: string,
  path: string,
  body?: Record<string, unknown>
) =>
  apiFetch<T>(path, {
    method,
    body: body ?? (method === "GET" ? undefined : {}),
  })

const s = (v: unknown) => {
  if (v === undefined) return undefined
  if (v === null) return null
  const t = String(v).trim()
  return t === "" ? null : t
}
const n = (v: unknown) =>
  v === undefined || v === null || v === "" ? undefined : Number(v)
const tags = (v: unknown) =>
  typeof v === "string"
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined

const lines = (v: unknown) =>
  typeof v === "string"
    ? v
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined
function params(v: unknown) {
  const raw = s(v)
  if (raw === undefined) return undefined
  if (raw === null) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new InputError("Renderer-Parameter sind kein gültiges JSON")
  }
}

type Values = Record<string, unknown>

/** Version fields of the format forms. Empty skills/examples clear the list. */
function formatVersionValues(v: Values) {
  return {
    description: s(v.description),
    guide: s(v.guide),
    rendererParams: params(v.rendererParams),
    skills: tags(v.skills),
    examples: lines(v.examples),
  }
}

const enc = encodeURIComponent

// ---------- plan ----------

export async function createEntry(v: Values) {
  return act(() =>
    api("POST", "/plan", {
      accountId: String(v.accountId),
      date: s(v.date),
      formatId: s(v.formatId),
      topic: String(v.topic ?? ""),
      angle: s(v.angle),
      hookDirection: s(v.hookDirection),
      hook: s(v.hook),
      rationale: s(v.rationale),
      status: s(v.status) ?? undefined,
      locked: v.locked === true,
      inspirationId: n(v.inspirationId) ?? null,
      comment: s(v.comment),
    })
  )
}

export async function saveEntry(id: number, v: Values) {
  return act(async () => {
    const before = await api<PlanEntryFull>("GET", `/plan/${id}`)
    const row = await api("PATCH", `/plan/${id}`, {
      date: s(v.date),
      formatId: s(v.formatId),
      topic: s(v.topic) ?? undefined,
      angle: s(v.angle),
      hookDirection: s(v.hookDirection),
      hook: s(v.hook),
      rationale: s(v.rationale),
      status: s(v.status) ?? undefined,
      inspirationId:
        v.inspirationId === undefined
          ? undefined
          : (n(v.inspirationId) ?? null),
      comment: s(v.comment),
    })
    if (typeof v.locked === "boolean" && v.locked !== before.locked)
      return api("POST", `/plan/${id}/lock`, { locked: v.locked })
    return row
  })
}

export async function moveEntry(id: number, date: string) {
  return act(() => api("POST", `/plan/${id}/move`, { date }))
}

export async function toggleLock(id: number, locked: boolean) {
  return act(() => api("POST", `/plan/${id}/lock`, { locked }))
}

export async function skipEntry(id: number, reason?: string) {
  return act(() => api("POST", `/plan/${id}/skip`, { reason }))
}

export async function deleteEntry(id: number) {
  return act(() => api("DELETE", `/plan/${id}`))
}

// ---------- posts ----------

export async function markPostPosted(id: number, v: Values) {
  return act(() =>
    api("POST", `/posts/${id}/posted`, {
      tiktokId: s(v.tiktokId),
      url: s(v.url),
      postedAt: s(v.postedAt),
    })
  )
}

export async function savePost(id: number, v: Values) {
  return act(() =>
    api("PATCH", `/posts/${id}`, {
      hook: s(v.hook),
      angle: s(v.angle),
      notes: s(v.notes),
    })
  )
}

export async function rescanPost(accountId: string, dir: string) {
  return act(() => api("POST", "/posts/register", { accountId, dir }))
}

export async function openFolder(
  kind: "post" | "account" | "inspo",
  id: string
) {
  try {
    return {
      ok: true as const,
      data: await api<{ opened: string }>("POST", "/open", { kind, id }),
    }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ---------- accounts & characters ----------

export async function createAccount(v: Values) {
  return act(async () => {
    let characterId: string | null = s(v.characterId) ?? null
    if (v.newCharacter === true && s(v.characterName)) {
      const ch = await api<CharacterRow>("POST", "/characters", {
        name: String(v.characterName),
        brandId: String(v.brandId),
        persona: s(v.persona),
        voice: s(v.voice),
        look: s(v.look),
      })
      characterId = ch.id
    }
    return api("POST", "/accounts", {
      id: s(v.id) ?? undefined,
      brandId: String(v.brandId),
      name: String(v.name ?? ""),
      handle: s(v.handle),
      language: s(v.language),
      status: s(v.status) ?? "planned",
      defaultFormatId: s(v.formatId),
      mode: s(v.mode),
      ctaRule: s(v.ctaRule) ?? "engagement",
      postsPerDay: n(v.postsPerDay) ?? 1,
      characterId,
    })
  })
}

export async function saveAccount(id: string, v: Values) {
  return act(() =>
    api("PATCH", `/accounts/${enc(id)}`, {
      // Format switch = pivot with reason (setActiveFormat), then the other fields.
      ...(v.formatId !== undefined
        ? { defaultFormatId: s(v.formatId) ?? null, reason: s(v.formatReason) }
        : {}),
      name: s(v.name) ?? undefined,
      handle: s(v.handle),
      language: s(v.language),
      status: s(v.status) ?? undefined,
      mode: s(v.mode),
      ctaRule: s(v.ctaRule) ?? undefined,
      postsPerDay: n(v.postsPerDay),
      characterId: v.characterId === undefined ? undefined : s(v.characterId),
      notes: s(v.notes),
    })
  )
}

export async function saveCharacter(id: string, v: Values) {
  return act(() =>
    api("PATCH", `/characters/${enc(id)}`, {
      name: s(v.name) ?? undefined,
      persona: s(v.persona),
      voice: s(v.voice),
      look: s(v.look),
      dos: s(v.dos),
      donts: s(v.donts),
    })
  )
}

// ---------- formats, rules, image errors ----------

export async function createFormat(v: Values) {
  return act(async () =>
    api("POST", "/formats", {
      id: s(v.id) ?? undefined,
      name: String(v.name ?? ""),
      brandId: s(v.brandId),
      ...formatVersionValues(v),
    })
  )
}

export async function newFormatVersion(id: string, v: Values) {
  return act(async () =>
    api("POST", `/formats/${enc(id)}/versions`, {
      changeNote: String(v.changeNote ?? ""),
      carryRules: v.carryRules !== false,
      ...formatVersionValues(v),
    })
  )
}

/** Correct the current version in place: no new version, no pivot. */
export async function correctFormat(id: string, v: Values) {
  return act(async () =>
    api("PATCH", `/formats/${enc(id)}`, {
      name: s(v.name) ?? undefined,
      ...formatVersionValues(v),
    })
  )
}

export async function createRule(v: Values) {
  return act(() =>
    api("POST", "/rules", {
      scopeType: String(v.scopeType),
      scopeId: String(v.scopeId),
      kind: s(v.kind) ?? "other",
      text: String(v.text ?? ""),
      source: s(v.source) ?? "Max in VibeGrowth",
    })
  )
}

export async function replaceRule(id: number, v: Values) {
  return act(() =>
    api("POST", `/rules/${id}/replace`, {
      text: String(v.text ?? ""),
      source: s(v.source) ?? "Max in VibeGrowth",
      kind: s(v.kind) ?? undefined,
    })
  )
}

export async function retireRule(id: number) {
  return act(() => api("POST", `/rules/${id}/retire`))
}

export async function createImageError(v: Values) {
  return act(() =>
    api("POST", "/image-errors", {
      title: String(v.title ?? ""),
      countermeasure: String(v.countermeasure ?? ""),
      detection: s(v.detection),
      formatIds: tags(v.formatIds),
      source: s(v.source) ?? "Max in VibeGrowth",
    })
  )
}

export async function setImageErrorStatus(
  id: number,
  status: "active" | "resolved"
) {
  return act(() => api("PATCH", `/image-errors/${id}`, { status }))
}

// ---------- knowledge ----------

function scope(v: Values) {
  const scopeType = s(v.scopeType) ?? "global"
  return { scopeType, scopeId: scopeType === "global" ? null : s(v.scopeId) }
}

export async function createLearning(v: Values) {
  return act(() =>
    api("POST", "/learnings", {
      ...scope(v),
      statement: String(v.statement ?? ""),
      evidence: String(v.evidence ?? ""),
      date: s(v.date) ?? undefined,
      source: s(v.source),
    })
  )
}

export async function setLearningStatus(
  id: number,
  status: "active" | "outdated"
) {
  return act(() => api("POST", `/learnings/${id}/status`, { status }))
}

export async function createDecision(v: Values) {
  return act(() =>
    api("POST", "/decisions", {
      ...scope(v),
      title: String(v.title ?? ""),
      rationale: String(v.rationale ?? ""),
      kind: v.pivot === true ? "pivot" : "decision",
      date: s(v.date) ?? undefined,
      supersedesId: n(v.supersedesId) ?? null,
      source: s(v.source),
    })
  )
}

export async function createHook(v: Values) {
  return act(() =>
    api("POST", "/hooks", {
      accountId: String(v.accountId),
      text: String(v.text ?? ""),
      mechanism: s(v.mechanism),
      winner: v.winner === true,
    })
  )
}

export async function setHookWinner(id: number, winner: boolean) {
  return act(() => api("POST", `/hooks/${id}/winner`, { winner }))
}

export async function createHookVariant(parentId: number, v: Values) {
  return act(() =>
    api("POST", `/hooks/${parentId}/variants`, {
      text: String(v.text ?? ""),
      mechanism: s(v.mechanism),
    })
  )
}

export async function createInspiration(v: Values) {
  return act(() =>
    api("POST", "/inspo", {
      url: String(v.url ?? "").trim(),
      type: s(v.type) ?? "format",
      note: s(v.note),
      tags: tags(v.tags),
      accountId: s(v.accountId),
      brandId: s(v.brandId),
    })
  )
}

export async function saveInspiration(id: number, v: Values) {
  return act(() =>
    api("PATCH", `/inspo/${id}`, {
      status: s(v.status) ?? undefined,
      type: s(v.type) ?? undefined,
      note: s(v.note),
      tags: tags(v.tags),
      accountId: s(v.accountId) ?? undefined,
    })
  )
}

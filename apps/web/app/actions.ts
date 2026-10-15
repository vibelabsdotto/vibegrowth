"use server"

import { revalidatePath } from "next/cache"
import * as cat from "@/core/catalog"
import { tx } from "@/core/db"
import { folderFor, openPath } from "@/core/files"
import * as know from "@/core/knowledge"
import * as plan from "@/core/plan"
import { markPosted, registerPost, updatePost } from "@/core/posts"
import { VSError } from "@/core/util"
import { ctx, WEB_ACTOR } from "@/lib/server"

export type ActionResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; code?: string }

function act<T>(fn: () => T): ActionResult<T> {
  try {
    const c = ctx()
    const data = tx(c, fn)
    revalidatePath("/", "layout")
    return { ok: true, data: JSON.parse(JSON.stringify(data ?? null)) as T }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code: e instanceof VSError ? e.code : undefined,
    }
  }
}

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
    throw new VSError("INVALID", "Renderer-Parameter sind kein gültiges JSON")
  }
}

type Values = Record<string, unknown>

/** Version fields of the format forms. Empty skills/examples clear the list. */
function formatVersionValues(v: Values): cat.FormatVersionInput {
  return {
    description: s(v.description),
    guide: s(v.guide),
    rendererParams: params(v.rendererParams),
    skills: tags(v.skills),
    examples: lines(v.examples),
  }
}

// ---------- plan ----------

export async function createEntry(v: Values) {
  return act(() =>
    plan.addEntry(
      ctx(),
      {
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
      },
      WEB_ACTOR
    )
  )
}

export async function saveEntry(id: number, v: Values) {
  return act(() => {
    const c = ctx()
    const before = plan.getEntry(c, id)
    const row = plan.updateEntry(
      c,
      id,
      {
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
      },
      WEB_ACTOR
    )
    if (typeof v.locked === "boolean" && v.locked !== before.locked)
      return plan.lockEntry(c, id, v.locked, WEB_ACTOR)
    return row
  })
}

export async function moveEntry(id: number, date: string) {
  return act(() => plan.moveEntry(ctx(), id, date, WEB_ACTOR))
}

export async function toggleLock(id: number, locked: boolean) {
  return act(() => plan.lockEntry(ctx(), id, locked, WEB_ACTOR))
}

export async function skipEntry(id: number, reason?: string) {
  return act(() => plan.skipEntry(ctx(), id, reason, WEB_ACTOR))
}

export async function deleteEntry(id: number) {
  return act(() => plan.deleteEntry(ctx(), id, WEB_ACTOR))
}

// ---------- posts ----------

export async function markPostPosted(id: number, v: Values) {
  return act(() =>
    markPosted(
      ctx(),
      id,
      { tiktokId: s(v.tiktokId), url: s(v.url), postedAt: s(v.postedAt) },
      WEB_ACTOR
    )
  )
}

export async function savePost(id: number, v: Values) {
  return act(() =>
    updatePost(
      ctx(),
      id,
      { hook: s(v.hook), angle: s(v.angle), notes: s(v.notes) },
      WEB_ACTOR
    )
  )
}

export async function rescanPost(accountId: string, dir: string) {
  return act(() => registerPost(ctx(), { accountId, dir }, WEB_ACTOR))
}

export async function openFolder(
  kind: "post" | "account" | "inspo",
  id: string
) {
  try {
    const c = ctx()
    return { ok: true as const, data: openPath(c, folderFor(c, kind, id)) }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ---------- accounts & characters ----------

export async function createAccount(v: Values) {
  return act(() => {
    const c = ctx()
    let characterId: string | null = s(v.characterId) ?? null
    if (v.newCharacter === true && s(v.characterName)) {
      characterId = cat.createCharacter(
        c,
        {
          name: String(v.characterName),
          brandId: String(v.brandId),
          persona: s(v.persona),
          voice: s(v.voice),
          look: s(v.look),
        },
        WEB_ACTOR
      ).id
    }
    return cat.createAccount(
      c,
      {
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
      },
      WEB_ACTOR
    )
  })
}

export async function saveAccount(id: string, v: Values) {
  return act(() => {
    const c = ctx()
    if (v.formatId !== undefined)
      know.setActiveFormat(
        c,
        id,
        s(v.formatId) ?? null,
        s(v.formatReason),
        WEB_ACTOR
      )
    return cat.updateAccount(
      c,
      id,
      {
        name: s(v.name) ?? undefined,
        handle: s(v.handle),
        language: s(v.language),
        status: s(v.status) ?? undefined,
        mode: s(v.mode),
        ctaRule: s(v.ctaRule) ?? undefined,
        postsPerDay: n(v.postsPerDay),
        characterId: v.characterId === undefined ? undefined : s(v.characterId),
        notes: s(v.notes),
      },
      WEB_ACTOR
    )
  })
}

export async function saveCharacter(id: string, v: Values) {
  return act(() =>
    cat.updateCharacter(
      ctx(),
      id,
      {
        name: s(v.name) ?? undefined,
        persona: s(v.persona),
        voice: s(v.voice),
        look: s(v.look),
        dos: s(v.dos),
        donts: s(v.donts),
      },
      WEB_ACTOR
    )
  )
}

// ---------- formats, rules, image errors ----------

export async function createFormat(v: Values) {
  return act(() =>
    cat.createFormat(
      ctx(),
      {
        id: s(v.id) ?? undefined,
        name: String(v.name ?? ""),
        brandId: s(v.brandId),
        ...formatVersionValues(v),
      },
      WEB_ACTOR
    )
  )
}

export async function newFormatVersion(id: string, v: Values) {
  return act(() =>
    cat.newFormatVersion(
      ctx(),
      id,
      {
        changeNote: String(v.changeNote ?? ""),
        carryRules: v.carryRules !== false,
        ...formatVersionValues(v),
      },
      WEB_ACTOR
    )
  )
}

/** Correct the current version in place: no new version, no pivot. */
export async function correctFormat(id: string, v: Values) {
  return act(() =>
    cat.updateFormat(
      ctx(),
      id,
      { name: s(v.name) ?? undefined, ...formatVersionValues(v) },
      WEB_ACTOR
    )
  )
}

export async function createRule(v: Values) {
  return act(() =>
    cat.addRule(
      ctx(),
      {
        scopeType: String(v.scopeType),
        scopeId: String(v.scopeId),
        kind: s(v.kind) ?? "other",
        text: String(v.text ?? ""),
        source: s(v.source) ?? "Max in VibeGrowth",
      },
      WEB_ACTOR
    )
  )
}

export async function replaceRule(id: number, v: Values) {
  return act(() =>
    cat.replaceRule(
      ctx(),
      id,
      {
        text: String(v.text ?? ""),
        source: s(v.source) ?? "Max in VibeGrowth",
        kind: s(v.kind) ?? undefined,
      },
      WEB_ACTOR
    )
  )
}

export async function retireRule(id: number) {
  return act(() => cat.retireRule(ctx(), id, WEB_ACTOR))
}

export async function createImageError(v: Values) {
  return act(() =>
    cat.addImageError(
      ctx(),
      {
        title: String(v.title ?? ""),
        countermeasure: String(v.countermeasure ?? ""),
        detection: s(v.detection),
        formatIds: tags(v.formatIds),
        source: s(v.source) ?? "Max in VibeGrowth",
      },
      WEB_ACTOR
    )
  )
}

export async function setImageErrorStatus(
  id: number,
  status: "active" | "resolved"
) {
  return act(() => cat.updateImageError(ctx(), id, { status }, WEB_ACTOR))
}

// ---------- knowledge ----------

function scope(v: Values) {
  const scopeType = s(v.scopeType) ?? "global"
  return { scopeType, scopeId: scopeType === "global" ? null : s(v.scopeId) }
}

export async function createLearning(v: Values) {
  return act(() =>
    know.addLearning(
      ctx(),
      {
        ...scope(v),
        statement: String(v.statement ?? ""),
        evidence: String(v.evidence ?? ""),
        date: s(v.date) ?? undefined,
        source: s(v.source),
      },
      WEB_ACTOR
    )
  )
}

export async function setLearningStatus(
  id: number,
  status: "active" | "outdated"
) {
  return act(() => know.setLearningStatus(ctx(), id, status, WEB_ACTOR))
}

export async function createDecision(v: Values) {
  return act(() =>
    know.addDecision(
      ctx(),
      {
        ...scope(v),
        title: String(v.title ?? ""),
        rationale: String(v.rationale ?? ""),
        kind: v.pivot === true ? "pivot" : "decision",
        date: s(v.date) ?? undefined,
        supersedesId: n(v.supersedesId) ?? null,
        source: s(v.source),
      },
      WEB_ACTOR
    )
  )
}

export async function createHook(v: Values) {
  return act(() =>
    know.addHook(
      ctx(),
      {
        accountId: String(v.accountId),
        text: String(v.text ?? ""),
        mechanism: s(v.mechanism),
        winner: v.winner === true,
      },
      WEB_ACTOR
    )
  )
}

export async function setHookWinner(id: number, winner: boolean) {
  return act(() => know.setHookWinner(ctx(), id, winner, WEB_ACTOR))
}

export async function createHookVariant(parentId: number, v: Values) {
  return act(() =>
    know.addHookVariant(
      ctx(),
      parentId,
      String(v.text ?? ""),
      WEB_ACTOR,
      s(v.mechanism)
    )
  )
}

export async function createInspiration(v: Values) {
  return act(() =>
    know.addInspiration(
      ctx(),
      {
        url: String(v.url ?? "").trim(),
        type: s(v.type) ?? "format",
        note: s(v.note),
        tags: tags(v.tags),
        accountId: s(v.accountId),
        brandId: s(v.brandId),
      },
      WEB_ACTOR
    )
  )
}

export async function saveInspiration(id: number, v: Values) {
  return act(() =>
    know.updateInspiration(
      ctx(),
      id,
      {
        status: s(v.status) ?? undefined,
        type: s(v.type) ?? undefined,
        note: s(v.note),
        tags: tags(v.tags),
        accountId: s(v.accountId) ?? undefined,
      },
      WEB_ACTOR
    )
  )
}

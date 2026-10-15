import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { and, desc, eq, like } from "drizzle-orm"
import { resolveInDataDir, toolConfig } from "./config"
import { appRoot, tx, type Ctx } from "./db"
import { accounts, metricSnapshots, posts, settings } from "./schema"
import {
  getById,
  json,
  nowIso,
  parseJson,
  patchRow,
  recordHistory,
  VSError,
} from "./util"

export type Snapshot = typeof metricSnapshots.$inferSelect

export const WINNER_FACTOR = 2
const FRESH_MIN = 60

export interface RawSnapshot {
  id: string
  url?: string | null
  created_at?: string | null
  pulled_at: string
  age_h: number
  plays?: number
  likes?: number
  saves?: number
  comments?: number
  shares?: number
  reposts?: number
  slides?: number | null
  desc?: string | null
  /** post folder name under <account>/posts */
  post_dir?: string | null
  match_dist?: number | null
}

interface MatchCache {
  post: string | null
  dist: number | null
  checked: number
}

function matchKey(accountId: string, tiktokId: string) {
  return `tiktok_match:${accountId}:${tiktokId}`
}

export function readMatches(
  ctx: Ctx,
  accountId: string
): Record<string, MatchCache> {
  const prefix = `tiktok_match:${accountId}:`
  const rows = ctx.db
    .select()
    .from(settings)
    .where(like(settings.key, `${prefix}%`))
    .all()
  return Object.fromEntries(
    rows.map((r) => [
      r.key.slice(prefix.length),
      parseJson<MatchCache>(r.value, { post: null, dist: null, checked: 0 }),
    ])
  )
}

export function writeMatch(
  ctx: Ctx,
  accountId: string,
  tiktokId: string,
  m: MatchCache
) {
  ctx.db
    .insert(settings)
    .values({ key: matchKey(accountId, tiktokId), value: json(m) })
    .onConflictDoUpdate({ target: settings.key, set: { value: json(m) } })
    .run()
}

/**
 * Store snapshots (idempotent on tiktok id + pull time) and link them to posts.
 * A matched post gets its TikTok id, URL and live date and becomes "posted".
 */
export function ingestSnapshots(
  ctx: Ctx,
  accountId: string,
  recs: RawSnapshot[],
  actor: string
) {
  const account = getById(ctx, accounts, accountId, "Account")
  let inserted = 0
  let linked = 0
  for (const r of recs) {
    let post =
      ctx.db.select().from(posts).where(eq(posts.tiktokId, r.id)).get() ??
      (r.post_dir
        ? ctx.db
            .select()
            .from(posts)
            .where(eq(posts.dir, `${account.dir}/posts/${r.post_dir}`))
            .get()
        : undefined)
    if (post && !post.tiktokId) {
      const clash = ctx.db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.tiktokId, r.id))
        .get()
      if (!clash) {
        post = patchRow(
          ctx,
          posts,
          "post",
          post.id,
          {
            tiktokId: r.id,
            tiktokUrl: r.url ?? null,
            postedAt: post.postedAt ?? r.created_at ?? null,
            status: "posted",
          },
          actor,
          "posted"
        )
        linked++
      }
    }
    const res = ctx.db
      .insert(metricSnapshots)
      .values({
        accountId,
        postId: post?.id ?? null,
        tiktokId: r.id,
        url: r.url ?? null,
        liveSince: r.created_at ?? null,
        pulledAt: r.pulled_at,
        ageH: r.age_h,
        plays: r.plays ?? 0,
        likes: r.likes ?? 0,
        saves: r.saves ?? 0,
        comments: r.comments ?? 0,
        shares: r.shares ?? 0,
        reposts: r.reposts ?? 0,
        slides: r.slides ?? null,
        description: r.desc ?? null,
        matchDist: r.match_dist ?? null,
      })
      .onConflictDoNothing()
      .run()
    inserted += res.changes
    if (post) {
      ctx.db
        .update(metricSnapshots)
        .set({ postId: post.id })
        .where(eq(metricSnapshots.tiktokId, r.id))
        .run()
    }
  }
  return { inserted, linked }
}

/** Plays at ~hours, same tolerance as the original script: max(12 h, 25 %). */
export function playsAt(
  snaps: Pick<Snapshot, "ageH" | "plays">[],
  hours: number
) {
  let best: { d: number; plays: number } | null = null
  for (const s of snaps) {
    const d = Math.abs(s.ageH - hours)
    if (d <= Math.max(12, hours * 0.25) && (!best || d < best.d))
      best = { d, plays: s.plays }
  }
  return best?.plays ?? null
}

function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface PostStats {
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

/** Per TikTok post: latest values, 24 h/48 h/7 d plays, account median and winners (>= 48 h and >= 2x median). */
export function accountStats(ctx: Ctx, accountId: string) {
  const snaps = ctx.db
    .select()
    .from(metricSnapshots)
    .where(eq(metricSnapshots.accountId, accountId))
    .all()
  const byId = new Map<string, Snapshot[]>()
  for (const s of snaps)
    byId.set(s.tiktokId, [...(byId.get(s.tiktokId) ?? []), s])
  const latest = [...byId.values()]
    .map((list) => list.reduce((a, b) => (a.pulledAt >= b.pulledAt ? a : b)))
    .sort((a, b) => (b.liveSince ?? "").localeCompare(a.liveSince ?? ""))
  const recent = latest
    .slice(0, 10)
    .filter((s) => s.ageH >= 24)
    .map((s) => s.plays)
  const med = median(recent)
  const stats: PostStats[] = latest.map((s) => {
    const hist = byId.get(s.tiktokId)!
    return {
      tiktokId: s.tiktokId,
      url: s.url,
      liveSince: s.liveSince,
      postId: hist.find((h) => h.postId)?.postId ?? null,
      latest: s,
      plays24: playsAt(hist, 24),
      plays48: playsAt(hist, 48),
      plays7d: playsAt(hist, 168),
      likeRate: s.plays ? s.likes / s.plays : null,
      saveRate: s.plays ? s.saves / s.plays : null,
      winner:
        !!med &&
        s.ageH >= 48 &&
        s.plays >= WINNER_FACTOR * med &&
        recent.length >= 3,
      snapshots: hist.length,
    }
  })
  const lastPull = snaps.reduce<string | null>(
    (a, s) => (!a || s.pulledAt > a ? s.pulledAt : a),
    null
  )
  return {
    accountId,
    median: med,
    winnerThreshold: med ? med * WINNER_FACTOR : null,
    lastPull,
    posts: stats,
  }
}

export function postStats(ctx: Ctx, postId: number) {
  const post = getById(ctx, posts, postId, "Post")
  const all = accountStats(ctx, post.accountId)
  const s =
    all.posts.find(
      (p) =>
        p.postId === postId || (post.tiktokId && p.tiktokId === post.tiktokId)
    ) ?? null
  const history = ctx.db
    .select()
    .from(metricSnapshots)
    .where(eq(metricSnapshots.postId, postId))
    .orderBy(desc(metricSnapshots.pulledAt))
    .all()
  return { median: all.median, stats: s, history }
}

// ---------- pull ----------

const LOCK_TTL_MS = 10 * 60 * 1000

function acquirePullLock(ctx: Ctx, accountId: string, owner: string) {
  const key = `pull_lock:${accountId}`
  return tx(ctx, () => {
    const row = ctx.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get()
    const held = row
      ? parseJson<{ owner: string; at: number }>(row.value, {
          owner: "",
          at: 0,
        })
      : null
    if (held && Date.now() - held.at < LOCK_TTL_MS && held.owner !== owner)
      return false
    const value = json({ owner, at: Date.now() })
    ctx.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
    return true
  })
}

function releasePullLock(ctx: Ctx, accountId: string) {
  ctx.db
    .delete(settings)
    .where(eq(settings.key, `pull_lock:${accountId}`))
    .run()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function lastPullAt(ctx: Ctx, accountId: string) {
  return (
    ctx.db
      .select({ at: metricSnapshots.pulledAt })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.accountId, accountId))
      .orderBy(desc(metricSnapshots.pulledAt))
      .limit(1)
      .get()?.at ?? null
  )
}

/**
 * Pull public numbers for one account. One pull per account at a time: a second
 * caller waits for the running pull and then reuses it (skips when fresh < 60 min).
 */
export async function pullAccount(
  ctx: Ctx,
  accountId: string,
  opts: { force?: boolean },
  actor: string
) {
  const account = getById(ctx, accounts, accountId, "Account")
  if (!account.handle)
    throw new VSError("INVALID", `Account ${accountId} hat keinen Handle`)
  const { python, tiktokPullScript } = toolConfig()
  if (!tiktokPullScript || !fs.existsSync(tiktokPullScript)) {
    throw new VSError(
      "EXTERNAL",
      "tiktok_pull.py nicht konfiguriert. Einmalig: vibegrowth init --tiktok-pull <pfad> (liefert Session und Cookies)."
    )
  }
  const owner = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const deadline = Date.now() + LOCK_TTL_MS
  while (!acquirePullLock(ctx, accountId, owner)) {
    if (Date.now() > deadline)
      throw new VSError(
        "EXTERNAL",
        `Zahlen-Abruf für ${accountId} hängt (Sperre älter als 10 min)`
      )
    await sleep(2000)
  }
  try {
    const last = lastPullAt(ctx, accountId)
    if (
      !opts.force &&
      last &&
      Date.now() - Date.parse(last) < FRESH_MIN * 60 * 1000
    ) {
      return {
        accountId,
        skipped: true,
        reason: `vor ${Math.round((Date.now() - Date.parse(last)) / 60000)} min abgerufen`,
        lastPull: last,
      }
    }
    const known = readMatches(ctx, accountId)
    const job = {
      handle: account.handle,
      account_dir: resolveInDataDir(ctx.config.dataDir, account.dir),
      known,
      tiktok_pull: tiktokPullScript,
    }
    const script = path.join(
      appRoot(),
      "renderer",
      "scripts",
      "pull_metrics.py"
    )
    const res = spawnSync(python, [script], {
      input: JSON.stringify(job),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    })
    if (res.status !== 0) {
      throw new VSError(
        "EXTERNAL",
        `@${account.handle}: ${(res.stderr || res.error?.message || "Abruf fehlgeschlagen").trim().split("\n").pop()}`
      )
    }
    const out = JSON.parse(res.stdout) as {
      items: Omit<RawSnapshot, "pulled_at">[]
      known: Record<string, MatchCache>
    }
    const pulledAt = nowIso()
    const result = tx(ctx, () => {
      for (const [id, m] of Object.entries(out.known))
        writeMatch(ctx, accountId, id, m)
      const r = ingestSnapshots(
        ctx,
        accountId,
        out.items.map((i) => ({ ...i, pulled_at: pulledAt })),
        actor
      )
      recordHistory(ctx, {
        actor,
        entity: "metrics",
        entityId: accountId,
        action: "pull",
        after: { items: out.items.length, ...r },
      })
      return r
    })
    const matched = out.items.filter((i) => i.post_dir).length
    return {
      accountId,
      skipped: false,
      pulledAt,
      items: out.items.length,
      matched,
      ...result,
    }
  } finally {
    releasePullLock(ctx, accountId)
  }
}

export async function pullMetrics(
  ctx: Ctx,
  opts: { accountId?: string; force?: boolean },
  actor: string
) {
  const targets = opts.accountId
    ? [getById(ctx, accounts, opts.accountId, "Account")]
    : ctx.db
        .select()
        .from(accounts)
        .where(and(eq(accounts.status, "active")))
        .all()
        .filter((a) => a.handle)
  const results = []
  const errors: string[] = []
  for (const a of targets) {
    try {
      results.push(await pullAccount(ctx, a.id, opts, actor))
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { results, errors }
}

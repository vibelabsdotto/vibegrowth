import fs from "node:fs"
import path from "node:path"
import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { resolveInDataDir, toRelative } from "./config"
import type { Ctx } from "./db"
import { accounts, planEntries, posts } from "./schema"
import {
  getById,
  isDate,
  json,
  nowIso,
  parseJson,
  patchRow,
  recordHistory,
  VSError,
} from "./util"

export type PostRow = typeof posts.$inferSelect

const IMAGE = /\.(jpe?g|png|webp)$/i
const NOT_A_SLIDE =
  /(contact|qa-frame|video-frame|phone-|verification|cutout|magenta)/i

export interface ScannedPost {
  slug: string
  date: string | null
  hook: string | null
  caption: string | null
  slides: string[]
  slideCount: number
  contactSheet: string | null
  mp4: string | null
  zip: string | null
}

function files(dir: string) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The newest vN/ subfolder that has its own render, else the post folder itself. */
function contentBase(abs: string) {
  const versions = files(abs)
    .filter(
      (d) =>
        d.isDirectory() &&
        /^v\d+$/.test(d.name) &&
        fs.existsSync(path.join(abs, d.name, "render"))
    )
    .map((d) => d.name)
    .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))
  return versions.length ? path.join(abs, versions[0]) : abs
}

function firstHeadline(manifestPath: string): string | null {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      slides?: {
        headline?: string
        elements?: {
          type?: string
          text?: string
          role?: string
          id?: string
        }[]
      }[]
    }
    const s = m.slides?.[0]
    if (!s) return null
    if (s.headline) return s.headline.replace(/\s*\n\s*/g, " ").trim()
    const texts = (s.elements ?? []).filter((e) => e.type === "text" && e.text)
    const hook =
      texts.find((e) =>
        /hook|headline|title/i.test(`${e.role ?? ""} ${e.id ?? ""}`)
      ) ?? texts[0]
    return hook?.text?.replace(/\s*\n\s*/g, " ").trim() ?? null
  } catch {
    return null
  }
}

/** Read what is on disk for a post folder. Only reads, never moves or writes files. */
export function scanPostDir(dataDir: string, relDir: string): ScannedPost {
  const abs = resolveInDataDir(dataDir, relDir)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory())
    throw new VSError("NOT_FOUND", `Post-Ordner fehlt: ${relDir}`)
  const slug = path.basename(abs)
  const dm = slug.match(/^(\d{4}-\d{2}-\d{2})/)
  const base = contentBase(abs)
  const render = path.join(base, "render")
  const rel = (p: string) => toRelative(dataDir, p)

  let slides: string[] = []
  const renderSlides = path.join(render, "slides")
  for (const dir of [renderSlides, render]) {
    const found = files(dir)
      .filter(
        (f) =>
          f.isFile() && /\.jpe?g$/i.test(f.name) && !NOT_A_SLIDE.test(f.name)
      )
      .map((f) => path.join(dir, f.name))
      .sort()
    if (found.length) {
      slides = found
      break
    }
  }
  if (!slides.length) {
    slides = files(base)
      .filter(
        (f) => f.isFile() && IMAGE.test(f.name) && !NOT_A_SLIDE.test(f.name)
      )
      .map((f) => path.join(base, f.name))
      .sort()
  }
  const mp4 = files(render).find((f) => f.isFile() && f.name.endsWith(".mp4"))
  const zip = [base, abs].flatMap((d) =>
    files(d)
      .filter((f) => f.isFile() && f.name.endsWith(".zip"))
      .map((f) => path.join(d, f.name))
  )[0]
  const contact = path.join(render, "contact-sheet.jpg")
  const captionFile = [
    path.join(base, "caption.txt"),
    path.join(abs, "caption.txt"),
  ].find((p) => fs.existsSync(p))
  const caption = captionFile
    ? fs.readFileSync(captionFile, "utf8").trim()
    : null
  const manifest = [
    path.join(base, "render-manifest.json"),
    path.join(abs, "render-manifest.json"),
  ].find((p) => fs.existsSync(p))
  const hook =
    (manifest && firstHeadline(manifest)) ||
    caption?.split("\n")[0]?.slice(0, 140) ||
    null

  return {
    slug,
    date: dm && isDate(dm[1]) ? dm[1] : null,
    hook,
    caption,
    slides: slides.map(rel),
    slideCount: slides.length,
    contactSheet: fs.existsSync(contact) ? rel(contact) : null,
    mp4: mp4 ? rel(path.join(render, mp4.name)) : null,
    zip: zip ? rel(zip) : null,
  }
}

function withSlides(p: PostRow) {
  return { ...p, slides: parseJson<string[]>(p.slides, []) }
}

export function listPosts(
  ctx: Ctx,
  f: { accountId?: string; status?: string } = {}
) {
  const conds = []
  if (f.accountId) conds.push(eq(posts.accountId, f.accountId))
  if (f.status) conds.push(eq(posts.status, f.status))
  return ctx.db
    .select()
    .from(posts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(posts.date), desc(posts.id))
    .all()
    .map(withSlides)
}

export function getPost(ctx: Ctx, idOrDir: string | number) {
  const asNum =
    typeof idOrDir === "number"
      ? idOrDir
      : /^\d+$/.test(idOrDir)
        ? Number(idOrDir)
        : null
  const row =
    asNum !== null
      ? ctx.db.select().from(posts).where(eq(posts.id, asNum)).get()
      : (ctx.db
          .select()
          .from(posts)
          .where(eq(posts.dir, String(idOrDir).replace(/\/$/, "")))
          .get() ??
        ctx.db
          .select()
          .from(posts)
          .where(eq(posts.slug, String(idOrDir)))
          .get())
  if (!row) throw new VSError("NOT_FOUND", `Post ${idOrDir} nicht gefunden`)
  return withSlides(row)
}

export interface RegisterInput {
  accountId: string
  /** relative to the data dir, absolute inside it, or just the folder name under <account>/posts */
  dir: string
  planEntryId?: number | null
  delivered?: boolean
  hook?: string | null
  angle?: string | null
  notes?: string | null
}

export function normalizePostDir(ctx: Ctx, accountDir: string, dir: string) {
  if (path.isAbsolute(dir)) return toRelative(ctx.config.dataDir, dir)
  const clean = dir.replace(/\/$/, "")
  if (!clean.includes("/")) return `${accountDir}/posts/${clean}`
  if (clean.startsWith("posts/")) return `${accountDir}/${clean}`
  return clean
}

/**
 * Create or refresh a post from its folder. Links the plan entry (explicit or the
 * account's entry on the post date) and moves that entry to delivered.
 */
export function registerPost(ctx: Ctx, input: RegisterInput, actor: string) {
  const account = getById(ctx, accounts, input.accountId, "Account")
  const dir = normalizePostDir(ctx, account.dir, input.dir)
  if (!dir.startsWith(`${account.dir}/`))
    throw new VSError(
      "INVALID",
      `Ordner ${dir} liegt nicht im Account-Ordner ${account.dir}`
    )
  const scan = scanPostDir(ctx.config.dataDir, dir)
  const existing = ctx.db.select().from(posts).where(eq(posts.dir, dir)).get()

  let planEntryId = input.planEntryId ?? existing?.planEntryId ?? null
  if (!planEntryId && scan.date) {
    const candidate = ctx.db
      .select()
      .from(planEntries)
      .where(
        and(
          eq(planEntries.accountId, account.id),
          eq(planEntries.date, scan.date)
        )
      )
      .orderBy(asc(planEntries.position), asc(planEntries.id))
      .all()
      .find(
        (e) =>
          e.status !== "skipped" &&
          !ctx.db
            .select({ id: posts.id })
            .from(posts)
            .where(eq(posts.planEntryId, e.id))
            .get()
      )
    planEntryId = candidate?.id ?? null
  }
  if (planEntryId) getById(ctx, planEntries, planEntryId, "Planeintrag")

  const fields = {
    accountId: account.id,
    planEntryId,
    slug: scan.slug,
    date: scan.date,
    hook: input.hook ?? existing?.hook ?? scan.hook,
    caption: scan.caption ?? existing?.caption ?? null,
    angle: input.angle ?? existing?.angle ?? null,
    slideCount: scan.slideCount,
    slides: json(scan.slides),
    contactSheet: scan.contactSheet,
    mp4: scan.mp4,
    zip: scan.zip,
    notes: input.notes ?? existing?.notes ?? null,
  }

  let row: PostRow
  if (existing) {
    const patch: Record<string, unknown> = { ...fields }
    if (input.delivered && !existing.deliveredAt) {
      patch.deliveredAt = nowIso()
      if (existing.status === "produced") patch.status = "delivered"
    }
    row = patchRow(ctx, posts, "post", existing.id, patch, actor, "register")
  } else {
    row = ctx.db
      .insert(posts)
      .values({
        ...fields,
        dir,
        status: input.delivered ? "delivered" : "produced",
        deliveredAt: input.delivered ? nowIso() : null,
      })
      .returning()
      .get()
    recordHistory(ctx, {
      actor,
      entity: "post",
      entityId: row.id,
      action: "create",
      after: row,
    })
  }

  if (planEntryId) {
    const entry = getById(ctx, planEntries, planEntryId, "Planeintrag")
    const target = row.status === "posted" ? "posted" : "delivered"
    const rank = ["idea", "planned", "in_production", "delivered", "posted"]
    if (rank.indexOf(entry.status) < rank.indexOf(target)) {
      patchRow(
        ctx,
        planEntries,
        "plan_entry",
        planEntryId,
        { status: target, hook: entry.hook ?? row.hook },
        actor,
        "status"
      )
    }
  }
  return withSlides(row)
}

export function markPosted(
  ctx: Ctx,
  idOrDir: string | number,
  input: {
    tiktokId?: string | null
    url?: string | null
    postedAt?: string | null
  },
  actor: string
) {
  const p = getPost(ctx, idOrDir)
  let tiktokId = input.tiktokId ?? null
  if (!tiktokId && input.url)
    tiktokId = input.url.match(/(\d{15,})/)?.[1] ?? null
  if (tiktokId) {
    const clash = ctx.db
      .select()
      .from(posts)
      .where(eq(posts.tiktokId, tiktokId))
      .get()
    if (clash && clash.id !== p.id)
      throw new VSError(
        "CONFLICT",
        `TikTok-ID ${tiktokId} gehört schon zu Post ${clash.id}`
      )
  }
  const row = patchRow(
    ctx,
    posts,
    "post",
    p.id,
    {
      status: "posted",
      tiktokId: tiktokId ?? p.tiktokId,
      tiktokUrl: input.url ?? p.tiktokUrl,
      postedAt: input.postedAt ?? p.postedAt ?? nowIso(),
    },
    actor,
    "posted"
  )
  if (row.planEntryId)
    patchRow(
      ctx,
      planEntries,
      "plan_entry",
      row.planEntryId,
      { status: "posted" },
      actor,
      "status"
    )
  return withSlides(row)
}

export function updatePost(
  ctx: Ctx,
  id: number,
  patch: { hook?: string | null; angle?: string | null; notes?: string | null },
  actor: string
) {
  return withSlides(patchRow(ctx, posts, "post", id, patch, actor))
}

/** Posts on disk that are not registered yet, per account. */
export function unregisteredPostDirs(ctx: Ctx, accountId: string) {
  const account = getById(ctx, accounts, accountId, "Account")
  const abs = resolveInDataDir(ctx.config.dataDir, `${account.dir}/posts`)
  const known = new Set(
    ctx.db
      .select({ dir: posts.dir })
      .from(posts)
      .where(eq(posts.accountId, accountId))
      .all()
      .map((r) => r.dir)
  )
  return files(abs)
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => `${account.dir}/posts/${d.name}`)
    .filter((d) => !known.has(d))
}

export function postsWithoutEntry(ctx: Ctx, accountId: string) {
  return ctx.db
    .select()
    .from(posts)
    .where(and(eq(posts.accountId, accountId), isNull(posts.planEntryId)))
    .all()
}

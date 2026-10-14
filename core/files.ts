import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveInDataDir, toolConfig } from "./config"
import { appRoot, type Ctx } from "./db"
import { getAccount, getFormat } from "./catalog"
import { getInspiration } from "./knowledge"
import { getPost, registerPost } from "./posts"
import { planEntries } from "./schema"
import { getById, VSError } from "./util"

/** Open a folder inside the data dir in Finder (or the platform file manager). */
export function openPath(ctx: Ctx, rel: string) {
  const abs = resolveInDataDir(ctx.config.dataDir, rel)
  if (!fs.existsSync(abs))
    throw new VSError("NOT_FOUND", `Ordner fehlt: ${rel}`)
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open"
  const child = spawn(cmd, [abs], { detached: true, stdio: "ignore" })
  child.unref()
  return { opened: abs }
}

export function folderFor(
  ctx: Ctx,
  kind: "post" | "account" | "inspo",
  id: string
) {
  if (kind === "post") return getPost(ctx, id).dir
  if (kind === "account") return getAccount(ctx, id).dir
  const insp = getInspiration(ctx, Number(id))
  const p = insp.briefingPath ?? insp.files[0]
  if (!p)
    throw new VSError(
      "NOT_FOUND",
      `Inspiration ${id} hat keinen lokalen Ordner`
    )
  return path.posix.dirname(p)
}

const TOP_LEVEL_PARAMS = new Set(["style", "handle"])

/**
 * Format renderer params fill in what the post manifest leaves open:
 * style/handle at manifest level, everything else per non-canvas slide.
 */
export function applyFormatParams(
  manifest: Record<string, unknown>,
  params: Record<string, unknown>
) {
  const out: Record<string, unknown> = { ...manifest }
  const slides = Array.isArray(manifest.slides)
    ? (manifest.slides as Record<string, unknown>[])
    : []
  for (const [k, v] of Object.entries(params)) {
    if (TOP_LEVEL_PARAMS.has(k)) {
      if (out[k] === undefined) out[k] = v
    }
  }
  out.slides = slides.map((s) => {
    if (s.layout === "canvas") return s
    const next = { ...s }
    for (const [k, v] of Object.entries(params))
      if (!TOP_LEVEL_PARAMS.has(k) && next[k] === undefined) next[k] = v
    return next
  })
  return out
}

/**
 * Render a post from its render-manifest.json into <post>/render with the bundled renderer.
 * finalize: render + technical QA + upload ZIP (canvas posts), via finalize_post.py.
 */
export function renderPost(
  ctx: Ctx,
  idOrDir: string,
  opts: { video?: boolean; finalize?: { stem: string; zip: string } },
  actor: string
) {
  const post = getPost(ctx, idOrDir)
  const abs = resolveInDataDir(ctx.config.dataDir, post.dir)
  const manifestPath = path.join(abs, "render-manifest.json")
  if (!fs.existsSync(manifestPath))
    throw new VSError("NOT_FOUND", `render-manifest.json fehlt in ${post.dir}`)
  const { python } = toolConfig()
  const scripts = path.join(appRoot(), "renderer", "scripts")
  let res
  if (opts.finalize) {
    res = spawnSync(
      python,
      [
        path.join(scripts, "finalize_post.py"),
        "--post",
        abs,
        "--stem",
        opts.finalize.stem,
        "--zip",
        opts.finalize.zip,
      ],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }
    )
  } else {
    const account = getAccount(ctx, post.accountId)
    const entryFormat = post.planEntryId
      ? getById(ctx, planEntries, post.planEntryId, "Planeintrag").formatId
      : null
    const formatId = entryFormat ?? account.defaultFormatId
    const params = formatId
      ? (getFormat(ctx, formatId).current?.rendererParams ?? {})
      : {}
    const merged = applyFormatParams(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      params
    )
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "vibeshorts-")),
      "manifest.json"
    )
    fs.writeFileSync(tmp, JSON.stringify(merged))
    const args = [
      path.join(scripts, "render_slideshow.py"),
      "--manifest",
      tmp,
      "--output-dir",
      path.join(abs, "render"),
    ]
    if (opts.video === false) args.push("--no-video")
    res = spawnSync(python, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim()
  if (res.status !== 0)
    throw new VSError(
      "EXTERNAL",
      `Renderer fehlgeschlagen (${res.status}): ${output.slice(-1500)}`
    )
  let report: unknown = output
  try {
    report = JSON.parse(
      res.stdout
        .trim()
        .split("\n")
        .filter((l) => l.trim())
        .join("\n")
    )
  } catch {
    // renderer printed non-JSON; keep raw text
  }
  const refreshed = registerPost(
    ctx,
    { accountId: post.accountId, dir: post.dir },
    actor
  )
  return { post: refreshed, renderer: report }
}

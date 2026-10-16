/**
 * Featurama access through the installed Featurama CLI (`featurama --context hosted tool call …`).
 * The CLI holds the token (~/.config/featurama/config.json); VibeGrowth never reads or prints it.
 * Every call returns the MCP envelope {content:[{type:"text", text:"<json>"}]}.
 *
 * Read: listFeatureRequests (paged against totalCount), listFeatureRequestComments.
 * Write (only `app publish`): addFeatureRequestComment = developer comment.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import {
  CollectorError,
  type FeatureRequestComment,
  type FeatureRequestRow,
} from "./types.js"

export interface FeaturamaOptions {
  /** CLI context, default "hosted" */
  context?: string | null
}

interface RawRequest {
  id: string
  projectId: string
  title: string
  description?: string | null
  status?: string | null
  voteCount?: number
  commentCount?: number
  createdAt?: string | null
  isApproved?: boolean
  needsReply?: boolean
  lastUserCommentAt?: string | null
  lastDeveloperCommentAt?: string | null
  deviceInfo?: { platform?: string | null; appVersion?: string | null } | null
}

export interface RawComment {
  id: string
  content: string
  authorName?: string | null
  authorRole: "user" | "developer"
  createdAt: string
}

export const FEATURAMA_PAGE_SIZE = 100

export function featuramaBin() {
  if (process.env.VIBEGROWTH_FEATURAMA_BIN)
    return process.env.VIBEGROWTH_FEATURAMA_BIN
  return existsSync("/opt/homebrew/bin/featurama")
    ? "/opt/homebrew/bin/featurama"
    : "featurama"
}

const scrub = (s: string) => s.replace(/fm_[A-Za-z0-9_-]{6,}/g, "***")

/** One MCP tool call through the CLI; returns the parsed JSON of the first text content. */
export function featuramaTool<T>(
  name: string,
  args: Record<string, unknown>,
  opts: FeaturamaOptions = {},
  timeoutMs = 60_000
): Promise<T> {
  const cmd = [
    "--context",
    opts.context || "hosted",
    "tool",
    "call",
    name,
    "--args",
    JSON.stringify(args),
  ]
  return new Promise((resolve, reject) => {
    execFile(
      featuramaBin(),
      cmd,
      {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, FEATURAMA_TIMEOUT_MS: "30000" },
      },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT")
            return reject(
              new CollectorError(
                "CONFIG",
                "Featurama-CLI nicht gefunden (VIBEGROWTH_FEATURAMA_BIN oder /opt/homebrew/bin/featurama)"
              )
            )
          let detail = (stderr || stdout || err.message).trim()
          try {
            const e = JSON.parse(detail) as {
              error?: { code?: string; message?: string }
            }
            if (e.error)
              detail = `${e.error.code ?? "ERROR"}: ${e.error.message ?? ""}`
          } catch {
            /* plain text */
          }
          return reject(
            new CollectorError(
              "EXTERNAL",
              scrub(`Featurama ${name}: ${detail.slice(0, 300)}`)
            )
          )
        }
        try {
          const env = JSON.parse(stdout) as {
            isError?: boolean
            content?: { type: string; text?: string }[]
          }
          const text = env.content?.find((c) => c.type === "text")?.text
          if (text === undefined) throw new Error("Antwort ohne Text")
          const value = JSON.parse(text) as T & { error?: unknown }
          if (
            env.isError ||
            (value &&
              typeof value === "object" &&
              "error" in value &&
              !("items" in value))
          )
            throw new Error(
              typeof value.error === "string" ? value.error : "Tool-Fehler"
            )
          resolve(value)
        } catch (e) {
          reject(
            new CollectorError(
              "EXTERNAL",
              scrub(
                `Featurama ${name}: ${e instanceof Error ? e.message : String(e)}`
              )
            )
          )
        }
      }
    )
  })
}

/**
 * All requests matching the filter: pages of 100 until totalCount, deduplicated by id. A changed
 * totalCount between pages starts the scan once more.
 */
export async function listRequests(
  projectId: string,
  filter: { approval?: "approved" | "pending" | "all"; needsReply?: boolean },
  opts: FeaturamaOptions = {}
): Promise<{ items: RawRequest[]; totalCount: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const byId = new Map<string, RawRequest>()
    let total: number | null = null
    let changed = false
    for (let page = 1; page < 1000; page++) {
      const r = await featuramaTool<{
        items: RawRequest[]
        totalCount: number
      }>(
        "listFeatureRequests",
        {
          projectId,
          page,
          pageSize: FEATURAMA_PAGE_SIZE,
          ...(filter.approval ? { approval: filter.approval } : {}),
          ...(filter.needsReply !== undefined
            ? { needsReply: filter.needsReply }
            : {}),
        },
        opts
      )
      if (total !== null && r.totalCount !== total) {
        changed = true
        break
      }
      total = r.totalCount
      for (const it of r.items) byId.set(it.id, it)
      if (!r.items.length || byId.size >= total) break
    }
    if (!changed) return { items: [...byId.values()], totalCount: total ?? 0 }
  }
  throw new CollectorError(
    "EXTERNAL",
    "Featurama: Anzahl der Requests hat sich während des Lesens zweimal geändert"
  )
}

export function listComments(
  projectId: string,
  requestId: string,
  opts: FeaturamaOptions = {}
) {
  return featuramaTool<RawComment[]>(
    "listFeatureRequestComments",
    { projectId, requestId },
    opts
  )
}

/** Developer comment (public, not editable). Only `app publish` calls this. */
export function addDeveloperComment(
  projectId: string,
  requestId: string,
  content: string,
  opts: FeaturamaOptions = {}
) {
  return featuramaTool<RawComment>(
    "addFeatureRequestComment",
    { projectId, requestId, content },
    opts
  )
}

export function requestUrl(projectId: string, requestId: string) {
  return `https://featurama.app/projects/${projectId}?request=${requestId}`
}

/** Comments without personal data: the author name only for developers. */
export function cleanComments(list: RawComment[]): FeatureRequestComment[] {
  return list.map((c) => ({
    id: c.id,
    role: c.authorRole === "developer" ? "developer" : "user",
    author: c.authorRole === "developer" ? (c.authorName ?? null) : null,
    content: c.content,
    createdAt: c.createdAt,
  }))
}

/** Request → row; e-mail, submitter id and device details except platform/app version are dropped. */
export function requestRow(
  r: RawRequest,
  comments: RawComment[] | null
): FeatureRequestRow {
  return {
    featuramaProjectId: r.projectId,
    requestId: r.id,
    title: r.title,
    body: r.description ?? null,
    status: r.status ?? null,
    votes: r.voteCount ?? 0,
    approved: Boolean(r.isApproved),
    platform: r.deviceInfo?.platform ?? null,
    appVersion: r.deviceInfo?.appVersion ?? null,
    requestedAt: r.createdAt ?? null,
    lastUserCommentAt: r.lastUserCommentAt ?? null,
    lastDeveloperCommentAt: r.lastDeveloperCommentAt ?? null,
    needsReply: Boolean(r.needsReply),
    commentCount: r.commentCount ?? 0,
    comments: comments ? cleanComments(comments) : null,
    url: requestUrl(r.projectId, r.id),
  }
}

/** Thread state from the comments (for the fresh read before publishing). */
export function threadState(comments: RawComment[]) {
  const last = (role: string) =>
    comments
      .filter((c) => c.authorRole === role)
      .map((c) => c.createdAt)
      .sort()
      .pop() ?? null
  const lastUser = last("user")
  const lastDev = last("developer")
  return {
    lastUserCommentAt: lastUser,
    lastDeveloperCommentAt: lastDev,
    needsReply: !lastDev || Boolean(lastUser && lastUser > lastDev),
  }
}

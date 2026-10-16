import type { CollectorDefinition } from "../collector"
import {
  listComments,
  listRequests,
  requestRow,
  type RawComment,
} from "../sources/featurama"
import { errorMessage, finish, type FeatureRequestRow } from "../sources/types"

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null

/** Parallel comment reads; Featurama allows 300 requests per minute. */
const CONCURRENCY = 4

/**
 * Feature requests of one Featurama project into feature_requests (read only). Reads every request
 * (approval all) page by page against totalCount, the threads of requests with comments, and checks
 * the counts with the filtered lists needsReply+approved and approval pending.
 */
export const featurama: CollectorDefinition = {
  id: "featurama",
  label: "Featurama Feature-Requests",
  channelKinds: ["ios", "android", "other"],
  configSchema: {
    featuramaProjectId: {
      description:
        "Featurama-Projekt-ID (UUID), z. B. c06e5a1f-7521-4265-b1a9-7037ed615f16",
      required: true,
      type: "string",
    },
    context: {
      description: 'Kontext der Featurama-CLI (Standard "hosted")',
      required: false,
      type: "string",
    },
  },
  secrets: false,
  async run(_project, config) {
    const pid = str(config.featuramaProjectId)
    const stats: Record<string, unknown> = {}
    if (!pid) {
      const msg = 'featurama: Konfiguration "featuramaProjectId" fehlt'
      return finish({ kpi: [], summary: msg, stats, errors: [msg] })
    }
    const opts = { context: str(config.context) }
    const errors: string[] = []
    let rows: FeatureRequestRow[] = []
    try {
      const all = await listRequests(pid, { approval: "all" }, opts)
      const withComments = all.items.filter((r) => (r.commentCount ?? 0) > 0)
      const threads = new Map<string, RawComment[] | null>()
      let next = 0
      const worker = async () => {
        while (next < withComments.length) {
          const r = withComments[next++]
          try {
            threads.set(r.id, await listComments(pid, r.id, opts))
          } catch (e) {
            threads.set(r.id, null)
            errors.push(`Kommentare ${r.id}: ${errorMessage(e)}`)
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      rows = all.items.map((r) =>
        requestRow(
          r,
          (r.commentCount ?? 0) > 0 ? (threads.get(r.id) ?? null) : []
        )
      )
      const needs = await listRequests(
        pid,
        { approval: "approved", needsReply: true },
        opts
      )
      const pending = await listRequests(pid, { approval: "pending" }, opts)
      const mirrorNeeds = rows.filter((r) => r.approved && r.needsReply).length
      const mirrorPending = rows.filter((r) => !r.approved).length
      stats.total = all.totalCount
      stats.read = rows.length
      stats.needsReplyApproved = {
        mirror: mirrorNeeds,
        featurama: needs.totalCount,
      }
      stats.pending = { mirror: mirrorPending, featurama: pending.totalCount }
      stats.threads = withComments.length
      if (rows.length !== all.totalCount)
        errors.push(
          `featurama: ${rows.length} von ${all.totalCount} Requests gelesen`
        )
      if (
        mirrorNeeds !== needs.totalCount ||
        mirrorPending !== pending.totalCount
      )
        stats.countMismatch = true
    } catch (e) {
      errors.push(errorMessage(e))
    }
    const s = stats as {
      total?: number
      needsReplyApproved?: { mirror: number }
      pending?: { mirror: number }
    }
    const summary = errors.length
      ? `Featurama: ${errors.join("; ").slice(0, 240)}`
      : `Featurama: ${s.total} Requests, ${s.needsReplyApproved?.mirror} brauchen Antwort, ${s.pending?.mirror} warten auf Freigabe in Featurama`
    return finish({ kpi: [], featureRequests: rows, summary, stats, errors })
  },
}

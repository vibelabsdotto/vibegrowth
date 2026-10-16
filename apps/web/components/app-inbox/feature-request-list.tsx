"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { MessageSquare, ThumbsUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { fmtAgo, fmtDateTime, label } from "@/components/growth/format"
import type { InboxFeatureRequest } from "@/lib/growth-types"
import { FeatureRequestThread, platformText } from "./feature-request-thread"
import { FEATURAMA_STATUS_LABEL, plural } from "./labels"
import { LinkedApprovals } from "./linked-approvals"
import { NeedsReplyToken, NotApprovedNote } from "./markers"

const ITEM_PARAM = "item"

const rowId = (requestId: string) => `fr-${requestId}`

/**
 * Feature requests as rows; a row opens the thread drawer. The open request lives in
 * ?item=<requestId> (set with history.replaceState, so no server round trip), which also
 * makes the drawer deep-linkable.
 */
export function FeatureRequestList({
  items,
  deepItem,
  projectNames,
  now,
}: {
  items: InboxFeatureRequest[]
  /** Request from ?item= that the current filter hides, so a deep link still opens. */
  deepItem: InboxFeatureRequest | null
  /** Project names when the page shows all projects, otherwise null. */
  projectNames: Record<string, string> | null
  now: number
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const openId = searchParams.get(ITEM_PARAM)
  const current =
    (openId &&
      (items.find((r) => r.requestId === openId) ??
        (deepItem?.requestId === openId ? deepItem : null))) ||
    null

  // Keep the last request rendered while the drawer animates out.
  const [shown, setShown] = React.useState<InboxFeatureRequest | null>(current)
  if (current && current !== shown) setShown(current)

  const setItem = (id: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (id) next.set(ITEM_PARAM, id)
    else next.delete(ITEM_PARAM)
    const qs = next.toString()
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
  }

  const request = current ?? shown
  return (
    <>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {items.map((r) => (
          <FeatureRequestRow
            key={r.id}
            request={r}
            projectName={projectNames?.[r.projectId] ?? null}
            now={now}
            onOpen={() => setItem(r.requestId)}
          />
        ))}
      </ul>
      <FeatureRequestThread
        request={request}
        projectName={
          request && projectNames
            ? (projectNames[request.projectId] ?? request.projectId)
            : null
        }
        open={current !== null}
        onOpenChange={(next) => {
          if (!next) setItem(null)
        }}
        onClosed={() => setShown(null)}
        finalFocus={() =>
          (request && document.getElementById(rowId(request.requestId))) ??
          document.querySelector<HTMLElement>("main h1")
        }
      />
    </>
  )
}

function FeatureRequestRow({
  request: r,
  projectName,
  now,
  onOpen,
}: {
  request: InboxFeatureRequest
  projectName: string | null
  now: number
  onOpen: () => void
}) {
  const platform = platformText(r)
  return (
    <li className="relative flex min-w-0 flex-col gap-2 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {r.needsReply ? <NeedsReplyToken /> : null}
          {projectName ? (
            <Badge variant="secondary">{projectName}</Badge>
          ) : null}
          {!r.approved ? <NotApprovedNote /> : null}
        </div>
        <button
          type="button"
          id={rowId(r.requestId)}
          onClick={onOpen}
          className="text-left text-sm font-medium break-words outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
        >
          {r.title}
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {r.status ? (
            <Badge variant="outline">
              {label(FEATURAMA_STATUS_LABEL, r.status)}
            </Badge>
          ) : null}
          <span className="inline-flex items-center gap-1 tabular-nums">
            <ThumbsUp aria-hidden="true" className="size-3" />
            {plural(r.votes, "Stimme", "Stimmen")}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <MessageSquare aria-hidden="true" className="size-3" />
            {plural(r.commentCount, "Kommentar", "Kommentare")}
          </span>
          {platform ? <span>{platform}</span> : null}
          {r.lastActivity ? (
            <time
              dateTime={r.lastActivity}
              title={fmtDateTime(r.lastActivity)}
              className="tabular-nums"
            >
              aktiv {fmtAgo(r.lastActivity, now)}
            </time>
          ) : null}
        </div>
      </div>
      {r.approvals.length ? (
        <LinkedApprovals approvals={r.approvals} className="relative z-10" />
      ) : null}
    </li>
  )
}

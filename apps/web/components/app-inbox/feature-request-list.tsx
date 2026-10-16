"use client"

import { MessageSquare, ThumbsUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { fmtAgo, fmtDateTime, label } from "@/components/growth/format"
import type { InboxFeatureRequest } from "@/lib/growth-types"
import { platformText } from "./feature-request-thread"
import { InboxSheet } from "./inbox-sheet"
import { FEATURAMA_STATUS_LABEL, plural } from "./labels"
import { InboxStateToken, NotApprovedNote } from "./markers"
import { inboxRowId, useInboxItem } from "./use-inbox-item"

/**
 * Feature requests as rows; a row opens the sheet with thread and actions. `items`
 * holds every loaded request, `visible` the ids the current filter shows.
 */
export function FeatureRequestList({
  items,
  visible,
  projectNames,
  now,
  param,
}: {
  items: InboxFeatureRequest[]
  visible: string[]
  /** Project names when the page shows all projects, otherwise null. */
  projectNames: Record<string, string> | null
  /** URL parameter of the open item; pages with a second sheet use their own. */
  param?: string
  now: number
}) {
  const { item, open, setItem, onClosed } = useInboxItem(items, param)
  const shownIds = new Set(visible)
  const rows = items.filter((r) => shownIds.has(r.itemId))
  return (
    <>
      {rows.length ? (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <FeatureRequestRow
              key={r.id}
              request={r}
              projectName={projectNames?.[r.projectId] ?? null}
              now={now}
              onOpen={() => setItem(r.itemId)}
            />
          ))}
        </ul>
      ) : null}
      <InboxSheet
        item={item}
        projectName={
          item && projectNames
            ? (projectNames[item.projectId] ?? item.projectId)
            : null
        }
        open={open}
        onOpenChange={(next) => {
          if (!next) setItem(null)
        }}
        onClosed={onClosed}
        finalFocus={() =>
          (item && document.getElementById(inboxRowId(item.itemId))) ??
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
    <li className="relative flex min-w-0 flex-col gap-1 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <InboxStateToken state={r.state} />
        {projectName ? <Badge variant="secondary">{projectName}</Badge> : null}
        {!r.approved ? <NotApprovedNote /> : null}
      </div>
      <button
        type="button"
        id={inboxRowId(r.itemId)}
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
    </li>
  )
}

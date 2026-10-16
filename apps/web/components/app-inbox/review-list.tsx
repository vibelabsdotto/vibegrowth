"use client"

import { Badge } from "@/components/ui/badge"
import { fmtDate, label, STORE_LABEL } from "@/components/growth/format"
import type { InboxReview } from "@/lib/growth-types"
import { InboxSheet } from "./inbox-sheet"
import { localeLabel } from "./labels"
import { InboxStateToken } from "./markers"
import { Stars } from "./stars"
import { inboxRowId, useInboxItem } from "./use-inbox-item"

/**
 * Store reviews with text as rows; a row opens the sheet with review and actions.
 * `items` holds every loaded review, `visible` the ids the current filter shows.
 */
export function ReviewList({
  items,
  visible,
  projectNames,
  param,
}: {
  items: InboxReview[]
  visible: string[]
  /** Project names when the page shows all projects, otherwise null. */
  projectNames: Record<string, string> | null
  /** URL parameter of the open item; pages with a second sheet use their own. */
  param?: string
}) {
  const { item, open, setItem, onClosed } = useInboxItem(items, param)
  const shownIds = new Set(visible)
  const rows = items.filter((r) => shownIds.has(r.itemId))
  return (
    <>
      {rows.length ? (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <ReviewRow
              key={r.id}
              review={r}
              projectName={
                projectNames ? (projectNames[r.projectId] ?? r.projectId) : null
              }
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

function ReviewRow({
  review: r,
  projectName,
  onOpen,
}: {
  review: InboxReview
  projectName: string | null
  onOpen: () => void
}) {
  const locale = localeLabel(r.language)
  const text = [r.title, r.body].filter(Boolean).join(" · ")
  return (
    <li className="relative flex min-w-0 flex-col gap-1.5 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <InboxStateToken state={r.state} />
        <Stars value={r.rating} />
        <Badge variant="outline">{label(STORE_LABEL, r.store)}</Badge>
        {projectName ? <Badge variant="secondary">{projectName}</Badge> : null}
      </div>
      <button
        type="button"
        id={inboxRowId(r.itemId)}
        onClick={onOpen}
        className="line-clamp-3 text-left text-sm break-words outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
      >
        {text || "Bewertung ohne Text"}
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <time dateTime={r.date ?? undefined} className="tabular-nums">
          {fmtDate(r.date)}
        </time>
        {r.version ? (
          <span className="tabular-nums">Version {r.version}</span>
        ) : null}
        {locale ? <span title={locale.title}>{locale.text}</span> : null}
        {r.reply ? <span>mit Antwort</span> : null}
      </div>
    </li>
  )
}

import { fmtDate, label, STORE_LABEL } from "@/components/growth/format"
import { Badge } from "@/components/ui/badge"
import type { InboxReview } from "@/lib/growth-types"
import { localeLabel } from "./labels"
import { LinkedApprovals } from "./linked-approvals"
import { ReviewReplyToken } from "./markers"
import { Stars } from "./stars"

/** Store reviews with text, their reply and linked suggestions. */
export function ReviewList({
  items,
  projectNames,
}: {
  items: InboxReview[]
  /** Project names when the page shows all projects, otherwise null. */
  projectNames: Record<string, string> | null
}) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {items.map((r) => (
        <ReviewRow
          key={r.id}
          review={r}
          projectName={
            projectNames ? (projectNames[r.projectId] ?? r.projectId) : null
          }
        />
      ))}
    </ul>
  )
}

function ReviewRow({
  review: r,
  projectName,
}: {
  review: InboxReview
  projectName: string | null
}) {
  const locale = localeLabel(r.language)
  return (
    <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Stars value={r.rating} />
        <Badge variant="outline">{label(STORE_LABEL, r.store)}</Badge>
        {projectName ? <Badge variant="secondary">{projectName}</Badge> : null}
        <ReviewReplyToken review={r} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <time dateTime={r.date ?? undefined} className="tabular-nums">
          {fmtDate(r.date)}
        </time>
        {r.version ? (
          <span className="tabular-nums">Version {r.version}</span>
        ) : null}
        {locale ? <span title={locale.title}>{locale.text}</span> : null}
        {r.lastModified &&
        r.date &&
        fmtDate(r.lastModified) !== fmtDate(r.date) &&
        r.lastModified > r.date ? (
          <span className="tabular-nums">
            geändert {fmtDate(r.lastModified)}
          </span>
        ) : null}
      </div>
      {r.title ? (
        <p className="text-sm font-medium break-words">{r.title}</p>
      ) : null}
      {r.body ? (
        <p className="text-sm break-words whitespace-pre-line">{r.body}</p>
      ) : null}
      {r.reply ? (
        <div className="ml-3 flex flex-col gap-1 border-l-2 pl-3 sm:ml-6">
          <span className="text-xs text-muted-foreground">
            Antwort
            {r.replyAt ? (
              <>
                {" vom "}
                <time dateTime={r.replyAt} className="tabular-nums">
                  {fmtDate(r.replyAt)}
                </time>
              </>
            ) : null}
          </span>
          <p className="text-sm break-words whitespace-pre-line text-muted-foreground">
            {r.reply}
          </p>
        </div>
      ) : null}
      <LinkedApprovals approvals={r.approvals} />
    </li>
  )
}

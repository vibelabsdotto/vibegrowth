import { Badge } from "@/components/ui/badge"
import { fmtDate, label, STORE_LABEL } from "@/components/growth/format"
import type { InboxReview } from "@/lib/growth-types"
import { fmtStamp, localeLabel } from "./labels"
import { InboxStateToken } from "./markers"
import { Stars } from "./stars"

/** True when the user changed the review after the last reply. */
function changedAfterReply(r: InboxReview) {
  return Boolean(
    r.reply && r.replyAt && r.lastModified && r.lastModified > r.replyAt
  )
}

/** Store review with stars, version, store, text and the previous reply, for the inbox sheet. */
export function ReviewDetails({
  review: r,
  projectName,
}: {
  review: InboxReview
  projectName: string | null
}) {
  const locale = localeLabel(r.language)
  const changed =
    r.lastModified &&
    r.date &&
    r.lastModified > r.date &&
    fmtDate(r.lastModified) !== fmtDate(r.date)
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <InboxStateToken state={r.state} />
          <Stars value={r.rating} />
          <Badge variant="outline">{label(STORE_LABEL, r.store)}</Badge>
          {projectName ? (
            <Badge variant="secondary">{projectName}</Badge>
          ) : null}
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="tabular-nums">{r.version || "unbekannt"}</dd>
          {locale ? (
            <>
              <dt className="text-muted-foreground">Sprache</dt>
              <dd title={locale.title}>{locale.text}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Geschrieben</dt>
          <dd className="tabular-nums">{fmtStamp(r.date)}</dd>
          {changed ? (
            <>
              <dt className="text-muted-foreground">Geändert</dt>
              <dd className="tabular-nums">{fmtStamp(r.lastModified)}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <section
        aria-labelledby="inbox-review-text"
        className="flex flex-col gap-3"
      >
        <h3 id="inbox-review-text" className="text-sm font-medium">
          Bewertung
        </h3>
        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3">
          {r.title ? (
            <p className="text-sm font-medium break-words">{r.title}</p>
          ) : null}
          {r.body ? (
            <p className="text-sm break-words whitespace-pre-line">{r.body}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Kein Text.</p>
          )}
        </div>
        {r.reply ? (
          <div className="ml-6 flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted p-3 sm:ml-12">
            <span className="text-xs text-muted-foreground">
              Bisherige Antwort
              {r.replyAt ? (
                <>
                  {" · "}
                  <time dateTime={r.replyAt} className="tabular-nums">
                    {fmtStamp(r.replyAt)}
                  </time>
                </>
              ) : null}
            </span>
            <p className="text-sm break-words whitespace-pre-line">{r.reply}</p>
          </div>
        ) : null}
        {changedAfterReply(r) ? (
          <p className="text-xs text-muted-foreground">
            Die Bewertung wurde nach der Antwort geändert.
          </p>
        ) : null}
      </section>
    </>
  )
}

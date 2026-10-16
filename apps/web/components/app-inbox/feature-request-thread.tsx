import { MessageSquare, ThumbsUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { fmtDate, label } from "@/components/growth/format"
import type {
  FeatureRequestComment,
  InboxFeatureRequest,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { FEATURAMA_STATUS_LABEL, fmtStamp, plural } from "./labels"
import { InboxStateToken, NotApprovedNote } from "./markers"

type Entry = {
  id: string
  developer: boolean
  author: string | null
  content: string
  createdAt: string | null
}

/** Request body first, then all comments in chronological order. */
function thread(r: InboxFeatureRequest): Entry[] {
  const comments = [...r.comments]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c: FeatureRequestComment) => ({
      id: c.id,
      developer: c.role === "developer",
      author: c.author,
      content: c.content,
      createdAt: c.createdAt,
    }))
  const body = r.body?.trim()
  return body
    ? [
        {
          id: "request",
          developer: false,
          author: null,
          content: body,
          createdAt: r.requestedAt,
        },
        ...comments,
      ]
    : comments
}

export function platformText(r: InboxFeatureRequest) {
  return [r.platform, r.appVersion ? `Version ${r.appVersion}` : null]
    .filter(Boolean)
    .join(" · ")
}

/** Meta data and full thread of a feature request, shown in the inbox sheet. */
export function FeatureRequestDetails({
  request: r,
  projectName,
}: {
  request: InboxFeatureRequest
  projectName: string | null
}) {
  const entries = thread(r)
  const platform = platformText(r)
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <InboxStateToken state={r.state} />
          {r.status ? (
            <Badge variant="outline">
              {label(FEATURAMA_STATUS_LABEL, r.status)}
            </Badge>
          ) : null}
          {projectName ? (
            <Badge variant="secondary">{projectName}</Badge>
          ) : null}
          <span className="inline-flex items-center gap-1 tabular-nums">
            <ThumbsUp aria-hidden="true" className="size-3" />
            {plural(r.votes, "Stimme", "Stimmen")}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <MessageSquare aria-hidden="true" className="size-3" />
            {plural(r.commentCount, "Kommentar", "Kommentare")}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Plattform</dt>
          <dd>{platform || "unbekannt"}</dd>
          <dt className="text-muted-foreground">Angefragt</dt>
          <dd className="tabular-nums">{fmtDate(r.requestedAt)}</dd>
        </dl>
        {!r.approved ? <NotApprovedNote /> : null}
        {r.url ? (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            In Featurama öffnen
          </a>
        ) : null}
      </div>

      <section
        aria-labelledby="inbox-thread-comments"
        className="flex flex-col gap-3"
      >
        <h3 id="inbox-thread-comments" className="text-sm font-medium">
          Verlauf
        </h3>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Kein Text und keine Kommentare.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {entries.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "flex min-w-0 flex-col gap-1.5 rounded-lg p-3",
                  e.developer
                    ? "ml-6 bg-muted sm:ml-12"
                    : "mr-6 border sm:mr-12"
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Badge variant={e.developer ? "default" : "outline"}>
                    {e.developer ? "Entwickler" : "Nutzer"}
                  </Badge>
                  {e.developer && e.author ? (
                    <span className="font-medium">{e.author}</span>
                  ) : null}
                  {e.id === "request" ? (
                    <span className="text-muted-foreground">Anfrage</span>
                  ) : null}
                  <time
                    dateTime={e.createdAt ?? undefined}
                    className="text-muted-foreground tabular-nums"
                  >
                    {fmtStamp(e.createdAt)}
                  </time>
                </div>
                <p className="text-sm break-words whitespace-pre-line">
                  {e.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

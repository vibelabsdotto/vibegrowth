import Link from "next/link"
import { ExternalLink } from "lucide-react"
import {
  FEATURAMA_STATUS_LABEL,
  fmtStamp,
  localeLabel,
} from "@/components/app-inbox/labels"
import {
  reviewReplyState,
  StatusToken,
  type InboxTone,
} from "@/components/app-inbox/markers"
import { Stars } from "@/components/app-inbox/stars"
import type {
  InboxFeatureRequest,
  InboxItem,
  InboxReview,
  ReplyPayload,
  TaskPayload,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import {
  BACKLOG_KIND_LABEL,
  fmtDateTime,
  label,
  REPLY_TARGET_LABEL,
  SOURCE_TYPE_LABEL,
  STORE_LABEL,
} from "./format"

/** Key of an inbox item for approval lookups: project, inbox type, item id. */
export function inboxKey(projectId: string, type: string, itemId: string) {
  return `${projectId}|${type}|${itemId}`
}

export function replyType(target: string) {
  return target === "featurama" ? "feature_request" : "review"
}

/** Where an inbox item lives in the web app. */
export function inboxHref(type: string, itemId: string) {
  return type === "feature_request"
    ? `/feature-requests?filter=all&item=${encodeURIComponent(itemId)}`
    : `/reviews?filter=all&item=${encodeURIComponent(itemId)}`
}

/**
 * Publication state of an approved reply (set by `app publish`). Pending replies have none.
 */
export function publishState(
  status: string,
  p: Pick<ReplyPayload, "published" | "publish"> | undefined
): { tone: InboxTone; text: string; detail?: string } | null {
  if (status !== "approved" || !p) return null
  if (p.published)
    return {
      tone: "good",
      text: `Veröffentlicht ${fmtDateTime(p.published.at)}`,
      detail:
        p.published.verified === false ? "nicht zurückgelesen" : undefined,
    }
  if (p.publish?.state === "stale")
    return {
      tone: "warn",
      text: "Nicht veröffentlicht, das Ziel hat sich geändert",
      detail: p.publish.reason,
    }
  if (p.publish?.state === "error")
    return {
      tone: "bad",
      text: "Veröffentlichen fehlgeschlagen, der nächste Lauf versucht es erneut",
      detail: p.publish.reason,
    }
  return {
    tone: "info",
    text: "Freigegeben, geht beim nächsten Lauf von app publish raus",
  }
}

export function PublishStateLine({
  state,
  refUrl,
}: {
  state: NonNullable<ReturnType<typeof publishState>>
  refUrl?: string | null
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <StatusToken tone={state.tone}>{state.text}</StatusToken>
      {state.detail ? (
        <span className="pl-3.5 text-xs break-words text-muted-foreground">
          {state.detail}
        </span>
      ) : null}
      {refUrl && /^https?:\/\//.test(refUrl) ? (
        <a
          href={refUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 pl-3.5 text-xs text-muted-foreground underline underline-offset-4"
        >
          Antwort ansehen
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : null}
    </span>
  )
}

/** The message a reply answers: store review or Featurama thread. */
export function ReplyContext({
  payload,
  item,
}: {
  payload: ReplyPayload
  item: InboxItem | undefined
}) {
  const target = label(REPLY_TARGET_LABEL, payload.target)
  if (!item)
    return (
      <p className="text-sm text-muted-foreground">
        {target}-Eintrag {payload.itemId} ist nicht im Spiegel. Der Collector
        holt ihn beim nächsten Lauf.
      </p>
    )
  return item.type === "review" ? (
    <ReviewContext review={item} />
  ) : (
    <ThreadContext request={item} />
  )
}

function ReviewContext({ review: r }: { review: InboxReview }) {
  const lang = localeLabel(r.language)
  const state = reviewReplyState(r)
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Stars value={r.rating} />
        <span>{label(STORE_LABEL, r.store)}</span>
        {r.version ? <span>Version {r.version}</span> : null}
        {lang ? <span title={lang.title}>{lang.text}</span> : null}
        <span>{fmtStamp(r.lastModified ?? r.date)}</span>
      </div>
      {r.title ? <p className="font-medium">{r.title}</p> : null}
      {r.body ? (
        <p className="break-words whitespace-pre-wrap">{r.body}</p>
      ) : null}
      <StatusToken tone={state.tone}>{state.label}</StatusToken>
      {r.reply ? (
        <div className="flex flex-col gap-1 border-l-2 pl-3 text-muted-foreground">
          <span className="text-xs">
            Bisherige Antwort · {fmtStamp(r.replyAt)}
          </span>
          <p className="break-words whitespace-pre-wrap">{r.reply}</p>
        </div>
      ) : null}
    </div>
  )
}

function ThreadContext({ request: r }: { request: InboxFeatureRequest }) {
  const comments = [...(r.comments ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
  const shown = comments.slice(-4)
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {r.status ? (
          <span>{label(FEATURAMA_STATUS_LABEL, r.status)}</span>
        ) : null}
        <span>{r.votes} Votes</span>
        {r.platform ? <span>{r.platform}</span> : null}
        {r.appVersion ? <span>Version {r.appVersion}</span> : null}
        <span>{fmtStamp(r.requestedAt)}</span>
      </div>
      <Link
        href={inboxHref("feature_request", r.requestId)}
        prefetch={false}
        className="font-medium underline-offset-4 hover:underline"
      >
        {r.title}
      </Link>
      {r.body ? (
        <p className="line-clamp-6 break-words whitespace-pre-wrap">{r.body}</p>
      ) : null}
      {comments.length > shown.length ? (
        <p className="text-xs text-muted-foreground">
          {comments.length - shown.length} ältere Kommentare im Thread
        </p>
      ) : null}
      {shown.length ? (
        <ol className="flex flex-col gap-2">
          {shown.map((c) => (
            <li
              key={c.id}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg px-3 py-2",
                c.role === "developer" ? "bg-muted" : "border"
              )}
            >
              <span className="text-xs text-muted-foreground">
                {c.role === "developer"
                  ? `Antwort von ${c.author ?? "Entwickler"}`
                  : "Nutzer"}{" "}
                · {fmtStamp(c.createdAt)}
              </span>
              <span className="break-words whitespace-pre-wrap">
                {c.content}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

/** Title, detail, kind, impact/effort and sources of a task suggestion. */
export function TaskDetails({
  payload: t,
  sources,
}: {
  payload: TaskPayload
  /** resolved inbox items per source key */
  sources: Record<string, InboxItem>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {t.title ? (
          <>
            <dt className="text-muted-foreground">Aufgabe</dt>
            <dd className="font-medium">{t.title}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Art</dt>
        <dd>{label(BACKLOG_KIND_LABEL, t.kind ?? "other")}</dd>
        <dt className="text-muted-foreground">Impact, Aufwand</dt>
        <dd className="tabular-nums">
          {t.impact ?? 2} von 3, {t.effort ?? 2} von 3
        </dd>
      </dl>
      {t.detail ? (
        <p className="break-words whitespace-pre-wrap">{t.detail}</p>
      ) : null}
      {t.sources?.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Quellen</span>
          <ul className="flex flex-col gap-1">
            {t.sources.map((s) => {
              const item = sources[`${s.type}|${s.id}`]
              const text = !item
                ? s.id
                : item.type === "feature_request"
                  ? `„${item.title}“`
                  : `${item.rating ?? "–"} Sterne, „${(item.body ?? item.title ?? "").slice(0, 80)}${(item.body ?? "").length > 80 ? "…" : ""}“`
              return (
                <li key={`${s.type}-${s.id}`} className="min-w-0">
                  <span className="text-muted-foreground">
                    {label(SOURCE_TYPE_LABEL, s.type)}{" "}
                  </span>
                  {s.type === "feature_request" || s.type === "review" ? (
                    <Link
                      href={inboxHref(s.type, s.id)}
                      prefetch={false}
                      className="break-words underline underline-offset-4"
                    >
                      {text}
                    </Link>
                  ) : (
                    <span className="break-words">{text}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

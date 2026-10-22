"use client"

import * as React from "react"
import Link from "next/link"
import { Check, Pencil, RotateCcw } from "lucide-react"
import {
  acceptTask,
  commentTask,
  loadTask,
  reopenTask,
} from "@/app/growth-actions"
import { StatusToken, type InboxTone } from "@/components/app-inbox/markers"
import { Markdown } from "@/components/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type {
  BacklogDetail,
  BacklogItem,
  InboxItem,
  TaskComment,
} from "@/lib/growth-types"
import { actorLabel, BACKLOG_KIND_LABEL, fmtDateTime, label } from "./format"

export const ASSIGNEE_LABEL: Record<string, string> = {
  byte: "Byte",
  hunter: "Hunter",
  echo: "Echo",
  max: "Max",
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  open: "Offen",
  doing: "In Arbeit",
  question: "Rückfrage",
  testing: "Zum Testen",
  done: "Erledigt",
  dropped: "Verworfen",
}

const STATUS_TONE: Record<string, InboxTone> = {
  open: "warn",
  doing: "info",
  question: "warn",
  testing: "info",
  done: "good",
  dropped: "neutral",
}

/** Data-dir file through the /media rewrite (lib/api is server-only). */
const mediaUrl = (rel: string) => `/media?path=${encodeURIComponent(rel)}`

const COMMENT_LABEL: Record<string, string> = {
  report: "Bericht",
  feedback: "Klappt nicht",
  answer: "Antwort von Max",
  accept: "Passt",
  comment: "Notiz",
}

export function TaskStatus({ status }: { status: string }) {
  return (
    <StatusToken tone={STATUS_TONE[status] ?? "neutral"}>
      {label(TASK_STATUS_LABEL, status)}
    </StatusToken>
  )
}

function Comment({ c }: { c: TaskComment }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {actorLabel(c.actor)}
        </span>
        <span>{label(COMMENT_LABEL, c.kind)}</span>
        <span>{fmtDateTime(c.createdAt)}</span>
      </div>
      <Markdown className="text-sm">{c.body}</Markdown>
      {c.attachments.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {c.attachments.map((a) => {
            const url = mediaUrl(a)
            return (
              <a
                key={a}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-md border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- media from the local API */}
                <img
                  src={url}
                  alt={`Anhang ${a.split("/").pop()}`}
                  className="h-40 w-full object-cover object-top"
                  loading="lazy"
                />
              </a>
            )
          })}
        </div>
      ) : null}
    </li>
  )
}

type Busy = "accept" | "reopen" | "comment" | null

/**
 * One task in a sheet from the right: details, linked inbox items, the thread with reports,
 * screenshots and feedback, and Max' verdict ("Passt" / "Klappt nicht").
 */
export function TaskSheet({
  item,
  projectName,
  open,
  onOpenChange,
  onEdit,
  finalFocus,
  sourceItems = {},
}: {
  item: BacklogItem | null
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens the edit form; without it no edit button (Wartet auf Max) */
  onEdit?: () => void
  finalFocus: () => HTMLElement | null
  /** inbox items by `${type}|${id}`, shown inline instead of a link */
  sourceItems?: Record<string, InboxItem>
}) {
  // Loaded thread per task id; a different id simply shows the spinner until its load lands.
  const [loaded, setLoaded] = React.useState<{
    id: number
    detail: BacklogDetail | null
    error: string | null
  } | null>(null)
  const [text, setText] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<Busy>(null)
  const fieldId = React.useId()
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const id = item?.id ?? null

  React.useEffect(() => {
    if (!open || id === null) return
    let live = true
    loadTask(id).then((r) => {
      if (!live) return
      setLoaded(
        r.ok
          ? { id, detail: r.data, error: null }
          : { id, detail: null, error: r.error }
      )
    })
    return () => {
      live = false
    }
  }, [open, id])
  const detail = loaded && loaded.id === id ? loaded.detail : null
  const loadError = loaded && loaded.id === id ? loaded.error : null
  const setDetail = (d: BacklogDetail) =>
    setLoaded({ id: d.id, detail: d, error: null })

  const task = detail ?? (item ? { ...item, comments: [] } : null)
  const closed = task?.status === "done" || task?.status === "dropped"
  const question = task?.status === "question"

  async function act(kind: Exclude<Busy, null>) {
    if (!task) return
    const body = text.trim()
    if ((kind === "reopen" || kind === "comment") && !body) {
      setError(
        kind === "reopen"
          ? question
            ? "Die Antwort ist leer."
            : "Schreib kurz, was nicht klappt."
          : "Die Notiz ist leer."
      )
      return
    }
    setBusy(kind)
    setError(null)
    const r =
      kind === "accept"
        ? await acceptTask(task.id, body)
        : kind === "reopen"
          ? await reopenTask(task.id, body)
          : await commentTask(task.id, body)
    setBusy(null)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setDetail(r.data)
    setText("")
    toast.add({
      title:
        kind === "accept"
          ? "Aufgabe erledigt"
          : kind === "reopen"
            ? question
              ? "Antwort gesendet"
              : "Zurück an die Aufgabe"
            : "Notiz gespeichert",
      description:
        kind === "accept" && task.sources?.length
          ? "Für die verknüpfte Anfrage kommt eine Folgeantwort zur Freigabe."
          : undefined,
      type: "success",
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        initialFocus={bodyRef}
        finalFocus={finalFocus}
        className="gap-0 data-[side=right]:w-full motion-reduce:transition-none data-[side=right]:sm:max-w-xl"
      >
        {task ? (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="line-clamp-2 break-words">
                {task.title}
              </SheetTitle>
              <SheetDescription>
                {projectName} · {label(BACKLOG_KIND_LABEL, task.kind)} ·
                angelegt von {actorLabel(task.actor)}
              </SheetDescription>
            </SheetHeader>
            <div
              ref={bodyRef}
              tabIndex={-1}
              className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 outline-none"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <TaskStatus status={task.status} />
                <Badge variant="outline">
                  {task.assignee
                    ? `Zuständig: ${label(ASSIGNEE_LABEL, task.assignee)}`
                    : "Niemand zuständig"}
                </Badge>
                {task.doneRef ? (
                  <Badge variant="outline" className="font-mono">
                    {task.doneRef}
                  </Badge>
                ) : null}
                {task.releasedVersion ? (
                  <Badge variant="outline">
                    Ausgeliefert in {task.releasedVersion}
                  </Badge>
                ) : task.acceptedAt ? (
                  <span className="text-muted-foreground">
                    bestätigt {fmtDateTime(task.acceptedAt)}, noch nicht
                    ausgeliefert
                  </span>
                ) : null}
                {onEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={onEdit}
                  >
                    <Pencil data-icon="inline-start" aria-hidden="true" />
                    Bearbeiten
                  </Button>
                ) : null}
              </div>
              {task.detail ? (
                <Markdown className="text-sm">{task.detail}</Markdown>
              ) : null}
              {task.sources?.length ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium">Anfrage</h3>
                  <ul className="flex flex-col gap-2 text-sm">
                    {task.sources.map((s) => {
                      const src = sourceItems[`${s.type}|${s.id}`]
                      if (src) {
                        const text =
                          src.type === "feature_request"
                            ? src.body
                            : (src.body ?? src.title)
                        return (
                          <li
                            key={`${s.type}:${s.id}`}
                            className="flex flex-col gap-1 rounded-lg border p-3"
                          >
                            <span className="font-medium break-words">
                              {src.type === "feature_request"
                                ? src.title
                                : `Bewertung${src.rating ? ` · ${src.rating} Sterne` : ""}`}
                            </span>
                            {text ? (
                              <p className="line-clamp-8 break-words whitespace-pre-wrap text-muted-foreground">
                                {text}
                              </p>
                            ) : null}
                          </li>
                        )
                      }
                      return (
                        <li key={`${s.type}:${s.id}`}>
                          <Link
                            prefetch={false}
                            className="underline-offset-4 hover:underline"
                            href={
                              s.type === "feature_request"
                                ? `/feature-requests?filter=all&item=${encodeURIComponent(s.id)}`
                                : `/reviews?filter=all&item=${encodeURIComponent(s.id)}`
                            }
                          >
                            {s.type === "feature_request"
                              ? "Feature Request öffnen"
                              : "Bewertung öffnen"}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ) : null}
              <Separator />
              <section
                aria-labelledby="task-thread"
                className="flex flex-col gap-2"
              >
                <h3 id="task-thread" className="text-sm font-medium">
                  Verlauf
                </h3>
                {loadError ? (
                  <p className="text-sm text-(--status-bad)">{loadError}</p>
                ) : !detail ? (
                  <Spinner />
                ) : detail.comments.length ? (
                  <ol className="flex flex-col gap-2">
                    {detail.comments.map((c) => (
                      <Comment key={c.id} c={c} />
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Noch kein Bericht. Der zuständige Agent schreibt hier, was
                    er gemacht hat und wie du es testest.
                  </p>
                )}
              </section>
            </div>
            <SheetFooter className="mt-0 flex-col gap-3 border-t">
              <Field data-invalid={error !== null || undefined}>
                <FieldLabel htmlFor={fieldId}>
                  {question
                    ? "Deine Antwort"
                    : task.status === "testing"
                      ? "Feedback (bei „Klappt nicht“ nötig)"
                      : "Notiz"}
                </FieldLabel>
                <Textarea
                  id={fieldId}
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    question
                      ? "Entscheidung oder Antwort auf die Rückfrage"
                      : task.status === "testing"
                        ? "Was klappt nicht? Schritte, erwartet, tatsächlich …"
                        : "Hinweis oder Beispiel für den Agent"
                  }
                />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => act("comment")}
                >
                  {busy === "comment" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Notiz speichern
                </Button>
                {!closed ||
                (task.status === "done" && !task.releasedVersion) ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null || task.status === "open"}
                    onClick={() => act("reopen")}
                  >
                    {busy === "reopen" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <RotateCcw data-icon="inline-start" aria-hidden="true" />
                    )}
                    {question ? "Antwort senden" : "Klappt nicht"}
                  </Button>
                ) : null}
                {!closed && !question ? (
                  <Button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act("accept")}
                  >
                    {busy === "accept" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Check data-icon="inline-start" aria-hidden="true" />
                    )}
                    Passt
                  </Button>
                ) : null}
              </div>
            </SheetFooter>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>Aufgabe</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}

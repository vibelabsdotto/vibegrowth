"use client"

import Link from "next/link"
import * as React from "react"
import {
  Check,
  MessageSquarePlus,
  PencilLine,
  RotateCcw,
  X,
} from "lucide-react"
import { decideApproval, type Decision } from "@/app/growth-actions"
import { Markdown } from "@/components/markdown"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type {
  Approval,
  InboxItem,
  ReplyPayload,
  TaskPayload,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import {
  publishState,
  PublishStateLine,
  ReplyContext,
  TaskDetails,
} from "./approval-app"
import { CategoryLabel } from "./category"
import {
  actorLabel,
  APPROVAL_KIND_LABEL,
  APPROVAL_STATUS_LABEL,
  fmtDateTime,
  label,
  REPLY_MAX_LENGTH,
  REPLY_TARGET_LABEL,
} from "./format"

const DONE: Record<Decision, string> = {
  approved: "Freigegeben",
  changes_requested: "Änderung angefragt",
  rejected: "Abgelehnt",
}

const REF_LINK: Record<string, (id: string) => string> = {
  content: () => "/content",
  backlog: () => "/tasks",
  experiment: (id) => `/experiments/${id}`,
  format: (id) => `/formats/${id}`,
  plan_entry: () => "/calendar",
  hook: () => "/hooks",
}

const REF_LABEL: Record<string, string> = {
  content: "Content",
  backlog: "Aufgabe",
  experiment: "Experiment",
  format: "Format",
  plan_entry: "Planeintrag",
  hook: "Hook",
}

export type ApprovalContext = {
  /** reply: the review or Featurama request it answers */
  item?: InboxItem
  /** task: inbox items of payload.sources, key `${type}|${id}` */
  sources?: Record<string, InboxItem>
}

export function ApprovalCard({
  approval: a,
  projectName,
  context,
}: {
  approval: Approval
  projectName?: string
  context?: ApprovalContext
}) {
  const reply = a.kind === "reply" ? (a.payload as ReplyPayload) : null
  const task = a.kind === "task" ? ((a.payload ?? {}) as TaskPayload) : null
  const original = reply?.text ?? ""
  const [text, setText] = React.useState(original)
  const [note, setNote] = React.useState("")
  const [noteOpen, setNoteOpen] = React.useState(false)
  const [rejectArmed, setRejectArmed] = React.useState(false)
  const [pending, setPending] = React.useState<Decision | "edit" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const noteId = React.useId()
  const textId = React.useId()
  const counterId = React.useId()
  const noteRef = React.useRef<HTMLTextAreaElement>(null)
  const open = a.status === "pending"
  const busy = pending !== null

  const edited = reply !== null && text.trim() !== original.trim()
  const max = reply ? (REPLY_MAX_LENGTH[reply.target] ?? 10000) : 0
  const length = text.trim().length
  const tooLong = reply !== null && length > max
  const empty = reply !== null && length === 0

  async function decide(decision: Decision, withText = false) {
    setPending(withText ? "edit" : decision)
    setError(null)
    const res = await decideApproval(
      a.id,
      decision,
      note,
      withText ? text : undefined
    ).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }))
    setPending(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    toast.add({
      title: withText ? "Geändert und freigegeben" : DONE[decision],
      description: a.title,
      type: "success",
      timeout: 4000,
    })
  }

  function reject() {
    // Reply and task: the first click asks for a note, the second rejects.
    if ((reply || task) && !rejectArmed) {
      setRejectArmed(true)
      setNoteOpen(true)
      requestAnimationFrame(() => noteRef.current?.focus())
      return
    }
    void decide("rejected")
  }

  const refHref =
    a.refType && a.refId ? REF_LINK[a.refType]?.(a.refId) : undefined
  const published = reply ? publishState(a.status, reply) : null

  const spinner = (k: Decision | "edit", Icon: typeof Check) =>
    pending === k ? (
      <Spinner data-icon="inline-start" aria-hidden="true" />
    ) : (
      <Icon data-icon="inline-start" aria-hidden="true" />
    )

  return (
    <Card id={`approval-${a.id}`} size="sm" aria-busy={busy}>
      <CardHeader>
        <CardTitle className="leading-snug">{a.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary">
            {label(APPROVAL_KIND_LABEL, a.kind)}
          </Badge>
          <CategoryLabel category={a.category} />
          {reply ? (
            <span className="font-medium text-foreground">
              {label(REPLY_TARGET_LABEL, reply.target)}
            </span>
          ) : null}
          {projectName ? <span>{projectName}</span> : null}
          {a.accountId ? <span>@{a.accountId}</span> : null}
          <span>
            von {actorLabel(a.requestedBy)} · {fmtDateTime(a.createdAt)}
          </span>
          {a.refType ? (
            refHref ? (
              <Link
                href={refHref}
                prefetch={false}
                className="underline underline-offset-4"
              >
                {label(REF_LABEL, a.refType)} {a.refId}
              </Link>
            ) : (
              <span>
                {label(REF_LABEL, a.refType)} {a.refId}
              </span>
            )
          ) : null}
        </CardDescription>
        {!open ? (
          <CardAction>
            <Badge variant={a.status === "approved" ? "default" : "outline"}>
              {label(APPROVAL_STATUS_LABEL, a.status)}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>

      {reply ? (
        <CardContent className="@container flex flex-col gap-4">
          {a.body ? (
            <Markdown className="max-w-prose text-muted-foreground">
              {a.body}
            </Markdown>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-4 @2xl:grid-cols-2">
            <section
              aria-label="Originalnachricht"
              className="flex min-w-0 flex-col gap-2"
            >
              <h3 className="text-xs font-medium text-muted-foreground">
                {reply.target === "featurama" ? "Feature Request" : "Bewertung"}
              </h3>
              <ReplyContext payload={reply} item={context?.item} />
            </section>
            {open ? (
              <Field data-invalid={tooLong || empty || undefined}>
                <FieldLabel htmlFor={textId}>
                  Antworttext
                  {reply.language ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      ({reply.language})
                    </span>
                  ) : null}
                </FieldLabel>
                <Textarea
                  id={textId}
                  rows={8}
                  value={text}
                  disabled={busy}
                  aria-invalid={tooLong || empty || undefined}
                  aria-describedby={counterId}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-40"
                />
                <FieldDescription
                  id={counterId}
                  className="flex items-start justify-between gap-3"
                >
                  <span>
                    {edited
                      ? "Geändert. Das Original bleibt im Verlauf."
                      : "Vorschlag des Agents. Du kannst ihn vor der Freigabe ändern."}
                  </span>
                  {reply.target === "google_play" || tooLong ? (
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        tooLong && "font-medium text-destructive"
                      )}
                    >
                      {length}/{max}
                    </span>
                  ) : null}
                </FieldDescription>
              </Field>
            ) : (
              <section
                aria-label="Antwort"
                className="flex min-w-0 flex-col gap-2"
              >
                <h3 className="text-xs font-medium text-muted-foreground">
                  Antwort
                  {reply.editedBy
                    ? ` · geändert von ${actorLabel(reply.editedBy)}`
                    : ""}
                </h3>
                <p className="text-sm break-words whitespace-pre-wrap">
                  {reply.text}
                </p>
                {published ? (
                  <PublishStateLine
                    state={published}
                    refUrl={reply.published?.ref}
                  />
                ) : null}
              </section>
            )}
          </div>
        </CardContent>
      ) : task ? (
        <CardContent className="flex flex-col gap-4">
          {a.body ? (
            <Markdown className="max-w-prose text-muted-foreground">
              {a.body}
            </Markdown>
          ) : null}
          <TaskDetails payload={task} sources={context?.sources ?? {}} />
        </CardContent>
      ) : a.body ? (
        <CardContent>
          <Markdown className="max-w-prose">{a.body}</Markdown>
        </CardContent>
      ) : null}

      {!open ? (
        <CardFooter className="flex-col items-start gap-1 text-xs text-muted-foreground">
          <span>
            {label(APPROVAL_STATUS_LABEL, a.status)} von{" "}
            {actorLabel(a.decidedBy)} · {fmtDateTime(a.decidedAt)}
          </span>
          {a.decisionNote ? (
            <span className="text-foreground">Notiz: {a.decisionNote}</span>
          ) : null}
        </CardFooter>
      ) : (
        <CardFooter className="flex-col items-stretch gap-3">
          {noteOpen ? (
            <Field>
              <FieldLabel htmlFor={noteId}>
                {rejectArmed ? "Warum ablehnen?" : "Notiz"}{" "}
                <span className="font-normal text-muted-foreground">
                  (optional, geht an den Agent)
                </span>
              </FieldLabel>
              <Textarea
                id={noteId}
                ref={noteRef}
                rows={2}
                value={note}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  rejectArmed ? "Was passt nicht?" : "Was soll anders werden?"
                }
              />
            </Field>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Entscheidung nicht gespeichert</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {reply ? (
              <>
                {edited ? (
                  <Button
                    type="button"
                    disabled={busy || tooLong || empty}
                    onClick={() => decide("approved", true)}
                  >
                    {spinner("edit", PencilLine)}
                    Ändern & freigeben
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={busy || tooLong}
                    onClick={() => decide("approved")}
                  >
                    {spinner("approved", Check)}
                    Freigeben
                  </Button>
                )}
                {edited ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setText(original)}
                  >
                    <RotateCcw data-icon="inline-start" aria-hidden="true" />
                    Zurücksetzen
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    title="Erst den Antworttext ändern"
                  >
                    <PencilLine data-icon="inline-start" aria-hidden="true" />
                    Ändern & freigeben
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                disabled={busy}
                onClick={() => decide("approved")}
              >
                {spinner("approved", Check)}
                Freigeben
              </Button>
            )}
            {!reply && !task ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => decide("changes_requested")}
              >
                {spinner("changes_requested", PencilLine)}
                Änderung
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={reject}
            >
              {spinner("rejected", X)}
              {rejectArmed ? "Ablehnen bestätigen" : "Ablehnen"}
            </Button>
            {!noteOpen ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:ml-auto"
                disabled={busy}
                onClick={() => setNoteOpen(true)}
              >
                <MessageSquarePlus
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Notiz
              </Button>
            ) : null}
          </div>
          {reply ? (
            <p className="text-xs text-muted-foreground">
              Nach der Freigabe postet der nächste Lauf von app publish die
              Antwort öffentlich auf {label(REPLY_TARGET_LABEL, reply.target)}.
            </p>
          ) : task ? (
            <p className="text-xs text-muted-foreground">
              Die Freigabe legt eine Aufgabe im Bereich App an.
            </p>
          ) : null}
        </CardFooter>
      )}
    </Card>
  )
}

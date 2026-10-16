"use client"

import * as React from "react"
import Link from "next/link"
import { markInboxNoReply, replyToInboxItem } from "@/app/growth-actions"
import {
  publishState,
  PublishStateLine,
} from "@/components/growth/approval-app"
import { fmtDateTime, REPLY_MAX_LENGTH } from "@/components/growth/format"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type { InboxApproval, InboxItem, InboxState } from "@/lib/growth-types"
import { cn } from "@/lib/utils"

/** Agent reply suggestion that still waits for Max. */
function pendingProposal(item: InboxItem) {
  return item.approvals.find(
    (a) => a.kind === "reply" && a.status === "pending"
  )
}

/** Newest approved reply, the one `app publish` takes or took. */
function approvedReply(item: InboxItem): InboxApproval | undefined {
  return item.approvals
    .filter((a) => a.kind === "reply" && a.status === "approved")
    .sort((a, b) => b.id - a.id)[0]
}

/** States in which an approved reply's publish state is worth showing. */
const PUBLISH_STATES: InboxState[] = ["approved", "answered", "stale", "error"]
/** States in which „Keine Antwort nötig“ makes sense. */
const NO_REPLY_STATES: InboxState[] = ["open", "proposal", "stale", "error"]

type Busy = "reply" | "no-reply" | null

/**
 * Max' actions on one inbox item: open the agent's suggestion, write an own reply
 * (approved right away, goes out with the next `app publish`) or mark „Keine Antwort nötig“.
 * Mount with a key per item and state so a finished action resets the form. `onDone`
 * runs after a confirmed action (the sheet closes, so the toast is not covered).
 */
export function InboxItemActions({
  item,
  onDone,
}: {
  item: InboxItem
  onDone?: () => void
}) {
  const proposal = pendingProposal(item)
  const reply = approvedReply(item)
  const pub =
    reply && PUBLISH_STATES.includes(item.state)
      ? publishState("approved", reply)
      : null
  // An approved, unpublished reply blocks a second one (one open reply per item).
  const canReply = item.state !== "approved"
  const canNoReply = NO_REPLY_STATES.includes(item.state)

  const [composing, setComposing] = React.useState(false)
  const [text, setText] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<Busy>(null)
  const [, startTransition] = React.useTransition()
  const fieldId = React.useId()

  const max = REPLY_MAX_LENGTH[item.target] ?? null
  const length = text.trim().length
  const over = max !== null && length > max
  const showCounter = item.target === "google_play" || over
  const target = {
    project: item.projectId,
    target: item.target,
    itemId: item.itemId,
  }

  const sendReply = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || length === 0 || over) return
    setBusy("reply")
    setError(null)
    startTransition(async () => {
      const res = await replyToInboxItem(target, text)
      setBusy(null)
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.add({
        title: "Antwort freigegeben",
        description: "Sie geht beim nächsten Lauf von app publish raus.",
        type: "success",
      })
      setComposing(false)
      setText("")
      onDone?.()
    })
  }

  const noReply = () => {
    if (busy) return
    setBusy("no-reply")
    setError(null)
    startTransition(async () => {
      const res = await markInboxNoReply(target)
      setBusy(null)
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.add({
        title: "Keine Antwort nötig",
        description:
          "Schreibt der Nutzer wieder, ist der Eintrag wieder offen.",
        type: "success",
      })
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {pub ? (
        <PublishStateLine state={pub} refUrl={reply?.published?.ref} />
      ) : null}
      {item.state === "no_reply" ? (
        <p className="text-xs text-muted-foreground">
          Als „keine Antwort nötig“ markiert
          {item.noReplyAt ? ` am ${fmtDateTime(item.noReplyAt)}` : ""}. Schreibt
          der Nutzer wieder, ist der Eintrag wieder offen.
        </p>
      ) : null}
      {proposal && composing ? (
        <p className="text-xs text-muted-foreground">
          Deine Antwort ersetzt den offenen Vorschlag des Agents.
        </p>
      ) : null}

      {composing ? (
        <form onSubmit={sendReply} className="flex min-w-0 flex-col gap-3">
          <Field data-invalid={over || error !== null || undefined}>
            <FieldLabel htmlFor={fieldId}>Eigene Antwort</FieldLabel>
            <Textarea
              id={fieldId}
              value={text}
              autoFocus
              rows={4}
              disabled={busy === "reply"}
              aria-invalid={over || undefined}
              onChange={(e) => setText(e.target.value)}
              className="max-h-64"
            />
            <FieldDescription className="flex flex-wrap justify-between gap-x-3">
              <span>Geht beim nächsten Lauf von app publish raus.</span>
              {showCounter && max !== null ? (
                <span className="tabular-nums">
                  {length}/{max}
                </span>
              ) : null}
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={busy !== null || length === 0 || over}
            >
              {busy === "reply" ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : null}
              Antwort freigeben
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setComposing(false)
                setError(null)
              }}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : (
        <>
          {proposal || canReply || canNoReply ? (
            <div className="flex flex-wrap gap-2">
              {proposal ? (
                <Link
                  href={`/approvals?item=${proposal.id}`}
                  prefetch={false}
                  className={cn(buttonVariants())}
                >
                  Vorschlag ansehen
                </Link>
              ) : null}
              {canReply ? (
                <Button
                  type="button"
                  variant={proposal || !canNoReply ? "outline" : "default"}
                  disabled={busy !== null}
                  onClick={() => {
                    setComposing(true)
                    setError(null)
                  }}
                >
                  Eigene Antwort
                </Button>
              ) : null}
              {canNoReply ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={noReply}
                >
                  {busy === "no-reply" ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : null}
                  Keine Antwort nötig
                </Button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

"use client"

import Link from "next/link"
import * as React from "react"
import { Check, MessageSquarePlus, PencilLine, X } from "lucide-react"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type { Approval } from "@/lib/growth-types"
import {
  actorLabel,
  APPROVAL_KIND_LABEL,
  APPROVAL_STATUS_LABEL,
  fmtDateTime,
  label,
} from "./format"

const DONE: Record<Decision, string> = {
  approved: "Freigegeben",
  changes_requested: "Änderung angefragt",
  rejected: "Abgelehnt",
}

const REF_LINK: Record<string, (id: string) => string> = {
  content: () => "/content",
  backlog: () => "/backlog",
  experiment: (id) => `/experiments/${id}`,
  format: (id) => `/formats/${id}`,
  plan_entry: () => "/calendar",
  hook: () => "/hooks",
}

const REF_LABEL: Record<string, string> = {
  content: "Content",
  backlog: "Backlog",
  experiment: "Experiment",
  format: "Format",
  plan_entry: "Planeintrag",
  hook: "Hook",
}

export function ApprovalCard({
  approval: a,
  projectName,
}: {
  approval: Approval
  projectName?: string
}) {
  const [note, setNote] = React.useState("")
  const [noteOpen, setNoteOpen] = React.useState(false)
  const [pending, setPending] = React.useState<Decision | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const noteId = React.useId()
  const open = a.status === "pending"

  async function decide(decision: Decision) {
    setPending(decision)
    setError(null)
    const res = await decideApproval(a.id, decision, note).catch(
      (e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      })
    )
    setPending(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    toast.add({
      title: DONE[decision],
      description: a.title,
      type: "success",
      timeout: 4000,
    })
  }

  const refHref =
    a.refType && a.refId ? REF_LINK[a.refType]?.(a.refId) : undefined

  return (
    <Card size="sm" aria-busy={pending !== null}>
      <CardHeader>
        <CardTitle className="leading-snug">{a.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary">
            {label(APPROVAL_KIND_LABEL, a.kind)}
          </Badge>
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
      {a.body ? (
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
              <FieldLabel htmlFor={noteId}>Notiz (optional)</FieldLabel>
              <Textarea
                id={noteId}
                rows={2}
                value={note}
                disabled={pending !== null}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Was soll anders werden?"
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
            <Button
              type="button"
              disabled={pending !== null}
              onClick={() => decide("approved")}
            >
              {pending === "approved" ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Check data-icon="inline-start" aria-hidden="true" />
              )}
              Freigeben
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending !== null}
              onClick={() => decide("changes_requested")}
            >
              {pending === "changes_requested" ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <PencilLine data-icon="inline-start" aria-hidden="true" />
              )}
              Änderung
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending !== null}
              onClick={() => decide("rejected")}
            >
              {pending === "rejected" ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <X data-icon="inline-start" aria-hidden="true" />
              )}
              Ablehnen
            </Button>
            {!noteOpen ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:ml-auto"
                disabled={pending !== null}
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
        </CardFooter>
      )}
    </Card>
  )
}

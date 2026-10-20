"use client"

import Link from "next/link"
import * as React from "react"
import {
  Check,
  CircleCheck,
  MessageSquareOff,
  RotateCcw,
  X,
} from "lucide-react"
import { decideApproval, type Decision } from "@/app/growth-actions"
import { Markdown } from "@/components/markdown"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
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
import { categoryLabel } from "@/lib/categories"
import type {
  Approval,
  ApprovalEffect,
  ReplyPayload,
  StrategyPayload,
  TaskPayload,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { InboxTasks } from "@/components/app-inbox/inbox-sheet"
import {
  publishState,
  PublishStateLine,
  ReplyContext,
  TaskDetails,
} from "./approval-app"
import type { ApprovalContext } from "./approval-inbox"
import { CategoryLabel } from "./category"
import {
  actorLabel,
  APPROVAL_KIND_LABEL,
  APPROVAL_STATUS_LABEL,
  CONTENT_KIND_LABEL,
  fmtDateTime,
  label,
  REPLY_MAX_LENGTH,
  REPLY_TARGET_LABEL,
  shortTitle,
} from "./format"

type Action = Decision | "no_reply"

const DONE: Record<Action, string> = {
  approved: "Bestätigt",
  changes_requested: "Änderung angefragt",
  rejected: "Abgelehnt",
  no_reply: "Keine Antwort nötig",
}

const REF_LINK: Record<string, (id: string) => string> = {
  content: (id) => `/content?item=${encodeURIComponent(id)}`,
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

export type DecisionNotice = { title: string; description?: string }

function effectText(effects: ApprovalEffect[] | undefined) {
  const list = (effects ?? []).map((e) => e.change).filter(Boolean)
  return list.length ? [...new Set(list)].join(" · ") : undefined
}

export function ApprovalSheet({
  open,
  approval,
  missingId,
  context,
  projectName,
  notice,
  onClose,
  onDecided,
}: {
  open: boolean
  approval: Approval | null
  /** ?item= points to an approval that could not be loaded */
  missingId: number | null
  context: ApprovalContext | undefined
  projectName: string
  /** result of the previous decision, shown above the next entry */
  notice: DecisionNotice | null
  onClose: () => void
  /** after a successful decision; opens the next entry or closes */
  onDecided: (id: number, notice: DecisionNotice) => void
}) {
  const bodyRef = React.useRef<HTMLDivElement>(null)
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent
        side="right"
        initialFocus={bodyRef}
        finalFocus={() =>
          approval
            ? document.getElementById(`approval-row-${approval.id}`)
            : null
        }
        className="gap-0 data-[side=right]:w-full motion-reduce:transition-none data-[side=right]:sm:max-w-xl"
      >
        {approval ? (
          <ApprovalDetail
            key={approval.id}
            approval={approval}
            context={context}
            projectName={projectName}
            bodyRef={bodyRef}
            notice={notice}
            onDecided={onDecided}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>Freigabe nicht gefunden</SheetTitle>
            <SheetDescription>
              {missingId
                ? `Freigabe #${missingId} gibt es nicht oder sie ist nicht mehr geladen.`
                : "Kein Eintrag gewählt."}
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  )
  if (!shown.length) return null
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      {shown.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function ApprovalDetail({
  approval: a,
  context,
  projectName,
  bodyRef,
  notice,
  onDecided,
}: {
  approval: Approval
  context: ApprovalContext | undefined
  projectName: string
  bodyRef: React.RefObject<HTMLDivElement | null>
  notice: DecisionNotice | null
  onDecided: (id: number, notice: DecisionNotice) => void
}) {
  const payload = (a.payload ?? {}) as Record<string, unknown>
  const reply = a.kind === "reply" ? (payload as ReplyPayload) : null
  const original = reply?.text ?? ""
  const [text, setText] = React.useState(original)
  const [note, setNote] = React.useState("")
  const [pending, setPending] = React.useState<Action | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const textId = React.useId()
  const counterId = React.useId()
  const noteId = React.useId()
  const open = a.status === "pending"
  const busy = pending !== null

  const edited = reply !== null && text.trim() !== original.trim()
  const max = reply ? (REPLY_MAX_LENGTH[reply.target] ?? 10000) : 0
  const length = text.trim().length
  const tooLong = reply !== null && length > max
  const empty = reply !== null && length === 0

  async function decide(action: Action) {
    setPending(action)
    setError(null)
    const decision: Decision = action === "no_reply" ? "rejected" : action
    const res = await decideApproval(
      a.id,
      decision,
      note,
      action === "approved" && edited ? text : undefined,
      action === "no_reply"
    ).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }))
    setPending(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onDecided(a.id, {
      title: `${DONE[action]}: ${shortTitle(a.title)}`,
      description: effectText(res.data.effects),
    })
  }

  const refHref =
    a.refType && a.refId ? REF_LINK[a.refType]?.(a.refId) : undefined
  const published = reply ? publishState(a.status, reply) : null

  const icon = (k: Action, Icon: typeof Check) =>
    pending === k ? (
      <Spinner data-icon="inline-start" aria-hidden="true" />
    ) : (
      <Icon data-icon="inline-start" aria-hidden="true" />
    )

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="leading-snug break-words">
          {shortTitle(a.title)}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary">
            {label(APPROVAL_KIND_LABEL, a.kind)}
          </Badge>
          <span className="font-medium text-foreground">{projectName}</span>
          <CategoryLabel category={a.category} />
          {a.accountId ? <span>@{a.accountId}</span> : null}
          <span>
            von {actorLabel(a.requestedBy)} · {fmtDateTime(a.createdAt)}
          </span>
        </SheetDescription>
      </SheetHeader>

      <div
        ref={bodyRef}
        tabIndex={-1}
        aria-busy={busy}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 outline-none"
      >
        {notice ? (
          <Alert role="status">
            <CircleCheck aria-hidden="true" />
            <AlertTitle>{notice.title}</AlertTitle>
            {notice.description ? (
              <AlertDescription>{notice.description}</AlertDescription>
            ) : null}
          </Alert>
        ) : null}
        {reply ? (
          <>
            {reply.summary || a.body ? (
              <Section title="Was passiert ist">
                {reply.summary ? (
                  <p className="text-sm">{reply.summary}</p>
                ) : (
                  <Markdown>{a.body ?? ""}</Markdown>
                )}
              </Section>
            ) : null}
            <Section
              title={
                reply.target === "featurama"
                  ? "Feature Request"
                  : `Bewertung auf ${label(REPLY_TARGET_LABEL, reply.target)}`
              }
            >
              <ReplyContext payload={reply} item={context?.item} />
              {context?.item ? <InboxTasks item={context.item} /> : null}
            </Section>
            {open ? (
              <Field data-invalid={tooLong || empty || undefined}>
                <FieldLabel htmlFor={textId}>
                  Antwort
                  {reply.language ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      ({reply.language})
                    </span>
                  ) : null}
                </FieldLabel>
                <Textarea
                  id={textId}
                  rows={7}
                  value={text}
                  disabled={busy}
                  aria-invalid={tooLong || empty || undefined}
                  aria-describedby={counterId}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-36"
                />
                <FieldDescription
                  id={counterId}
                  className="flex items-start justify-between gap-3"
                >
                  <span>
                    {edited
                      ? "Geändert. Das Original bleibt im Verlauf."
                      : "Vorschlag des Agents, du kannst ihn ändern."}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {edited ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setText(original)}
                        className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                      >
                        <RotateCcw aria-hidden="true" className="size-3" />
                        Original
                      </button>
                    ) : null}
                    {reply.target === "google_play" || tooLong ? (
                      <span
                        className={cn(
                          "tabular-nums",
                          tooLong && "font-medium text-destructive"
                        )}
                      >
                        {length}/{max}
                      </span>
                    ) : null}
                  </span>
                </FieldDescription>
              </Field>
            ) : (
              <Section
                title={`Antwort${reply.editedBy ? ` · geändert von ${actorLabel(reply.editedBy)}` : ""}`}
              >
                <p className="text-sm break-words whitespace-pre-wrap">
                  {reply.text}
                </p>
                {published ? (
                  <PublishStateLine
                    state={published}
                    refUrl={reply.published?.ref}
                  />
                ) : null}
              </Section>
            )}
            {reply.task ? (
              <Section title="Nächster Schritt">
                <TaskDetails payload={reply.task} sources={{}} />
              </Section>
            ) : null}
            {open ? (
              <AfterNote>
                Nach dem Bestätigen postet der nächste Lauf die Antwort
                öffentlich auf {label(REPLY_TARGET_LABEL, reply.target)}
                {reply.task ? " und legt die Aufgabe an" : ""}.
              </AfterNote>
            ) : null}
          </>
        ) : a.kind === "strategy" ? (
          <StrategyBody approval={a} payload={payload as StrategyPayload} />
        ) : context?.content || a.kind === "content" ? (
          <>
            {context?.content ? (
              <Facts
                rows={[
                  ["Titel", context.content.title],
                  ["Art", label(CONTENT_KIND_LABEL, context.content.kind)],
                  ["Keyword", context.content.keyword],
                  ["Intent", context.content.intent],
                ]}
              />
            ) : null}
            {context?.content?.brief ? (
              <Section title="Brief">
                <p className="text-sm break-words whitespace-pre-line">
                  {context.content.brief}
                </p>
              </Section>
            ) : null}
            {a.body &&
            a.body.trim() !== (context?.content?.brief ?? "").trim() ? (
              <Section title="Vorschlag">
                <Markdown>{a.body}</Markdown>
              </Section>
            ) : null}
            {open ? (
              <AfterNote>
                Nach dem Bestätigen schreibt der Agent den Entwurf.
              </AfterNote>
            ) : null}
          </>
        ) : a.kind === "task" ? (
          <>
            {a.body ? (
              <Section title="Kontext">
                <Markdown>{a.body}</Markdown>
              </Section>
            ) : null}
            <Section title="Vorschlag">
              <TaskDetails
                payload={payload as TaskPayload}
                sources={context?.sources ?? {}}
              />
            </Section>
            {open ? (
              <AfterNote>Nach dem Bestätigen entsteht die Aufgabe.</AfterNote>
            ) : null}
          </>
        ) : (
          <>
            {a.body ? (
              <Section title="Vorschlag">
                <Markdown>{a.body}</Markdown>
              </Section>
            ) : (
              <p className="text-sm text-muted-foreground">
                Der Agent hat keinen weiteren Text mitgegeben.
              </p>
            )}
            {open ? (
              <AfterNote>
                {a.refType === "backlog"
                  ? "Nach dem Bestätigen bleibt die verknüpfte Aufgabe offen und der Agent setzt den Vorschlag um. Deine Notiz geht als Auftrag mit. Ablehnen verwirft die Aufgabe."
                  : a.refType === "plan_entry"
                    ? "Nach dem Bestätigen wird der Planeintrag gesperrt."
                    : "Nach dem Bestätigen setzt der Agent den Vorschlag beim nächsten Lauf um."}
              </AfterNote>
            ) : null}
          </>
        )}

        {refHref && a.refType ? (
          <p className="text-sm">
            <Link
              href={refHref}
              prefetch={false}
              className="underline underline-offset-4"
            >
              {label(REF_LABEL, a.refType)} {a.refId} öffnen
            </Link>
          </p>
        ) : null}

        {open ? (
          <Field>
            <FieldLabel htmlFor={noteId}>
              Notiz{" "}
              <span className="font-normal text-muted-foreground">
                (optional, geht an den Agent)
              </span>
            </FieldLabel>
            <Textarea
              id={noteId}
              rows={2}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        ) : (
          <Section title="Entscheidung">
            <p className="text-sm">
              {label(APPROVAL_STATUS_LABEL, a.status)} von{" "}
              {actorLabel(a.decidedBy)} · {fmtDateTime(a.decidedAt)}
            </p>
            {a.decisionNote ? (
              <p className="text-sm break-words whitespace-pre-wrap">
                Notiz: {a.decisionNote}
              </p>
            ) : null}
          </Section>
        )}
      </div>

      {open ? (
        <SheetFooter className="mt-0 gap-3 border-t">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Entscheidung nicht gespeichert</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={busy || tooLong || empty}
              onClick={() => decide("approved")}
            >
              {icon("approved", Check)}
              Bestätigen
            </Button>
            {reply ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => decide("no_reply")}
              >
                {icon("no_reply", MessageSquareOff)}
                Keine Antwort nötig
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => decide("rejected")}
              className="sm:ml-auto"
            >
              {icon("rejected", X)}
              Ablehnen
            </Button>
          </div>
        </SheetFooter>
      ) : null}
    </>
  )
}

function AfterNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function StrategyBody({
  approval: a,
  payload: p,
}: {
  approval: Approval
  payload: StrategyPayload
}) {
  const skills = Array.isArray(p.skills) ? p.skills : []
  return (
    <>
      <Facts
        rows={[
          ["Name", p.name],
          ["Bereich", categoryLabel(p.category)],
          ["Skills", skills.length ? skills.join(", ") : null],
        ]}
      />
      {p.summary ? (
        <Section title="Zusammenfassung">
          <p className="text-sm">{p.summary}</p>
        </Section>
      ) : null}
      {a.body && a.body.trim() !== (p.summary ?? "").trim() ? (
        <Section title="Begründung">
          <Markdown>{a.body}</Markdown>
        </Section>
      ) : null}
      {p.guide ? (
        <Section title="Leitfaden">
          <Markdown>{p.guide}</Markdown>
        </Section>
      ) : null}
      {a.status === "pending" ? (
        <AfterNote>Nach dem Bestätigen wird die Strategie aktiv.</AfterNote>
      ) : null}
    </>
  )
}

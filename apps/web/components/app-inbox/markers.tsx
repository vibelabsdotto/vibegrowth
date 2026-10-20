import type { ReactNode } from "react"
import { EyeOff } from "lucide-react"
import type { InboxReview, InboxState } from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { INBOX_STATE_LABEL } from "./labels"

export type InboxTone = "good" | "warn" | "bad" | "info" | "neutral"

const TEXT: Record<InboxTone, string> = {
  good: "text-(--status-good)",
  warn: "text-(--status-warn)",
  bad: "text-(--status-bad)",
  info: "text-(--status-info)",
  neutral: "text-muted-foreground",
}

const DOT: Record<InboxTone, string> = {
  good: "bg-(--status-good)",
  warn: "bg-(--status-warn)",
  bad: "bg-(--status-bad)",
  info: "bg-(--status-info)",
  neutral: "bg-muted-foreground/50",
}

/** Status as dot plus word, never colour alone. */
export function StatusToken({
  tone,
  children,
  title,
  className,
}: {
  tone: InboxTone
  children: ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        TEXT[tone],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", DOT[tone])}
      />
      {children}
    </span>
  )
}

const STATE_TONE: Record<InboxState, InboxTone> = {
  open: "warn",
  proposal: "info",
  approved: "good",
  tasks_open: "info",
  answered: "neutral",
  no_reply: "neutral",
  stale: "warn",
  error: "bad",
}

/** Inbox item state (open, proposal, approved …) as dot plus word. */
export function InboxStateToken({
  state,
  className,
}: {
  state: InboxState
  className?: string
}) {
  return (
    <StatusToken tone={STATE_TONE[state] ?? "neutral"} className={className}>
      {INBOX_STATE_LABEL[state] ?? state}
    </StatusToken>
  )
}

/** Feature request that Featurama has not approved yet (hidden from users there). */
export function NotApprovedNote() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <EyeOff aria-hidden="true" className="size-3" />
      in Featurama nicht freigegeben
    </span>
  )
}

/** Reply state of a store review. */
export function reviewReplyState(r: InboxReview): {
  tone: InboxTone
  label: string
} {
  if (r.needsReply && r.reply)
    return { tone: "warn", label: "Bewertung nach Antwort geändert" }
  if (r.needsReply) return { tone: "warn", label: "braucht Antwort" }
  if (r.reply && r.replyState === "PENDING_PUBLISH")
    return { tone: "info", label: "Antwort wartet auf Veröffentlichung" }
  if (r.reply) return { tone: "good", label: "beantwortet" }
  return { tone: "neutral", label: "ohne Antwort" }
}

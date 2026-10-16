import type { ReactNode } from "react"
import { EyeOff } from "lucide-react"
import type { InboxReview } from "@/lib/growth-types"
import { cn } from "@/lib/utils"

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

export function NeedsReplyToken() {
  return <StatusToken tone="warn">braucht Antwort</StatusToken>
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

export function ReviewReplyToken({ review }: { review: InboxReview }) {
  const s = reviewReplyState(review)
  return <StatusToken tone={s.tone}>{s.label}</StatusToken>
}

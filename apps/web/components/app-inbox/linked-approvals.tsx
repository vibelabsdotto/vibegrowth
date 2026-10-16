import Link from "next/link"
import {
  APPROVAL_KIND_LABEL,
  APPROVAL_STATUS_LABEL,
  fmtDateTime,
  label,
} from "@/components/growth/format"
import type { InboxApproval } from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { approvalsHref } from "./labels"
import { StatusToken, type InboxTone } from "./markers"

const STATUS_TONE: Record<string, InboxTone> = {
  pending: "info",
  approved: "good",
  rejected: "neutral",
  changes_requested: "warn",
  withdrawn: "neutral",
}

/** Publish state of a reply suggestion (`app publish`), null when not relevant. */
function publishState(a: InboxApproval) {
  if (a.published)
    return {
      tone: "good" as const,
      label: a.published.verified
        ? "veröffentlicht und geprüft"
        : "veröffentlicht",
      title: `Veröffentlicht ${fmtDateTime(a.published.at)}`,
    }
  if (a.publish?.state === "stale")
    return {
      tone: "warn" as const,
      label: "veraltet",
      title: a.publish.reason,
    }
  if (a.publish)
    return {
      tone: "bad" as const,
      label: "Fehler beim Veröffentlichen",
      title: a.publish.reason,
    }
  return null
}

/** Reply and task suggestions linked to an inbox item, each linking to /approvals. */
export function LinkedApprovals({
  approvals,
  className,
}: {
  approvals: InboxApproval[]
  className?: string
}) {
  if (!approvals.length) return null
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {approvals.map((a) => {
        const pub = publishState(a)
        return (
          <li
            key={a.id}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          >
            <Link
              href={
                a.status === "pending"
                  ? `/approvals?item=${a.id}`
                  : approvalsHref(a.status)
              }
              prefetch={false}
              className="min-w-0 font-medium break-words underline-offset-4 hover:underline"
            >
              <span className="text-muted-foreground">
                {label(APPROVAL_KIND_LABEL, a.kind)}:
              </span>{" "}
              {a.title}
            </Link>
            <StatusToken tone={STATUS_TONE[a.status] ?? "neutral"}>
              {label(APPROVAL_STATUS_LABEL, a.status)}
            </StatusToken>
            {pub ? (
              <StatusToken tone={pub.tone} title={pub.title}>
                {pub.label}
              </StatusToken>
            ) : null}
            {a.publish?.reason && !a.published ? (
              <span className="w-full text-muted-foreground">
                {a.publish.reason}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

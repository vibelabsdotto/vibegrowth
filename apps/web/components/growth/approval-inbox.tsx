"use client"

import { useSearchParams } from "next/navigation"
import * as React from "react"
import { ChevronDown } from "lucide-react"
import { EmptyState } from "@/components/growth/status"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type {
  Approval,
  ContentItem,
  InboxItem,
  ReplyPayload,
  StrategyPayload,
  TaskPayload,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/toast"
import { ApprovalSheet, type DecisionNotice } from "./approval-sheet"
import { CategoryLabel } from "./category"
import {
  APPROVAL_KIND_LABEL,
  APPROVAL_STATUS_LABEL,
  fmtDateTime,
  label,
  shortTitle,
} from "./format"

export type ApprovalContext = {
  /** reply: the review or Featurama request it answers */
  item?: InboxItem
  /** task: inbox items of payload.sources, key `${type}|${id}` */
  sources?: Record<string, InboxItem>
  /** refType content: the content item */
  content?: ContentItem
}

function plain(md: string | null | undefined) {
  return (md ?? "")
    .replace(/[#*_`>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** One line under the title: what the suggestion is about. */
function summaryOf(a: Approval, ctx: ApprovalContext | undefined) {
  const p = (a.payload ?? {}) as Record<string, unknown>
  if (a.kind === "reply") {
    const r = p as ReplyPayload
    return plain(r.summary) || plain(r.text)
  }
  if (a.kind === "strategy") return plain((p as StrategyPayload).summary)
  if (ctx?.content) {
    const c = ctx.content
    return [c.keyword, plain(c.brief)].filter(Boolean).join(" · ")
  }
  if (a.kind === "task")
    return plain((p as TaskPayload).detail) || plain(a.body)
  return plain(a.body)
}

/** Writes ?item= without a server round trip (Next syncs useSearchParams). */
function setItemParam(id: number | null) {
  const q = new URLSearchParams(window.location.search)
  if (id === null) q.delete("item")
  else q.set("item", String(id))
  const qs = q.toString()
  window.history.replaceState(
    null,
    "",
    qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  )
}

export function ApprovalInbox({
  pending,
  decided,
  linked,
  contexts,
  projectNames,
  showProject,
  emptyText,
}: {
  pending: Approval[]
  decided: Approval[]
  /** deep-linked approval outside both lists */
  linked: Approval | null
  contexts: Record<number, ApprovalContext>
  projectNames: Record<string, string>
  showProject: boolean
  emptyText: string
}) {
  const search = useSearchParams()
  const selectedId = Number(search.get("item")) || null
  const all = React.useMemo(
    () => [...pending, ...decided, ...(linked ? [linked] : [])],
    [pending, decided, linked]
  )
  const current = all.find((a) => a.id === selectedId) ?? null
  // Keep the last shown approval while the sheet animates out or the list refreshes.
  const [shown, setShown] = React.useState<Approval | null>(current)
  if (current && current !== shown) setShown(current)
  const open = selectedId !== null
  const [notice, setNotice] = React.useState<DecisionNotice | null>(null)

  /** After a decision: next open entry after this one, else the first remaining. */
  function next(afterId: number) {
    const rest = pending.filter((a) => a.id !== afterId)
    if (!rest.length) return null
    const idx = pending.findIndex((a) => a.id === afterId)
    return (
      pending.slice(idx + 1).find((a) => a.id !== afterId) ?? rest[0] ?? null
    )
  }

  const name = (id: string) => projectNames[id] ?? id

  return (
    <>
      {pending.length === 0 ? (
        <EmptyState title="Nichts offen" description={emptyText} />
      ) : (
        <ApprovalRows
          rows={pending}
          contexts={contexts}
          showProject={showProject}
          name={name}
          selectedId={selectedId}
          onOpen={setItemParam}
        />
      )}

      {decided.length ? (
        <Collapsible className="flex flex-col gap-3">
          <CollapsibleTrigger className="group flex items-center gap-2 self-start rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-data-[panel-open]:rotate-180"
            />
            Zuletzt entschieden
            <span className="font-normal tabular-nums">{decided.length}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ApprovalRows
              rows={decided}
              contexts={contexts}
              showProject={showProject}
              name={name}
              selectedId={selectedId}
              onOpen={setItemParam}
              decided
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <ApprovalSheet
        open={open}
        approval={current ?? (open ? null : shown)}
        missingId={open && !current ? selectedId : null}
        context={shown ? contexts[shown.id] : undefined}
        projectName={shown ? name(shown.projectId) : ""}
        notice={notice}
        onClose={() => {
          setNotice(null)
          setItemParam(null)
        }}
        onDecided={(id, result) => {
          const following = next(id)
          if (following) {
            // The toast would cover the sheet footer; say it inside the next entry.
            setNotice(result)
            setItemParam(following.id)
          } else {
            setNotice(null)
            setItemParam(null)
            toast.add({ ...result, type: "success", timeout: 5000 })
          }
        }}
      />
    </>
  )
}

function ApprovalRows({
  rows,
  contexts,
  showProject,
  name,
  selectedId,
  onOpen,
  decided = false,
}: {
  rows: Approval[]
  contexts: Record<number, ApprovalContext>
  showProject: boolean
  name: (id: string) => string
  selectedId: number | null
  onOpen: (id: number) => void
  decided?: boolean
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {rows.map((a) => {
        const summary = summaryOf(a, contexts[a.id])
        return (
          <li key={a.id}>
            <button
              type="button"
              id={`approval-row-${a.id}`}
              onClick={() => onOpen(a.id)}
              aria-current={selectedId === a.id ? "true" : undefined}
              className={cn(
                "flex w-full min-w-0 flex-col gap-1 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                selectedId === a.id && "bg-muted/60"
              )}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <Badge variant="secondary">
                  {label(APPROVAL_KIND_LABEL, a.kind)}
                </Badge>
                {showProject ? (
                  <span className="font-medium text-foreground">
                    {name(a.projectId)}
                  </span>
                ) : null}
                <CategoryLabel category={a.category} />
                {decided ? (
                  <Badge
                    variant={a.status === "approved" ? "default" : "outline"}
                  >
                    {label(APPROVAL_STATUS_LABEL, a.status)}
                  </Badge>
                ) : null}
                <span className="ml-auto tabular-nums">
                  {fmtDateTime(decided ? a.decidedAt : a.createdAt)}
                </span>
              </span>
              <span className="min-w-0 font-medium break-words">
                {shortTitle(a.title)}
              </span>
              {summary ? (
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {summary}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

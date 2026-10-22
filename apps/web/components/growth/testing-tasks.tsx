"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import type { BacklogItem, InboxItem } from "@/lib/growth-types"
import { BACKLOG_KIND_LABEL, fmtDateTime, label } from "./format"
import { ASSIGNEE_LABEL, TaskSheet, TaskStatus } from "./task-sheet"

export const TASK_PARAM = "task"

/**
 * "Aufgaben für dich" on Wartet auf Max: tasks to test or with a question from the agent.
 * Each opens the task sheet (?task=<id>, also for a linked task outside the list).
 */
export function TestingTasks({
  items,
  linked,
  projectNames,
  sourceItems,
}: {
  /** inbox items by `${type}|${id}` for the tasks' sources */
  sourceItems: Record<string, InboxItem>
  items: BacklogItem[]
  /** ?task=<id> outside the list (other status), loaded by the page */
  linked: BacklogItem | null
  projectNames: Record<string, string>
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const raw = searchParams.get(TASK_PARAM)
  const openId = raw && /^\d+$/.test(raw) ? Number(raw) : null
  const all =
    linked && !items.some((i) => i.id === linked.id)
      ? [...items, linked]
      : items
  const current = all.find((i) => i.id === openId) ?? null
  const [shown, setShown] = React.useState<BacklogItem | null>(current)
  if (current && current !== shown) setShown(current)
  const opener = React.useRef<HTMLElement | null>(null)

  const setOpen = (id: number | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (id !== null) next.set(TASK_PARAM, String(id))
    else next.delete(TASK_PARAM)
    const qs = next.toString()
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <>
      {items.length ? (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="flex w-full min-w-0 flex-col gap-1 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                onClick={(e) => {
                  opener.current = e.currentTarget
                  setOpen(t.id)
                }}
              >
                <span className="text-sm font-medium break-words">
                  {t.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <TaskStatus status={t.status} />
                  <Badge variant="outline">
                    {projectNames[t.projectId] ?? t.projectId}
                  </Badge>
                  <span>{label(BACKLOG_KIND_LABEL, t.kind)}</span>
                  {t.assignee ? (
                    <span>von {label(ASSIGNEE_LABEL, t.assignee)}</span>
                  ) : null}
                  {t.updatedAt ? <span>{fmtDateTime(t.updatedAt)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <TaskSheet
        item={current ?? shown}
        projectName={
          (current ?? shown)
            ? (projectNames[(current ?? shown)!.projectId] ?? "")
            : ""
        }
        open={current !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null)
        }}
        finalFocus={() => opener.current}
        sourceItems={sourceItems}
      />
    </>
  )
}

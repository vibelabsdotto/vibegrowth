"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { createInboxTask } from "@/app/growth-actions"
import { FormDrawer, type FieldSpec } from "@/components/form-drawer"
import {
  BACKLOG_KIND_LABEL,
  label,
  STORE_LABEL,
} from "@/components/growth/format"
import { ASSIGNEE_LABEL, TaskStatus } from "@/components/growth/task-sheet"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { InboxItem } from "@/lib/growth-types"
import { FeatureRequestDetails } from "./feature-request-thread"
import { InboxItemActions } from "./inbox-actions"
import { LinkedApprovals } from "./linked-approvals"
import { ReviewDetails } from "./review-details"

function sheetTitle(item: InboxItem) {
  if (item.type === "feature_request") return item.title
  if (item.title?.trim()) return item.title
  return item.rating !== null
    ? `Bewertung mit ${item.rating} ${item.rating === 1 ? "Stern" : "Sternen"}`
    : "Bewertung"
}

const TASK_FIELDS: FieldSpec[] = [
  { name: "title", label: "Titel", required: true },
  {
    name: "kind",
    label: "Art",
    type: "select",
    options: ["bug", "feature", "ux"].map((k) => ({
      value: k,
      label: BACKLOG_KIND_LABEL[k],
    })),
  },
  {
    name: "assignee",
    label: "Zuständig",
    type: "select",
    options: Object.entries(ASSIGNEE_LABEL).map(([value, l]) => ({
      value,
      label: l,
    })),
  },
  {
    name: "detail",
    label: "Beschreibung",
    type: "textarea",
    rows: 6,
    placeholder: "Was klappt nicht oder fehlt? Schritte, erwartet, tatsächlich …",
  },
]

const DUE_TEXT = {
  accepted:
    "Alle Aufgaben sind bestätigt. Die Folgeantwort „ist umgesetzt“ ist fällig.",
  released:
    "Alle Aufgaben sind ausgeliefert. Die Folgeantwort „ist jetzt verfügbar“ ist fällig.",
} as const

/** Tasks linked to the item and "Aufgabe erstellen". */
function InboxTasks({ item }: { item: InboxItem }) {
  const tasks = item.tasks ?? []
  return (
    <section aria-labelledby="inbox-sheet-tasks" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 id="inbox-sheet-tasks" className="text-sm font-medium">
          Aufgaben
        </h3>
        <FormDrawer
          title="Aufgabe erstellen"
          description="Hängt an dieser Anfrage. Ist sie erledigt, kommt eine Folgeantwort zur Freigabe."
          fields={TASK_FIELDS}
          initial={{ kind: "bug", assignee: "byte", title: "", detail: "" }}
          submitLabel="Anlegen"
          successMessage="Aufgabe angelegt"
          action={(v) =>
            createInboxTask(
              {
                projectId: item.projectId,
                type: item.type,
                id: item.itemId,
              },
              v
            )
          }
          trigger={(show) => (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={show}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Aufgabe erstellen
            </Button>
          )}
        />
      </div>
      {item.replyDue ? (
        <p className="text-sm text-(--status-warn)">{DUE_TEXT[item.replyDue]}</p>
      ) : null}
      {tasks.length ? (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            >
              <Link
                href={`/tasks?item=${t.id}`}
                prefetch={false}
                className="min-w-0 font-medium break-words underline-offset-4 hover:underline"
              >
                <span className="text-muted-foreground">
                  {label(BACKLOG_KIND_LABEL, t.kind)}:
                </span>{" "}
                {t.title}
              </Link>
              <TaskStatus status={t.status} />
              {t.assignee ? (
                <span className="text-muted-foreground">
                  {label(ASSIGNEE_LABEL, t.assignee)}
                </span>
              ) : null}
              {t.releasedVersion ? (
                <span className="text-muted-foreground">
                  in {t.releasedVersion}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Noch keine. Fällt dir beim Prüfen ein Fehler auf, leg ihn hier an.
        </p>
      )}
    </section>
  )
}

/**
 * One inbox item (feature request or store review) in a sheet from the right:
 * thread or review, linked suggestions, and Max' actions in the footer.
 */
export function InboxSheet({
  item,
  projectName,
  open,
  onOpenChange,
  onClosed,
  finalFocus,
}: {
  item: InboxItem | null
  projectName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
  finalFocus: () => HTMLElement | null
}) {
  // Focus the scrollable body on open: keyboard users can scroll right away, and no
  // action button looks preselected.
  const bodyRef = React.useRef<HTMLDivElement>(null)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed()
      }}
    >
      <SheetContent
        side="right"
        initialFocus={bodyRef}
        finalFocus={finalFocus}
        className="gap-0 data-[side=right]:w-full motion-reduce:transition-none data-[side=right]:sm:max-w-xl"
      >
        {item ? (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="line-clamp-2 break-words">
                {sheetTitle(item)}
              </SheetTitle>
              <SheetDescription>
                {item.type === "feature_request"
                  ? "Feature Request aus Featurama"
                  : `Bewertung aus ${label(STORE_LABEL, item.store)}`}
              </SheetDescription>
            </SheetHeader>
            <div
              ref={bodyRef}
              tabIndex={-1}
              className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 outline-none"
            >
              {item.type === "feature_request" ? (
                <FeatureRequestDetails
                  request={item}
                  projectName={projectName}
                />
              ) : (
                <ReviewDetails review={item} projectName={projectName} />
              )}
              {item.approvals.length ? (
                <>
                  <Separator />
                  <section
                    aria-labelledby="inbox-sheet-approvals"
                    className="flex flex-col gap-2"
                  >
                    <h3
                      id="inbox-sheet-approvals"
                      className="text-sm font-medium"
                    >
                      Vorschläge
                    </h3>
                    <LinkedApprovals approvals={item.approvals} />
                  </section>
                </>
              ) : null}
              <Separator />
              <InboxTasks item={item} />
            </div>
            <SheetFooter className="mt-0 border-t">
              <InboxItemActions
                key={`${item.itemId}:${item.state}`}
                item={item}
                onDone={() => onOpenChange(false)}
              />
            </SheetFooter>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>Eintrag</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}

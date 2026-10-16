"use client"

import * as React from "react"
import { Circle, CircleCheck, CircleDot, CircleX, Plus } from "lucide-react"
import { createBacklog, updateBacklog } from "@/app/growth-actions"
import { FormDrawer, type FieldSpec } from "@/components/form-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { BacklogItem } from "@/lib/growth-types"
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/categories"
import { cn } from "@/lib/utils"
import { CategoryLabel } from "./category"
import { actorLabel, BACKLOG_KIND_LABEL, label } from "./format"
import { GroupedList, type GroupDef } from "./grouped-list"

export const BACKLOG_GROUPS: GroupDef[] = [
  {
    key: "open",
    label: "Offen",
    description: "Sortiert nach Impact, dann Aufwand",
    icon: Circle,
  },
  { key: "doing", label: "In Arbeit", icon: CircleDot, tone: "warn" },
  {
    key: "done",
    label: "Erledigt",
    icon: CircleCheck,
    tone: "good",
    collapsed: true,
  },
  { key: "dropped", label: "Verworfen", icon: CircleX, collapsed: true },
]

const levelOptions = [
  { value: "1", label: "1 · niedrig" },
  { value: "2", label: "2 · mittel" },
  { value: "3", label: "3 · hoch" },
]

const fields: FieldSpec[] = [
  { name: "title", label: "Titel", required: true },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: BACKLOG_GROUPS.map((g) => ({ value: g.key, label: g.label })),
  },
  {
    name: "kind",
    label: "Art",
    type: "select",
    options: Object.entries(BACKLOG_KIND_LABEL).map(([value, l]) => ({
      value,
      label: l,
    })),
  },
  {
    name: "category",
    label: "Bereich",
    type: "select",
    options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
  },
  { name: "impact", label: "Impact", type: "select", options: levelOptions },
  { name: "effort", label: "Aufwand", type: "select", options: levelOptions },
  { name: "detail", label: "Details", type: "textarea", rows: 5 },
  { name: "source", label: "Quelle", placeholder: "audit, gsc, max …" },
  {
    name: "doneRef",
    label: "Erledigt durch",
    placeholder: "Commit, PR oder Change-ID",
  },
  {
    name: "notionUrl",
    label: "Notion-Ticket",
    type: "url",
    placeholder: "https://www.notion.so/…",
  },
]

/** Three-step meter with a text label for screen readers. */
export function Level({ value, name }: { value: number; name: string }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`${name} ${value} von 3`}
    >
      <span className="text-muted-foreground">{name}</span>
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 w-1 rounded-full bg-muted-foreground/25",
              i <= value && "bg-foreground/70"
            )}
          />
        ))}
      </span>
      <span className="sr-only">{value} von 3</span>
    </span>
  )
}

const order = (a: BacklogItem, b: BacklogItem) =>
  b.impact - a.impact || a.effort - b.effort || a.position - b.position

export function BacklogBoard({
  items,
  projects,
  project,
  category = "",
}: {
  items: BacklogItem[]
  projects: { id: string; name: string }[]
  project: string
  /** Bereich from the page filter, preset for new tasks ("" = alle). */
  category?: string
}) {
  const [openId, setOpenId] = React.useState<number | null>(null)
  const [snapshot, setSnapshot] = React.useState<BacklogItem | null>(null)
  const opener = React.useRef<HTMLElement | null>(null)
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  const current = items.find((i) => i.id === openId) ?? snapshot
  const sorted = React.useMemo(() => [...items].sort(order), [items])

  return (
    <>
      <GroupedList
        groups={BACKLOG_GROUPS}
        items={sorted}
        noun={{ one: "Aufgabe", many: "Aufgaben" }}
        title={(b) => b.title}
        searchText={(b) =>
          [b.title, b.detail, b.source].filter(Boolean).join(" ")
        }
        description={(b) => b.detail ?? ""}
        meta={(b) => (
          <>
            {!project ? (
              <Badge variant="outline">{name(b.projectId)}</Badge>
            ) : null}
            {!category ? <CategoryLabel category={b.category} /> : null}
            <span>{label(BACKLOG_KIND_LABEL, b.kind)}</span>
            <Level name="Impact" value={b.impact} />
            <Level name="Aufwand" value={b.effort} />
          </>
        )}
        onMove={(b, status) => updateBacklog(b.id, { status })}
        onOpen={(b, el) => {
          opener.current = el
          setSnapshot(b)
          setOpenId(b.id)
        }}
        toolbar={
          <FormDrawer
            title="Neue Aufgabe"
            fields={[
              {
                name: "project",
                label: "Projekt",
                type: "select",
                required: true,
                options: projects.map((p) => ({ value: p.id, label: p.name })),
              },
              ...fields.filter(
                (f) =>
                  f.name !== "status" &&
                  f.name !== "doneRef" &&
                  f.name !== "notionUrl"
              ),
            ]}
            initial={{
              project: project || projects[0]?.id || "",
              category: category || "web",
              kind: category === "app" ? "feature" : "seo",
              impact: "2",
              effort: "2",
              source: "max",
            }}
            submitLabel="Anlegen"
            successMessage="Aufgabe angelegt"
            action={createBacklog}
            trigger={(show) => (
              <Button type="button" className="sm:ml-auto" onClick={show}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Neue Aufgabe
              </Button>
            )}
          />
        }
      />
      {current ? (
        <FormDrawer
          key={current.id}
          open={openId !== null}
          onOpenChange={(o) => {
            if (!o) {
              setOpenId(null)
              requestAnimationFrame(() => opener.current?.focus())
            }
          }}
          title={current.title}
          description={`${name(current.projectId)} · angelegt von ${actorLabel(current.actor)}${current.source ? ` · Quelle ${current.source}` : ""}`}
          fields={fields}
          initial={{
            title: current.title,
            status: current.status,
            kind: current.kind,
            category: current.category ?? "web",
            impact: String(current.impact),
            effort: String(current.effort),
            detail: current.detail ?? "",
            source: current.source ?? "",
            doneRef: current.doneRef ?? "",
            notionUrl: current.notionUrl ?? "",
          }}
          successMessage="Aufgabe gespeichert"
          action={(v) => {
            // Send the Bereich only when changed, so a derived one stays derived.
            const { category: c, ...rest } = v
            return updateBacklog(current.id, c === current.category ? rest : v)
          }}
        />
      ) : null}
    </>
  )
}

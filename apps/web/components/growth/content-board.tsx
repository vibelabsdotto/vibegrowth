"use client"

import * as React from "react"
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Eye,
  Plus,
  ThumbsUp,
} from "lucide-react"
import { createContent, getContent, updateContent } from "@/app/growth-actions"
import { FormDrawer, type FieldSpec } from "@/components/form-drawer"
import { Markdown } from "@/components/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ContentDetail, ContentItem } from "@/lib/growth-types"
import {
  actorLabel,
  APPROVAL_STATUS_LABEL,
  CONTENT_KIND_LABEL,
  fmtDate,
  fmtNum,
  fmtPct,
  label,
} from "./format"
import { GroupedList, type GroupDef } from "./grouped-list"

export const CONTENT_GROUPS: GroupDef[] = [
  {
    key: "idea",
    label: "Idee",
    description: "Themenvorschlag, noch nicht freigegeben",
    icon: CircleDashed,
  },
  {
    key: "approved",
    label: "Freigegeben",
    description: "Thema freigegeben, Entwurf steht aus",
    icon: ThumbsUp,
  },
  {
    key: "draft",
    label: "Entwurf",
    description: "Agent schreibt",
    icon: CircleDot,
  },
  {
    key: "review",
    label: "Review",
    description: "Entwurf wartet auf Abnahme",
    icon: Eye,
    tone: "warn",
  },
  {
    key: "live",
    label: "Live",
    description: "Veröffentlicht, Zahlen seit Livegang",
    icon: CircleCheck,
    tone: "good",
  },
  {
    key: "discarded",
    label: "Verworfen",
    icon: CircleX,
    collapsed: true,
  },
]

const kindOptions = Object.entries(CONTENT_KIND_LABEL).map(([value, l]) => ({
  value,
  label: l,
}))
const statusOptions = CONTENT_GROUPS.map((g) => ({
  value: g.key,
  label: g.label,
}))

const editFields: FieldSpec[] = [
  { name: "title", label: "Titel", required: true },
  { name: "status", label: "Status", type: "select", options: statusOptions },
  { name: "kind", label: "Art", type: "select", options: kindOptions },
  { name: "keyword", label: "Keyword" },
  { name: "intent", label: "Suchintention" },
  { name: "brief", label: "Briefing", type: "textarea", rows: 5 },
  {
    name: "urlPath",
    label: "URL-Pfad",
    placeholder: "/blog/ueberstunden",
  },
  { name: "liveDate", label: "Live seit", type: "date" },
  {
    name: "draftPath",
    label: "Entwurf (Pfad)",
    description: "Absoluter Pfad zur Entwurfsdatei, nur als Verweis.",
  },
  { name: "notes", label: "Notizen", type: "textarea", rows: 3 },
]

function initialOf(c: ContentItem) {
  return {
    title: c.title,
    status: c.status,
    kind: c.kind,
    keyword: c.keyword ?? "",
    intent: c.intent ?? "",
    brief: c.brief ?? "",
    urlPath: c.urlPath ?? "",
    liveDate: c.liveDate ?? "",
    draftPath: c.draftPath ?? "",
    notes: c.notes ?? "",
  }
}

export function ContentBoard({
  items,
  projects,
  project,
}: {
  items: ContentItem[]
  projects: { id: string; name: string }[]
  project: string
}) {
  const [openId, setOpenId] = React.useState<number | null>(null)
  const [snapshot, setSnapshot] = React.useState<ContentItem | null>(null)
  const [detail, setDetail] = React.useState<{
    id: number
    data: ContentDetail | null
    error: string | null
  } | null>(null)
  const opener = React.useRef<HTMLElement | null>(null)
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  const current = items.find((i) => i.id === openId) ?? snapshot

  function open(item: ContentItem, el: HTMLElement) {
    opener.current = el
    setSnapshot(item)
    setOpenId(item.id)
    setDetail({ id: item.id, data: null, error: null })
    getContent(item.id)
      .then((res) =>
        setDetail((d) =>
          d?.id === item.id
            ? res.ok
              ? { id: item.id, data: res.data, error: null }
              : { id: item.id, data: null, error: res.error }
            : d
        )
      )
      .catch((e: unknown) =>
        setDetail((d) =>
          d?.id === item.id ? { id: item.id, data: null, error: String(e) } : d
        )
      )
  }

  return (
    <>
      <GroupedList
        groups={CONTENT_GROUPS}
        items={items}
        noun={{ one: "Eintrag", many: "Einträge" }}
        title={(c) => c.title}
        searchText={(c) =>
          [c.title, c.keyword, c.urlPath, c.brief].filter(Boolean).join(" ")
        }
        description={(c) => c.keyword ?? c.intent ?? ""}
        meta={(c) => (
          <>
            {!project ? (
              <Badge variant="outline">{name(c.projectId)}</Badge>
            ) : null}
            <span>{label(CONTENT_KIND_LABEL, c.kind)}</span>
            {c.urlPath ? (
              <span className="max-w-48 truncate font-mono">{c.urlPath}</span>
            ) : null}
            {c.liveDate ? (
              <span className="tabular-nums">{fmtDate(c.liveDate)}</span>
            ) : null}
          </>
        )}
        onMove={(c, status) => updateContent(c.id, { status })}
        onOpen={open}
        toolbar={
          <FormDrawer
            title="Neuer Content"
            description="Thema oder Seite für die Pipeline."
            fields={[
              {
                name: "project",
                label: "Projekt",
                type: "select",
                required: true,
                options: projects.map((p) => ({ value: p.id, label: p.name })),
              },
              ...editFields.filter((f) =>
                ["title", "kind", "keyword", "intent", "brief"].includes(f.name)
              ),
            ]}
            initial={{
              project: project || projects[0]?.id || "",
              kind: "blog",
              status: "idea",
            }}
            submitLabel="Anlegen"
            successMessage="Content angelegt"
            action={createContent}
            trigger={(show) => (
              <Button type="button" className="sm:ml-auto" onClick={show}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Neuer Content
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
          description={`${name(current.projectId)} · ${label(CONTENT_KIND_LABEL, current.kind)} · von ${actorLabel(current.actor)}`}
          fields={editFields}
          initial={initialOf(current)}
          successMessage="Content gespeichert"
          action={(v) => updateContent(current.id, v)}
          width="sm:w-[min(40rem,calc(100vw-3rem))]"
        >
          <ContentFacts
            detail={detail?.id === current.id ? detail : null}
            brief={current.brief}
          />
        </FormDrawer>
      ) : null}
    </>
  )
}

function ContentFacts({
  detail,
  brief,
}: {
  detail: { data: ContentDetail | null; error: string | null } | null
  brief: string | null
}) {
  const d = detail?.data
  const numbers = d?.numbers
  const search = numbers ? Object.entries(numbers.search ?? {}) : []
  return (
    <div className="flex flex-col gap-4">
      {brief ? (
        <section className="rounded-lg border p-3">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Briefing
          </h3>
          <Markdown>{brief}</Markdown>
        </section>
      ) : null}
      {!detail || (!d && !detail.error) ? (
        <Skeleton className="h-16 w-full" />
      ) : detail.error ? (
        <p className="text-sm text-destructive">
          Zahlen nicht geladen: {detail.error}
        </p>
      ) : (
        <>
          {numbers ? (
            <section className="flex flex-col gap-2 rounded-lg border p-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                Seit Livegang ({fmtDate(numbers.from)} bis {fmtDate(numbers.to)}
                , {numbers.days} Tage)
              </h3>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {search.map(([source, s]) => (
                  <React.Fragment key={source}>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Klicks ({source.toUpperCase()})
                      </dt>
                      <dd className="font-semibold tabular-nums">
                        {fmtNum(s.clicks)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Impressionen
                      </dt>
                      <dd className="font-semibold tabular-nums">
                        {fmtNum(s.impressions)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">CTR</dt>
                      <dd className="font-semibold tabular-nums">
                        {fmtPct(s.ctr)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Ø Position
                      </dt>
                      <dd className="font-semibold tabular-nums">
                        {fmtNum(s.position)}
                      </dd>
                    </div>
                  </React.Fragment>
                ))}
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Besuche (GA4)
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {numbers.sessions ? fmtNum(numbers.sessions.total) : "–"}
                  </dd>
                </div>
              </dl>
              {search[0]?.[1].topQueries?.length ? (
                <ul className="flex flex-col gap-0.5 text-xs">
                  {search[0][1].topQueries.slice(0, 5).map((tq) => (
                    <li
                      key={tq.query}
                      className="flex justify-between gap-2 tabular-nums"
                    >
                      <span className="truncate">{tq.query}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {fmtNum(tq.clicks)} Klicks · Pos. {fmtNum(tq.position)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {search.length === 0 && !numbers.sessions ? (
                <p className="text-xs text-muted-foreground">
                  Noch keine Such- oder Besuchsdaten für {numbers.urlPath}.
                </p>
              ) : null}
            </section>
          ) : null}
          {d?.approvals?.length ? (
            <section className="flex flex-col gap-1 rounded-lg border p-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                Freigaben
              </h3>
              <ul className="flex flex-col gap-1 text-sm">
                {d.approvals.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{a.title}</span>
                    <span className="text-muted-foreground">
                      {label(APPROVAL_STATUS_LABEL, a.status)}
                      {a.decidedBy ? ` von ${actorLabel(a.decidedBy)}` : ""}
                      {a.decisionNote ? `: ${a.decisionNote}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

"use client"

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { moveEntry } from "@/app/actions"
import { EntryDrawer, type EntryTarget } from "@/components/entry-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  dayMonth,
  isoWeek,
  monthLabel,
  plusDays,
  plusMonths,
  weekday,
} from "@/lib/dates"
import { PLAN_STATUS_LABEL } from "@/lib/labels"
import type { CalendarPost, InspoLite, Lite, PlanEntryRow } from "@/lib/types"
import { cn } from "@/lib/utils"

export type CalendarAccount = Lite & {
  brandId: string
  projectName: string
  defaultFormatId: string | null
  horizon: { filledDays: number; days: number }
}

export type CalendarProps = {
  view: "week" | "3w" | "month"
  anchor: string
  today: string
  days: string[]
  weeks: string[][]
  /** View "Alle Projekte": label accounts with their project. */
  showProject: boolean
  /** Current scope (project id or "all"); stored with an account selection. */
  scopeKey: string
  /** Accounts of the project chosen in the sidebar switcher (all of them for "Alle Projekte"). */
  allAccounts: CalendarAccount[]
  accounts: CalendarAccount[]
  entries: PlanEntryRow[]
  posts: CalendarPost[]
  ideas: PlanEntryRow[]
  formats: Lite[]
  inspirations: InspoLite[]
  postsByEntry: Record<number, { id: number; label: string }>
}

const PRODUCED = new Set(["delivered", "posted"])

function EntryChip({
  entry,
  accountName,
  onOpen,
}: {
  entry: PlanEntryRow
  accountName?: string
  onOpen: (e: PlanEntryRow) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `entry-${entry.id}`, data: { entry } })
  const protectedEntry = entry.locked || entry.origin === "max"
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => onOpen(entry)}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "group/chip flex w-full min-w-0 cursor-grab flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5 text-left text-xs shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        protectedEntry && "border-foreground/70",
        PRODUCED.has(entry.status) && "bg-muted text-muted-foreground",
        entry.status === "idea" && "border-dashed",
        entry.status === "skipped" && "line-through opacity-60",
        isDragging && "z-10 opacity-80 shadow-md"
      )}
      aria-label={`${entry.topic}, ${PLAN_STATUS_LABEL[entry.status] ?? entry.status}${entry.locked ? ", gesperrt" : ""}`}
    >
      {accountName ? (
        <span className="truncate text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {accountName}
        </span>
      ) : null}
      <span className="line-clamp-2 font-medium text-foreground">
        {entry.topic}
      </span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {entry.locked ? <Lock className="size-3" aria-hidden="true" /> : null}
        {PLAN_STATUS_LABEL[entry.status] ?? entry.status}
        {entry.origin === "max" ? " · Max" : ""}
      </span>
    </button>
  )
}

function PostChip({
  post,
  accountName,
}: {
  post: CalendarPost
  accountName?: string
}) {
  return (
    <Link
      href={`/posts/${post.id}`}
      prefetch={false}
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-dashed bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      title="Gepostet, ohne Planeintrag"
    >
      {accountName ? (
        <span className="truncate text-[10px] font-medium tracking-wide uppercase">
          {accountName}
        </span>
      ) : null}
      <span className="line-clamp-2">{post.hook ?? post.slug}</span>
      <span className="flex items-center gap-1 text-[11px]">
        <CalendarCheck className="size-3" aria-hidden="true" /> gepostet
      </span>
    </Link>
  )
}

function DayCell({
  id,
  date,
  today,
  onAdd,
  children,
  className,
}: {
  id: string
  date: string
  today: string
  onAdd: () => void
  children: React.ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { date } })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/cell relative flex min-h-24 min-w-0 flex-col gap-1.5 border-t border-l p-1.5",
        date < today && "bg-muted/30",
        date === today && "bg-accent/40",
        isOver && "bg-accent",
        className
      )}
    >
      {children}
      <Button
        variant="ghost"
        size="icon-xs"
        className="mt-auto self-end opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
        aria-label={`Eintrag am ${dayMonth(date)} hinzufügen`}
        onClick={onAdd}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  )
}

export function PlanCalendar(p: CalendarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [entries, setEntries] = React.useState(p.entries)
  const [synced, setSynced] = React.useState(p.entries)
  if (p.entries !== synced) {
    setSynced(p.entries)
    setEntries(p.entries)
  }
  const [target, setTarget] = React.useState<EntryTarget | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const dndId = React.useId()

  const nav = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") params.delete(k)
      else params.set(k, v)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const step = (dir: -1 | 1) => {
    if (p.view === "month") nav({ date: plusMonths(p.anchor, dir) })
    else nav({ date: plusDays(p.anchor, dir * (p.view === "3w" ? 21 : 7)) })
  }

  const accountName = React.useMemo(
    () => Object.fromEntries(p.allAccounts.map((a) => [a.id, a.name])),
    [p.allAccounts]
  )
  const projectOf = React.useMemo(
    () => Object.fromEntries(p.allAccounts.map((a) => [a.id, a.projectName])),
    [p.allAccounts]
  )
  const visible = new Set(p.accounts.map((a) => a.id))
  const shownEntries = entries.filter((e) => visible.has(e.accountId))
  const byCell = React.useMemo(() => {
    const m = new Map<string, PlanEntryRow[]>()
    for (const e of shownEntries) {
      const k = `${e.accountId}|${e.date}`
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return m
  }, [shownEntries])
  const byDay = React.useMemo(() => {
    const m = new Map<string, PlanEntryRow[]>()
    for (const e of shownEntries) m.set(e.date!, [...(m.get(e.date!) ?? []), e])
    return m
  }, [shownEntries])
  const postsBy = (accountId: string | null, date: string) =>
    p.posts.filter(
      (x) =>
        visible.has(x.accountId) &&
        x.date === date &&
        (accountId === null || x.accountId === accountId)
    )

  async function onDragEnd(ev: DragEndEvent) {
    const entry = ev.active.data.current?.entry as PlanEntryRow | undefined
    const over = ev.over?.data.current as
      { date: string; accountId?: string } | undefined
    if (!entry || !over || over.date === entry.date) return
    if (over.accountId && over.accountId !== entry.accountId) {
      toast.add({
        title: "Nur innerhalb des Accounts verschieben",
        description:
          "Das Thema gehört zu einem Account. Für einen anderen Account neu anlegen.",
        type: "info",
      })
      return
    }
    const before = entries
    setEntries((list) =>
      list.map((e) => (e.id === entry.id ? { ...e, date: over.date } : e))
    )
    const res = await moveEntry(entry.id, over.date)
    if (!res.ok) {
      setEntries(before)
      toast.add({
        title: "Nicht verschoben",
        description: res.error,
        type: "error",
      })
    } else
      toast.add({
        title: `Auf ${weekday(over.date)} ${dayMonth(over.date)} verschoben`,
        type: "success",
        timeout: 3000,
      })
  }

  const open = (e: PlanEntryRow) => setTarget({ mode: "edit", entry: e })
  const add = (date: string | null, accountId?: string) =>
    setTarget({ mode: "create", defaults: { date, accountId } })

  const title =
    p.view === "month"
      ? monthLabel(p.anchor)
      : p.view === "3w"
        ? `KW ${isoWeek(p.days[0])} bis KW ${isoWeek(p.days[p.days.length - 1])}`
        : `KW ${isoWeek(p.days[0])} · ${dayMonth(p.days[0])} bis ${dayMonth(p.days[6])}`

  const weekGrid = (week: string[], key: string) => (
    <div key={key} className="overflow-x-auto rounded-lg border">
      <div className="grid min-w-[56rem] grid-cols-[9rem_repeat(7,minmax(0,1fr))] border-r border-b">
        <div className="border-t border-l bg-muted/40 p-2" />
        {week.map((d) => (
          <div
            key={d}
            className={cn(
              "border-t border-l bg-muted/40 px-2 py-1.5 text-xs font-medium",
              d === p.today && "text-foreground",
              d !== p.today && "text-muted-foreground"
            )}
          >
            {weekday(d)} {dayMonth(d)}
            {d === p.today ? (
              <span className="ml-1 rounded bg-foreground px-1 text-[10px] text-background">
                heute
              </span>
            ) : null}
          </div>
        ))}
        {p.accounts.map((a) => (
          <React.Fragment key={a.id}>
            <div className="flex min-w-0 flex-col gap-1 border-t border-l p-2">
              <Link
                href={`/accounts/${a.id}`}
                prefetch={false}
                className="truncate text-sm font-medium hover:underline"
              >
                {a.name}
              </Link>
              {p.showProject ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  {a.projectName}
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="w-fit text-[11px] text-muted-foreground" />
                  }
                >
                  {a.horizon.filledDays}/{a.horizon.days} Tage
                </TooltipTrigger>
                <TooltipContent>
                  Geplante Tage in den nächsten drei Wochen
                </TooltipContent>
              </Tooltip>
            </div>
            {week.map((d) => (
              <AccountDayCell
                key={d}
                accountId={a.id}
                date={d}
                today={p.today}
                onAdd={() => add(d, a.id)}
              >
                {(byCell.get(`${a.id}|${d}`) ?? []).map((e) => (
                  <EntryChip key={e.id} entry={e} onOpen={open} />
                ))}
                {postsBy(a.id, d).map((x) => (
                  <PostChip key={`p${x.id}`} post={x} />
                ))}
              </AccountDayCell>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Zurück"
            onClick={() => step(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => nav({ date: null })}
          >
            Heute
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Weiter"
            onClick={() => step(1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <h2 className="ml-1 text-base font-semibold">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[p.view]}
            onValueChange={(v: string[]) =>
              v[0] && nav({ view: v[0] === "week" ? null : v[0] })
            }
            aria-label="Ansicht"
          >
            <ToggleGroupItem
              value="week"
              className="text-muted-foreground aria-pressed:text-foreground"
            >
              Woche
            </ToggleGroupItem>
            <ToggleGroupItem
              value="3w"
              className="text-muted-foreground aria-pressed:text-foreground"
            >
              3 Wochen
            </ToggleGroupItem>
            <ToggleGroupItem
              value="month"
              className="text-muted-foreground aria-pressed:text-foreground"
            >
              Monat
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" onClick={() => add(p.today, p.accounts[0]?.id)}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Eintrag hinzufügen
          </Button>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Accounts filtern"
      >
        {p.allAccounts.map((a, i) => {
          const on = visible.has(a.id)
          const first =
            p.showProject && p.allAccounts[i - 1]?.brandId !== a.brandId
          return (
            <React.Fragment key={a.id}>
              {first ? (
                <span
                  className={cn(
                    "text-xs font-medium text-muted-foreground",
                    i > 0 && "ml-2"
                  )}
                >
                  {a.projectName}:
                </span>
              ) : null}
              <Button
                size="xs"
                variant={on ? "secondary" : "ghost"}
                aria-pressed={on}
                aria-label={
                  p.showProject ? `${a.name} (${a.projectName})` : undefined
                }
                className={cn(!on && "text-muted-foreground line-through")}
                onClick={() => {
                  const current = p.accounts.map((x) => x.id)
                  const next = on
                    ? current.filter((x) => x !== a.id)
                    : [...current, a.id]
                  nav({
                    accounts: next.join(",") || "none",
                    for: p.scopeKey,
                  })
                }}
              >
                {a.name}
              </Button>
            </React.Fragment>
          )
        })}
        <span className="ml-2 text-xs text-muted-foreground">
          Dunkler Rahmen: von Max angelegt oder gesperrt · Grau: produziert ·
          gestrichelt: Idee oder Post ohne Eintrag
        </span>
      </div>

      <DndContext id={dndId} sensors={sensors} onDragEnd={onDragEnd}>
        {p.view === "month" ? (
          <div className="overflow-x-auto rounded-lg border">
            <div className="grid min-w-[56rem] grid-cols-7 border-r border-b">
              {p.weeks[0].map((d) => (
                <div
                  key={d}
                  className="border-t border-l bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {weekday(d)}
                </div>
              ))}
              {p.weeks.flat().map((d) => (
                <DayCell
                  key={d}
                  id={`day|${d}`}
                  date={d}
                  today={p.today}
                  onAdd={() => add(d)}
                  className={cn(
                    "min-h-32",
                    d.slice(0, 7) !== p.anchor.slice(0, 7) && "opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "text-xs text-muted-foreground",
                      d === p.today && "font-semibold text-foreground"
                    )}
                  >
                    {d.slice(8, 10)}
                  </span>
                  {(byDay.get(d) ?? []).map((e) => (
                    <EntryChip
                      key={e.id}
                      entry={e}
                      accountName={accountName[e.accountId]}
                      onOpen={open}
                    />
                  ))}
                  {postsBy(null, d).map((x) => (
                    <PostChip
                      key={`p${x.id}`}
                      post={x}
                      accountName={accountName[x.accountId]}
                    />
                  ))}
                </DayCell>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {p.weeks.map((w, i) => weekGrid(w, String(i)))}
          </div>
        )}
      </DndContext>

      <section className="flex flex-col gap-2" aria-labelledby="ideas-title">
        <div className="flex items-center justify-between">
          <h2 id="ideas-title" className="text-sm font-semibold">
            Ideen-Pool{" "}
            <span className="font-normal text-muted-foreground">
              ({p.ideas.length})
            </span>
          </h2>
          <Button
            size="xs"
            variant="outline"
            onClick={() => add(null, p.accounts[0]?.id)}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Idee
          </Button>
        </div>
        {p.ideas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine Ideen ohne Datum. Der Agent füllt den Plan per „plan fill“ aus
            diesem Pool.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {p.ideas.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => open(e)}
                className="flex min-w-0 flex-col gap-1 rounded-md border border-dashed bg-card p-2 text-left text-xs hover:bg-accent"
              >
                <span className="flex items-center gap-1.5">
                  <Badge variant="outline">
                    {accountName[e.accountId]}
                    {p.showProject && projectOf[e.accountId]
                      ? ` · ${projectOf[e.accountId]}`
                      : ""}
                  </Badge>
                  {e.angle ? (
                    <span className="truncate text-muted-foreground">
                      {e.angle}
                    </span>
                  ) : null}
                </span>
                <span className="line-clamp-2 font-medium">{e.topic}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <EntryDrawer
        target={target}
        onClose={() => setTarget(null)}
        accounts={p.allAccounts}
        formats={p.formats}
        inspirations={p.inspirations}
        postLink={
          target?.mode === "edit"
            ? (p.postsByEntry[target.entry.id] ?? null)
            : null
        }
      />
    </div>
  )
}

function AccountDayCell({
  accountId,
  date,
  today,
  onAdd,
  children,
}: {
  accountId: string
  date: string
  today: string
  onAdd: () => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell|${accountId}|${date}`,
    data: { date, accountId },
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/cell relative flex min-h-28 min-w-0 flex-col gap-1.5 border-t border-l p-1.5",
        date < today && "bg-muted/30",
        date === today && "bg-accent/40",
        isOver && "bg-accent"
      )}
    >
      {children}
      <Button
        variant="ghost"
        size="icon-xs"
        className="mt-auto self-end opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
        aria-label={`Eintrag am ${dayMonth(date)} hinzufügen`}
        onClick={onAdd}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  )
}

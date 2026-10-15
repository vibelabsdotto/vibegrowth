"use client"

import * as React from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import {
  ChevronRight,
  GripVertical,
  Search,
  type LucideIcon,
} from "lucide-react"
import type { GrowthResult } from "@/app/growth-actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { Tone } from "./format"
import { TONE_TEXT } from "./status"

export type GroupDef = {
  key: string
  label: string
  description?: string
  icon: LucideIcon
  tone?: Tone
  /** Terminal states start collapsed. */
  collapsed?: boolean
}

type Row = { id: number; status: string; updatedAt?: string }

type Override = { status: string; confirmedAt: string | null }

const DRAG_TYPE = "application/x-vibegrowth-row"

/**
 * Records grouped by status in collapsible sections (VibeCRM pattern): drag at the grip into
 * another group, or change the status at the row glyph. Row click opens the caller's drawer.
 */
export function GroupedList<T extends Row>({
  groups,
  items,
  noun,
  title,
  description,
  meta,
  searchText,
  onMove,
  onOpen,
  toolbar,
  emptyHint,
}: {
  groups: GroupDef[]
  items: T[]
  noun: { one: string; many: string }
  title: (item: T) => string
  description?: (item: T) => React.ReactNode
  meta?: (item: T) => React.ReactNode
  searchText?: (item: T) => string
  onMove: (item: T, status: string) => Promise<GrowthResult<unknown>>
  onOpen: (item: T, opener: HTMLElement) => void
  toolbar?: React.ReactNode
  emptyHint?: string
}) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set(groups.filter((g) => g.collapsed).map((g) => g.key))
  )
  const [overrides, setOverrides] = React.useState<Record<number, Override>>({})
  const [query, setQuery] = React.useState("")
  const [dragging, setDragging] = React.useState<number | null>(null)
  const [dropKey, setDropKey] = React.useState<string | null>(null)
  const [moving, setMoving] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const dragId = React.useRef<number | null>(null)
  const busy = React.useRef(false)
  const helpId = React.useId()

  const effective = React.useMemo(
    () =>
      items.map((item) => {
        const o = overrides[item.id]
        if (!o) return item
        // Keep a confirmed move through stale refreshes, let a newer server edit win.
        if (
          o.confirmedAt !== null &&
          item.updatedAt &&
          (item.updatedAt > o.confirmedAt ||
            (item.updatedAt === o.confirmedAt && item.status === o.status))
        )
          return item
        return { ...item, status: o.status }
      }),
    [items, overrides]
  )

  const q = query.trim().toLowerCase()
  const visible = q
    ? effective.filter((i) =>
        (searchText?.(i) ?? title(i)).toLowerCase().includes(q)
      )
    : effective

  const byGroup = new Map<string, T[]>()
  for (const i of visible) {
    const g = byGroup.get(i.status) ?? []
    g.push(i)
    byGroup.set(i.status, g)
  }

  const groupLabel = (key: string) =>
    groups.find((g) => g.key === key)?.label ?? key

  async function move(item: T, status: string) {
    if (busy.current || status === item.status) return
    busy.current = true
    const previous = overrides[item.id]
    setMoving(item.id)
    setError(null)
    setOverrides((o) => ({ ...o, [item.id]: { status, confirmedAt: null } }))
    const res = await onMove(item, status).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }))
    if (res.ok) {
      const saved = res.data as Partial<Row> | null
      setOverrides((o) => ({
        ...o,
        [item.id]: {
          status: saved?.status ?? status,
          confirmedAt: saved?.updatedAt ?? null,
        },
      }))
      toast.add({
        title: `Nach „${groupLabel(status)}“ verschoben`,
        description: title(item),
        type: "success",
        timeout: 4000,
      })
    } else {
      setOverrides((o) => {
        const next = { ...o }
        if (previous) next[item.id] = previous
        else delete next[item.id]
        return next
      })
      setError(
        `„${title(item)}“ bleibt in „${groupLabel(item.status)}“: ${res.error}`
      )
    }
    busy.current = false
    setMoving(null)
  }

  function finishDrag() {
    dragId.current = null
    setDragging(null)
    setDropKey(null)
  }

  function openRow(e: React.MouseEvent<HTMLLIElement>, item: T) {
    if (busy.current || dragId.current !== null) return
    if (!(e.target instanceof Element)) return
    const control = e.target.closest(
      "button, a, input, textarea, select, [role=menuitemradio], [role=menuitem]"
    )
    if (control && e.currentTarget.contains(control)) return
    if (window.getSelection()?.toString()) return
    const opener = e.currentTarget.querySelector<HTMLElement>("[data-opener]")
    onOpen(item, opener ?? e.currentTarget)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Suchen"
            placeholder="Suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        {toolbar}
      </div>
      <p id={helpId} className="sr-only">
        Am Griff in eine andere Gruppe ziehen, auch wenn sie eingeklappt ist.
        Alternativ den Status am Symbol vor dem Titel wählen.
      </p>
      <p className="sr-only" role="status">
        {moving !== null ? "Status wird gespeichert." : ""}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Nicht verschoben</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-w-0 flex-col gap-3">
        {groups.map((g) => {
          const rows = byGroup.get(g.key) ?? []
          const isOpen = !collapsed.has(g.key)
          return (
            <Collapsible.Root
              key={g.key}
              open={isOpen}
              onOpenChange={(open) =>
                setCollapsed((c) => {
                  const next = new Set(c)
                  if (open) next.delete(g.key)
                  else next.add(g.key)
                  return next
                })
              }
              render={<section aria-labelledby={`group-${g.key}`} />}
              className={cn(
                "min-w-0 rounded-lg",
                dragging !== null && "outline-1 outline-border outline-dashed",
                dropKey === g.key && "bg-accent outline-2 outline-primary"
              )}
              onDragOver={(e: React.DragEvent<HTMLElement>) => {
                if (
                  dragId.current === null ||
                  !e.dataTransfer.types.includes(DRAG_TYPE)
                )
                  return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                setDropKey(g.key)
              }}
              onDragLeave={(e: React.DragEvent<HTMLElement>) => {
                if (
                  !(e.relatedTarget instanceof Node) ||
                  !e.currentTarget.contains(e.relatedTarget)
                )
                  setDropKey((k) => (k === g.key ? null : k))
              }}
              onDrop={(e: React.DragEvent<HTMLElement>) => {
                const id = dragId.current
                if (id === null) return
                e.preventDefault()
                const item = effective.find((i) => i.id === id)
                finishDrag()
                if (item) void move(item, g.key)
              }}
            >
              <div className="flex min-w-0 items-center gap-2 px-1 py-1">
                <h2 id={`group-${g.key}`} className="min-w-0">
                  <Collapsible.Trigger
                    render={<Button type="button" variant="ghost" size="sm" />}
                    className="h-auto min-h-7 justify-start"
                  >
                    <ChevronRight
                      data-icon="inline-start"
                      aria-hidden="true"
                      className={cn(
                        "transition-transform",
                        isOpen && "rotate-90"
                      )}
                    />
                    <g.icon
                      aria-hidden="true"
                      className={TONE_TEXT[g.tone ?? "neutral"]}
                    />
                    <span className="font-medium">{g.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {rows.length}
                    </span>
                  </Collapsible.Trigger>
                </h2>
                {g.description ? (
                  <span className="hidden truncate text-xs text-muted-foreground md:inline">
                    {g.description}
                  </span>
                ) : null}
                {dropKey === g.key ? (
                  <span className="ml-auto text-xs font-medium">
                    Hier ablegen
                  </span>
                ) : null}
              </div>
              <Collapsible.Panel>
                {rows.length === 0 ? (
                  <p className="px-10 py-2 text-xs text-muted-foreground">
                    {dragging !== null
                      ? "Hier ablegen"
                      : (emptyHint ?? `Keine ${noun.many}`)}
                  </p>
                ) : (
                  <ul
                    className="min-w-0"
                    aria-label={`${noun.many}: ${g.label}`}
                  >
                    {rows.map((item) => (
                      <li
                        key={item.id}
                        onClick={(e) => openRow(e, item)}
                        aria-busy={moving === item.id}
                        className={cn(
                          "grid min-w-0 cursor-pointer grid-cols-[1.5rem_1.5rem_minmax(0,1fr)] items-start gap-x-1.5 gap-y-1 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/60 md:grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_auto] md:items-center",
                          dragging === item.id && "opacity-40",
                          moving === item.id && "opacity-60"
                        )}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          draggable={moving === null}
                          className="cursor-grab text-muted-foreground active:cursor-grabbing"
                          aria-label={`${title(item)} ziehen`}
                          aria-describedby={helpId}
                          onClick={(e) => e.stopPropagation()}
                          onDragStart={(e) => {
                            if (busy.current) {
                              e.preventDefault()
                              return
                            }
                            dragId.current = item.id
                            e.dataTransfer.effectAllowed = "move"
                            e.dataTransfer.setData(DRAG_TYPE, String(item.id))
                            e.dataTransfer.setData("text/plain", title(item))
                            setDragging(item.id)
                            setError(null)
                          }}
                          onDragEnd={finishDrag}
                        >
                          <GripVertical />
                        </Button>
                        <StatusMenu
                          groups={groups}
                          value={item.status}
                          disabled={moving !== null}
                          itemTitle={title(item)}
                          onChange={(s) => void move(item, s)}
                        />
                        <div className="flex min-w-0 items-baseline gap-3">
                          <button
                            type="button"
                            data-opener
                            className="min-w-0 shrink-0 truncate text-left text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring/50 max-md:max-w-full lg:max-w-[60%]"
                            onClick={(e) => onOpen(item, e.currentTarget)}
                          >
                            {title(item)}
                          </button>
                          {description ? (
                            <span className="hidden min-w-0 truncate text-sm text-muted-foreground lg:inline">
                              {description(item)}
                            </span>
                          ) : null}
                        </div>
                        {meta ? (
                          <div className="col-start-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:col-start-auto md:justify-end">
                            {meta(item)}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Collapsible.Panel>
            </Collapsible.Root>
          )
        })}
      </div>
    </div>
  )
}

function StatusMenu({
  groups,
  value,
  disabled,
  itemTitle,
  onChange,
}: {
  groups: GroupDef[]
  value: string
  disabled: boolean
  itemTitle: string
  onChange: (status: string) => void
}) {
  const current = groups.find((g) => g.key === value)
  const Icon = current?.icon ?? ChevronRight
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label={`Status von ${itemTitle}: ${current?.label ?? value}. Ändern`}
          />
        }
      >
        <Icon className={TONE_TEXT[current?.tone ?? "neutral"]} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Verschieben nach</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v: string) => onChange(v)}
          >
            {groups.map((g) => (
              <DropdownMenuRadioItem key={g.key} value={g.key}>
                <g.icon className={TONE_TEXT[g.tone ?? "neutral"]} />
                {g.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

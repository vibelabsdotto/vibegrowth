"use client"

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import {
  CHANGE_KIND_LABEL,
  fmtDate,
  fmtNum,
  fmtPct,
  fmtShortDate,
  label,
} from "./format"

export type ChartChange = {
  id: number
  date: string
  kind: string
  summary: string
}

type Point = { date: string; [key: string]: string | number | null }

const tick = (v: number) =>
  v.toLocaleString("de-DE", { maximumFractionDigits: v < 10 ? 2 : 0 })

/** Numbered marker on a change line; the SVG title is the native hover text. */
function ChangeMarker({
  viewBox,
  n,
  text,
}: {
  viewBox?: { x?: number; y?: number }
  n: number
  text: string
}) {
  const x = viewBox?.x ?? 0
  const y = (viewBox?.y ?? 0) + 8
  return (
    <g>
      <title>{text}</title>
      <circle cx={x} cy={y} r={8} className="fill-(--status-warn)" />
      <text
        x={x}
        y={y}
        dy="0.35em"
        textAnchor="middle"
        className="fill-(--status-warn-foreground) text-[10px] font-semibold"
      >
        {n}
      </text>
    </g>
  )
}

function TooltipBox({
  active,
  payload,
  config,
  changesByDate,
  format,
}: {
  active?: boolean
  payload?: { dataKey?: unknown; value?: unknown; payload?: Point }[]
  config: ChartConfig
  changesByDate: Map<string, (ChartChange & { n: number })[]>
  format: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const date = payload[0]?.payload?.date as string | undefined
  const changes = date ? (changesByDate.get(date) ?? []) : []
  return (
    <div className="grid max-w-72 min-w-36 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{fmtDate(date)}</div>
      {payload.map((p) => {
        const key = String(p.dataKey)
        return (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="size-2 rounded-[2px]"
                style={{ background: `var(--color-${key})` }}
              />
              {config[key]?.label ?? key}
            </span>
            <span className="font-mono font-medium tabular-nums">
              {typeof p.value === "number" ? format(p.value) : "–"}
            </span>
          </div>
        )
      })}
      {changes.length ? (
        <ul className="flex flex-col gap-1 border-t pt-1.5">
          {changes.map((c) => (
            <li key={c.id} className="flex gap-1.5">
              <span className="font-semibold text-(--status-warn) tabular-nums">
                {c.n}
              </span>
              <span>
                <span className="text-muted-foreground">
                  {label(CHANGE_KIND_LABEL, c.kind)}:
                </span>{" "}
                {c.summary}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Daily line chart with change markers. `areas` shade date windows (baseline/after),
 * clamped to the data range. Animations off.
 */
export function MarkedLineChart({
  data,
  config,
  changes,
  areas = [],
  percent = false,
  reversed = false,
  className,
}: {
  data: Point[]
  config: ChartConfig
  changes: ChartChange[]
  areas?: { from: string; to: string; label: string; tone: "muted" | "info" }[]
  /** values are shares 0–1 */
  percent?: boolean
  reversed?: boolean
  className?: string
}) {
  const dates = data.map((d) => d.date)
  const first = dates[0]
  const last = dates[dates.length - 1]
  const numbered = changes
    .filter((c) => first && last && c.date >= first && c.date <= last)
    .map((c, i) => ({ ...c, n: i + 1 }))
  const changesByDate = new Map<string, (ChartChange & { n: number })[]>()
  for (const c of numbered) {
    const list = changesByDate.get(c.date) ?? []
    list.push(c)
    changesByDate.set(c.date, list)
  }
  const clamp = (d: string) =>
    !first || !last ? d : d < first ? first : d > last ? last : d
  // Series without a single value would only add an empty legend entry.
  const keys = Object.keys(config).filter((k) =>
    data.some((d) => typeof d[k] === "number")
  )
  const format = percent ? (v: number) => fmtPct(v) : fmtNum

  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto h-72 w-full", className)}
    >
      <LineChart
        data={data}
        margin={{ top: 20, right: 12, left: 4, bottom: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={(v: string) => fmtShortDate(v)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          reversed={reversed}
          tickFormatter={percent ? (v: number) => fmtPct(v, 0) : tick}
        />
        {areas.map((a) =>
          first && last && a.to >= first && a.from <= last ? (
            <ReferenceArea
              key={a.label}
              x1={clamp(a.from)}
              x2={clamp(a.to)}
              ifOverflow="hidden"
              // Recharts writes fill="#ccc" on the rect itself; a class on the group loses.
              fill={
                a.tone === "info"
                  ? "var(--status-info)"
                  : "var(--muted-foreground)"
              }
              fillOpacity={a.tone === "info" ? 0.12 : 0.1}
              label={{
                value: a.label,
                position: "insideTopLeft",
                className: "fill-muted-foreground text-[11px]",
              }}
            />
          ) : null
        )}
        {numbered.map((c) => (
          <ReferenceLine
            key={c.id}
            x={c.date}
            className="stroke-(--status-warn)"
            strokeDasharray="4 3"
            label={
              <ChangeMarker
                n={c.n}
                text={`${fmtDate(c.date)} · ${label(CHANGE_KIND_LABEL, c.kind)}: ${c.summary}`}
              />
            }
          />
        ))}
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={(props) => (
            <TooltipBox
              active={props.active}
              payload={
                props.payload as unknown as {
                  dataKey?: unknown
                  value?: unknown
                  payload?: Point
                }[]
              }
              config={config}
              changesByDate={changesByDate}
              format={format}
            />
          )}
        />
        {keys.length > 1 ? (
          <ChartLegend content={<ChartLegendContent />} />
        ) : null}
        {keys.map((k) => (
          <Line
            key={k}
            dataKey={k}
            type="monotone"
            stroke={`var(--color-${k})`}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}

/** Numbered list that matches the chart markers. */
export function ChangeLegend({
  changes,
  from,
  to,
}: {
  changes: ChartChange[]
  from?: string
  to?: string
}) {
  const shown = changes.filter(
    (c) => (!from || c.date >= from) && (!to || c.date <= to)
  )
  if (!shown.length)
    return (
      <p className="text-xs text-muted-foreground">
        Keine Änderungen im Zeitraum.
      </p>
    )
  return (
    <ol className="flex flex-col gap-1 text-xs">
      {shown.map((c, i) => (
        <li key={c.id} className="flex gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-(--status-warn) text-[10px] font-semibold text-(--status-warn-foreground) tabular-nums">
            {i + 1}
          </span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {fmtShortDate(c.date)}
          </span>
          <span className="min-w-0">
            <span className="text-muted-foreground">
              {label(CHANGE_KIND_LABEL, c.kind)}:
            </span>{" "}
            {c.summary}
          </span>
        </li>
      ))}
    </ol>
  )
}

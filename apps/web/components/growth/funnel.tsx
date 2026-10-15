import { ArrowRight } from "lucide-react"
import type { FunnelStage } from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { fmtCompact, fmtNum, fmtPct, label, STAGE_LABEL } from "./format"
import { Delta } from "./status"

const stageLabel = (s: FunnelStage) => s.label ?? label(STAGE_LABEL, s.key)
const hasData = (s: FunnelStage) => s.hasData ?? s.value !== null

/** Funnel as a stage strip: value, change vs. previous window, conversion from the previous stage. */
export function FunnelStrip({
  stages,
  weakest,
  prevLabel = "Vorwoche",
  windowTo,
}: {
  stages: FunnelStage[]
  weakest: string | null
  /** Window end; a stage with an earlier asOf shows its own end date (lagging source). */
  windowTo?: string
  /** "Vorwoche" for 7-day windows, "davor" otherwise */
  prevLabel?: string
}) {
  return (
    <ol
      className="grid grid-cols-1 gap-2 min-[25rem]:grid-cols-2 md:grid-cols-4"
      aria-label="Funnel-Stufen"
    >
      {stages.map((s, i) => {
        const data = hasData(s)
        const weak = s.key === weakest
        const prevStage = i > 0 ? stages[i - 1] : null
        const conv = s.conversion ?? null
        return (
          <li
            key={s.key}
            className={cn(
              "relative flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3",
              !data && "border-dashed bg-transparent",
              weak && "border-(--status-bad) ring-1 ring-(--status-bad)"
            )}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-muted-foreground">
                <span className="tabular-nums">{i + 1}.</span> {stageLabel(s)}
              </span>
            </div>
            {data ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-semibold tabular-nums">
                    {fmtNum(s.value)}
                  </span>
                  <Delta value={s.delta} />
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {prevLabel} {fmtNum(s.prev)}
                  {s.asOf && windowTo && s.asOf < windowTo
                    ? ` · Stand ${s.asOf.slice(8, 10)}.${s.asOf.slice(5, 7)}.`
                    : null}
                </p>
                {prevStage ? (
                  <div className="mt-auto flex flex-col gap-1 border-t pt-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                        <ArrowRight aria-hidden="true" className="size-3" />
                        <span className="truncate">Conversion</span>
                      </span>
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          weak && "text-(--status-bad)"
                        )}
                      >
                        {fmtPct(conv, conv !== null && conv < 0.01 ? 2 : 1)}
                      </span>
                    </div>
                    <div
                      className="h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden="true"
                    >
                      <div
                        className={cn(
                          "h-full rounded-full bg-foreground/60",
                          weak && "bg-(--status-bad)"
                        )}
                        style={{
                          width: `${Math.min(100, Math.max(conv !== null && conv > 0 ? 2 : 0, (conv ?? 0) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {prevLabel} {fmtPct(s.prevConversion ?? null)}
                    </span>
                  </div>
                ) : null}
                {weak ? (
                  <span className="text-xs font-medium text-(--status-bad)">
                    Schwächste Stufe
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">keine Daten</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** One-line funnel for the overview: stages with data only. */
export function FunnelCompact({
  stages,
  weakest,
}: {
  stages: FunnelStage[]
  weakest: string | null
}) {
  const shown = stages.filter(hasData)
  if (shown.length === 0)
    return <p className="text-sm text-muted-foreground">Noch keine KPI-Daten</p>
  return (
    <ol className="flex min-w-0 flex-wrap gap-1.5" aria-label="Funnel">
      {shown.map((s) => {
        const weak = s.key === weakest
        return (
          <li
            key={s.key}
            className={cn(
              "flex min-w-[6.5rem] flex-col rounded-md border px-2 py-1",
              weak && "border-(--status-bad) ring-1 ring-(--status-bad)"
            )}
            title={weak ? `${stageLabel(s)}: schwächste Stufe` : stageLabel(s)}
          >
            <span
              className={cn(
                "truncate text-[11px] text-muted-foreground",
                weak && "font-medium text-(--status-bad)"
              )}
            >
              {stageLabel(s)}
              {weak ? (
                <span className="sr-only"> (schwächste Stufe)</span>
              ) : null}
            </span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums">
                {fmtCompact(s.value)}
              </span>
              <Delta value={s.delta} hideIcon />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

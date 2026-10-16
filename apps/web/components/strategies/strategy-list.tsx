import Link from "next/link"
import {
  fmtShortDate,
  label,
  STRATEGY_STATUS_LABEL,
} from "@/components/growth/format"
import { Badge } from "@/components/ui/badge"
import type { Strategy, StrategyAccount } from "@/lib/growth-types"
import { ACCOUNT_STATUS_LABEL } from "@/lib/labels"
import { cn } from "@/lib/utils"

/** Status as a badge: active filled, paused/retired outlined. */
export function StrategyStatus({ status }: { status: string }) {
  return (
    <Badge
      variant={status === "active" ? "secondary" : "outline"}
      className={cn(status === "retired" && "text-muted-foreground")}
    >
      {label(STRATEGY_STATUS_LABEL, status)}
    </Badge>
  )
}

export function SkillBadges({ skills }: { skills: string[] }) {
  if (!skills.length) return null
  return (
    <ul className="flex min-w-0 flex-wrap gap-1" aria-label="Skills">
      {skills.map((s) => (
        <li key={s} className="min-w-0">
          <Badge
            variant="outline"
            className="max-w-full font-mono text-[11px] font-normal text-muted-foreground"
          >
            <span className="truncate">{s}</span>
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function projectText(
  projectId: string | null,
  projectName: (id: string) => string,
  shared = "alle Projekte"
) {
  return projectId ? projectName(projectId) : shared
}

/** One row per stored strategy (kind strategy). */
export function StrategyList({
  items,
  projectName,
}: {
  items: Strategy[]
  projectName: (id: string) => string
}) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {items.map((s) => (
        <li
          key={s.id}
          className="flex min-w-0 flex-col gap-2 p-4 first:rounded-t-xl last:rounded-b-xl"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/strategies/${encodeURIComponent(s.id)}`}
              prefetch={false}
              className="min-w-0 font-medium break-words underline-offset-4 hover:underline"
            >
              {s.name}
            </Link>
            <StrategyStatus status={s.status} />
            <span className="text-xs text-muted-foreground">
              {projectText(s.projectId, projectName)}
            </span>
          </div>
          {s.summary ? (
            <p className="line-clamp-2 max-w-prose text-sm text-muted-foreground">
              {s.summary}
            </p>
          ) : null}
          <SkillBadges skills={s.skills} />
        </li>
      ))}
    </ul>
  )
}

function AccountLine({ a }: { a: StrategyAccount }) {
  const plan = a.source === "plan"
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs">
      <span className="font-medium text-foreground">{a.name}</span>
      <span className="text-muted-foreground">
        {label(ACCOUNT_STATUS_LABEL, a.status)}
        {plan
          ? ` · im Plan${a.dates?.length ? ` am ${a.dates.map(fmtShortDate).join(", ")}` : ""}`
          : ""}
      </span>
    </li>
  )
}

/** Formats as shortform strategies (kind format) with the accounts running them. */
export function FormatList({
  items,
  projectName,
}: {
  items: Strategy[]
  projectName: (id: string) => string
}) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {items.map((f) => {
        const accounts = f.accounts ?? []
        return (
          <li
            key={f.id}
            className="grid min-w-0 grid-cols-1 gap-3 p-4 first:rounded-t-xl last:rounded-b-xl md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:gap-6"
          >
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={f.url ?? `/formats/${encodeURIComponent(f.id)}`}
                  prefetch={false}
                  className="min-w-0 font-medium break-words underline-offset-4 hover:underline"
                >
                  {f.name}
                </Link>
                <StrategyStatus status={f.status} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {projectText(f.projectId, projectName, "geteilt")}
                  {f.version ? ` · Version ${f.version}` : ""}
                </span>
              </div>
              {f.summary ? (
                <p className="line-clamp-2 max-w-prose text-sm text-muted-foreground">
                  {f.summary}
                </p>
              ) : null}
              <SkillBadges skills={f.skills} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">Accounts</span>
              {accounts.length ? (
                <ul className="flex flex-col gap-1">
                  {accounts.map((a) => (
                    <AccountLine key={`${a.id}-${a.source}`} a={a} />
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Kein Account nutzt das Format.
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

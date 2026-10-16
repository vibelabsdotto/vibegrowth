import { Cockpit } from "@/components/growth/cockpit"
import { FunnelCompact } from "@/components/growth/funnel"
import {
  fmtAgo,
  fmtCompact,
  label,
  LIGHT_LABEL,
  PROJECT_KIND_LABEL,
} from "@/components/growth/format"
import { ScopeLabel, ScopeLink } from "@/components/growth/scope"
import { load, projectScope, requestTime } from "@/components/growth/server"
import {
  EmptyState,
  LightBadge,
  SectionError,
  TONE_TEXT,
} from "@/components/growth/status"
import { UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import type { Light, OverviewRow } from "@/lib/growth-types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Übersicht" }

// Links from here change the project scope (?project=). Plain anchors on purpose:
// a full load re-renders the sidebar switcher, a client-side <Link> would leave it stale.

const ORDER: Record<string, number> = { red: 0, yellow: 1, green: 2 }
const REASON_TONE: Record<string, "bad" | "warn" | "neutral"> = {
  red: "bad",
  yellow: "warn",
  green: "neutral",
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const sp = await searchParams
  const days = sp.days === "28" ? 28 : 7
  // One page, two views: with a project chosen in the switcher the cockpit, otherwise every project.
  const scope = await projectScope()
  if (scope.project)
    return <Cockpit id={scope.project} days={days} daysParam={sp.days} />
  const res = await load<OverviewRow[]>("/overview", { days })
  const rows = [...(res.data ?? [])].sort(
    (a, b) =>
      (ORDER[a.light] ?? 3) - (ORDER[b.light] ?? 3) ||
      a.project.name.localeCompare(b.project.name, "de")
  )
  const now = requestTime()
  const count = (l: Light) => rows.filter((r) => r.light === l).length
  const pending = rows.reduce((n, r) => n + (r.pendingApprovals ?? 0), 0)
  const running = rows.reduce((n, r) => n + (r.runningExperiments ?? 0), 0)

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Übersicht"
        description={
          <ScopeLabel project="" name="Alle Projekte">
            Letzte {days} Tage gegen die {days} Tage davor. Ein Projekt öffnet
            sein Cockpit.
          </ScopeLabel>
        }
        actions={
          <UrlToggle
            param="days"
            value={String(days)}
            params={{ days: sp.days }}
            label="Zeitraum"
            options={[
              { value: "7", label: "7 Tage" },
              { value: "28", label: "28 Tage" },
            ]}
          />
        }
      />

      {res.error !== null ? (
        <SectionError title="Übersicht nicht geladen" error={res.error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Keine aktiven Projekte"
          description="Projekte legt ein Agent mit `vibegrowth projects add` an."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Handeln" value={count("red")} tone="bad" />
            <Stat label="Beobachten" value={count("yellow")} tone="warn" />
            <Stat
              label="Wartet auf Max"
              value={pending}
              href={pending ? "/approvals?project=all" : undefined}
            />
            <Stat
              label="Laufende Experimente"
              value={running}
              href={running ? "/experiments?project=all" : undefined}
            />
          </div>

          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {rows.map((r) => (
              <li
                key={r.project.id}
                className="grid min-w-0 grid-cols-1 gap-3 p-4 first:rounded-t-xl last:rounded-b-xl lg:grid-cols-[13rem_minmax(0,1fr)_13rem] lg:gap-6"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <LightBadge light={r.light} />
                  <ScopeLink
                    path="/"
                    project={r.project.id}
                    className="truncate font-medium underline-offset-4 hover:underline"
                  >
                    {r.project.name}
                  </ScopeLink>
                  <span className="truncate text-xs text-muted-foreground">
                    {label(PROJECT_KIND_LABEL, r.project.kind)}
                    {r.project.url
                      ? ` · ${r.project.url.replace(/^https?:\/\//, "")}`
                      : ""}
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <FunnelCompact
                    stages={r.funnel?.stages ?? []}
                    weakest={r.weakest}
                  />
                  {r.reasons?.length ? (
                    <ul
                      className={cn(
                        "flex flex-col gap-0.5 text-xs",
                        TONE_TEXT[REASON_TONE[r.light] ?? "neutral"]
                      )}
                      aria-label={`Gründe für „${label(LIGHT_LABEL, r.light)}“`}
                    >
                      {r.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <dl className="grid grid-cols-2 content-start gap-x-3 gap-y-1 text-xs sm:grid-cols-4 lg:grid-cols-[auto_1fr]">
                  <dt className="text-muted-foreground">Freigaben</dt>
                  <dd className="tabular-nums">
                    {r.pendingApprovals ? (
                      <a
                        href={`/approvals?project=${encodeURIComponent(r.project.id)}`}
                        className="font-medium underline underline-offset-4"
                      >
                        {r.pendingApprovals} offen
                      </a>
                    ) : (
                      "keine"
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Experimente</dt>
                  <dd className="tabular-nums">
                    {r.runningExperiments ? (
                      <a
                        href={`/experiments?project=${encodeURIComponent(r.project.id)}`}
                        className="underline underline-offset-4"
                      >
                        {r.runningExperiments} laufen
                      </a>
                    ) : (
                      "keine"
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Letzter Abruf</dt>
                  <dd
                    className={cn(
                      r.collectorErrors?.length && "text-(--status-warn)"
                    )}
                  >
                    {fmtAgo(r.lastCollect, now)}
                    {r.collectorErrors?.length
                      ? ` · ${r.collectorErrors.length} Fehler`
                      : ""}
                  </dd>
                  {r.shorts?.accounts ? (
                    <>
                      <dt className="text-muted-foreground">Shorts 7 T.</dt>
                      <dd className="tabular-nums">
                        {r.shorts.postsLast7d} Posts ·{" "}
                        {fmtCompact(r.shorts.playsLast7d)} Plays
                      </dd>
                    </>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string
  value: number
  tone?: "bad" | "warn"
  href?: string
}) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums",
          value > 0 && tone && TONE_TEXT[tone]
        )}
      >
        {value}
      </span>
    </>
  )
  return href ? (
    <a
      href={href}
      className="flex flex-col gap-1 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/40"
    >
      {body}
    </a>
  ) : (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-3">
      {body}
    </div>
  )
}

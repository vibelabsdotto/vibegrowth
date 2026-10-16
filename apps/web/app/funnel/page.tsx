import { Cmd } from "@/components/strategies/cmd"
import { fmtDate, label, PROJECT_KIND_LABEL } from "@/components/growth/format"
import { FunnelCompact, FunnelStrip } from "@/components/growth/funnel"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel, ScopeLink } from "@/components/growth/scope"
import { EmptyState, SectionError } from "@/components/growth/status"
import { UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import type { Funnel, OverviewRow } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Funnel" }

const DESCRIPTION =
  "Von der Impression bis zum aktiven Nutzer, mit Conversion je Stufe."

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const sp = await searchParams
  const days = sp.days === "28" ? 28 : 7
  const scope = await projectScope()
  const { project } = scope
  const [funnelRes, overviewRes] = await Promise.all([
    project ? load<Funnel>("/funnel", { project, days }) : null,
    project ? null : load<OverviewRow[]>("/overview", { days }),
  ])
  const prevLabel = days === 7 ? "Vorwoche" : "davor"

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Funnel"
        description={
          <ScopeLabel project={project} name={scope.name}>
            {DESCRIPTION} Letzte {days} Tage gegen die {days} Tage davor.
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

      {funnelRes ? (
        funnelRes.error !== null ? (
          <SectionError title="Funnel nicht geladen" error={funnelRes.error} />
        ) : (
          <section
            aria-labelledby="funnel-title"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="funnel-title" className="text-base font-semibold">
                Stufen
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {fmtDate(funnelRes.data.window.from)} bis{" "}
                {fmtDate(funnelRes.data.window.to)} · Vergleich{" "}
                {fmtDate(funnelRes.data.prevWindow.from)} bis{" "}
                {fmtDate(funnelRes.data.prevWindow.to)}
              </span>
            </div>
            <FunnelStrip
              stages={funnelRes.data.stages}
              weakest={funnelRes.data.weakest}
              prevLabel={prevLabel}
              windowTo={funnelRes.data.window.to}
            />
          </section>
        )
      ) : overviewRes && overviewRes.error !== null ? (
        <SectionError title="Funnel nicht geladen" error={overviewRes.error} />
      ) : (
        <FunnelAll rows={overviewRes?.data ?? []} />
      )}
    </div>
  )
}

/** Scope "Alle": one compact funnel per project, the name switches the scope. */
function FunnelAll({ rows }: { rows: OverviewRow[] }) {
  if (!rows.length)
    return (
      <EmptyState
        title="Keine aktiven Projekte"
        description={
          <>
            Projekte legt ein Agent mit <Cmd>vibegrowth projects add</Cmd> an.
          </>
        }
      />
    )
  const sorted = [...rows].sort(
    (a, b) =>
      Number(b.funnel.stages.some((s) => s.value !== null)) -
        Number(a.funnel.stages.some((s) => s.value !== null)) ||
      a.project.name.localeCompare(b.project.name, "de")
  )
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {sorted.map((r) => (
        <li
          key={r.project.id}
          className="grid min-w-0 grid-cols-1 gap-3 p-4 first:rounded-t-xl last:rounded-b-xl lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <ScopeLink
              path="/funnel"
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
          <FunnelCompact stages={r.funnel?.stages ?? []} weakest={r.weakest} />
        </li>
      ))}
    </ul>
  )
}

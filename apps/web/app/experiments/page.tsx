import Link from "next/link"
import { AddChange } from "@/components/growth/add-change"
import { ChangeLegend, MarkedLineChart } from "@/components/growth/charts"
import {
  addDays,
  CHANGE_KIND_LABEL,
  EXPERIMENT_STATUS_LABEL,
  fmtDate,
  label,
  localToday,
  lowerIsBetter,
  METRIC_LABEL,
  actorLabel,
} from "@/components/growth/format"
import { list, load } from "@/components/growth/server"
import {
  Delta,
  EmptyState,
  SectionError,
  VerdictToken,
} from "@/components/growth/status"
import { UrlFilter, UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Change, Experiment, KpiRow, Project } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Experimente & Log" }

type Search = { project?: string; range?: string }

const RANGES: Record<string, number> = { "28": 28, "90": 90, "180": 180 }

export default async function ExperimentsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const sp = await searchParams
  const project = sp.project ?? ""
  const range = RANGES[sp.range ?? ""] ? sp.range! : "90"
  // Up to today, so a change logged today shows in the log and as a marker (today's numbers are still empty).
  const to = localToday()
  const from = addDays(to, -(RANGES[range] - 1))

  const [expRes, projectsRes, changesRes] = await Promise.all([
    load<Experiment[]>("/experiments", { project: project || undefined }),
    load<Project[]>("/projects"),
    load<Change[]>("/changes", { project: project || undefined, from, to }),
  ])
  const projects = (projectsRes.data ?? []).filter(
    (p) => p.status !== "archived"
  )
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  // The traffic chart needs one project; default to the one with the most logged changes.
  const changeCount = (id: string) =>
    (changesRes.data ?? []).filter((c) => c.projectId === id).length
  const busiest = [...projects].sort(
    (a, b) => changeCount(b.id) - changeCount(a.id)
  )[0]
  const chartProject = project || busiest?.id || ""
  const [clicksRes, sessionsRes] = chartProject
    ? await Promise.all([
        load<KpiRow[]>("/kpi", {
          project: chartProject,
          source: "gsc",
          metric: "clicks",
          from,
          to,
        }),
        load<KpiRow[]>("/kpi", {
          project: chartProject,
          source: "ga4",
          metric: "sessions",
          from,
          to,
        }),
      ])
    : [null, null]

  const totals = (rows: KpiRow[] | null | undefined) => {
    const m = new Map<string, number>()
    for (const r of list<KpiRow>(rows))
      if (!r.dims) m.set(r.date, (m.get(r.date) ?? 0) + r.value)
    return m
  }
  const clicks = totals(clicksRes?.data)
  const sessions = totals(sessionsRes?.data)
  const series: {
    date: string
    clicks: number | null
    visits: number | null
  }[] = []
  for (let d = from; d <= to; d = addDays(d, 1))
    series.push({
      date: d,
      clicks: clicks.get(d) ?? null,
      visits: sessions.get(d) ?? null,
    })
  const hasTraffic = clicks.size > 0 || sessions.size > 0
  const changes = changesRes.data ?? []
  const chartChanges = changes
    .filter((c) => c.projectId === chartProject)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const experiments = expRes.data ?? []
  const params = { project: sp.project, range: sp.range }

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Experimente & Log"
        description="Was wurde geändert, und hat es gewirkt?"
        actions={
          <>
            <UrlFilter
              param="project"
              value={project}
              params={params}
              label="Projekt"
              allLabel="Alle Projekte"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
            <AddChange
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              project={project}
              experiments={experiments
                .filter((e) => e.status === "running")
                .map((e) => ({ id: e.id, title: e.title }))}
            />
          </>
        }
      />

      <section aria-labelledby="exp-title" className="flex flex-col gap-3">
        <h2 id="exp-title" className="text-base font-semibold">
          Experimente
        </h2>
        {expRes.error !== null ? (
          <SectionError
            title="Experimente nicht geladen"
            error={expRes.error}
          />
        ) : experiments.length === 0 ? (
          <EmptyState
            title="Keine Experimente"
            description="Ein Agent legt Experimente mit `vibegrowth exp add` an."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Experiment</TableHead>
                  {!project ? <TableHead>Projekt</TableHead> : null}
                  <TableHead>Metrik</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Veränderung</TableHead>
                  <TableHead>Urteil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {experiments.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-80">
                      <Link
                        href={`/experiments/${e.id}`}
                        prefetch={false}
                        className="block truncate font-medium underline-offset-4 hover:underline"
                      >
                        {e.title}
                      </Link>
                      {e.target ? (
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {e.target}
                        </span>
                      ) : null}
                    </TableCell>
                    {!project ? (
                      <TableCell className="text-muted-foreground">
                        {name(e.projectId)}
                      </TableCell>
                    ) : null}
                    <TableCell>{label(METRIC_LABEL, e.metric)}</TableCell>
                    <TableCell className="tabular-nums">
                      {fmtDate(e.startDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          e.status === "running" ? "secondary" : "outline"
                        }
                      >
                        {label(EXPERIMENT_STATUS_LABEL, e.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {e.result ? (
                        <Delta
                          value={e.result.change}
                          invert={lowerIsBetter(e.metric)}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          ab {fmtDate(e.dueOn ?? null)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <VerdictToken verdict={e.verdict} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="log-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="log-title" className="text-base font-semibold">
            Log
          </h2>
          <UrlToggle
            param="range"
            value={range}
            params={params}
            label="Zeitraum"
            options={[
              { value: "28", label: "28 Tage" },
              { value: "90", label: "90 Tage" },
              { value: "180", label: "180 Tage" },
            ]}
          />
        </div>
        {chartProject ? (
          <Card>
            <CardHeader>
              <CardTitle>Klicks und Besuche · {name(chartProject)}</CardTitle>
              <CardDescription>
                Tageswerte aus Search Console und GA4, Änderungen als
                Markierung.
              </CardDescription>
              {!project && projects.length > 1 ? (
                <CardAction className="text-xs text-muted-foreground">
                  Projekt oben wählen
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {clicksRes?.error ? (
                <SectionError
                  title="KPI nicht geladen"
                  error={clicksRes.error}
                />
              ) : hasTraffic ? (
                <>
                  <MarkedLineChart
                    data={series}
                    changes={chartChanges}
                    config={{
                      clicks: { label: "Klicks", color: "var(--foreground)" },
                      visits: {
                        label: "Besuche",
                        color: "var(--status-info)",
                      },
                    }}
                  />
                  <ChangeLegend changes={chartChanges} from={from} to={to} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Keine Klick- oder Besuchsdaten im Zeitraum.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {changesRes.error !== null ? (
          <SectionError
            title="Änderungen nicht geladen"
            error={changesRes.error}
          />
        ) : changes.length === 0 ? (
          <EmptyState
            title="Keine Änderungen im Zeitraum"
            description="Deploys, Content und Store-Änderungen trägt der Agent mit `vibegrowth changes add` ein."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  {!project ? <TableHead>Projekt</TableHead> : null}
                  <TableHead>Art</TableHead>
                  <TableHead>Änderung</TableHead>
                  <TableHead>Verweis</TableHead>
                  <TableHead>Von</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...changes]
                  .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
                  .map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="tabular-nums">
                        {fmtDate(c.date)}
                      </TableCell>
                      {!project ? (
                        <TableCell className="text-muted-foreground">
                          {name(c.projectId)}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <Badge variant="outline">
                          {label(CHANGE_KIND_LABEL, c.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[28rem] whitespace-normal">
                        {c.summary}
                        {c.experimentId ? (
                          <Link
                            href={`/experiments/${c.experimentId}`}
                            prefetch={false}
                            className="ml-2 text-xs text-muted-foreground underline underline-offset-4"
                          >
                            Experiment {c.experimentId}
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                        {c.ref ?? "–"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {actorLabel(c.actor)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

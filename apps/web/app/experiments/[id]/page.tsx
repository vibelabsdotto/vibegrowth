import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { ChangeLegend, MarkedLineChart } from "@/components/growth/charts"
import {
  actorLabel,
  EXPERIMENT_STATUS_LABEL,
  fmtDate,
  fmtMetric,
  label,
  lowerIsBetter,
  METRIC_LABEL,
} from "@/components/growth/format"
import { load } from "@/components/growth/server"
import { Delta, SectionError, VerdictToken } from "@/components/growth/status"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type {
  ExperimentDetail,
  ExperimentResult,
  Project,
} from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Experiment" }

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const [res, projectRes] = await Promise.all([
    load<ExperimentDetail>(`/experiments/${id}`),
    load<Project[]>("/projects"),
  ])
  if (res.error !== null) {
    if (/NOT_FOUND/.test(res.error)) notFound()
    return (
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
        <BackLink />
        <SectionError title="Experiment nicht geladen" error={res.error} />
      </div>
    )
  }
  const e = res.data
  const projectName =
    projectRes.data?.find((p) => p.id === e.projectId)?.name ?? e.projectId
  const result: ExperimentResult | null = e.result ?? e.interim ?? null
  const isInterim = !e.result && !!e.interim
  const percent = e.metric === "ctr" || e.metric.endsWith(":ctr")
  const series = (e.series ?? []).map((p) => ({ date: p.date, value: p.value }))
  const changes = [...(e.changes ?? [])].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id - b.id
  )
  const w = e.windows
  const metricName = label(METRIC_LABEL, e.metric)
  const first = series[0]?.date
  const last = series[series.length - 1]?.date

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <BackLink />
      <PageHeader
        title={e.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/projects/${encodeURIComponent(e.projectId)}`}
              prefetch={false}
              className="underline underline-offset-4"
            >
              {projectName}
            </Link>
            <span>· {metricName}</span>
            {e.target ? (
              <span className="font-mono text-xs">· {e.target}</span>
            ) : null}
            <span>· angelegt von {actorLabel(e.actor)}</span>
          </span>
        }
        actions={
          <>
            <Badge variant={e.status === "running" ? "secondary" : "outline"}>
              {label(EXPERIMENT_STATUS_LABEL, e.status)}
            </Badge>
            <VerdictToken verdict={e.verdict} />
          </>
        }
      />

      {e.hypothesis ? (
        <p className="max-w-prose text-sm">
          <span className="text-muted-foreground">Hypothese: </span>
          {e.hypothesis}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <WindowCard
          title="Vorher"
          range={w?.baseline}
          value={result?.baseline}
          metric={e.metric}
        />
        <WindowCard
          title={isInterim ? "Nachher (bisher)" : "Nachher"}
          range={w?.after}
          value={result?.after}
          metric={e.metric}
        />
        <Card size="sm">
          <CardHeader>
            <CardDescription>
              Veränderung
              {result?.baseline.perDay !== null &&
              result?.baseline.perDay !== undefined
                ? " pro Tag"
                : ""}
            </CardDescription>
            <CardTitle className="text-2xl">
              {result ? (
                <Delta
                  value={result.change}
                  invert={lowerIsBetter(e.metric)}
                  className="text-2xl font-semibold"
                />
              ) : (
                "–"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {e.status === "running" ? (
              e.due ? (
                "Auswertung fällig"
              ) : (
                `Auswertung ab ${fmtDate(e.dueOn ?? null)}`
              )
            ) : e.verdict ? (
              <VerdictToken verdict={e.verdict} />
            ) : (
              label(EXPERIMENT_STATUS_LABEL, e.status)
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{metricName} pro Tag</CardTitle>
          <CardDescription>
            Grau: Vorher-Fenster, blau: Nachher-Fenster. Nummern markieren
            Änderungen.
            {lowerIsBetter(e.metric)
              ? " Achse umgedreht: oben ist besser."
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {series.some((p) => p.value !== null) ? (
            <MarkedLineChart
              data={series}
              changes={changes}
              percent={percent}
              reversed={lowerIsBetter(e.metric)}
              config={{
                value: { label: metricName, color: "var(--foreground)" },
              }}
              areas={[
                ...(w?.baseline
                  ? [{ ...w.baseline, label: "Vorher", tone: "muted" as const }]
                  : []),
                ...(w?.after
                  ? [{ ...w.after, label: "Nachher", tone: "info" as const }]
                  : []),
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Für diese Metrik liegen im Zeitraum noch keine Tageswerte vor.
            </p>
          )}
          <ChangeLegend changes={changes} from={first} to={last} />
        </CardContent>
      </Card>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/experiments"
      prefetch={false}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Experimente & Log
    </Link>
  )
}

function WindowCard({
  title,
  range,
  value,
  metric,
}: {
  title: string
  range?: { from: string; to: string }
  value?: ExperimentResult["baseline"]
  metric: string
}) {
  const perDay = value?.perDay
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>
          {title}
          {range ? ` · ${fmtDate(range.from)} bis ${fmtDate(range.to)}` : ""}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {fmtMetric(metric, value?.value)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
        {perDay !== null && perDay !== undefined ? (
          <span>{fmtMetric(metric, perDay)} pro Tag</span>
        ) : null}
        {value?.daysWithData !== undefined ? (
          <span>
            {value.daysWithData}/{value.days} Tage mit Daten
          </span>
        ) : null}
        {value?.impressions !== undefined ? (
          <span>
            {fmtMetric("impressions", value.impressions)} Impressionen
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
}

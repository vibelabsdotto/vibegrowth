import { Check, Minus, TriangleAlert } from "lucide-react"
import { MarkedLineChart } from "@/components/growth/charts"
import {
  fmtDate,
  fmtNum,
  fmtPct,
  fmtShortDate,
  json,
  label,
  MENTION_KIND_LABEL,
} from "@/components/growth/format"
import { MentionStatus } from "@/components/growth/mention-status"
import { list, load } from "@/components/growth/server"
import { EmptyState, SectionError } from "@/components/growth/status"
import { UrlFilter } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
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
import type {
  GeoCheck,
  GeoQuestion,
  MentionTarget,
  Project,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "GEO" }

type Run = {
  key: string
  date: string
  engine: string
  checks: GeoCheck[]
  ok: number
  mentioned: number
  cited: number
  avgPosition: number | null
}

function nameOf(v: unknown): string | null {
  if (typeof v === "string") return v
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    const n = o.name ?? o.brand ?? o.title
    if (typeof n === "string") return n
  }
  return null
}

function domainOf(v: unknown): string | null {
  let url: string | null = null
  if (typeof v === "string") url = v
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    if (typeof o.domain === "string") return o.domain.replace(/^www\./, "")
    if (typeof o.url === "string") url = o.url
  }
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url.replace(/^www\./, "")
  }
}

function tally(values: (string | null)[]) {
  const m = new Map<string, number>()
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )
}

export default async function GeoPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const sp = await searchParams
  const projectsRes = await load<Project[]>("/projects")
  const projects = (projectsRes.data ?? []).filter(
    (p) => p.status !== "archived"
  )
  const project = sp.project || projects[0]?.id || ""
  const [questionsRes, checksRes, mentionsRes] = project
    ? await Promise.all([
        load<GeoQuestion[]>("/geo/questions", { project }),
        load<GeoCheck[]>("/geo/checks", { project }),
        load<MentionTarget[]>("/mentions", { project }),
      ])
    : [null, null, null]

  const questions = list<GeoQuestion>(questionsRes?.data)
  const checks = list<GeoCheck>(checksRes?.data)
  const mentions = list<MentionTarget>(mentionsRes?.data).sort(
    (a, b) => b.citedCount - a.citedCount || b.seenCount - a.seenCount
  )

  const runMap = new Map<string, Run>()
  for (const c of checks) {
    const key = `${c.date}|${c.engine}`
    const r =
      runMap.get(key) ??
      ({
        key,
        date: c.date,
        engine: c.engine,
        checks: [],
        ok: 0,
        mentioned: 0,
        cited: 0,
        avgPosition: null,
      } satisfies Run)
    r.checks.push(c)
    runMap.set(key, r)
  }
  const runs = [...runMap.values()]
    .map((r) => {
      const ok = r.checks.filter((c) => c.status === "ok")
      const pos = ok
        .filter((c) => c.mentioned && c.position !== null)
        .map((c) => c.position as number)
      return {
        ...r,
        ok: ok.length,
        mentioned: ok.filter((c) => c.mentioned).length,
        cited: ok.filter((c) => c.cited).length,
        avgPosition: pos.length
          ? pos.reduce((a, b) => a + b, 0) / pos.length
          : null,
      }
    })
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.engine.localeCompare(b.engine)
    )
  const latest = runs[0]
  const matrixRuns = runs.slice(0, 8)
  const engines = [...new Set(runs.map((r) => r.engine))]
  const chartData = [...new Set(runs.map((r) => r.date))].sort().map((date) => {
    const row: { date: string; [k: string]: string | number | null } = {
      date,
    }
    engines.forEach((e, i) => {
      const r = runs.find((x) => x.date === date && x.engine === e)
      row[`e${i}`] = r && r.ok ? r.mentioned / r.ok : null
    })
    return row
  })
  const recentChecks = checks.filter((c) =>
    runs.slice(0, 4).some((r) => r.date === c.date && r.engine === c.engine)
  )
  const competitors = tally(
    recentChecks.flatMap((c) => json<unknown[]>(c.competitors, []).map(nameOf))
  ).slice(0, 12)
  const domains = tally(
    recentChecks.flatMap((c) => [
      ...json<unknown[]>(c.sources, []).map(domainOf),
    ])
  ).slice(0, 15)
  const qText = (id: number) =>
    questions.find((q) => q.id === id)?.text ?? `#${id}`
  const rowQuestions = questions.length
    ? questions.filter(
        (q) => q.active || checks.some((c) => c.questionId === q.id)
      )
    : [...new Set(checks.map((c) => c.questionId))].map((id) => ({
        id,
        text: qText(id),
        active: true,
        projectId: project,
      }))
  const error = questionsRes?.error ?? checksRes?.error ?? null

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="GEO"
        description="Wird das Projekt in KI-Antworten genannt, und welche Quellen zitieren die Antworten?"
        actions={
          <UrlFilter
            param="project"
            value={project}
            params={{ project: sp.project }}
            label="Projekt"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        }
      />
      {projectsRes.error !== null ? (
        <SectionError
          title="Projekte nicht geladen"
          error={projectsRes.error}
        />
      ) : error ? (
        <SectionError title="GEO-Daten nicht geladen" error={error} />
      ) : runs.length === 0 ? (
        <EmptyState
          title="Noch keine GEO-Läufe"
          description={
            questions.length
              ? `${questions.length} Fragen hinterlegt. Den ersten Lauf startet \`vibegrowth geo run --project ${project}\`.`
              : `Fragen legt ein Agent mit \`vibegrowth geo question add --project ${project}\` an.`
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi
              label="Nennungsquote"
              value={latest.ok ? fmtPct(latest.mentioned / latest.ok, 0) : "–"}
              hint={`${latest.mentioned} von ${latest.ok} Fragen`}
            />
            <Kpi
              label="Ø Position"
              value={fmtNum(latest.avgPosition)}
              hint="wenn genannt"
            />
            <Kpi
              label="Zitiert"
              value={latest.ok ? fmtPct(latest.cited / latest.ok, 0) : "–"}
              hint={`${latest.cited} Antworten verlinken das Projekt`}
            />
            <Kpi
              label="Letzter Lauf"
              value={fmtShortDate(latest.date)}
              hint={latest.engine}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Läufe</CardTitle>
              <CardDescription>
                Nennungsquote und Ø-Position je Lauf
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {chartData.length > 1 ? (
                <MarkedLineChart
                  data={chartData}
                  changes={[]}
                  percent
                  className="h-48"
                  config={Object.fromEntries(
                    engines.map((e, i) => [
                      `e${i}`,
                      {
                        label: e,
                        color:
                          i === 0 ? "var(--foreground)" : "var(--status-info)",
                      },
                    ])
                  )}
                />
              ) : null}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Engine</TableHead>
                      <TableHead className="text-right">Genannt</TableHead>
                      <TableHead className="text-right">Quote</TableHead>
                      <TableHead className="text-right">Ø Position</TableHead>
                      <TableHead className="text-right">Zitiert</TableHead>
                      <TableHead className="text-right">Fehler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.slice(0, 12).map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="tabular-nums">
                          {fmtDate(r.date)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.engine}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.mentioned}/{r.ok}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.ok ? fmtPct(r.mentioned / r.ok, 0) : "–"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNum(r.avgPosition)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.ok ? fmtPct(r.cited / r.ok, 0) : "–"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            r.checks.length - r.ok > 0 && "text-(--status-warn)"
                          )}
                        >
                          {r.checks.length - r.ok}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fragen × Lauf</CardTitle>
              <CardDescription>
                Zahl = Position der Nennung, Strich = nicht genannt
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-card py-2 pr-3 text-left text-xs font-medium text-muted-foreground">
                        Frage
                      </th>
                      {matrixRuns.map((r) => (
                        <th
                          key={r.key}
                          className="px-1 py-2 text-center text-xs font-medium whitespace-nowrap text-muted-foreground"
                          title={r.engine}
                        >
                          {fmtShortDate(r.date)}
                          {engines.length > 1 ? (
                            <span className="block font-normal">
                              {r.engine}
                            </span>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowQuestions.map((q) => (
                      <tr key={q.id}>
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-0 z-10 max-w-80 border-t bg-card py-1.5 pr-3 text-left font-normal",
                            !q.active && "text-muted-foreground"
                          )}
                        >
                          <span className="line-clamp-2">{q.text}</span>
                        </th>
                        {matrixRuns.map((r) => {
                          const c = r.checks.find((x) => x.questionId === q.id)
                          return (
                            <td
                              key={r.key}
                              className="border-t px-1 py-1.5 text-center"
                            >
                              <MatrixCell check={c} />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Konkurrenten</CardTitle>
                <CardDescription>
                  Genannte Marken der letzten {Math.min(4, runs.length)} Läufe
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RankList
                  rows={competitors}
                  total={recentChecks.length}
                  empty="Keine Konkurrenten erkannt."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Quellen-Domains</CardTitle>
                <CardDescription>
                  Woraus die Antworten schöpfen (letzte{" "}
                  {Math.min(4, runs.length)} Läufe)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RankList
                  rows={domains}
                  total={recentChecks.length}
                  empty="Keine Quellen erfasst."
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {project && mentionsRes && !error ? (
        <Card>
          <CardHeader>
            <CardTitle>Erwähnungs-Ziele</CardTitle>
            <CardDescription>
              Seiten, die KI-Antworten als Quelle nutzen. Ein Eintrag dort hilft
              bei der Nennung.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mentionsRes.error !== null ? (
              <SectionError error={mentionsRes.error} />
            ) : mentions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Ziele.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Art</TableHead>
                      <TableHead className="text-right">Gesehen</TableHead>
                      <TableHead className="text-right">Zitiert</TableHead>
                      <TableHead>Zuletzt</TableHead>
                      <TableHead className="w-40">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mentions.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="max-w-64">
                          {m.url ? (
                            <a
                              href={m.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate underline-offset-4 hover:underline"
                            >
                              {m.domain}
                            </a>
                          ) : (
                            <span className="block truncate">{m.domain}</span>
                          )}
                          {m.contact || m.notes ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {[m.contact, m.notes].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {label(MENTION_KIND_LABEL, m.kind)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.seenCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.citedCount}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {fmtDate(m.lastSeen)}
                        </TableCell>
                        <TableCell>
                          <MentionStatus
                            id={m.id}
                            domain={m.domain}
                            status={m.status}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint ? (
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
}

function MatrixCell({ check }: { check?: GeoCheck }) {
  if (!check) return <span className="text-muted-foreground/50">·</span>
  if (check.status !== "ok")
    return (
      <span
        title={check.error ?? "Fehler"}
        className="inline-flex text-(--status-warn)"
      >
        <TriangleAlert aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Fehler</span>
      </span>
    )
  if (!check.mentioned)
    return (
      <span className="inline-flex text-muted-foreground" title="nicht genannt">
        <Minus aria-hidden="true" className="size-3.5" />
        <span className="sr-only">nicht genannt</span>
      </span>
    )
  return (
    <span
      className={cn(
        "inline-flex min-w-7 items-center justify-center gap-0.5 rounded-md bg-(--status-good)/15 px-1.5 py-0.5 text-xs font-medium text-(--status-good) tabular-nums",
        check.position !== null && check.position <= 3 && "font-semibold"
      )}
      title={`genannt${check.position ? ` auf Position ${check.position}` : ""}${check.cited ? ", zitiert" : ""}`}
    >
      {check.position ?? <Check aria-hidden="true" className="size-3" />}
      {check.cited ? <span aria-hidden="true">*</span> : null}
      <span className="sr-only">genannt{check.cited ? ", zitiert" : ""}</span>
    </span>
  )
}

function RankList({
  rows,
  total,
  empty,
}: {
  rows: [string, number][]
  total: number
  empty: string
}) {
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">{empty}</p>
  const max = rows[0][1]
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {rows.map(([name, n]) => (
        <li key={name} className="flex items-center gap-2">
          <span className="w-40 min-w-0 shrink-0 truncate sm:w-56">{name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-foreground/60"
              style={{ width: `${(n / max) * 100}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {n} / {total}
          </span>
        </li>
      ))}
    </ul>
  )
}

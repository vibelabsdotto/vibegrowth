import { Star } from "lucide-react"
import { MarkedLineChart } from "@/components/growth/charts"
import {
  addDays,
  fmtDate,
  fmtNum,
  json,
  label,
  localToday,
  STORE_LABEL,
} from "@/components/growth/format"
import { list, load, projectScope } from "@/components/growth/server"
import { ScopeLabel, ScopeLink } from "@/components/growth/scope"
import { Delta, EmptyState, SectionError } from "@/components/growth/status"
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
  Channel,
  KpiRow,
  Project,
  StoreReview,
  StoreSummary,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Store" }

const DAYS = 28
const STORES = [
  { source: "play", label: "Google Play" },
  { source: "asc", label: "App Store" },
] as const

const DESCRIPTION = `Installationen, Bewertung und Kampagnen der letzten ${DAYS} Tage.`

export default async function StorePage() {
  const scope = await projectScope()
  const { project, projectsRes } = scope
  if (!project)
    return (
      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
        <PageHeader
          title="Store"
          description={
            <ScopeLabel project="" name={scope.name}>
              {DESCRIPTION}
            </ScopeLabel>
          }
        />
        {projectsRes.error !== null ? (
          <SectionError
            title="Projekte nicht geladen"
            error={projectsRes.error}
          />
        ) : (
          <StoreAll projects={scope.projects} />
        )}
      </div>
    )
  const to = addDays(localToday(), -1)
  const from = addDays(to, -(DAYS - 1))
  const prevFrom = addDays(from, -DAYS)
  const prevTo = addDays(from, -1)

  const [playRes, ascRes, reviewsRes] = project
    ? await Promise.all([
        load<KpiRow[]>("/kpi", { project, source: "play", from: prevFrom, to }),
        load<KpiRow[]>("/kpi", { project, source: "asc", from: prevFrom, to }),
        load<StoreReview[]>("/store/reviews", { project, limit: 50 }),
      ])
    : [null, null, null]
  const rows = [...list<KpiRow>(playRes?.data), ...list<KpiRow>(ascRes?.data)]
  const kpiError = playRes?.error ?? ascRes?.error ?? null
  const reviews = list<StoreReview>(reviewsRes?.data)

  const sum = (source: string, metric: string, a: string, b: string) => {
    const r = rows.filter(
      (x) =>
        x.source === source &&
        x.metric === metric &&
        !x.dims &&
        x.date >= a &&
        x.date <= b
    )
    return r.length ? r.reduce((n, x) => n + x.value, 0) : null
  }
  const lastValue = (source: string, metric: string) => {
    const r = rows
      .filter((x) => x.source === source && x.metric === metric && !x.dims)
      .sort((a, b) => b.date.localeCompare(a.date))
    return r[0]?.value ?? null
  }
  const rel = (now: number | null, prev: number | null) =>
    now === null || prev === null || prev === 0 ? null : (now - prev) / prev

  const storeStats = STORES.map((s) => {
    const installs = sum(s.source, "installs", from, to)
    const prev = sum(s.source, "installs", prevFrom, prevTo)
    const visits =
      sum(s.source, "store_visits", from, to) ??
      sum(s.source, "product_page_views", from, to)
    return {
      ...s,
      installs,
      delta: rel(installs, prev),
      visits,
      rating: lastValue(s.source, "rating"),
    }
  }).filter((s) => s.installs !== null || s.rating !== null)

  const series: { date: string; play: number | null; asc: number | null }[] = []
  const daily = (source: string, d: string) =>
    rows.find(
      (x) =>
        x.source === source &&
        x.metric === "installs" &&
        !x.dims &&
        x.date === d
    )?.value ?? null
  for (let d = from; d <= to; d = addDays(d, 1))
    series.push({ date: d, play: daily("play", d), asc: daily("asc", d) })

  const campaigns = new Map<
    string,
    { store: string; installs: number; visits: number }
  >()
  for (const x of rows) {
    if (!x.dims || x.date < from) continue
    const d = json<Record<string, string>>(x.dims, {})
    const name = d.utm_campaign ?? d.campaign
    if (!name) continue
    const key = `${x.source}|${name}`
    const c = campaigns.get(key) ?? { store: x.source, installs: 0, visits: 0 }
    if (x.metric === "installs") c.installs += x.value
    if (x.metric === "store_visits" || x.metric === "product_page_views")
      c.visits += x.value
    campaigns.set(key, c)
  }
  const campaignRows = [...campaigns.entries()]
    .map(([key, v]) => ({ name: key.split("|")[1], ...v }))
    .sort((a, b) => b.installs - a.installs)
    .slice(0, 15)

  const ratingAvg = reviews.filter((r) => r.rating !== null)
  const avg = ratingAvg.length
    ? ratingAvg.reduce((n, r) => n + (r.rating ?? 0), 0) / ratingAvg.length
    : null

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Store"
        description={
          <ScopeLabel project={project} name={scope.name}>
            {DESCRIPTION}
          </ScopeLabel>
        }
      />
      {projectsRes.error !== null ? (
        <SectionError
          title="Projekte nicht geladen"
          error={projectsRes.error}
        />
      ) : kpiError ? (
        <SectionError title="Store-Zahlen nicht geladen" error={kpiError} />
      ) : storeStats.length === 0 && reviews.length === 0 ? (
        <EmptyState
          title="Keine Store-Daten"
          description="Die Collectors Google Play und App Store Connect liefern Installationen und Bewertungen, sobald sie im Projekt eingeschaltet sind."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {storeStats.map((s) => (
              <div
                key={s.source}
                className="flex flex-col gap-1 rounded-xl border bg-card p-3"
              >
                <span className="text-xs text-muted-foreground">
                  Installationen · {s.label}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {fmtNum(s.installs)}
                  </span>
                  <Delta value={s.delta} />
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {s.visits !== null
                    ? `${fmtNum(s.visits)} Store-Besuche`
                    : "keine Besuchsdaten"}
                </span>
              </div>
            ))}
            {storeStats.map((s) =>
              s.rating !== null ? (
                <div
                  key={`${s.source}-rating`}
                  className="flex flex-col gap-1 rounded-xl border bg-card p-3"
                >
                  <span className="text-xs text-muted-foreground">
                    Bewertung · {s.label}
                  </span>
                  <span className="flex items-center gap-1 text-2xl font-semibold tabular-nums">
                    {s.rating.toLocaleString("de-DE", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 2,
                    })}
                    <Star aria-hidden="true" className="size-4 fill-current" />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    letzter Stand
                  </span>
                </div>
              ) : null
            )}
          </div>

          {series.some((p) => p.play !== null || p.asc !== null) ? (
            <Card>
              <CardHeader>
                <CardTitle>Installationen pro Tag</CardTitle>
                <CardDescription>
                  {fmtDate(from)} bis {fmtDate(to)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MarkedLineChart
                  data={series}
                  changes={[]}
                  className="h-56"
                  config={{
                    play: { label: "Google Play", color: "var(--foreground)" },
                    asc: { label: "App Store", color: "var(--status-info)" },
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Kampagnen</CardTitle>
                <CardDescription>
                  Installationen nach Kampagne, {DAYS} Tage
                </CardDescription>
              </CardHeader>
              <CardContent>
                {campaignRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Keine Kampagnendaten.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kampagne</TableHead>
                        <TableHead>Store</TableHead>
                        <TableHead className="text-right">Installs</TableHead>
                        <TableHead className="text-right">Besuche</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaignRows.map((c) => (
                        <TableRow key={`${c.store}-${c.name}`}>
                          <TableCell className="max-w-48 truncate">
                            {c.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {c.store === "play" ? "Play" : "App Store"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNum(c.installs)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.visits ? fmtNum(c.visits) : "–"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bewertungen</CardTitle>
                <CardDescription>
                  {reviews.length
                    ? `${reviews.length} neueste · Ø ${fmtNum(avg)} Sterne`
                    : "Keine Bewertungen"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reviewsRes?.error ? (
                  <SectionError error={reviewsRes.error} />
                ) : (
                  <ul className="flex flex-col divide-y">
                    {reviews.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Stars value={r.rating} />
                          <Badge variant="outline">
                            {label(STORE_LABEL, r.store)}
                          </Badge>
                          <span className="text-muted-foreground tabular-nums">
                            {fmtDate(r.date)}
                            {r.version ? ` · v${r.version}` : ""}
                            {r.language ? ` · ${r.language}` : ""}
                          </span>
                        </div>
                        {r.title ? (
                          <span className="text-sm font-medium">{r.title}</span>
                        ) : null}
                        {r.body ? (
                          <p className="text-sm whitespace-pre-line">
                            {r.body}
                          </p>
                        ) : null}
                        {r.reply ? (
                          <p className="border-l-2 pl-3 text-sm text-muted-foreground">
                            Antwort: {r.reply}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

/** Alle Projekte: installs and rating per project; the detail opens with the project chosen. */
async function StoreAll({ projects }: { projects: Project[] }) {
  const [channelsRes, ...summaries] = await Promise.all([
    load<Channel[]>("/channels"),
    ...projects.map((p) =>
      load<StoreSummary>("/store/summary", { project: p.id, days: DAYS })
    ),
  ])
  const listings = list<Channel>(channelsRes.data).filter(
    (c) => (c.kind === "android" || c.kind === "ios") && c.status === "active"
  )
  const rows = projects
    .map((p, i) => {
      const res = summaries[i]
      const stores = Object.values(res.data?.stores ?? {})
      return {
        project: p,
        error: res.error,
        installs: res.data?.installs ?? null,
        play: res.data?.stores.google_play?.rating ?? null,
        asc: res.data?.stores.app_store?.rating ?? null,
        reviews: res.data?.reviews.window ?? null,
        hasData: stores.some((s) => s.hasData),
        listed: listings.some((c) => c.projectId === p.id),
      }
    })
    // Projects with store numbers first, then listed ones, then by name.
    .sort(
      (a, b) =>
        Number(b.hasData) - Number(a.hasData) ||
        Number(b.listed) - Number(a.listed) ||
        a.project.name.localeCompare(b.project.name, "de")
    )
  if (!rows.length)
    return (
      <EmptyState
        title="Keine aktiven Projekte"
        description="Projekte legt ein Agent mit `vibegrowth projects add` an."
      />
    )
  const rating = (r: { value: number } | null) =>
    r ? (
      <span className="inline-flex items-center gap-1">
        {r.value.toLocaleString("de-DE", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 2,
        })}
        <Star aria-hidden="true" className="size-3 fill-current" />
      </span>
    ) : (
      "–"
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Projekte</CardTitle>
        <CardDescription>
          Installationen der letzten {DAYS} Tage gegen die {DAYS} davor.
          Kampagnen und Bewertungstexte zeigt die Projektansicht.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projekt</TableHead>
                <TableHead className="text-right">Installs {DAYS} T.</TableHead>
                <TableHead className="text-right">Trend</TableHead>
                <TableHead className="text-right">Bewertung Play</TableHead>
                <TableHead className="text-right">
                  Bewertung App Store
                </TableHead>
                <TableHead className="text-right">
                  Bewertungen {DAYS} T.
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.project.id}>
                  <TableCell>
                    <ScopeLink
                      path="/store"
                      project={r.project.id}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {r.project.name}
                    </ScopeLink>
                  </TableCell>
                  {r.error !== null ? (
                    <TableCell
                      colSpan={5}
                      className="whitespace-normal text-(--status-bad)"
                    >
                      {r.error}
                    </TableCell>
                  ) : !r.hasData && !r.reviews?.count ? (
                    <TableCell colSpan={5} className="text-muted-foreground">
                      {r.listed
                        ? "Store-Eintrag, aber noch keine Zahlen"
                        : "keine Store-Daten"}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(r.installs?.value)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Delta value={r.installs?.delta ?? null} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rating(r.play)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rating(r.asc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.reviews?.count
                          ? `${r.reviews.count} · Ø ${fmtNum(r.reviews.avgRating)}`
                          : "–"}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function Stars({ value }: { value: number | null }) {
  if (value === null) return null
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`${value} von 5 Sternen`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn(
            "size-3.5",
            i <= value
              ? value <= 2
                ? "fill-(--status-bad) text-(--status-bad)"
                : "fill-foreground text-foreground"
              : "text-muted-foreground/40"
          )}
        />
      ))}
      <span className="sr-only">{value} von 5 Sternen</span>
    </span>
  )
}

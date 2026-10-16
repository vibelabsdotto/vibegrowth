import { Cmd } from "@/components/strategies/cmd"
import { fmtAgo, fmtNum } from "@/components/growth/format"
import { load, projectScope, requestTime } from "@/components/growth/server"
import { ScopeLabel, ScopeLink } from "@/components/growth/scope"
import { EmptyState, SectionError, TONE_TEXT } from "@/components/growth/status"
import { UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import { AuditPanel, SearchQueries } from "@/components/search/search-sections"
import type { AuditResult, SearchResult } from "@/components/search/types"
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
import type { Project } from "@/lib/growth-types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Suche & Audit" }

const DESCRIPTION =
  "Suchanfragen aus Search Console und Bing, dazu der letzte SEO-Audit der Website."

/** Rows per table; the API caps at 500. */
const LIMIT = 250

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; view?: string }>
}) {
  const sp = await searchParams
  const days = sp.days === "90" ? 90 : 28
  const opportunities = sp.view === "chancen"
  const scope = await projectScope()
  const { project, projectsRes } = scope

  if (!project)
    return (
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
        <PageHeader
          title="Suche & Audit"
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
          <SearchAll projects={scope.projects} />
        )}
      </div>
    )

  const [searchRes, auditRes] = await Promise.all([
    load<SearchResult>("/search", {
      project,
      days,
      opportunities: opportunities ? 1 : undefined,
      limit: LIMIT,
    }),
    load<AuditResult>("/audit", { project, diff: 1 }),
  ])
  const params = {
    days: days === 90 ? "90" : undefined,
    view: opportunities ? "chancen" : undefined,
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Suche & Audit"
        description={
          <ScopeLabel project={project} name={scope.name}>
            {DESCRIPTION}
          </ScopeLabel>
        }
      />
      {searchRes.error !== null ? (
        <SectionError
          title="Suchanfragen nicht geladen"
          error={searchRes.error}
        />
      ) : (
        <SearchQueries
          data={searchRes.data}
          project={project}
          opportunities={opportunities}
          toolbar={
            <>
              <UrlToggle
                param="view"
                value={opportunities ? "chancen" : "alle"}
                params={params}
                label="Auswahl"
                options={[
                  { value: "alle", label: "Alle" },
                  { value: "chancen", label: "Chancen" },
                ]}
              />
              <UrlToggle
                param="days"
                value={String(days)}
                params={params}
                label="Zeitraum"
                options={[
                  { value: "28", label: "28 Tage" },
                  { value: "90", label: "90 Tage" },
                ]}
              />
            </>
          }
        />
      )}
      {auditRes.error !== null ? (
        <SectionError title="Audit nicht geladen" error={auditRes.error} />
      ) : (
        <AuditPanel data={auditRes.data} project={project} />
      )}
    </div>
  )
}

/** Scope "Alle": one row per project, the link switches the scope. */
async function SearchAll({ projects }: { projects: Project[] }) {
  if (!projects.length)
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
  const results = await Promise.all(
    projects.map((p) =>
      Promise.all([
        load<SearchResult>("/search", { project: p.id, days: 28, limit: 1 }),
        load<AuditResult>("/audit", { project: p.id }),
      ])
    )
  )
  const now = requestTime()
  const rows = projects
    .map((p, i) => {
      const [search, audit] = results[i]
      return { project: p, search, audit }
    })
    // Projects with search data or an audit first, then by name.
    .sort(
      (a, b) =>
        Number(!!b.search.data?.total) - Number(!!a.search.data?.total) ||
        Number(!!b.audit.data?.run) - Number(!!a.audit.data?.run) ||
        a.project.name.localeCompare(b.project.name, "de")
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Projekte</CardTitle>
        <CardDescription>
          Suchanfragen braucht ein einzelnes Projekt. Projekt oben wählen oder
          hier anklicken.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Projekt</TableHead>
              <TableHead className="text-right">Suchanfragen 28 T.</TableHead>
              <TableHead className="text-right">Klicks</TableHead>
              <TableHead className="text-right">Impressionen</TableHead>
              <TableHead>Letzter Audit</TableHead>
              <TableHead className="text-right">Fehler</TableHead>
              <TableHead className="text-right">Warnungen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ project: p, search, audit }) => {
              const s = search.data
              const a = audit.data
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <ScopeLink
                      path="/search"
                      project={p.id}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </ScopeLink>
                  </TableCell>
                  {search.error !== null ? (
                    <TableCell
                      colSpan={3}
                      className="whitespace-normal text-(--status-bad)"
                    >
                      {search.error}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="text-right tabular-nums">
                        {s!.total ? fmtNum(s!.total) : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s!.total ? fmtNum(s!.totals.clicks) : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s!.total ? fmtNum(s!.totals.impressions) : "–"}
                      </TableCell>
                    </>
                  )}
                  {audit.error !== null ? (
                    <TableCell
                      colSpan={3}
                      className="whitespace-normal text-(--status-bad)"
                    >
                      {audit.error}
                    </TableCell>
                  ) : a!.run ? (
                    <>
                      <TableCell className="text-muted-foreground">
                        {fmtAgo(a!.run.at, now)} · {fmtNum(a!.run.pages)} Seiten
                        {a!.run.ok ? "" : " · fehlgeschlagen"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          a!.counts.error > 0 && TONE_TEXT.bad
                        )}
                      >
                        {fmtNum(a!.counts.error)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          a!.counts.warning > 0 && TONE_TEXT.warn
                        )}
                      >
                        {fmtNum(a!.counts.warning)}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={3} className="text-muted-foreground">
                      noch kein Lauf
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

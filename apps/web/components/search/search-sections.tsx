import { Cmd } from "@/components/strategies/cmd"
import type { ReactNode } from "react"
import {
  fmtDate,
  fmtDateTime,
  fmtNum,
  fmtPct,
} from "@/components/growth/format"
import { EmptyState, TONE_DOT, TONE_TEXT } from "@/components/growth/status"
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
import { cn } from "@/lib/utils"
import type { AuditIssue, AuditResult, SearchResult } from "./types"

export const SEVERITY_LABEL: Record<string, string> = {
  error: "Fehler",
  warning: "Warnung",
  info: "Hinweis",
}

const SEVERITY_TONE: Record<string, "bad" | "warn" | "neutral"> = {
  error: "bad",
  warning: "warn",
  info: "neutral",
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 }

const SOURCE_LABEL: Record<string, string> = { gsc: "Google", bing: "Bing" }

/** https://example.com/de/blog → example.com/de/blog; http stays visible. */
export function shortUrl(u: string) {
  return u.replace(/^https:\/\//, "")
}

function pathOf(u: string) {
  try {
    const url = new URL(u)
    return `${url.pathname}${url.search}` || "/"
  } catch {
    return u
  }
}

const SEVERITY_PLURAL: Record<string, string> = {
  error: "Fehler",
  warning: "Warnungen",
  info: "Hinweise",
}

export function SeverityToken({
  severity,
  plural = false,
}: {
  severity: string
  plural?: boolean
}) {
  const tone = SEVERITY_TONE[severity] ?? "neutral"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        TONE_TEXT[tone]
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])}
      />
      {(plural ? SEVERITY_PLURAL : SEVERITY_LABEL)[severity] ?? severity}
    </span>
  )
}

function sortIssues(issues: AuditIssue[]) {
  return [...issues].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
      a.code.localeCompare(b.code) ||
      a.url.localeCompare(b.url)
  )
}

/** Search queries (gsc/bing) aggregated per query and page. */
export function SearchQueries({
  data,
  project,
  opportunities,
  toolbar,
}: {
  data: SearchResult
  project: string
  opportunities: boolean
  toolbar: ReactNode
}) {
  const sources = new Set(data.rows.map((r) => r.source))
  const showSource = sources.size > 1
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Suchanfragen</CardTitle>
        <CardDescription className="tabular-nums">
          {fmtDate(data.window.from)} bis {fmtDate(data.window.to)}
          {opportunities ? " · Position 4 bis 20 mit Impressionen" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {toolbar}
        </div>
        {data.total === 0 ? (
          opportunities ? (
            <EmptyState
              title="Keine Chancen im Zeitraum"
              description="Chancen sind Suchanfragen auf Position 4 bis 20 mit Impressionen. Unter „Alle“ stehen die übrigen."
            />
          ) : (
            <EmptyState
              title="Keine Suchdaten im Zeitraum"
              description={
                <>
                  Suchanfragen liefern die Collectors gsc (Search Console) und
                  bing (Bing Webmaster). Einschalten im Projekt-Cockpit oder mit{" "}
                  <Cmd>
                    vibegrowth collectors set gsc --project {project} --enable
                  </Cmd>
                  .
                </>
              }
            />
          )
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3 sm:max-w-md">
              <Total
                label={opportunities ? "Chancen" : "Suchanfragen"}
                value={data.total}
              />
              <Total label="Klicks" value={data.totals.clicks} />
              <Total label="Impressionen" value={data.totals.impressions} />
            </dl>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Suchanfrage</TableHead>
                  <TableHead className="hidden md:table-cell">Seite</TableHead>
                  <TableHead className="text-right">Klicks</TableHead>
                  <TableHead className="text-right">
                    <Short short="Impr." full="Impressionen" />
                  </TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">
                    <Short short="Pos." full="Position" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={`${r.source}|${r.query}|${r.page}`}>
                    <TableCell className="max-w-[18rem] min-w-[8rem] break-words whitespace-normal">
                      {r.query}
                      {showSource ? (
                        <Badge
                          variant="outline"
                          className="ml-2 font-normal text-muted-foreground"
                        >
                          {SOURCE_LABEL[r.source] ?? r.source}
                        </Badge>
                      ) : null}
                      <span className="mt-0.5 block md:hidden">
                        <PageLink url={r.page} />
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-[16rem] min-w-[8rem] whitespace-normal md:table-cell">
                      <PageLink url={r.page} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(r.clicks)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(r.impressions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtPct(r.ctr)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.position === null
                        ? "–"
                        : r.position.toLocaleString("de-DE", {
                            maximumFractionDigits: 1,
                          })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.total > data.rows.length ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                Zeigt {fmtNum(data.rows.length)} von {fmtNum(data.total)}.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Short({ short, full }: { short: string; full: string }) {
  return (
    <>
      <abbr title={full} className="no-underline md:hidden">
        {short}
      </abbr>
      <span className="hidden md:inline">{full}</span>
    </>
  )
}

function PageLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className="text-xs break-all text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:text-sm"
    >
      {pathOf(url)}
    </a>
  )
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border p-2.5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{fmtNum(value)}</dd>
    </div>
  )
}

/** Latest audit run: counts, findings, change against the previous run. */
export function AuditPanel({
  data,
  project,
}: {
  data: AuditResult
  project: string
}) {
  const run = data.run
  if (!run)
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>SEO-Audit</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Noch kein Audit-Lauf"
            description={
              <>
                Den Audit startet der Collector audit oder{" "}
                <Cmd>vibegrowth audit run --project {project}</Cmd>.
              </>
            }
          />
        </CardContent>
      </Card>
    )
  const issues = sortIssues(data.issues)
  const added = data.diff?.new ?? null
  const fixed = data.diff?.fixed ?? []
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>SEO-Audit</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
          <span>Letzter Lauf {fmtDateTime(run.at)}</span>
          <span>· {fmtNum(run.pages)} Seiten</span>
          <span>·</span>
          <span
            className={cn(
              "font-medium",
              run.ok ? TONE_TEXT.good : TONE_TEXT.bad
            )}
          >
            {run.ok ? "ok" : "fehlgeschlagen"}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <dl className="grid grid-cols-3 gap-3 sm:max-w-md">
          {(["error", "warning", "info"] as const).map((sev) => (
            <div
              key={sev}
              className="flex min-w-0 flex-col gap-0.5 rounded-lg border p-2.5"
            >
              <dt className="truncate">
                <SeverityToken severity={sev} plural />
              </dt>
              <dd
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  sev !== "info" &&
                    data.counts[sev] > 0 &&
                    TONE_TEXT[SEVERITY_TONE[sev]]
                )}
              >
                {fmtNum(data.counts[sev])}
              </dd>
            </div>
          ))}
        </dl>

        <section
          aria-labelledby="audit-diff"
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 id="audit-diff" className="text-sm font-medium">
            Seit dem vorherigen Lauf
            {data.previous ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                vom {fmtDateTime(data.previous.at)}
              </span>
            ) : null}
          </h3>
          {added === null ? (
            <p className="text-sm text-muted-foreground">
              Erster Lauf, noch kein Vergleich.
            </p>
          ) : added.length === 0 && fixed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine neuen und keine behobenen Befunde.
            </p>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              <DiffList title="Neu" items={added} empty="Keine neuen Befunde" />
              <DiffList title="Behoben" items={fixed} empty="Nichts behoben" />
            </div>
          )}
        </section>

        <section
          aria-labelledby="audit-issues"
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 id="audit-issues" className="text-sm font-medium">
            Befunde
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {issues.length}
            </span>
          </h3>
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Der letzte Lauf hat nichts gefunden.
            </p>
          ) : (
            <div className="flex min-w-0 flex-col">
              <div
                aria-hidden="true"
                className="hidden gap-x-4 border-b pb-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[6rem_minmax(0,16rem)_minmax(0,11rem)_minmax(0,1fr)]"
              >
                <span>Schwere</span>
                <span>URL</span>
                <span>Code</span>
                <span>Detail</span>
              </div>
              <ul className="flex flex-col divide-y" aria-label="Befunde">
                {issues.map((i, n) => (
                  <li
                    key={`${i.url}|${i.code}|${n}`}
                    className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-0.5 py-2 text-sm md:grid-cols-[6rem_minmax(0,16rem)_minmax(0,11rem)_minmax(0,1fr)] md:items-baseline"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <SeverityToken severity={i.severity} />
                      <span className="font-mono text-xs md:hidden">
                        {i.code}
                      </span>
                    </span>
                    <span className="min-w-0 break-all">{shortUrl(i.url)}</span>
                    <span className="hidden min-w-0 font-mono text-xs break-all md:block">
                      {i.code}
                    </span>
                    <span className="min-w-0 break-words text-muted-foreground">
                      {i.detail ?? "–"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function DiffList({
  title,
  items,
  empty,
}: {
  title: string
  items: AuditIssue[]
  empty: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3">
      <span className="text-xs font-medium text-muted-foreground">
        {title}
        <span className="ml-1.5 tabular-nums">{items.length}</span>
      </span>
      {items.length === 0 ? (
        <span className="text-sm text-muted-foreground">{empty}</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sortIssues(items).map((i, n) => (
            <li
              key={`${i.url}|${i.code}|${n}`}
              className="flex min-w-0 flex-col gap-0.5 text-sm"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <SeverityToken severity={i.severity} />
                <span className="font-mono text-xs">{i.code}</span>
              </span>
              <span className="text-xs break-all text-muted-foreground">
                {shortUrl(i.url)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

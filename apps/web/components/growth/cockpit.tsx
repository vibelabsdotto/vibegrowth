import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { Level } from "@/components/growth/backlog-board"
import { CategoryLabel } from "@/components/growth/category"
import { CollectorPanel } from "@/components/growth/collector-panel"
import {
  actorLabel,
  APPROVAL_KIND_LABEL,
  BACKLOG_KIND_LABEL,
  CHANNEL_KIND_LABEL,
  EXPERIMENT_STATUS_LABEL,
  fmtDate,
  fmtDateTime,
  label,
  lowerIsBetter,
  METRIC_LABEL,
  PROJECT_KIND_LABEL,
} from "@/components/growth/format"
import { FunnelStrip } from "@/components/growth/funnel"
import { ScopeLink } from "@/components/growth/scope"
import { list, load, requestTime } from "@/components/growth/server"
import { Delta, SectionError, VerdictToken } from "@/components/growth/status"
import { UrlToggle } from "@/components/growth/url-filter"
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
import { categoryLabel } from "@/lib/categories"
import type {
  AccountLite,
  AppInbox,
  Approval,
  BacklogItem,
  Channel,
  CollectorState,
  Experiment,
  Funnel,
  KnowledgeItem,
  ProjectDetail,
  Strategy,
} from "@/lib/growth-types"

/**
 * Übersicht with a project chosen in the switcher (formerly /projects/<id>): funnel, open
 * approvals, experiments, tasks, strategies, app inbox, knowledge, data sources, channels.
 */
export async function Cockpit({
  id,
  days,
  daysParam,
}: {
  id: string
  days: 7 | 28
  /** raw ?days= for the period toggle */
  daysParam?: string
}) {
  const pid = encodeURIComponent(id)
  const [
    projectRes,
    funnelRes,
    collectorsRes,
    approvalsRes,
    experimentsRes,
    backlogRes,
    knowledgeRes,
    strategiesRes,
    inboxRes,
  ] = await Promise.all([
    load<ProjectDetail>(`/projects/${pid}`),
    load<Funnel>("/funnel", { project: id, days }),
    load<CollectorState[]>("/collectors", { project: id }),
    load<Approval[]>("/approvals", { project: id, status: "pending" }),
    load<Experiment[]>("/experiments", { project: id }),
    load<BacklogItem[]>("/backlog", { project: id, status: "open,doing" }),
    load<KnowledgeItem[]>("/knowledge", { project: id }),
    load<Strategy[]>("/strategies", { project: id, status: "active" }),
    load<AppInbox>("/app/inbox", { project: id, limit: 1 }),
  ])
  if (projectRes.error !== null) {
    return (
      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
        <SectionError title="Projekt nicht geladen" error={projectRes.error} />
      </div>
    )
  }
  const p = projectRes.data
  const now = requestTime()
  const accounts = list<AccountLite>(p.accounts)
  // Own knowledge only (brand, accounts, formats); global and growth live on their pages.
  const knowledge = list<KnowledgeItem>(knowledgeRes.data).filter(
    (k) => k.projectId === p.id
  )
  const learnings = knowledge.filter(
    (k) => k.type === "learning" && k.status !== "outdated"
  )
  const decisions = knowledge.filter((k) => k.type === "decision")
  const strategies = list<Strategy>(strategiesRes.data)
  const inbox = inboxRes.data?.counts
  const channels = list<Channel>(p.channels)
  const experiments = experimentsRes.data ?? []
  const running = experiments.filter((e) => e.status === "running")
  const recent = experiments.filter((e) => e.status !== "running").slice(0, 3)
  const backlog = [...(backlogRes.data ?? [])]
    .sort(
      (a, b) =>
        (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) ||
        b.impact - a.impact ||
        a.effort - b.effort
    )
    .slice(0, 6)
  const approvals = approvalsRes.data ?? []
  const funnel = funnelRes.data

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Übersicht · {label(PROJECT_KIND_LABEL, p.kind)}</span>
            {p.status !== "active" ? (
              <Badge variant="outline">
                {p.status === "paused" ? "pausiert" : "archiviert"}
              </Badge>
            ) : null}
            {p.url ? (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                {p.url.replace(/^https?:\/\//, "")}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : null}
            <ScopeLink
              path="/"
              project=""
              className="underline underline-offset-4"
            >
              Alle Projekte
            </ScopeLink>
          </span>
        }
        actions={
          <UrlToggle
            param="days"
            value={String(days)}
            params={{ days: daysParam }}
            label="Zeitraum"
            options={[
              { value: "7", label: "7 Tage" },
              { value: "28", label: "28 Tage" },
            ]}
          />
        }
      />

      <section aria-labelledby="funnel-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="funnel-title" className="text-base font-semibold">
            Funnel
          </h2>
          {funnel ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {fmtDate(funnel.window.from)} bis {fmtDate(funnel.window.to)} ·
              Vergleich {fmtDate(funnel.prevWindow.from)} bis{" "}
              {fmtDate(funnel.prevWindow.to)}
            </span>
          ) : null}
        </div>
        {funnelRes.error !== null ? (
          <SectionError title="Funnel nicht geladen" error={funnelRes.error} />
        ) : (
          <FunnelStrip
            stages={funnel!.stages}
            weakest={funnel!.weakest}
            prevLabel={days === 7 ? "Vorwoche" : "davor"}
            windowTo={funnel!.window.to}
          />
        )}
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Wartet auf Max</CardTitle>
              <CardDescription>
                {approvals.length
                  ? `${approvals.length} offen`
                  : "Nichts offen"}
              </CardDescription>
              {approvals.length ? (
                <CardAction>
                  <Link
                    href="/approvals"
                    prefetch={false}
                    className="text-sm underline underline-offset-4"
                  >
                    Entscheiden
                  </Link>
                </CardAction>
              ) : null}
            </CardHeader>
            {approvalsRes.error !== null ? (
              <CardContent>
                <SectionError error={approvalsRes.error} />
              </CardContent>
            ) : approvals.length ? (
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {approvals.slice(0, 5).map((a) => (
                    <li
                      key={a.id}
                      className="flex min-w-0 items-baseline gap-2 text-sm"
                    >
                      <Badge variant="secondary">
                        {label(APPROVAL_KIND_LABEL, a.kind)}
                      </Badge>
                      <span className="min-w-0 truncate">{a.title}</span>
                      <CategoryLabel category={a.category} />
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {fmtDateTime(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Experimente</CardTitle>
              <CardDescription>
                {running.length} laufen
                {recent.length ? `, ${recent.length} zuletzt ausgewertet` : ""}
              </CardDescription>
              <CardAction>
                <Link
                  href="/experiments"
                  prefetch={false}
                  className="text-sm underline underline-offset-4"
                >
                  Log
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {experimentsRes.error !== null ? (
                <SectionError error={experimentsRes.error} />
              ) : running.length + recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Keine Experimente.
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {[...running, ...recent].map((e) => (
                    <li
                      key={e.id}
                      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0"
                    >
                      <Link
                        href={`/experiments/${e.id}`}
                        prefetch={false}
                        className="min-w-0 basis-full truncate font-medium underline-offset-4 hover:underline sm:flex-1 sm:basis-0"
                      >
                        {e.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {label(METRIC_LABEL, e.metric)} · seit{" "}
                        {fmtDate(e.startDate)}
                      </span>
                      {e.result ? (
                        <Delta
                          value={e.result.change}
                          invert={lowerIsBetter(e.metric)}
                        />
                      ) : (
                        <Badge variant="secondary">
                          {label(EXPERIMENT_STATUS_LABEL, e.status)}
                        </Badge>
                      )}
                      <VerdictToken verdict={e.verdict} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Aufgaben</CardTitle>
              <CardDescription>
                In Arbeit und offen, höchster Impact zuerst
              </CardDescription>
              <CardAction>
                <Link
                  href="/tasks"
                  prefetch={false}
                  className="text-sm underline underline-offset-4"
                >
                  Alle
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {backlogRes.error !== null ? (
                <SectionError error={backlogRes.error} />
              ) : backlog.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Keine offenen Aufgaben.
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {backlog.map((b) => (
                    <li
                      key={b.id}
                      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0 basis-full truncate sm:flex-1 sm:basis-0">
                        {b.title}
                      </span>
                      {b.status === "doing" ? (
                        <Badge variant="secondary">in Arbeit</Badge>
                      ) : null}
                      <span className="flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground">
                          {categoryLabel(b.category)} ·{" "}
                          {label(BACKLOG_KIND_LABEL, b.kind)}
                        </span>
                        <Level name="Impact" value={b.impact} />
                        <Level name="Aufwand" value={b.effort} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Learnings und Entscheidungen</CardTitle>
              <CardDescription>
                Projekt, seine Accounts und Formate
              </CardDescription>
              <CardAction>
                <Link
                  href="/learnings"
                  prefetch={false}
                  className="text-sm underline underline-offset-4"
                >
                  Alle
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {learnings.length + decisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Noch nichts festgehalten.
                </p>
              ) : null}
              {learnings.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {learnings.slice(0, 6).map((l) => (
                    <li key={`l${l.id}`} className="flex flex-col">
                      <span>{l.statement}</span>
                      <span className="text-xs text-muted-foreground">
                        Learning · {categoryLabel(l.category)} ·{" "}
                        {fmtDate(l.date)} · {actorLabel(l.actor)}
                        {l.scopeType === "account" ? ` · @${l.scopeId}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {decisions.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {decisions.slice(0, 6).map((d) => (
                    <li key={`d${d.id}`} className="flex flex-col">
                      <span className="font-medium">{d.title}</span>
                      <span className="line-clamp-2 text-muted-foreground">
                        {d.rationale}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {d.kind === "pivot" ? "Pivot" : "Entscheidung"} ·{" "}
                        {categoryLabel(d.category)} · {fmtDate(d.date)} ·{" "}
                        {actorLabel(d.actor)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {inbox && inbox.featureRequests.total + inbox.reviews.total > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>App-Inbox</CardTitle>
                <CardDescription>
                  Feature Requests und Bewertungen mit Antwortstatus
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
                  <dt>
                    <Link
                      href="/feature-requests"
                      prefetch={false}
                      className="underline-offset-4 hover:underline"
                    >
                      Feature Requests
                    </Link>
                  </dt>
                  <dd className="text-right tabular-nums">
                    {inbox.featureRequests.needsReply ? (
                      <span className="font-medium text-(--status-warn)">
                        {inbox.featureRequests.needsReply} brauchen Antwort
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {inbox.featureRequests.total} gesamt
                      </span>
                    )}
                  </dd>
                  <dt>
                    <Link
                      href="/reviews"
                      prefetch={false}
                      className="underline-offset-4 hover:underline"
                    >
                      Bewertungen
                    </Link>
                  </dt>
                  <dd className="text-right tabular-nums">
                    {inbox.reviews.needsReply ? (
                      <span className="font-medium text-(--status-warn)">
                        {inbox.reviews.needsReply} brauchen Antwort
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {inbox.reviews.total} mit Text
                      </span>
                    )}
                  </dd>
                </dl>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Strategien</CardTitle>
              <CardDescription>
                {strategies.length
                  ? `${strategies.length} aktiv`
                  : "Keine aktiven Strategien"}
              </CardDescription>
              <CardAction>
                <Link
                  href="/strategies"
                  prefetch={false}
                  className="text-sm underline underline-offset-4"
                >
                  Alle
                </Link>
              </CardAction>
            </CardHeader>
            {strategiesRes.error !== null ? (
              <CardContent>
                <SectionError error={strategiesRes.error} />
              </CardContent>
            ) : strategies.length ? (
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {strategies.slice(0, 8).map((s) => (
                    <li
                      key={`${s.kind}-${s.id}`}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <Link
                        href={
                          s.kind === "format"
                            ? `/formats/${encodeURIComponent(s.id)}`
                            : `/strategies/${encodeURIComponent(s.id)}`
                        }
                        prefetch={false}
                        className="min-w-0 truncate underline-offset-4 hover:underline"
                      >
                        {s.name}
                      </Link>
                      {!s.projectId ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          alle Projekte
                        </span>
                      ) : null}
                      <CategoryLabel
                        category={s.category}
                        className="ml-auto font-normal text-muted-foreground"
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Datenquellen</CardTitle>
              <CardDescription>
                Schalter, Konfiguration und Abruf je Collector
              </CardDescription>
            </CardHeader>
            <CardContent>
              {collectorsRes.error !== null ? (
                <SectionError error={collectorsRes.error} />
              ) : (
                <CollectorPanel
                  project={p.id}
                  collectors={collectorsRes.data}
                  now={now}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kanäle</CardTitle>
            </CardHeader>
            <CardContent>
              {channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Keine Kanäle eingetragen.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {channels.map((c) => (
                    <li key={c.id} className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline">
                        {label(CHANNEL_KIND_LABEL, c.kind)}
                      </Badge>
                      <span className="min-w-0 truncate">
                        {c.name ?? c.handle ?? c.id}
                      </span>
                      {c.status && c.status !== "active" ? (
                        <span className="text-xs text-muted-foreground">
                          {c.status === "planned" ? "geplant" : "pausiert"}
                        </span>
                      ) : null}
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={`${c.name ?? c.id} öffnen`}
                        >
                          <ExternalLink
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shorts-Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Keine Shorts-Accounts.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {accounts.map((a) => (
                    <li key={a.id} className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/accounts/${encodeURIComponent(a.id)}`}
                        prefetch={false}
                        className="min-w-0 truncate underline-offset-4 hover:underline"
                      >
                        {a.name}
                      </Link>
                      {a.handle ? (
                        <span className="truncate text-xs text-muted-foreground">
                          @{a.handle}
                        </span>
                      ) : null}
                      {a.status && a.status !== "active" ? (
                        <Badge variant="outline" className="ml-auto">
                          {a.status === "paused" ? "pausiert" : a.status}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

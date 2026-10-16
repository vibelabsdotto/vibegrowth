import { Cmd } from "@/components/strategies/cmd"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { actorLabel, fmtDateTime } from "@/components/growth/format"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { SectionError } from "@/components/growth/status"
import { CategoryLabel } from "@/components/growth/category"
import { Markdown } from "@/components/markdown"
import { PageHeader } from "@/components/page-header"
import {
  EditStrategy,
  StrategyStatusToggle,
} from "@/components/strategies/strategy-forms"
import { SkillBadges } from "@/components/strategies/strategy-list"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Strategy } from "@/lib/growth-types"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const res = await load<Strategy>(`/strategies/${encodeURIComponent(id)}`)
  return { title: res.data?.name ?? "Strategie" }
}

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [res, scope] = await Promise.all([
    load<Strategy>(`/strategies/${encodeURIComponent(id)}`),
    projectScope(),
  ])
  if (res.error !== null) {
    if (/NOT_FOUND/.test(res.error)) notFound()
    return (
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
        <BackLink />
        <SectionError title="Strategie nicht geladen" error={res.error} />
      </div>
    )
  }
  const s = res.data
  if (s.kind === "format")
    redirect(s.url ?? `/formats/${encodeURIComponent(s.id)}`)

  const all = scope.projectsRes.data ?? []
  const projectName = s.projectId
    ? (all.find((p) => p.id === s.projectId)?.name ?? s.projectId)
    : null
  const options = scope.projects.map((p) => ({ value: p.id, label: p.name }))
  // A strategy of an archived project keeps its project in the edit form.
  if (s.projectId && !options.some((o) => o.value === s.projectId))
    options.push({ value: s.projectId, label: projectName ?? s.projectId })

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <BackLink />
      <PageHeader
        title={s.name}
        description={
          <ScopeLabel project={scope.project} name={scope.name}>
            {s.summary ?? "Ohne Kurzbeschreibung"}
          </ScopeLabel>
        }
        actions={<EditStrategy strategy={s} projects={options} />}
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Leitfaden</CardTitle>
            {!s.guide ? (
              <CardDescription>
                Noch kein Leitfaden. Über „Bearbeiten“ oder mit{" "}
                <Cmd>vibegrowth strategies update {s.id} --guide …</Cmd>{" "}
                ergänzen.
              </CardDescription>
            ) : null}
          </CardHeader>
          {s.guide ? (
            <CardContent>
              <Markdown>{s.guide}</Markdown>
            </CardContent>
          ) : null}
        </Card>

        <div className="order-first flex min-w-0 flex-col gap-4 lg:order-none">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Wird sofort gespeichert.</CardDescription>
            </CardHeader>
            <CardContent>
              <StrategyStatusToggle id={s.id} status={s.status} />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Bereich</dt>
                <dd>
                  <CategoryLabel category={s.category} />
                </dd>
                <dt className="text-muted-foreground">Projekt</dt>
                <dd className="min-w-0 break-words">
                  {s.projectId ? (
                    // Plain anchor: the cockpit switches the project scope, the sidebar must re-render.
                    <a
                      href={`/projects/${encodeURIComponent(s.projectId)}`}
                      className="underline underline-offset-4"
                    >
                      {projectName}
                    </a>
                  ) : (
                    "alle Projekte"
                  )}
                </dd>
                <dt className="text-muted-foreground">Skills</dt>
                <dd className="min-w-0">
                  {s.skills.length ? (
                    <SkillBadges skills={s.skills} />
                  ) : (
                    <span className="text-muted-foreground">keine</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Quelle</dt>
                <dd className="min-w-0 break-words">
                  {s.source ? <SourceText source={s.source} /> : "–"}
                </dd>
                <dt className="text-muted-foreground">Akteur</dt>
                <dd>{actorLabel(s.actor)}</dd>
                <dt className="text-muted-foreground">Angelegt</dt>
                <dd className="tabular-nums">{fmtDateTime(s.createdAt)}</dd>
                <dt className="text-muted-foreground">Geändert</dt>
                <dd className="tabular-nums">{fmtDateTime(s.updatedAt)}</dd>
                <dt className="text-muted-foreground">ID</dt>
                <dd className="min-w-0 font-mono text-xs break-all">{s.id}</dd>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SourceText({ source }: { source: string }) {
  if (/^https?:\/\//.test(source))
    return (
      <a
        href={source}
        target="_blank"
        rel="noreferrer"
        className="break-all underline underline-offset-4"
      >
        {source.replace(/^https?:\/\//, "")}
      </a>
    )
  return <>{source}</>
}

function BackLink() {
  return (
    <Link
      href="/strategies"
      prefetch={false}
      className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      Alle Strategien
    </Link>
  )
}

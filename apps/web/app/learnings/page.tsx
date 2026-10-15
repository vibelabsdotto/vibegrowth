import { Suspense } from "react"
import { LearningStatusButton, NewLearning } from "@/components/knowledge-forms"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { UrlSelect } from "@/components/url-select"
import { actorLabel, fmtDate } from "@/lib/labels"
import { ScopedDescription } from "@/components/scope-badge"
import { apiFetch } from "@/lib/api"
import {
  isCrossProject,
  knowledgeInScope,
  projectScope,
  scopeLabeler,
} from "@/lib/server"
import type { AccountRow, FormatRow, LearningRow } from "@/lib/types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Learnings" }

export default async function LearningsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; status?: string }>
}) {
  const sp = await searchParams
  const [all, { projects: brands, project }, formats] = await Promise.all([
    apiFetch<AccountRow[]>("/accounts"),
    projectScope(),
    apiFetch<FormatRow[]>("/formats"),
  ])
  const accounts = all.filter((a) => !project || a.brandId === project.id)
  const account = accounts.some((a) => a.id === sp.account) ? sp.account : ""
  const scopeName = scopeLabeler(all, brands, formats, !project)
  const status =
    sp.status === "all"
      ? undefined
      : sp.status === "outdated"
        ? "outdated"
        : "active"
  // GET /learnings knows active or all; "outdated" is filtered here. The project from the
  // switcher keeps its own scopes plus global and growth (see knowledgeInScope).
  const items = knowledgeInScope(
    (
      await apiFetch<LearningRow[]>("/learnings", {
        query: { account: account || undefined, all: status !== "active" },
      })
    ).filter((l) => !status || l.status === status),
    project,
    all,
    formats
  )
  const accOpts = accounts.map((a) => ({ value: a.id, label: a.name }))
  const groups = project
    ? [
        {
          title: `Für ${project.name}`,
          items: items.filter((l) => !isCrossProject(l)),
          empty: `Keine eigenen Learnings für ${project.name}.`,
        },
        {
          title: "Für alle Projekte",
          items: items.filter(isCrossProject),
          empty: "Keine projektübergreifenden Learnings.",
        },
      ]
    : [{ title: "", items, empty: "" }]

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Learnings"
        description={
          <ScopedDescription project={project}>
            Was die Zahlen gezeigt haben, jeweils mit Beleg, Datum und Akteur.
            {project
              ? " Dazu die Learnings, die für alle Projekte gelten."
              : ""}
          </ScopedDescription>
        }
        actions={
          <>
            <Suspense>
              {accounts.length ? (
                <UrlSelect
                  param="account"
                  label="Account"
                  allLabel="Alle Accounts"
                  value={account ?? ""}
                  options={accOpts}
                />
              ) : null}
              <UrlSelect
                param="status"
                label="Status"
                allLabel="Aktiv"
                value={sp.status ?? ""}
                options={[
                  { value: "outdated", label: "Überholt" },
                  { value: "all", label: "Alle" },
                ]}
              />
            </Suspense>
            <NewLearning
              accounts={accOpts}
              brands={(project ? [project] : brands).map((b) => ({
                value: b.id,
                label: b.name,
              }))}
              account={account || undefined}
              brand={project?.id}
            />
          </>
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Keine Learnings</EmptyTitle>
            <EmptyDescription>
              Agents tragen sie per „vibegrowth learning add“ mit Beleg ein.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section
              key={g.title || "all"}
              className="flex flex-col gap-3"
              aria-label={g.title || undefined}
            >
              {g.title ? (
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {g.title}{" "}
                  <span className="font-normal">({g.items.length})</span>
                </h2>
              ) : null}
              {g.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{g.empty}</p>
              ) : null}
              {g.items.map((l) => (
                <Card key={l.id} size="sm">
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 font-medium">
                        {l.statement}
                      </p>
                      <LearningStatusButton id={l.id} status={l.status} />
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {l.evidence}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">
                        {scopeName(l.scopeType, l.scopeId)}
                      </Badge>
                      {l.status !== "active" ? (
                        <Badge variant="secondary">überholt</Badge>
                      ) : null}
                      {fmtDate(l.date)} · {actorLabel(l.actor)}
                      {l.source ? ` · ${l.source}` : ""}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

import { NewDecision } from "@/components/knowledge-forms"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { actorLabel, fmtDate } from "@/lib/labels"
import { ScopedDescription } from "@/components/scope-badge"
import { apiFetch } from "@/lib/api"
import {
  isCrossProject,
  knowledgeInScope,
  projectScope,
  scopeLabeler,
} from "@/lib/server"
import type { AccountRow, DecisionRow, FormatRow } from "@/lib/types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Entscheidungen" }

export default async function DecisionsPage() {
  const [all, { projects: brands, project }, formats, every] =
    await Promise.all([
      apiFetch<AccountRow[]>("/accounts"),
      projectScope(),
      apiFetch<FormatRow[]>("/formats"),
      apiFetch<DecisionRow[]>("/decisions"),
    ])
  // Project from the switcher: its own scopes plus global and growth (see knowledgeInScope).
  const items = knowledgeInScope(every, project, all, formats)
  const accounts = all.filter((a) => !project || a.brandId === project.id)
  const byId = new Map(every.map((d) => [d.id, d]))
  const scopeName = scopeLabeler(all, brands, formats, !project)

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Entscheidungen"
        description={
          <ScopedDescription project={project}>
            Zeitleiste der Entscheidungen und Pivots, jeweils mit Begründung.
            {project
              ? " Dazu die Entscheidungen, die für alle Projekte gelten."
              : ""}
          </ScopedDescription>
        }
        actions={
          <NewDecision
            accounts={accounts.map((a) => ({ value: a.id, label: a.name }))}
            brands={(project ? [project] : brands).map((b) => ({
              value: b.id,
              label: b.name,
            }))}
            brand={project?.id}
          />
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Noch keine Entscheidungen</EmptyTitle>
            <EmptyDescription>
              Pivots kommen per „vibegrowth decision add --pivot“ oder hier über
              „Entscheidung“.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="relative flex flex-col gap-6 border-l pl-6">
          {items.map((d) => (
            <li key={d.id} className="relative flex flex-col gap-1.5">
              <span
                className={`absolute top-1.5 -left-[1.95rem] size-3 rounded-full border-2 border-background ${d.kind === "pivot" ? "bg-foreground" : "bg-muted-foreground"}`}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {fmtDate(d.date)}
                </span>
                {d.kind === "pivot" ? <Badge>Pivot</Badge> : null}
                <Badge variant={isCrossProject(d) ? "outline" : "secondary"}>
                  {scopeName(d.scopeType, d.scopeId)}
                </Badge>
                {actorLabel(d.actor)}
              </div>
              <h3 className="font-semibold">{d.title}</h3>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {d.rationale}
              </p>
              {d.supersedesId ? (
                <p className="text-xs text-muted-foreground">
                  Ersetzt:{" "}
                  {byId.get(d.supersedesId)?.title ?? `#${d.supersedesId}`}
                </p>
              ) : null}
              {d.source ? (
                <p className="text-xs text-muted-foreground">
                  Quelle: {d.source}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

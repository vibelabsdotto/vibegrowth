import { CategoryLabel, CategoryTabs } from "@/components/growth/category"
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
import { parseCategory, type Category } from "@/lib/categories"
import type { KnowledgeItem } from "@/lib/growth-types"
import { projectScope } from "@/lib/server"
import type { AccountRow } from "@/lib/types"
import { cn } from "@/lib/utils"
import { NewProjectDecision } from "./new-decision"

export const dynamic = "force-dynamic"
export const metadata = { title: "Entscheidungen" }

type Group = {
  key: string
  title: string
  hint?: string
  items: KnowledgeItem[]
}

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const sp = await searchParams
  const category = parseCategory(sp.category)
  const [all, scope] = await Promise.all([
    apiFetch<AccountRow[]>("/accounts"),
    projectScope(),
  ])
  const { projects, project } = scope
  // GET /knowledge?type=decision only returns decisions of a project (brand, growth with the
  // project as scope_id, or one of its accounts), never global ones (contract §7.9).
  const [rows, every] = await Promise.all([
    apiFetch<KnowledgeItem[]>("/knowledge", {
      query: {
        type: "decision",
        project: project?.id,
        category: category || undefined,
      },
    }),
    // all decisions, to name the one a decision supersedes
    apiFetch<KnowledgeItem[]>("/knowledge", { query: { type: "decision" } }),
  ])
  const items = rows.filter((d) => d.projectId)
  const byId = new Map(every.map((d) => [d.id, d]))
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? id ?? "–"
  const accountName = (id: string | null | undefined) =>
    all.find((a) => a.id === id)?.name ?? id ?? "–"

  const groups: Group[] = project
    ? groupByAccount(items, accountName)
    : groupByProject(items, projectName)

  const active = projects.filter((p) => p.status !== "archived")
  const targets = (project ? [project] : active).flatMap((p) => [
    {
      value: `brand:${p.id}`,
      label: project ? `${p.name} (projekt-weit)` : `${p.name}, projekt-weit`,
    },
    ...all
      .filter((a) => a.brandId === p.id)
      .map((a) => ({
        value: `account:${a.id}`,
        label: project ? `Account ${a.name}` : `${p.name}, Account ${a.name}`,
      })),
  ])

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Entscheidungen"
        description={
          <ScopedDescription project={project}>
            Entscheidungen und Pivots je Projekt und Account, jeweils mit
            Begründung.
          </ScopedDescription>
        }
        actions={
          <NewProjectDecision
            targets={targets}
            initialTarget={project ? `brand:${project.id}` : undefined}
          />
        }
      />
      <CategoryTabs value={category} />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {category
                ? "Keine Entscheidungen in diesem Bereich"
                : "Noch keine Entscheidungen"}
            </EmptyTitle>
            <EmptyDescription>
              Agents halten sie per „vibegrowth decision add“ mit Projekt oder
              Account fest, du hier über „Entscheidung“.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section
              key={g.key}
              aria-labelledby={`decisions-${g.key}`}
              className="flex min-w-0 flex-col gap-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2
                  id={`decisions-${g.key}`}
                  className="text-base font-semibold"
                >
                  {g.title}
                </h2>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {g.items.length}
                </span>
                {g.hint ? (
                  <span className="text-sm text-muted-foreground">
                    {g.hint}
                  </span>
                ) : null}
              </div>
              <Timeline
                items={g.items}
                category={category}
                scopeOf={
                  project
                    ? undefined
                    : (d) =>
                        d.accountId
                          ? `Account ${accountName(d.accountId)}`
                          : "Projekt-weit"
                }
                supersededTitle={(id) => byId.get(id)?.title ?? `#${id}`}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** Gewähltes Projekt: "Projekt-weit" first, then one group per account. */
function groupByAccount(
  items: KnowledgeItem[],
  accountName: (id: string | null | undefined) => string
): Group[] {
  const wide = items.filter((d) => !d.accountId)
  const byAccount = new Map<string, KnowledgeItem[]>()
  for (const d of items)
    if (d.accountId)
      byAccount.set(d.accountId, [...(byAccount.get(d.accountId) ?? []), d])
  const groups: Group[] = []
  if (wide.length)
    groups.push({
      key: "project",
      title: "Projekt-weit",
      hint: "gilt für alle Accounts und Kanäle",
      items: wide,
    })
  for (const [id, list] of [...byAccount].sort((a, b) =>
    accountName(a[0]).localeCompare(accountName(b[0]))
  ))
    groups.push({
      key: `account-${id}`,
      title: `Account ${accountName(id)}`,
      items: list,
    })
  return groups
}

/** Alle Projekte: one group per project, sorted by name. */
function groupByProject(
  items: KnowledgeItem[],
  projectName: (id: string | null) => string
): Group[] {
  const byProject = new Map<string, KnowledgeItem[]>()
  for (const d of items)
    byProject.set(d.projectId!, [...(byProject.get(d.projectId!) ?? []), d])
  return [...byProject]
    .sort((a, b) => projectName(a[0]).localeCompare(projectName(b[0])))
    .map(([id, list]) => ({
      key: `project-${id}`,
      title: projectName(id),
      items: list,
    }))
}

function Timeline({
  items,
  category,
  scopeOf,
  supersededTitle,
}: {
  items: KnowledgeItem[]
  category: Category | ""
  /** Scope badge per row (view "Alle Projekte"); groups already name it otherwise. */
  scopeOf?: (d: KnowledgeItem) => string
  supersededTitle: (id: number) => string
}) {
  return (
    <ol className="relative flex flex-col gap-6 border-l pl-6">
      {items.map((d) => (
        <li key={d.id} className="relative flex min-w-0 flex-col gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1.5 -left-[1.95rem] size-3 rounded-full border-2 border-background",
              d.kind === "pivot" ? "bg-foreground" : "bg-muted-foreground"
            )}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {fmtDate(d.date)}
            </span>
            {d.kind === "pivot" ? <Badge>Pivot</Badge> : null}
            {scopeOf ? <Badge variant="secondary">{scopeOf(d)}</Badge> : null}
            {!category ? <CategoryLabel category={d.category} /> : null}
            {actorLabel(d.actor)}
          </div>
          <h3 className="font-semibold break-words">{d.title}</h3>
          <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
            {d.rationale}
          </p>
          {d.supersedesId ? (
            <p className="text-xs text-muted-foreground">
              Ersetzt: {supersededTitle(d.supersedesId)}
            </p>
          ) : null}
          {d.source ? (
            <p className="text-xs break-words text-muted-foreground">
              Quelle: {d.source}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

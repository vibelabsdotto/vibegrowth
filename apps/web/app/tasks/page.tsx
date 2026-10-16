import { BacklogBoard } from "@/components/growth/backlog-board"
import { CategoryTabs } from "@/components/growth/category"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { SectionError } from "@/components/growth/status"
import { PageHeader } from "@/components/page-header"
import { parseCategory } from "@/lib/categories"
import type { BacklogItem } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Aufgaben" }

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const sp = await searchParams
  const category = parseCategory(sp.category)
  const scope = await projectScope()
  const { project, projects } = scope
  const res = await load<BacklogItem[]>("/backlog", {
    project: project || undefined,
    category: category || undefined,
  })

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Aufgaben"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Aus Audit, Suche, App-Inbox und von Agents, nach Impact und Aufwand.
          </ScopeLabel>
        }
      />
      <CategoryTabs value={category} />
      {res.error !== null ? (
        <SectionError title="Aufgaben nicht geladen" error={res.error} />
      ) : (
        <BacklogBoard
          items={res.data}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          project={project}
          category={category}
        />
      )}
    </div>
  )
}

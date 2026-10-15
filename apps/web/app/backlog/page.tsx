import { BacklogBoard } from "@/components/growth/backlog-board"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { SectionError } from "@/components/growth/status"
import { PageHeader } from "@/components/page-header"
import type { BacklogItem } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Backlog" }

export default async function BacklogPage() {
  const scope = await projectScope()
  const { project, projects } = scope
  const res = await load<BacklogItem[]>("/backlog", {
    project: project || undefined,
  })

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Backlog"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Aufgaben aus Audit, Suche und Agents, nach Impact und Aufwand.
          </ScopeLabel>
        }
      />
      {res.error !== null ? (
        <SectionError title="Backlog nicht geladen" error={res.error} />
      ) : (
        <BacklogBoard
          items={res.data}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          project={project}
        />
      )}
    </div>
  )
}

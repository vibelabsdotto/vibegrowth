import { BacklogBoard } from "@/components/growth/backlog-board"
import { load } from "@/components/growth/server"
import { SectionError } from "@/components/growth/status"
import { UrlFilter } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import type { BacklogItem, Project } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Backlog" }

export default async function BacklogPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const sp = await searchParams
  const project = sp.project ?? ""
  const [res, projectsRes] = await Promise.all([
    load<BacklogItem[]>("/backlog", { project: project || undefined }),
    load<Project[]>("/projects"),
  ])
  const projects = (projectsRes.data ?? []).filter(
    (p) => p.status !== "archived"
  )

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Backlog"
        description="Aufgaben aus Audit, Suche und Agents, nach Impact und Aufwand."
        actions={
          <UrlFilter
            param="project"
            value={project}
            params={{ project: sp.project }}
            label="Projekt"
            allLabel="Alle Projekte"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
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

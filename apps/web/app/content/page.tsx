import { ContentBoard } from "@/components/growth/content-board"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { SectionError } from "@/components/growth/status"
import { PageHeader } from "@/components/page-header"
import type { ContentItem } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Content" }

export default async function ContentPage() {
  const scope = await projectScope()
  const { project, projects } = scope
  const res = await load<ContentItem[]>("/content", {
    project: project || undefined,
  })

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Content"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Blogartikel, Landingpages und Store-Texte von der Idee bis live.
          </ScopeLabel>
        }
      />
      {res.error !== null ? (
        <SectionError title="Content nicht geladen" error={res.error} />
      ) : (
        <ContentBoard
          items={res.data}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          project={project}
        />
      )}
    </div>
  )
}

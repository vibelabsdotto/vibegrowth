import type { ComponentProps, ReactNode } from "react"
import { FolderKanban, Layers3 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

/**
 * Names the project scope a page shows (switcher at the top of the sidebar), so filtered
 * data is never mistaken for the full picture. Goes first in the PageHeader description.
 */
export function ScopeLabel({
  project,
  name,
  children,
}: {
  /** "" = alle Projekte */
  project: string
  name: string
  children?: ReactNode
}) {
  const Icon = project ? FolderKanban : Layers3
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant={project ? "secondary" : "outline"}>
        <Icon aria-hidden="true" />
        <span className="sr-only">Projekt: </span>
        {name}
      </Badge>
      {children ? <span>{children}</span> : null}
    </span>
  )
}

/**
 * Link that switches the project scope and opens `path` (proxy.ts stores ?project= in the
 * cookie and redirects to the URL without it; "" = alle Projekte). A plain anchor on purpose:
 * a client-side <Link> whose redirect lands on the page already shown keeps the old render.
 */
export function ScopeLink({
  path,
  project,
  ...props
}: { path: string; project: string } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      href={`${path}?project=${project ? encodeURIComponent(project) : "all"}`}
      {...props}
    />
  )
}

/** Links that switch the scope to one project each. */
export function ProjectLinks({
  path,
  projects,
}: {
  path: string
  projects: { id: string; name: string }[]
}) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {projects.map((p) => (
        <ScopeLink
          key={p.id}
          path={path}
          project={p.id}
          className="font-medium text-foreground underline underline-offset-4"
        >
          {p.name}
        </ScopeLink>
      ))}
    </span>
  )
}

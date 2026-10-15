import { FolderKanban, Layers3 } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"

type Project = { id: string; name: string } | null

/**
 * What the page is filtered to: the project from the sidebar switcher or "Alle Projekte".
 * Same look as ScopeLabel on the growth pages.
 */
export function ScopeBadge({ project }: { project: Project }) {
  const Icon = project ? FolderKanban : Layers3
  return (
    <Badge variant={project ? "secondary" : "outline"}>
      <Icon aria-hidden="true" />
      <span className="sr-only">Projekt: </span>
      {project ? project.name : "Alle Projekte"}
    </Badge>
  )
}

/** Page description with the scope badge in front. */
export function ScopedDescription({
  project,
  children,
}: {
  project: Project
  children: ReactNode
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <ScopeBadge project={project} />
      <span>{children}</span>
    </span>
  )
}

/** Empty state for a project without shortform accounts (e.g. a website-only project). */
export function NoAccounts({
  project,
  what,
  link = true,
}: {
  project: { name: string }
  /** What is missing because of that, e.g. "keine Posts". */
  what?: string
  /** Link to /accounts (off on the accounts page itself). */
  link?: boolean
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{project.name} hat keine Shortform-Accounts</EmptyTitle>
        <EmptyDescription>
          {what ? `Deshalb ${what}. ` : ""}Wähl oben in der Navigation ein
          anderes Projekt oder leg einen Account an.
        </EmptyDescription>
      </EmptyHeader>
      {link ? (
        <EmptyContent>
          <Link
            href="/accounts"
            prefetch={false}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Zu den Accounts
          </Link>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

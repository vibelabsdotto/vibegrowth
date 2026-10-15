"use client"

import { usePathname, useRouter } from "next/navigation"
import { useTransition } from "react"
import { ChevronsUpDown, Layers3, TrendingUp } from "lucide-react"
import { selectProject } from "@/app/scope-actions"
import type { SidebarProject } from "@/components/app-sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar"

const ALL = "__all__"

/** Workspace switcher at the top of the sidebar: scopes every project-aware page. */
export function ProjectSwitcher({
  projects,
  selected,
}: {
  projects: SidebarProject[]
  selected: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { isMobile, state } = useSidebar()
  const [pending, start] = useTransition()
  // On a cockpit page the URL names the project; show that one.
  const cockpit = pathname.match(/^\/projects\/([^/]+)/)
  const current = cockpit ? decodeURIComponent(cockpit[1]) : selected
  const name = projects.find((p) => p.id === current)?.name

  const choose = (value: string) => {
    const id = value === ALL ? "" : value
    start(async () => {
      await selectProject(id)
      if (cockpit) router.push(id ? `/projects/${encodeURIComponent(id)}` : "/")
      else router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            aria-busy={pending}
            aria-label={`Projekt wählen, aktuell ${name ?? "alle Projekte"}`}
            className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
          />
        }
      >
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <TrendingUp className="size-4" aria-hidden="true" />
        </div>
        <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-semibold">VibeGrowth</span>
          <span className="truncate text-xs text-muted-foreground">
            {name ?? "Alle Projekte"}
          </span>
        </div>
        <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--anchor-width) min-w-56"
        side={!isMobile && state === "collapsed" ? "right" : "bottom"}
        align="start"
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Projekt</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current || ALL}
            onValueChange={(v: string) => choose(v)}
          >
            <DropdownMenuRadioItem value={ALL} closeOnClick>
              <Layers3 aria-hidden="true" />
              Alle Projekte
            </DropdownMenuRadioItem>
            {projects.length ? <DropdownMenuSeparator /> : null}
            {projects.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id} closeOnClick>
                <span
                  aria-hidden="true"
                  className="flex size-4 items-center justify-center rounded-sm border text-[10px] font-medium uppercase"
                >
                  {p.name.slice(0, 1)}
                </span>
                {p.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

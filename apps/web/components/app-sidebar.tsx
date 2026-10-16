"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  Compass,
  FileText,
  FlaskConical,
  Funnel,
  GitBranch,
  History,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  MessageSquareText,
  Quote,
  SearchCheck,
  Sparkles,
  Star,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react"
import { ProjectSwitcher } from "@/components/project-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  badge?: number
  /** Further path prefixes that belong to this item (e.g. format pages under Strategien). */
  also?: string[]
}

export type SidebarProject = { id: string; name: string }

/** Badge numbers in the project scope of the switcher. */
export type SidebarCounts = {
  pendingApprovals: number
  /** inbox state open + proposal */
  featureRequestsOpen: number
  /** inbox state open + proposal */
  reviewsOpen: number
}

const web: NavItem[] = [
  { href: "/content", label: "Content", icon: FileText },
  { href: "/search", label: "Suche & Audit", icon: SearchCheck },
  { href: "/geo", label: "GEO", icon: Sparkles },
]

const shortform: NavItem[] = [
  { href: "/posts", label: "Posts", icon: Clapperboard },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/hooks", label: "Hooks", icon: Quote },
  { href: "/inspiration", label: "Inspiration", icon: Lightbulb },
]

export function AppSidebar({
  projects = [],
  selected = "",
  counts = { pendingApprovals: 0, featureRequestsOpen: 0, reviewsOpen: 0 },
  apiDown = false,
}: {
  projects?: SidebarProject[]
  /** Project from the switcher, "" = alle */
  selected?: string
  counts?: SidebarCounts
  apiDown?: boolean
}) {
  const pathname = usePathname()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const collapsed = !isMobile && state === "collapsed"
  const under = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)
  const active = (item: NavItem) =>
    item.href === "/"
      ? pathname === "/"
      : under(item.href) || (item.also ?? []).some(under)

  const general: NavItem[] = [
    { href: "/", label: "Übersicht", icon: LayoutDashboard },
    {
      href: "/approvals",
      label: "Wartet auf Max",
      icon: Inbox,
      badge: counts.pendingApprovals,
    },
    { href: "/tasks", label: "Aufgaben", icon: ListTodo, also: ["/backlog"] },
    { href: "/calendar", label: "Kalender", icon: CalendarDays },
    {
      href: "/experiments",
      label: "Experimente & Log",
      icon: FlaskConical,
    },
    {
      href: "/strategies",
      label: "Strategien",
      icon: Compass,
      also: ["/formats"],
    },
    { href: "/learnings", label: "Learnings", icon: BookOpen },
    { href: "/decisions", label: "Entscheidungen", icon: GitBranch },
    { href: "/history", label: "Verlauf", icon: History },
  ]

  const app: NavItem[] = [
    {
      href: "/feature-requests",
      label: "Feature Requests",
      icon: MessageSquareText,
      badge: counts.featureRequestsOpen,
    },
    {
      href: "/reviews",
      label: "Bewertungen",
      icon: Star,
      badge: counts.reviewsOpen,
    },
    { href: "/store", label: "Store", icon: Store },
    { href: "/funnel", label: "Funnel", icon: Funnel },
  ]

  const group = (label: string, items: NavItem[], empty?: string) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                isActive={active(item)}
                tooltip={
                  item.badge ? `${item.label} (${item.badge})` : item.label
                }
                render={
                  <Link
                    href={item.href}
                    prefetch={false}
                    aria-current={active(item) ? "page" : undefined}
                    onNavigate={() => setOpenMobile(false)}
                  />
                }
              >
                <item.icon aria-hidden="true" />
                <span className="truncate">{item.label}</span>
                {item.badge ? (
                  <span className="sr-only">, {item.badge} offen</span>
                ) : null}
              </SidebarMenuButton>
              {item.badge ? (
                <SidebarMenuBadge
                  aria-hidden="true"
                  className="bg-(--status-warn)/20 text-foreground peer-hover/menu-button:text-foreground peer-data-active/menu-button:text-foreground"
                >
                  {item.badge}
                </SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          ))}
          {items.length === 0 && empty && !collapsed ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">{empty}</li>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader
        className={cn(
          "h-14 flex-row items-center",
          collapsed && "justify-center"
        )}
      >
        {!collapsed && (
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <ProjectSwitcher projects={projects} selected={selected} />
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <SidebarTrigger aria-label="Seitenleiste umschalten" />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Hauptnavigation">
          {group("Allgemein", general)}
          {group("Web", web)}
          {group("App", app)}
          {group("Shortform", shortform)}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <div
          className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "justify-between px-2"
          )}
        >
          {!collapsed && (
            <span className="text-xs text-muted-foreground">
              {apiDown ? "API nicht erreichbar" : "Lokal · 127.0.0.1"}
            </span>
          )}
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

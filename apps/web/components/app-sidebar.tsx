"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  FileText,
  FlaskConical,
  FolderKanban,
  GitBranch,
  History,
  Inbox,
  Layers,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  Quote,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react"
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
}

export type SidebarProject = { id: string; name: string }

const shortform: NavItem[] = [
  { href: "/calendar", label: "Kalender", icon: CalendarDays },
  { href: "/posts", label: "Posts", icon: Clapperboard },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/formats", label: "Formate", icon: Layers },
  { href: "/hooks", label: "Hooks", icon: Quote },
  { href: "/inspiration", label: "Inspiration", icon: Lightbulb },
]

const knowledge: NavItem[] = [
  { href: "/learnings", label: "Learnings", icon: BookOpen },
  { href: "/decisions", label: "Entscheidungen", icon: GitBranch },
  { href: "/history", label: "Verlauf", icon: History },
]

export function AppSidebar({
  projects = [],
  pendingApprovals = 0,
  apiDown = false,
}: {
  projects?: SidebarProject[]
  pendingApprovals?: number
  apiDown?: boolean
}) {
  const pathname = usePathname()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const collapsed = !isMobile && state === "collapsed"
  const active = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`)

  const growth: NavItem[] = [
    { href: "/", label: "Übersicht", icon: LayoutDashboard },
    {
      href: "/approvals",
      label: "Wartet auf Max",
      icon: Inbox,
      badge: pendingApprovals,
    },
    { href: "/content", label: "Content", icon: FileText },
    { href: "/experiments", label: "Experimente & Log", icon: FlaskConical },
    { href: "/backlog", label: "Backlog", icon: ListTodo },
    { href: "/geo", label: "GEO", icon: Sparkles },
    { href: "/store", label: "Store", icon: Store },
  ]

  const projectItems: NavItem[] = projects.map((p) => ({
    href: `/projects/${encodeURIComponent(p.id)}`,
    label: p.name,
    icon: FolderKanban,
  }))

  const group = (label: string, items: NavItem[], empty?: string) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                isActive={active(item.href)}
                tooltip={
                  item.badge ? `${item.label} (${item.badge})` : item.label
                }
                render={
                  <Link
                    href={item.href}
                    prefetch={false}
                    aria-current={active(item.href) ? "page" : undefined}
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
              <SidebarMenuButton render={<Link href="/" prefetch={false} />}>
                <TrendingUp aria-hidden="true" />
                <span className="font-semibold">VibeGrowth</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <SidebarTrigger aria-label="Seitenleiste umschalten" />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Hauptnavigation">
          {group("Growth", growth)}
          {group(
            "Projekte",
            projectItems,
            apiDown ? "API nicht erreichbar" : "Keine Projekte"
          )}
          {group("Shortform", shortform)}
          {group("Wissen", knowledge)}
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
              Lokal · 127.0.0.1
            </span>
          )}
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  GitBranch,
  History,
  Layers,
  Lightbulb,
  Quote,
  Users,
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

const plan = [
  { href: "/", label: "Kalender", icon: CalendarDays },
  { href: "/posts", label: "Posts", icon: Clapperboard },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/formats", label: "Formate", icon: Layers },
]

const trace = [
  { href: "/learnings", label: "Learnings", icon: BookOpen },
  { href: "/decisions", label: "Entscheidungen", icon: GitBranch },
  { href: "/hooks", label: "Hooks", icon: Quote },
  { href: "/inspiration", label: "Inspiration", icon: Lightbulb },
  { href: "/history", label: "Verlauf", icon: History },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const collapsed = !isMobile && state === "collapsed"
  const active = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`)

  const group = (label: string, items: typeof plan) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                isActive={active(item.href)}
                tooltip={item.label}
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
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
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
                <Clapperboard aria-hidden="true" />
                <span className="font-semibold">VibeShorts</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <SidebarTrigger aria-label="Seitenleiste umschalten" />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Hauptnavigation">
          {group("Planen", plan)}
          {group("Nachvollziehen", trace)}
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

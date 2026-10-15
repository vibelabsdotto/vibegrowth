import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { AppSidebar, type SidebarProject } from "@/components/app-sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { apiUrl, WEB_ACTOR } from "@/lib/api"
import { cn } from "@/lib/utils"
import "./globals.css"
import "@/components/growth/growth.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: { default: "VibeGrowth", template: "%s · VibeGrowth" },
  description: "Lokales Growth-Studio: Shortform, Websites und Apps.",
}

/** Short GET for the navigation; a slow or missing API must not block every page. */
async function navFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiUrl()}/api${path}`, {
      headers: { "X-Actor": WEB_ACTOR },
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function navData() {
  const [projects, pending] = await Promise.all([
    navFetch<{ id: string; name: string; status?: string }[]>("/projects"),
    navFetch<unknown[]>("/approvals?status=pending"),
  ])
  const list: SidebarProject[] = Array.isArray(projects)
    ? projects
        .filter((p) => p.status !== "archived")
        .map((p) => ({ id: p.id, name: p.name }))
    : []
  return {
    projects: list,
    pendingApprovals: Array.isArray(pending) ? pending.length : 0,
    apiDown: projects === null,
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nav = await navData()
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        geist.variable,
        geistMono.variable,
        "font-sans"
      )}
    >
      <body>
        <ThemeProvider>
          <Toaster>
            <TooltipProvider>
              <SidebarProvider className="h-svh min-h-0 overflow-hidden">
                <AppSidebar {...nav} />
                <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
                  <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
                    <SidebarTrigger aria-label="Navigation öffnen" />
                    <span className="text-sm font-semibold">VibeGrowth</span>
                  </header>
                  <div
                    id="main-content"
                    className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6"
                  >
                    {children}
                  </div>
                </SidebarInset>
              </SidebarProvider>
            </TooltipProvider>
          </Toaster>
        </ThemeProvider>
      </body>
    </html>
  )
}

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
import type { InboxStateCounts } from "@/lib/growth-types"
import { selectedProject } from "@/lib/project-scope"
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

/** Items Max still has to act on: state open (no reply yet) or proposal (agent reply waits). */
function actionable(byState: InboxStateCounts | undefined) {
  return (byState?.open ?? 0) + (byState?.proposal ?? 0)
}

async function navData() {
  const [projects, chosen] = await Promise.all([
    navFetch<{ id: string; name: string; status?: string }[]>("/projects"),
    selectedProject(),
  ])
  const list: SidebarProject[] = Array.isArray(projects)
    ? projects
        .filter((p) => p.status !== "archived")
        .map((p) => ({ id: p.id, name: p.name }))
    : []
  // A deleted or archived project falls back to "alle".
  const selected = list.some((p) => p.id === chosen) ? chosen : ""
  // Badges follow the project scope of the switcher, like the pages they link to.
  const scope = selected ? `&project=${encodeURIComponent(selected)}` : ""
  const [pending, inbox, testing] = await Promise.all([
    navFetch<unknown[]>(`/approvals?status=pending&waiting=exclude${scope}`),
    navFetch<{
      counts?: {
        featureRequests?: { byState?: InboxStateCounts }
        reviews?: { byState?: InboxStateCounts }
      }
    }>(`/app/inbox?limit=1${scope}`),
    navFetch<unknown[]>(`/backlog?status=question,testing${scope}`),
  ])
  return {
    projects: list,
    selected,
    counts: {
      // Wartet auf Max: open approvals plus tasks waiting for "Passt"
      pendingApprovals:
        (Array.isArray(pending) ? pending.length : 0) +
        (Array.isArray(testing) ? testing.length : 0),
      featureRequestsOpen: actionable(inbox?.counts?.featureRequests?.byState),
      reviewsOpen: actionable(inbox?.counts?.reviews?.byState),
    },
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

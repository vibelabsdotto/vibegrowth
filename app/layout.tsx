import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: { default: "VibeShorts", template: "%s · VibeShorts" },
  description: "Lokales Content-Studio für Shortform.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
                <AppSidebar />
                <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
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

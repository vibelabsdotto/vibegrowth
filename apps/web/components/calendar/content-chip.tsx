"use client"

import { FileText } from "lucide-react"
import Link from "next/link"
import { CategoryLabel } from "@/components/growth/category"
import { cn } from "@/lib/utils"

/** Web content with a date, from GET /calendar (type content). */
export type CalendarContent = {
  id: number
  date: string
  title: string
  projectName: string
  category: string
  dateKind: "planned" | "live"
  kind: string
  status: string
  urlPath: string | null
}

const STATUS_LABEL: Record<string, string> = {
  idea: "Idee",
  approved: "freigegeben",
  draft: "Entwurf",
  review: "Review",
  live: "live",
}

/** Calendar chip for a content item; opens the item on /content. */
export function ContentChip({
  item,
  showProject,
}: {
  item: CalendarContent
  showProject?: boolean
}) {
  const live = item.dateKind === "live"
  const status = STATUS_LABEL[item.status] ?? item.status
  return (
    <Link
      href={`/content?item=${item.id}`}
      prefetch={false}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-md border bg-card px-2 py-1.5 text-xs shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        live && "bg-muted text-muted-foreground"
      )}
      aria-label={`${item.title}, ${live ? "live seit" : "geplant am"} ${item.date}, ${status}`}
    >
      <span className="flex min-w-0 items-center gap-1">
        <CategoryLabel
          category={item.category}
          className="h-4 px-1 text-[10px] font-normal text-muted-foreground"
        />
        {showProject ? (
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {item.projectName}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "line-clamp-2 font-medium break-words hyphens-auto",
          live ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {item.title}
      </span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <FileText className="size-3 shrink-0" aria-hidden="true" />
        {live ? "live" : `geplant · ${status}`}
      </span>
    </Link>
  )
}

"use client"

import { usePathname, useRouter } from "next/navigation"
import { useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CATEGORY_TABS, categoryLabel, type Category } from "@/lib/categories"

type Params = Record<string, string | undefined>

/**
 * Bereich-Filter (Alle/Web/Shortform/App/Allgemein) bound to ?category=. The page reads the
 * parameter on the server and passes it to the API (`?category=`). `params` keeps the other
 * filters of the page.
 */
export function CategoryTabs({
  value,
  params = {},
  counts,
}: {
  value: Category | ""
  params?: Params
  /** Optional number per tab ("" = Alle). */
  counts?: Partial<Record<Category | "", number>>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  const go = (next: string) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params))
      if (v && k !== "category") q.set(k, v)
    if (next) q.set("category", next)
    const qs = q.toString()
    start(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    )
  }

  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        if (typeof v === "string" && v !== value) go(v)
      }}
      aria-busy={pending}
      className="max-w-full min-w-0"
    >
      <TabsList
        aria-label="Bereich"
        className="max-w-full justify-start overflow-x-auto overflow-y-hidden"
      >
        {CATEGORY_TABS.map((t) => (
          <TabsTrigger
            key={t.value || "all"}
            value={t.value}
            className="px-2.5"
          >
            {t.label}
            {counts && counts[t.value] !== undefined ? (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {counts[t.value]}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

/** Dezentes Bereich-Label in Listen. */
export function CategoryLabel({
  category,
  className,
}: {
  category: string | null | undefined
  className?: string
}) {
  if (!category) return null
  return (
    <Badge
      variant="outline"
      className={className ?? "font-normal text-muted-foreground"}
    >
      <span className="sr-only">Bereich: </span>
      {categoryLabel(category)}
    </Badge>
  )
}

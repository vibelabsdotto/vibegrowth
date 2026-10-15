import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { PlanCalendar, type CalendarAccount } from "@/components/plan-calendar"
import { apiFetch } from "@/lib/api"
import { isDate, localToday, monthGrid, range, weekStart } from "@/lib/dates"
import { listBrands } from "@/lib/server"
import type {
  AccountRow,
  CalendarPost,
  FormatRow,
  Horizon,
  InspirationRow,
  PlanEntryRow,
  PostRow,
} from "@/lib/types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Kalender" }

type Search = Promise<{
  view?: string
  date?: string
  brand?: string
  accounts?: string
}>

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Search
}) {
  const sp = await searchParams
  const today = localToday()
  const view = sp.view === "month" || sp.view === "3w" ? sp.view : "week"
  const anchor = isDate(sp.date) ? sp.date : today

  const weeks: string[][] = []
  const grid =
    view === "month"
      ? monthGrid(anchor)
      : range(weekStart(anchor), view === "3w" ? 21 : 7)
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7))
  const from = grid[0]
  const to = grid[grid.length - 1]

  const [brands, rawAccounts, allPosts, inspos, formats] = await Promise.all([
    listBrands(),
    apiFetch<AccountRow[]>("/accounts"),
    apiFetch<PostRow[]>("/posts"),
    apiFetch<InspirationRow[]>("/inspo"),
    apiFetch<FormatRow[]>("/formats"),
  ])
  const brand =
    sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : ""
  // Horizon counts from the API's today (same local date as localToday on this machine).
  const horizons = await Promise.all(
    rawAccounts.map((a) =>
      apiFetch<Horizon>("/plan/horizon", { query: { account: a.id, days: 21 } })
    )
  )
  const allAccounts: CalendarAccount[] = rawAccounts.map((a, i) => {
    const h = horizons[i]
    return {
      id: a.id,
      name: a.name,
      brandId: a.brandId,
      defaultFormatId: a.defaultFormatId,
      horizon: { filledDays: h.filledDays, days: h.days },
    }
  })
  const selected = sp.accounts ? sp.accounts.split(",").filter(Boolean) : null
  // Default: active accounts and everything that already has a plan. Others can be toggled on.
  const accounts = allAccounts.filter((a) => {
    if (brand && a.brandId !== brand) return false
    if (selected) return selected.includes(a.id)
    return (
      rawAccounts.find((x) => x.id === a.id)!.status === "active" ||
      a.horizon.filledDays > 0
    )
  })
  const ids = new Set(accounts.map((a) => a.id))

  // GET /plan filters one account or brand; the calendar shows a selection, so filter here.
  const [plan, ideaPool] = await Promise.all([
    apiFetch<PlanEntryRow[]>("/plan", { query: { from, to } }),
    apiFetch<PlanEntryRow[]>("/plan", { query: { ideas: true } }),
  ])
  const entries = plan.filter((e) => ids.has(e.accountId))
  const posts: CalendarPost[] = allPosts
    .filter((x) => x.status === "posted" && !x.planEntryId && x.postedAt)
    .map((x) => ({
      id: x.id,
      accountId: x.accountId,
      date: (x.postedAt ?? "").slice(0, 10),
      hook: x.hook,
      slug: x.slug,
      status: x.status,
    }))
    .filter((x) => x.date >= from && x.date <= to)
  const postsByEntry: Record<number, { id: number; label: string }> = {}
  for (const x of allPosts)
    if (x.planEntryId) postsByEntry[x.planEntryId] = { id: x.id, label: x.slug }

  const ideas = ideaPool.filter((e) => ids.has(e.accountId))
  const inspirations = inspos.map((i) => ({
    id: i.id,
    label: (i.note ?? i.url).slice(0, 80),
  }))

  return (
    <div className="mx-auto flex w-full max-w-[110rem] min-w-0 flex-col gap-6">
      <PageHeader
        title="Kalender"
        description="Alle Accounts. Der Agent plant drei Wochen im Voraus, du verschiebst, sperrst und legst an, wo du willst."
      />
      <Suspense>
        <PlanCalendar
          view={view}
          anchor={anchor}
          today={today}
          days={grid}
          weeks={weeks}
          brands={brands.map((b) => ({ id: b.id, name: b.name }))}
          brand={brand}
          allAccounts={allAccounts}
          accounts={accounts}
          entries={entries}
          posts={posts}
          ideas={ideas}
          formats={formats.map((f) => ({ id: f.id, name: f.name }))}
          inspirations={inspirations}
          postsByEntry={postsByEntry}
        />
      </Suspense>
    </div>
  )
}

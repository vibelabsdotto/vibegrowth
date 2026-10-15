import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { PlanCalendar, type CalendarAccount } from "@/components/plan-calendar"
import { apiFetch } from "@/lib/api"
import { isDate, localToday, monthGrid, range, weekStart } from "@/lib/dates"
import { NoAccounts, ScopedDescription } from "@/components/scope-badge"
import { formatsInScope, projectScope } from "@/lib/server"
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
  accounts?: string
  /** Scope the account selection was made in (project id or "all"). */
  for?: string
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

  const [{ projects, project }, everyAccount, allPosts, inspos, allFormats] =
    await Promise.all([
      projectScope(),
      apiFetch<AccountRow[]>("/accounts"),
      apiFetch<PostRow[]>("/posts"),
      apiFetch<InspirationRow[]>("/inspo"),
      apiFetch<FormatRow[]>("/formats"),
    ])
  const brand = project?.id
  // Project from the switcher: only its accounts (and through them its entries and posts).
  const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]))
  const rawAccounts = everyAccount
    .filter((a) => !brand || a.brandId === brand)
    .sort((a, b) =>
      (projectName[a.brandId] ?? a.brandId).localeCompare(
        projectName[b.brandId] ?? b.brandId
      )
    )
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
      projectName: projectName[a.brandId] ?? a.brandId,
      defaultFormatId: a.defaultFormatId,
      horizon: { filledDays: h.filledDays, days: h.days },
    }
  })
  // An account selection belongs to the scope it was made in (?for=); after switching the
  // project it no longer applies and the default selection returns.
  const scopeKey = project?.id ?? "all"
  const raw = sp.for === scopeKey ? sp.accounts : undefined
  const picked = raw
    ? raw.split(",").filter((id) => allAccounts.some((a) => a.id === id))
    : []
  const selected = raw === "none" || picked.length ? picked : null
  // Default: active accounts and everything that already has a plan. Others can be toggled on.
  const accounts = allAccounts.filter((a) => {
    if (selected) return selected.includes(a.id)
    return (
      rawAccounts.find((x) => x.id === a.id)!.status === "active" ||
      a.horizon.filledDays > 0
    )
  })
  const ids = new Set(accounts.map((a) => a.id))

  // GET /plan filters one account or brand; the calendar shows a selection, so filter here.
  const [plan, ideaPool] = await Promise.all([
    apiFetch<PlanEntryRow[]>("/plan", { query: { from, to, brand } }),
    apiFetch<PlanEntryRow[]>("/plan", { query: { ideas: true, brand } }),
  ])
  const entries = plan.filter((e) => ids.has(e.accountId))
  const posts: CalendarPost[] = allPosts
    .filter(
      (x) =>
        ids.has(x.accountId) &&
        x.status === "posted" &&
        !x.planEntryId &&
        x.postedAt
    )
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
  // Inspiration of the project (own brand or one of its accounts) plus cross-project links.
  const accountIds = new Set(rawAccounts.map((a) => a.id))
  const inspirations = inspos
    .filter(
      (i) =>
        !project ||
        i.brandId === project.id ||
        (i.accountId && accountIds.has(i.accountId)) ||
        (!i.brandId && !i.accountId)
    )
    .map((i) => ({
      id: i.id,
      label: (i.note ?? i.url).slice(0, 80),
    }))

  const referenced = new Set(
    [...entries, ...ideas].map((e) => e.formatId).filter(Boolean)
  )
  const scopedFormats = formatsInScope(allFormats, project, rawAccounts)
  const formats = allFormats.filter(
    (f) => scopedFormats.includes(f) || referenced.has(f.id)
  )

  return (
    <div className="mx-auto flex w-full max-w-[110rem] min-w-0 flex-col gap-6">
      <PageHeader
        title="Kalender"
        description={
          <ScopedDescription project={project}>
            Der Agent plant drei Wochen im Voraus, du verschiebst, sperrst und
            legst an, wo du willst.
          </ScopedDescription>
        }
      />
      {project && !allAccounts.length ? (
        <NoAccounts project={project} what="gibt es keinen Plan" />
      ) : (
        <Suspense>
          <PlanCalendar
            view={view}
            anchor={anchor}
            today={today}
            days={grid}
            weeks={weeks}
            showProject={!project}
            scopeKey={scopeKey}
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
      )}
    </div>
  )
}

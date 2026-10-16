import { plural } from "@/components/app-inbox/labels"
import { ReviewList } from "@/components/app-inbox/review-list"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { EmptyState, SectionError } from "@/components/growth/status"
import { UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import type { AppInbox, InboxReview } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Bewertungen" }

/** Reviews that need a reply come first in the API order, so this cap never hides one. */
const LIMIT = 1000

const STORES = ["google_play", "app_store"] as const
type StoreKey = (typeof STORES)[number]

type Search = { filter?: string; store?: string }

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const sp = await searchParams
  const scope = await projectScope()
  const { project, projects } = scope
  const res = await load<AppInbox>("/app/inbox", {
    project: project || undefined,
    type: "review",
    limit: LIMIT,
  })
  const counts = res.data?.counts.reviews
  const store: StoreKey | "all" = STORES.includes(sp.store as StoreKey)
    ? (sp.store as StoreKey)
    : "all"
  const storeCounts =
    store === "all"
      ? { total: counts?.total ?? 0, needsReply: counts?.needsReply ?? 0 }
      : (counts?.[store] ?? { total: 0, needsReply: 0 })
  const filter =
    sp.filter === "open" || sp.filter === "all"
      ? sp.filter
      : storeCounts.needsReply > 0
        ? "open"
        : "all"
  const all = (res.data?.items ?? []).filter(
    (i): i is InboxReview => i.type === "review"
  )
  const rows = all.filter(
    (r) =>
      (store === "all" || r.store === store) &&
      (filter === "all" || r.needsReply)
  )
  const projectNames = project
    ? null
    : Object.fromEntries(projects.map((p) => [p.id, p.name]))
  const params = { filter: sp.filter, store: sp.store }

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Bewertungen"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Bewertungen mit Text aus Google Play und dem App Store.
          </ScopeLabel>
        }
      />
      {res.error !== null ? (
        <SectionError title="Bewertungen nicht geladen" error={res.error} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <UrlToggle
                param="filter"
                value={filter}
                params={params}
                label="Antwortstatus"
                options={[
                  {
                    value: "open",
                    label: `Braucht Antwort (${storeCounts.needsReply})`,
                  },
                  { value: "all", label: `Alle (${storeCounts.total})` },
                ]}
              />
              <UrlToggle
                param="store"
                value={store}
                params={params}
                label="Store"
                options={[
                  { value: "all", label: "Alle Stores" },
                  {
                    value: "google_play",
                    label: `Google Play (${counts?.google_play?.total ?? 0})`,
                  },
                  {
                    value: "app_store",
                    label: `App Store (${counts?.app_store?.total ?? 0})`,
                  },
                ]}
              />
            </div>
            {counts && counts.ratingsOnly > 0 ? (
              <p className="text-sm text-muted-foreground">
                Dazu kommen{" "}
                {plural(counts.ratingsOnly, "Bewertung", "Bewertungen")} nur mit
                Sternen. Sie stehen nicht in der Liste und brauchen keine
                Antwort.
              </p>
            ) : null}
            {all.length < (counts?.total ?? 0) ? (
              <p className="text-sm text-muted-foreground">
                Gezeigt werden die ersten {all.length} von {counts?.total}{" "}
                Bewertungen.
              </p>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <EmptyState
              title={filter === "open" ? "Nichts offen" : "Keine Bewertungen"}
              description={
                filter === "open"
                  ? "Alle Bewertungen mit Text sind beantwortet."
                  : "Der Collector reviews liefert Bewertungen, sobald er für das Projekt eingeschaltet ist."
              }
            />
          ) : (
            <ReviewList items={rows} projectNames={projectNames} />
          )}
        </>
      )}
    </div>
  )
}

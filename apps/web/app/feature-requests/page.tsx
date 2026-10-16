import { FeatureRequestList } from "@/components/app-inbox/feature-request-list"
import { plural } from "@/components/app-inbox/labels"
import { load, projectScope, requestTime } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { EmptyState, SectionError } from "@/components/growth/status"
import { UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import type { AppInbox, InboxFeatureRequest } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Feature Requests" }

/** Open requests come first in the API order, so this cap never hides one. */
const LIMIT = 1000

type Search = { filter?: string; item?: string }

export default async function FeatureRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const sp = await searchParams
  const scope = await projectScope()
  const { project, projects } = scope
  const res = await load<AppInbox>("/app/inbox", {
    project: project || undefined,
    type: "feature_request",
    limit: LIMIT,
  })
  const counts = res.data?.counts.featureRequests
  const all = (res.data?.items ?? []).filter(
    (i): i is InboxFeatureRequest => i.type === "feature_request"
  )
  const openCount = counts?.needsReply ?? 0
  const filter =
    sp.filter === "open" || sp.filter === "all"
      ? sp.filter
      : openCount > 0
        ? "open"
        : "all"
  const rows = filter === "open" ? all.filter((r) => r.needsReply) : all
  const deepItem =
    sp.item && !rows.some((r) => r.requestId === sp.item)
      ? (all.find((r) => r.requestId === sp.item) ?? null)
      : null
  const projectNames = project
    ? null
    : Object.fromEntries(projects.map((p) => [p.id, p.name]))
  const total = counts?.total ?? 0

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Feature Requests"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Wünsche aus Featurama. Ein Klick öffnet den Verlauf.
          </ScopeLabel>
        }
      />
      {res.error !== null ? (
        <SectionError
          title="Feature Requests nicht geladen"
          error={res.error}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <UrlToggle
              param="filter"
              value={filter}
              params={{ filter: sp.filter }}
              label="Antwortstatus"
              options={[
                { value: "open", label: `Braucht Antwort (${openCount})` },
                { value: "all", label: `Alle (${total})` },
              ]}
            />
            {counts && counts.pending > 0 ? (
              <span className="text-sm text-muted-foreground tabular-nums">
                {plural(counts.pending, "Request", "Requests")} in Featurama
                nicht freigegeben
              </span>
            ) : null}
          </div>
          {all.length < total ? (
            <p className="text-sm text-muted-foreground">
              Gezeigt werden die ersten {all.length} von {total} Requests.
            </p>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState
              title={
                filter === "open" ? "Nichts offen" : "Keine Feature Requests"
              }
              description={
                filter === "open"
                  ? "Alle freigegebenen Requests sind beantwortet."
                  : "Der Collector featurama liefert Requests, sobald er für das Projekt eingeschaltet ist."
              }
            />
          ) : null}
          {rows.length > 0 || deepItem ? (
            <FeatureRequestList
              items={rows}
              deepItem={deepItem}
              projectNames={projectNames}
              now={requestTime()}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

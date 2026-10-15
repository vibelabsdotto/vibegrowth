import { Inbox } from "lucide-react"
import { ApprovalCard } from "@/components/growth/approval-card"
import { APPROVAL_KIND_LABEL } from "@/components/growth/format"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel, ScopeLink } from "@/components/growth/scope"
import { EmptyState, SectionError } from "@/components/growth/status"
import { UrlFilter, UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Approval } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Wartet auf Max" }

const STATUS_QUERY: Record<string, string> = {
  pending: "pending",
  decided: "approved,rejected,changes_requested,withdrawn",
  all: "all",
}

type Search = { status?: string; kind?: string }

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const sp = await searchParams
  const status = sp.status && STATUS_QUERY[sp.status] ? sp.status : "pending"
  const scope = await projectScope()
  const { project, projects } = scope
  const [res, pendingRes] = await Promise.all([
    load<Approval[]>("/approvals", {
      status: STATUS_QUERY[status],
      project: project || undefined,
      kind: sp.kind,
      limit: status === "pending" ? undefined : 200,
    }),
    // The sidebar badge counts every project; say what the project filter hides.
    project ? load<Approval[]>("/approvals", { status: "pending" }) : null,
  ])
  const elsewhere = (pendingRes?.data ?? []).filter(
    (a) => a.projectId !== project
  ).length
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  const rows = res.data ?? []
  const groups = new Map<string, Approval[]>()
  for (const a of rows) {
    const g = groups.get(a.projectId) ?? []
    g.push(a)
    groups.set(a.projectId, g)
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    name(a[0]).localeCompare(name(b[0]), "de")
  )
  const params = { status: sp.status, kind: sp.kind }

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Wartet auf Max"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Vorschläge der Agents. Nur du entscheidest; die Notiz geht an den
            Agent zurück.
          </ScopeLabel>
        }
      />
      {elsewhere > 0 ? (
        <Alert role="status">
          <Inbox aria-hidden="true" />
          <AlertDescription>
            <p>
              {elsewhere === 1
                ? "1 weitere offene Freigabe"
                : `${elsewhere} weitere offene Freigaben`}{" "}
              in anderen Projekten.{" "}
              <ScopeLink path="/approvals" project="">
                Alle Projekte anzeigen
              </ScopeLink>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <UrlToggle
          param="status"
          value={status}
          params={params}
          label="Status"
          options={[
            { value: "pending", label: "Offen" },
            { value: "decided", label: "Entschieden" },
            { value: "all", label: "Alle" },
          ]}
        />
        <UrlFilter
          param="kind"
          value={sp.kind ?? ""}
          params={params}
          label="Art"
          allLabel="Alle Arten"
          options={Object.entries(APPROVAL_KIND_LABEL).map(([value, l]) => ({
            value,
            label: l,
          }))}
        />
        {res.data ? (
          <span className="text-sm text-muted-foreground tabular-nums sm:ml-auto">
            {rows.length} {rows.length === 1 ? "Eintrag" : "Einträge"}
          </span>
        ) : null}
      </div>

      {res.error !== null ? (
        <SectionError title="Freigaben nicht geladen" error={res.error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            status === "pending" ? "Nichts offen" : "Keine Freigaben gefunden"
          }
          description={
            status === "pending"
              ? project
                ? `Für ${scope.name} wartet nichts auf dich.`
                : "Sobald ein Agent etwas zur Freigabe stellt, erscheint es hier."
              : "Für diese Filter gibt es keine Einträge."
          }
        />
      ) : project ? (
        <div className="flex flex-col gap-3">
          {rows.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      ) : (
        ordered.map(([projectId, items]) => (
          <section
            key={projectId}
            aria-labelledby={`approvals-${projectId}`}
            className="flex flex-col gap-3"
          >
            <h2
              id={`approvals-${projectId}`}
              className="flex items-baseline gap-2 text-sm font-semibold text-muted-foreground"
            >
              {name(projectId)}
              <span className="font-normal tabular-nums">{items.length}</span>
            </h2>
            {items.map((a) => (
              <ApprovalCard key={a.id} approval={a} />
            ))}
          </section>
        ))
      )}
    </div>
  )
}

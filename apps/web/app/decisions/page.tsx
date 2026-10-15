import { NewDecision } from "@/components/knowledge-forms"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { actorLabel, fmtDate } from "@/lib/labels"
import { apiFetch } from "@/lib/api"
import { listBrands } from "@/lib/server"
import type { AccountRow, DecisionRow } from "@/lib/types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Entscheidungen" }

export default async function DecisionsPage() {
  const [accounts, brands, items] = await Promise.all([
    apiFetch<AccountRow[]>("/accounts"),
    listBrands(),
    apiFetch<DecisionRow[]>("/decisions"),
  ])
  const byId = new Map(items.map((d) => [d.id, d]))
  const scopeName = (t: string, id: string | null) =>
    t === "global"
      ? "alle"
      : t === "account"
        ? (accounts.find((a) => a.id === id)?.name ?? id)
        : t === "brand"
          ? (brands.find((b) => b.id === id)?.name ?? id)
          : `Format ${id}`

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Entscheidungen"
        description="Zeitleiste der Entscheidungen und Pivots, jeweils mit Begründung."
        actions={
          <NewDecision
            accounts={accounts.map((a) => ({ value: a.id, label: a.name }))}
            brands={brands.map((b) => ({ value: b.id, label: b.name }))}
          />
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Noch keine Entscheidungen</EmptyTitle>
            <EmptyDescription>
              Pivots kommen per „vibegrowth decision add --pivot“ oder hier über
              „Entscheidung“.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="relative flex flex-col gap-6 border-l pl-6">
          {items.map((d) => (
            <li key={d.id} className="relative flex flex-col gap-1.5">
              <span
                className={`absolute top-1.5 -left-[1.95rem] size-3 rounded-full border-2 border-background ${d.kind === "pivot" ? "bg-foreground" : "bg-muted-foreground"}`}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {fmtDate(d.date)}
                </span>
                {d.kind === "pivot" ? <Badge>Pivot</Badge> : null}
                <Badge variant="outline">
                  {scopeName(d.scopeType, d.scopeId)}
                </Badge>
                {actorLabel(d.actor)}
              </div>
              <h3 className="font-semibold">{d.title}</h3>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {d.rationale}
              </p>
              {d.supersedesId ? (
                <p className="text-xs text-muted-foreground">
                  Ersetzt:{" "}
                  {byId.get(d.supersedesId)?.title ?? `#${d.supersedesId}`}
                </p>
              ) : null}
              {d.source ? (
                <p className="text-xs text-muted-foreground">
                  Quelle: {d.source}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

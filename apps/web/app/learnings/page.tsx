import { Suspense } from "react"
import { LearningStatusButton, NewLearning } from "@/components/knowledge-forms"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { UrlSelect } from "@/components/url-select"
import { actorLabel, fmtDate } from "@/lib/labels"
import { apiFetch } from "@/lib/api"
import { listBrands } from "@/lib/server"
import type { AccountRow, LearningRow } from "@/lib/types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Learnings" }

export default async function LearningsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; status?: string }>
}) {
  const sp = await searchParams
  const [accounts, brands] = await Promise.all([
    apiFetch<AccountRow[]>("/accounts"),
    listBrands(),
  ])
  const scopeName = (t: string, id: string | null) =>
    t === "global"
      ? "alle"
      : t === "account"
        ? (accounts.find((a) => a.id === id)?.name ?? id)
        : t === "brand"
          ? (brands.find((b) => b.id === id)?.name ?? id)
          : `Format ${id}`
  const status =
    sp.status === "all"
      ? undefined
      : sp.status === "outdated"
        ? "outdated"
        : "active"
  // GET /learnings knows active or all; "outdated" is filtered here.
  const items = (
    await apiFetch<LearningRow[]>("/learnings", {
      query: { account: sp.account || undefined, all: status !== "active" },
    })
  ).filter((l) => !status || l.status === status)
  const accOpts = accounts.map((a) => ({ value: a.id, label: a.name }))

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Learnings"
        description="Was die Zahlen gezeigt haben, jeweils mit Beleg, Datum und Akteur."
        actions={
          <>
            <Suspense>
              <UrlSelect
                param="account"
                label="Account"
                allLabel="Alle Accounts"
                value={sp.account ?? ""}
                options={accOpts}
              />
              <UrlSelect
                param="status"
                label="Status"
                allLabel="Aktiv"
                value={sp.status ?? ""}
                options={[
                  { value: "outdated", label: "Überholt" },
                  { value: "all", label: "Alle" },
                ]}
              />
            </Suspense>
            <NewLearning
              accounts={accOpts}
              brands={brands.map((b) => ({ value: b.id, label: b.name }))}
              account={sp.account}
            />
          </>
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Keine Learnings</EmptyTitle>
            <EmptyDescription>
              Agents tragen sie per „vibegrowth learning add“ mit Beleg ein.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((l) => (
            <Card key={l.id} size="sm">
              <CardContent className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-medium">{l.statement}</p>
                  <LearningStatusButton id={l.id} status={l.status} />
                </div>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {l.evidence}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {scopeName(l.scopeType, l.scopeId)}
                  </Badge>
                  {l.status !== "active" ? (
                    <Badge variant="secondary">überholt</Badge>
                  ) : null}
                  {fmtDate(l.date)} · {actorLabel(l.actor)}
                  {l.source ? ` · ${l.source}` : ""}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

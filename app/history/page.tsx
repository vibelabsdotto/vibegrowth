import { Suspense } from "react"
import { listHistory } from "@/core/knowledge"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UrlSelect } from "@/components/url-select"
import { actorLabel, fmtDateTime } from "@/lib/labels"
import { ctx } from "@/lib/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Verlauf" }

const ENTITY_LABEL: Record<string, string> = {
  plan_entry: "Planeintrag",
  post: "Post",
  account: "Account",
  character: "Charakter",
  format: "Format",
  rule: "Regel",
  image_error: "Bildfehler",
  learning: "Learning",
  decision: "Entscheidung",
  hook: "Hook",
  inspiration: "Inspiration",
  metrics: "Zahlen",
  brand: "Brand",
}

function diff(before: unknown, after: unknown) {
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object"
  )
    return null
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  return Object.keys(a)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${k}: ${short(b[k])} → ${short(a[k])}`)
}

function short(v: unknown) {
  const s =
    v === null || v === undefined
      ? "–"
      : typeof v === "string"
        ? v
        : JSON.stringify(v)
  return s.length > 60 ? `${s.slice(0, 59)}…` : s
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; by?: string }>
}) {
  const sp = await searchParams
  const c = ctx()
  const rows = listHistory(c, {
    entity: sp.entity || undefined,
    actor: sp.by || undefined,
    limit: 300,
  })
  const actors = (
    c.sqlite
      .prepare("SELECT DISTINCT actor FROM history ORDER BY actor")
      .all() as { actor: string }[]
  ).map((r) => r.actor)

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Verlauf"
        description="Jede Änderung mit Akteur, Zeit, vorher und nachher. Max im Browser, Agents per CLI."
        actions={
          <Suspense>
            <UrlSelect
              param="entity"
              label="Bereich"
              allLabel="Alle Bereiche"
              value={sp.entity ?? ""}
              options={Object.entries(ENTITY_LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <UrlSelect
              param="by"
              label="Akteur"
              allLabel="Alle Akteure"
              value={sp.by ?? ""}
              options={actors.map((a) => ({ value: a, label: actorLabel(a) }))}
            />
          </Suspense>
        }
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zeit</TableHead>
              <TableHead>Akteur</TableHead>
              <TableHead>Bereich</TableHead>
              <TableHead>Aktion</TableHead>
              <TableHead>Änderung</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => {
              const changes = diff(h.before, h.after)
              return (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap">
                    {fmtDateTime(h.at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={h.actor === "max" ? "default" : "outline"}>
                      {actorLabel(h.actor)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {ENTITY_LABEL[h.entity] ?? h.entity}{" "}
                    <span className="text-muted-foreground">#{h.entityId}</span>
                  </TableCell>
                  <TableCell>{h.action}</TableCell>
                  <TableCell className="max-w-xl text-xs whitespace-normal text-muted-foreground">
                    {changes?.length
                      ? changes.join(" · ")
                      : h.action === "create" &&
                          h.after &&
                          typeof h.after === "object"
                        ? short(
                            (h.after as Record<string, unknown>).topic ??
                              (h.after as Record<string, unknown>).text ??
                              (h.after as Record<string, unknown>).title ??
                              (h.after as Record<string, unknown>).statement ??
                              ""
                          )
                        : ""}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

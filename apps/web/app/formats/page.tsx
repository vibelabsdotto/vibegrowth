import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { apiFetch } from "@/lib/api"
import { listBrands } from "@/lib/server"
import type { FormatRow, FormatShow } from "@/lib/types"
import { NewFormat } from "./new-format"

export const dynamic = "force-dynamic"
export const metadata = { title: "Formate" }

export default async function FormatsPage() {
  const [formats, brands] = await Promise.all([
    apiFetch<FormatRow[]>("/formats"),
    listBrands(),
  ])
  // formats show: current version, active accounts, rules of the current version, image errors.
  const shows = new Map(
    (
      await Promise.all(
        formats.map((f) =>
          apiFetch<FormatShow>(`/formats/${encodeURIComponent(f.id)}`)
        )
      )
    ).map((s) => [s.id, s])
  )

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Formate"
        description="Formate mit Versionen, Regeln und bekannten Bildfehlern. Ein Pivot ist eine neue Version, kein Skill-Umbau."
        actions={
          <NewFormat
            brands={brands.map((b) => ({ value: b.id, label: b.name }))}
          />
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {formats.map((f) => {
          const full = shows.get(f.id)!
          const rules = full.rules.filter((r) => r.status === "active")
          const errors = full.imageErrors.filter((e) => e.status === "active")
          const users = full.activeAccounts
          return (
            <Link
              key={f.id}
              href={`/formats/${f.id}`}
              prefetch={false}
              className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle>{f.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {f.description ?? "Ohne Beschreibung"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>Version {f.currentVersion}</Badge>
                    <Badge variant="outline">{rules.length} Regeln</Badge>
                    <Badge variant="outline">{errors.length} Bildfehler</Badge>
                    {full.current?.guide ? null : (
                      <Badge variant="destructive">ohne Leitfaden</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Aktiv bei: {users.map((a) => a.name).join(", ") || "–"} ·
                    Renderer:{" "}
                    <span className="font-mono">
                      {JSON.stringify(full.current?.rendererParams ?? {})}
                    </span>
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

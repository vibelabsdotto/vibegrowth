import Link from "next/link"
import {
  getFormat,
  listAccounts,
  listBrands,
  listFormats,
  listImageErrors,
  listRules,
} from "@/core/catalog"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ctx } from "@/lib/server"
import { NewFormat } from "./new-format"

export const dynamic = "force-dynamic"
export const metadata = { title: "Formate" }

export default function FormatsPage() {
  const c = ctx()
  const formats = listFormats(c)
  const accounts = listAccounts(c)
  const brands = listBrands(c)

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
          const full = getFormat(c, f.id)
          const rules = listRules(c, {
            scopeType: "format",
            scopeId: f.id,
            status: "active",
            formatVersion: f.currentVersion,
          })
          const errors = listImageErrors(c, {
            formatId: f.id,
            status: "active",
          })
          const users = accounts.filter((a) => a.defaultFormatId === f.id)
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
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Accounts: {users.map((a) => a.name).join(", ") || "–"} ·
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

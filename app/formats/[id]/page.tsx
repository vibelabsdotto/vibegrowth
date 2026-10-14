import { notFound } from "next/navigation"
import {
  getFormat,
  listAccounts,
  listImageErrors,
  listRules,
} from "@/core/catalog"
import { VSError } from "@/core/util"
import { PageHeader } from "@/components/page-header"
import { RulesCard } from "@/components/rules-card"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { actorLabel, fmtDateTime } from "@/lib/labels"
import { ctx } from "@/lib/server"
import { ImageErrorsCard, NewVersion } from "./format-actions"

export const dynamic = "force-dynamic"

export default async function FormatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const c = ctx()
  let f
  try {
    f = getFormat(c, id)
  } catch (e) {
    if (e instanceof VSError && e.code === "NOT_FOUND") notFound()
    throw e
  }
  const rules = listRules(c, {
    scopeType: "format",
    scopeId: id,
    status: "active",
    formatVersion: f.currentVersion,
  })
  const allRules = listRules(c, { scopeType: "format", scopeId: id })
  const errors = listImageErrors(c, { formatId: id })
  const users = listAccounts(c).filter((a) => a.defaultFormatId === id)
  const cur = f.current

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title={f.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>Version {f.currentVersion}</Badge> Accounts:{" "}
            {users.map((a) => a.name).join(", ") || "–"}
          </span>
        }
        actions={
          <NewVersion
            id={f.id}
            current={{
              description: cur?.description ?? f.description ?? "",
              slideStructure: cur?.slideStructure ?? "",
              rendererParams: JSON.stringify(cur?.rendererParams ?? {}),
            }}
          />
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aktuelle Version</CardTitle>
            <CardDescription>
              {cur
                ? `${fmtDateTime(cur.createdAt)} · ${actorLabel(cur.actor)}`
                : "–"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Beschreibung</div>
              <p className="whitespace-pre-wrap">
                {cur?.description ?? f.description ?? "–"}
              </p>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Slide-Aufbau</div>
              <p className="whitespace-pre-wrap">
                {cur?.slideStructure ?? "–"}
              </p>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                Renderer-Parameter
              </div>
              <code className="font-mono text-xs">
                {JSON.stringify(cur?.rendererParams ?? {})}
              </code>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Versionen</CardTitle>
            <CardDescription>
              Alte Versionen bleiben lesbar, ihre Regeln auch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 text-sm">
              {[...f.versions].reverse().map((v) => (
                <li
                  key={v.id}
                  className="flex flex-col gap-0.5 border-l-2 pl-3"
                >
                  <span className="font-medium">
                    Version {v.version}{" "}
                    {v.version === f.currentVersion ? (
                      <Badge variant="secondary">aktuell</Badge>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">
                    {v.changeNote ?? "–"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDateTime(v.createdAt)} · {actorLabel(v.actor)} ·{" "}
                    {
                      allRules.filter((r) => r.formatVersion === v.version)
                        .length
                    }{" "}
                    Regeln ·{" "}
                    <span className="font-mono">
                      {JSON.stringify(v.rendererParams)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
      <RulesCard
        scopeType="format"
        scopeId={f.id}
        rules={rules}
        description={`Regeln der Version ${f.currentVersion}. Eine neue Version übernimmt sie.`}
      />
      <ImageErrorsCard formatId={f.id} errors={errors} />
    </div>
  )
}

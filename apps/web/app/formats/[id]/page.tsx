import Link from "next/link"
import { Markdown } from "@/components/markdown"
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
import { apiFetch } from "@/lib/api"
import { actorLabel, fmtDateTime, GUIDE_LABEL } from "@/lib/labels"
import { orNotFound } from "@/lib/server"
import type { FormatShow, RuleRow } from "@/lib/types"
import { CorrectFormat, ImageErrorsCard, NewVersion } from "./format-actions"

export const dynamic = "force-dynamic"

export default async function FormatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [f, allRules] = await Promise.all([
    orNotFound(apiFetch<FormatShow>(`/formats/${encodeURIComponent(id)}`)),
    apiFetch<RuleRow[]>("/rules", { query: { format: id, all: true } }),
  ])
  const rules = f.rules.filter((r) => r.status === "active")
  const errors = f.imageErrors
  const users = f.activeAccounts
  const cur = f.current
  const values = {
    description: cur?.description ?? f.description ?? "",
    guide: cur?.guide ?? "",
    rendererParams: JSON.stringify(cur?.rendererParams ?? {}),
    skills: (cur?.skills ?? []).join(", "),
    examples: (cur?.examples ?? []).join("\n"),
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <Link
        href="/strategies?category=shortform"
        prefetch={false}
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Alle Shortform-Strategien
      </Link>
      <PageHeader
        title={f.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>Version {f.currentVersion}</Badge> Aktiv bei:{" "}
            {users.length
              ? users.map((a, i) => (
                  <span key={a.id}>
                    <Link
                      href={`/accounts/${a.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.source === "plan" ? " (heute laut Plan)" : ""}
                    {i < users.length - 1 ? "," : ""}
                  </span>
                ))
              : "keinem Account"}
          </span>
        }
        actions={
          <>
            <CorrectFormat
              id={f.id}
              version={f.currentVersion}
              current={{ ...values, name: f.name }}
            />
            <NewVersion id={f.id} current={values} />
          </>
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
              <div className="text-xs text-muted-foreground">
                Werkzeug-Skills
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {cur?.skills.length
                  ? cur.skills.map((s) => (
                      <Badge key={s} variant="secondary" className="font-mono">
                        {s}
                      </Badge>
                    ))
                  : "–"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Beispielposts</div>
              {cur?.examples.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                  {cur.examples.map((e) => (
                    <li key={e} className="break-all">
                      {e}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>–</p>
              )}
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
      <Card>
        <CardHeader>
          <CardTitle>{GUIDE_LABEL}</CardTitle>
          <CardDescription>
            Version {f.currentVersion}
            {cur?.guide
              ? ` · ${cur.guide.length.toLocaleString("de-DE")} Zeichen`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cur?.guide ? (
            <Markdown>{cur.guide}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch kein Leitfaden.
            </p>
          )}
        </CardContent>
      </Card>
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

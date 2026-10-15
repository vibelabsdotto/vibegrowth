"use client"

import * as React from "react"
import { createRule, replaceRule, retireRule } from "@/app/actions"
import { FormDrawer } from "@/components/form-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "@/components/ui/toast"
import { actorLabel, fmtDate, options, RULE_KIND_LABEL } from "@/lib/labels"

export type RuleItem = {
  id: number
  kind: string
  text: string
  source: string
  actor: string
  date: string
  status: string
  formatVersion: number | null
}

export function RulesCard({
  title = "Regeln",
  description,
  scopeType,
  scopeId,
  rules,
}: {
  title?: string
  description?: string
  scopeType: "format" | "account" | "brand"
  scopeId: string
  rules: RuleItem[]
}) {
  const [replacing, setReplacing] = React.useState<RuleItem | null>(null)
  const kinds = options(RULE_KIND_LABEL)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description ??
            `${rules.length} aktive Regeln. Ersetzte Regeln bleiben im Verlauf.`}
        </CardDescription>
        <CardAction>
          <FormDrawer
            title="Regel hinzufügen"
            trigger={(open) => (
              <Button size="sm" variant="outline" onClick={open}>
                Regel hinzufügen
              </Button>
            )}
            initial={{ kind: "hook", text: "", source: "Max in VibeGrowth" }}
            fields={[
              { name: "kind", label: "Typ", type: "select", options: kinds },
              {
                name: "text",
                label: "Regel",
                type: "textarea",
                required: true,
              },
              {
                name: "source",
                label: "Quelle",
                required: true,
                description: "Wer, wo, wann",
              },
            ]}
            action={(v) => createRule({ ...v, scopeType, scopeId })}
            successMessage="Regel gespeichert"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Regeln.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3"
              >
                <Badge variant="outline" className="w-fit shrink-0">
                  {RULE_KIND_LABEL[r.kind] ?? r.kind}
                </Badge>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm whitespace-pre-wrap">{r.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(r.date)} · {actorLabel(r.actor)} · {r.source}
                    {r.formatVersion ? ` · Version ${r.formatVersion}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setReplacing(r)}
                  >
                    Ersetzen
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      const res = await retireRule(r.id)
                      toast.add(
                        res.ok
                          ? {
                              title: "Regel deaktiviert",
                              type: "success",
                              timeout: 3000,
                            }
                          : {
                              title: "Nicht deaktiviert",
                              description: res.error,
                              type: "error",
                            }
                      )
                    }}
                  >
                    Deaktivieren
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <FormDrawer
        title="Regel ersetzen"
        description="Die alte Regel bleibt als ersetzt lesbar."
        open={replacing !== null}
        onOpenChange={(o) => !o && setReplacing(null)}
        initial={{
          kind: replacing?.kind ?? "other",
          text: replacing?.text ?? "",
          source: "Max in VibeGrowth",
        }}
        fields={[
          { name: "kind", label: "Typ", type: "select", options: kinds },
          {
            name: "text",
            label: "Neue Regel",
            type: "textarea",
            required: true,
          },
          { name: "source", label: "Quelle", required: true },
        ]}
        action={(v) => replaceRule(replacing!.id, v)}
        successMessage="Regel ersetzt"
      />
    </Card>
  )
}

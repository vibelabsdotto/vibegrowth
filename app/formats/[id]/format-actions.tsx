"use client"

import {
  createImageError,
  newFormatVersion,
  setImageErrorStatus,
} from "@/app/actions"
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
import { actorLabel } from "@/lib/labels"

export function NewVersion({
  id,
  current,
}: {
  id: string
  current: {
    description: string
    slideStructure: string
    rendererParams: string
  }
}) {
  return (
    <FormDrawer
      title="Neue Formatversion"
      description="Für einen Pivot. Die alte Version bleibt lesbar, aktive Regeln werden übernommen."
      width="sm:w-[min(40rem,calc(100vw-3rem))]"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Neue Version
        </Button>
      )}
      initial={{ ...current, changeNote: "", carryRules: true }}
      fields={[
        {
          name: "changeNote",
          label: "Begründung",
          type: "textarea",
          required: true,
          rows: 3,
        },
        { name: "description", label: "Beschreibung", type: "textarea" },
        {
          name: "slideStructure",
          label: "Slide-Aufbau",
          type: "textarea",
          rows: 6,
        },
        { name: "rendererParams", label: "Renderer-Parameter (JSON)" },
        {
          name: "carryRules",
          label: "Aktive Regeln übernehmen",
          type: "switch",
        },
      ]}
      action={(v) => newFormatVersion(id, v)}
      successMessage="Neue Version angelegt"
    />
  )
}

type ImageError = {
  id: number
  title: string
  detection: string | null
  countermeasure: string
  source: string
  actor: string
  status: string
  formatIds: string[]
}

export function ImageErrorsCard({
  formatId,
  errors,
}: {
  formatId: string
  errors: ImageError[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bekannte Bildfehler</CardTitle>
        <CardDescription>
          Der Agent prüft jedes generierte Bild gegen diese Liste.
        </CardDescription>
        <CardAction>
          <FormDrawer
            title="Bildfehler hinzufügen"
            trigger={(open) => (
              <Button size="sm" variant="outline" onClick={open}>
                Bildfehler hinzufügen
              </Button>
            )}
            initial={{ formatIds: formatId, source: "Max in VibeShorts" }}
            fields={[
              {
                name: "title",
                label: "Fehlerbild",
                required: true,
                placeholder: "z. B. Zwiebeln sehen aus wie Mais",
              },
              {
                name: "detection",
                label: "Erkennung",
                type: "textarea",
                rows: 2,
              },
              {
                name: "countermeasure",
                label: "Gegenmaßnahme im Prompt",
                type: "textarea",
                required: true,
              },
              {
                name: "formatIds",
                label: "Formate",
                description: "Kommagetrennt, leer = alle Formate",
              },
              { name: "source", label: "Quelle", required: true },
            ]}
            action={createImageError}
            successMessage="Bildfehler gespeichert"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine bekannten Bildfehler.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {errors.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {e.title}
                    {e.status !== "active" ? (
                      <Badge variant="outline">erledigt</Badge>
                    ) : null}
                    {e.formatIds.length === 0 ? (
                      <Badge variant="secondary">alle Formate</Badge>
                    ) : null}
                  </span>
                  {e.detection ? (
                    <span className="text-sm text-muted-foreground">
                      Erkennung: {e.detection}
                    </span>
                  ) : null}
                  <span className="text-sm">
                    Gegenmaßnahme: {e.countermeasure}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {actorLabel(e.actor)} · {e.source}
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const res = await setImageErrorStatus(
                      e.id,
                      e.status === "active" ? "resolved" : "active"
                    )
                    if (!res.ok)
                      toast.add({
                        title: "Nicht gespeichert",
                        description: res.error,
                        type: "error",
                      })
                  }}
                >
                  {e.status === "active"
                    ? "Als erledigt markieren"
                    : "Wieder aktivieren"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

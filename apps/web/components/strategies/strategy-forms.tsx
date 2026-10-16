"use client"

import { Pencil, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  createStrategy,
  setStrategyStatus,
  updateStrategy,
} from "@/app/growth-actions"
import { FormDrawer, type FieldSpec } from "@/components/form-drawer"
import { STRATEGY_STATUS_LABEL } from "@/components/growth/format"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CATEGORY_LABEL } from "@/lib/categories"
import type { Strategy } from "@/lib/growth-types"

type Option = { value: string; label: string }

/** Strategies take web, app and general; shortform lives in formats. */
const CATEGORY_OPTIONS: Option[] = (["web", "app", "general"] as const).map(
  (c) => ({ value: c, label: CATEGORY_LABEL[c] })
)

const STATUS_OPTIONS: Option[] = Object.entries(STRATEGY_STATUS_LABEL).map(
  ([value, label]) => ({ value, label })
)

function fields(projects: Option[]): FieldSpec[] {
  return [
    { name: "name", label: "Name", required: true },
    {
      name: "category",
      label: "Bereich",
      type: "select",
      required: true,
      options: CATEGORY_OPTIONS,
      description:
        "Shortform-Strategien sind Formate. Die legst du im Abschnitt Shortform über „Format anlegen“ an.",
    },
    {
      name: "project",
      label: "Projekt",
      type: "select",
      options: [{ value: "", label: "Alle Projekte" }, ...projects],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: STATUS_OPTIONS,
    },
    {
      name: "summary",
      label: "Kurzbeschreibung",
      type: "textarea",
      rows: 3,
    },
    {
      name: "guide",
      label: "Leitfaden",
      type: "textarea",
      rows: 12,
      description: "Markdown: Vorgehen, Signale, Abnahme",
    },
    {
      name: "skills",
      label: "Skills",
      description: "Komma- oder zeilengetrennt, z. B. seo-audit, unslop",
    },
    {
      name: "source",
      label: "Quelle",
      placeholder: "z. B. Link oder Notiz, woher die Strategie stammt",
    },
  ]
}

/** "Strategie anlegen": project preset from the scope, category from the tab. */
export function NewStrategy({
  projects,
  project,
  category,
}: {
  projects: Option[]
  /** "" = Alle Projekte */
  project: string
  category: string
}) {
  const router = useRouter()
  return (
    <FormDrawer
      title="Strategie anlegen"
      description="Die ID entsteht aus dem Namen."
      trigger={(open) => (
        <Button onClick={open}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Strategie anlegen
        </Button>
      )}
      fields={fields(projects)}
      initial={{
        name: "",
        category: CATEGORY_OPTIONS.some((o) => o.value === category)
          ? category
          : "web",
        project,
        status: "active",
        summary: "",
        guide: "",
        skills: "",
        source: "",
      }}
      submitLabel="Anlegen"
      successMessage="Strategie angelegt"
      action={createStrategy}
      onSuccess={(d) => {
        const id = (d as Strategy | null)?.id
        if (id) router.push(`/strategies/${encodeURIComponent(id)}`)
      }}
    />
  )
}

export function EditStrategy({
  strategy,
  projects,
}: {
  strategy: Strategy
  projects: Option[]
}) {
  const router = useRouter()
  return (
    <FormDrawer
      title="Strategie bearbeiten"
      description={`ID ${strategy.id}`}
      trigger={(open) => (
        <Button variant="outline" onClick={open}>
          <Pencil data-icon="inline-start" aria-hidden="true" />
          Bearbeiten
        </Button>
      )}
      fields={fields(projects)}
      initial={{
        name: strategy.name,
        category: strategy.category,
        project: strategy.projectId ?? "",
        status: strategy.status,
        summary: strategy.summary ?? "",
        guide: strategy.guide ?? "",
        skills: strategy.skills.join(", "),
        source: strategy.source ?? "",
      }}
      successMessage="Strategie gespeichert"
      action={(v) => updateStrategy(strategy.id, v)}
      onSuccess={() => router.refresh()}
    />
  )
}

/** Status switch that saves on change. */
export function StrategyStatusToggle({
  id,
  status,
}: {
  id: string
  status: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // Shown value while saving; null = server value.
  const [draft, setDraft] = useState<string | null>(null)
  // The refreshed server value caught up: drop the draft so later changes show.
  if (draft !== null && draft === status && !pending) setDraft(null)
  const shown = draft ?? status

  const change = (next: string) => {
    if (!next || next === shown) return
    setDraft(next)
    start(async () => {
      const res = await setStrategyStatus(id, next).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }))
      if (!res.ok) {
        setDraft(null)
        toast.add({
          title: "Status nicht gespeichert",
          description: res.error,
          type: "error",
          timeout: 0,
        })
        return
      }
      toast.add({
        title: `Status: ${STRATEGY_STATUS_LABEL[next] ?? next}`,
        type: "success",
        timeout: 4000,
      })
      start(() => router.refresh())
    })
  }

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Status"
      aria-busy={pending}
      disabled={pending}
      value={[shown]}
      onValueChange={(v: string[]) => change(v[0])}
    >
      {STATUS_OPTIONS.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="text-muted-foreground aria-pressed:text-foreground"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

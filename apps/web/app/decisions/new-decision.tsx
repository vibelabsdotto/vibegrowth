"use client"

import { Plus } from "lucide-react"
import { createDecision } from "@/app/actions"
import { FormDrawer } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"

type Opt = { value: string; label: string }

/**
 * Decisions in VibeGrowth always belong to a project or one of its accounts (contract §7.9),
 * so the form offers no "alle" scope. `targets` values are "brand:<id>" or "account:<id>".
 */
export function NewProjectDecision({
  targets,
  initialTarget,
}: {
  targets: Opt[]
  initialTarget?: string
}) {
  return (
    <FormDrawer
      title="Entscheidung festhalten"
      description="Gilt für ein Projekt oder einen Account darin. Pivots sind Entscheidungen, Begründung ist Pflicht."
      trigger={(open) => (
        <Button size="sm" onClick={open} disabled={!targets.length}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Entscheidung
        </Button>
      )}
      initial={{
        target: initialTarget ?? targets[0]?.value ?? "",
        pivot: false,
      }}
      fields={[
        {
          name: "target",
          label: "Gilt für",
          type: "select",
          required: true,
          options: targets,
        },
        { name: "title", label: "Titel", required: true },
        {
          name: "rationale",
          label: "Begründung",
          type: "textarea",
          required: true,
          rows: 5,
        },
        { name: "pivot", label: "Pivot", type: "switch" },
        { name: "date", label: "Datum", type: "date" },
        { name: "source", label: "Quelle" },
      ]}
      action={(v) => {
        const [scopeType, ...rest] = String(v.target ?? "").split(":")
        const scopeId = rest.join(":")
        if ((scopeType !== "brand" && scopeType !== "account") || !scopeId)
          return Promise.resolve({
            ok: false as const,
            error: "Projekt oder Account wählen.",
          })
        return createDecision({ ...v, scopeType, scopeId })
      }}
      successMessage="Entscheidung gespeichert"
    />
  )
}

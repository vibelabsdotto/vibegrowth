"use client"

import { Plus } from "lucide-react"
import { addChange } from "@/app/growth-actions"
import { FormDrawer } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"
import { CHANGE_KIND_LABEL, localToday } from "./format"

/** Log a change (deploy, content, store …) so charts can mark it. */
export function AddChange({
  projects,
  project,
  experiments = [],
}: {
  projects: { id: string; name: string }[]
  project: string
  experiments?: { id: number; title: string }[]
}) {
  return (
    <FormDrawer
      title="Änderung eintragen"
      description="Erscheint als Markierung in den Diagrammen."
      fields={[
        {
          name: "project",
          label: "Projekt",
          type: "select",
          required: true,
          options: projects.map((p) => ({ value: p.id, label: p.name })),
        },
        { name: "date", label: "Datum", type: "date", required: true },
        {
          name: "kind",
          label: "Art",
          type: "select",
          options: Object.entries(CHANGE_KIND_LABEL).map(([value, l]) => ({
            value,
            label: l,
          })),
        },
        {
          name: "summary",
          label: "Was wurde geändert?",
          type: "textarea",
          rows: 3,
          required: true,
        },
        {
          name: "ref",
          label: "Verweis",
          placeholder: "Commit, PR oder URL",
        },
        ...(experiments.length
          ? [
              {
                name: "experimentId",
                label: "Experiment",
                type: "select" as const,
                options: [
                  { value: "", label: "keins" },
                  ...experiments.map((e) => ({
                    value: String(e.id),
                    label: e.title,
                  })),
                ],
              },
            ]
          : []),
      ]}
      initial={{
        project: project || projects[0]?.id || "",
        date: localToday(),
        kind: "deploy",
      }}
      submitLabel="Eintragen"
      successMessage="Änderung eingetragen"
      action={addChange}
      trigger={(show) => (
        <Button type="button" variant="outline" onClick={show}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Änderung
        </Button>
      )}
    />
  )
}

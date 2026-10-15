"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { createFormat } from "@/app/actions"
import { FormDrawer } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"
import { GUIDE_LABEL } from "@/lib/labels"

export function NewFormat({
  brands,
  brand,
}: {
  brands: { value: string; label: string }[]
  /** Project from the sidebar switcher, preselected. */
  brand?: string
}) {
  const router = useRouter()
  return (
    <FormDrawer
      title="Format anlegen"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Format anlegen
        </Button>
      )}
      initial={{ brandId: brand ?? "", rendererParams: '{"style":"native"}' }}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "id", label: "ID", placeholder: "leer = aus dem Namen" },
        {
          name: "brandId",
          label: "Projekt",
          type: "select",
          options: [{ value: "", label: "geteilt (alle Projekte)" }, ...brands],
        },
        { name: "description", label: "Beschreibung", type: "textarea" },
        {
          name: "guide",
          label: GUIDE_LABEL,
          type: "textarea",
          rows: 10,
          description: "Markdown",
        },
        {
          name: "skills",
          label: "Werkzeug-Skills",
          description: "Kommagetrennt, z. B. pinterest, bg-removal",
        },
        {
          name: "rendererParams",
          label: "Renderer-Parameter (JSON)",
          description: 'z. B. {"style":"native","text_scale":1.2}',
        },
      ]}
      action={createFormat}
      successMessage="Format angelegt"
      onSuccess={(d) => {
        const id = (d as { id?: string } | null)?.id
        if (id) router.push(`/formats/${id}`)
      }}
    />
  )
}

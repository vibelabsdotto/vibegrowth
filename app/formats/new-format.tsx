"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { createFormat } from "@/app/actions"
import { FormDrawer } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"

export function NewFormat({
  brands,
}: {
  brands: { value: string; label: string }[]
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
      initial={{ brandId: "", rendererParams: '{"style":"native"}' }}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "id", label: "ID", placeholder: "leer = aus dem Namen" },
        {
          name: "brandId",
          label: "Brand",
          type: "select",
          options: [{ value: "", label: "alle" }, ...brands],
        },
        { name: "description", label: "Beschreibung", type: "textarea" },
        {
          name: "slideStructure",
          label: "Slide-Aufbau",
          type: "textarea",
          rows: 6,
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

"use client"

import { FolderOpen } from "lucide-react"
import * as React from "react"
import { openFolder } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

export function OpenFolderButton({
  kind,
  id,
  label = "Im Finder öffnen",
}: {
  kind: "post" | "account" | "inspo"
  id: string | number
  label?: string
}) {
  const [pending, setPending] = React.useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        const res = await openFolder(kind, String(id))
        setPending(false)
        if (!res.ok)
          toast.add({
            title: "Ordner nicht geöffnet",
            description: res.error,
            type: "error",
          })
      }}
    >
      <FolderOpen data-icon="inline-start" aria-hidden="true" />
      {label}
    </Button>
  )
}

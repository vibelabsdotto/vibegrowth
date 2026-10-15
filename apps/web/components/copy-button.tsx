"use client"

import { Check, Copy } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"

export function CopyButton({
  text,
  label = "Kopieren",
}: {
  text: string
  label?: string
}) {
  const [done, setDone] = React.useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? (
        <Check data-icon="inline-start" aria-hidden="true" />
      ) : (
        <Copy data-icon="inline-start" aria-hidden="true" />
      )}
      {done ? "Kopiert" : label}
    </Button>
  )
}

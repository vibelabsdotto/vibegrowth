"use client"

import * as React from "react"
import { updateMention } from "@/app/growth-actions"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { toast } from "@/components/ui/toast"
import { MENTION_STATUS_LABEL } from "./format"

/** Status select for one mention target; saves on change, keeps the error visible. */
export function MentionStatus({
  id,
  domain,
  status,
}: {
  id: number
  domain: string
  status: string
}) {
  const [draft, setDraft] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const shown = draft ?? status

  async function change(next: string) {
    setDraft(next)
    setPending(true)
    setError(null)
    const res = await updateMention(id, { status: next }).catch(
      (e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      })
    )
    setPending(false)
    if (!res.ok) {
      setDraft(null)
      setError(res.error)
      return
    }
    setDraft(null)
    toast.add({
      title: `${domain}: ${MENTION_STATUS_LABEL[next] ?? next}`,
      type: "success",
      timeout: 3000,
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        size="sm"
        aria-label={`Status für ${domain}`}
        value={shown}
        disabled={pending}
        onChange={(e) => void change(e.target.value)}
      >
        {Object.entries(MENTION_STATUS_LABEL).map(([value, l]) => (
          <NativeSelectOption key={value} value={value}>
            {l}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

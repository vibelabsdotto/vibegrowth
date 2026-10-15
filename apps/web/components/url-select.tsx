"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

/** A select that writes its value into one URL search param (filters on server-rendered lists). */
export function UrlSelect({
  param,
  value,
  options,
  label,
  allLabel,
}: {
  param: string
  value: string
  options: { value: string; label: string }[]
  label: string
  allLabel: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  return (
    <NativeSelect
      size="sm"
      aria-label={label}
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString())
        if (e.target.value) params.set(param, e.target.value)
        else params.delete(param)
        router.push(`${pathname}?${params.toString()}`)
      }}
    >
      <NativeSelectOption value="">{allLabel}</NativeSelectOption>
      {options.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

"use client"

import { usePathname, useRouter } from "next/navigation"
import { useTransition } from "react"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

type Params = Record<string, string | undefined>

function href(pathname: string, params: Params, key: string, value: string) {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) next.set(k, v)
  if (value) next.set(key, value)
  else next.delete(key)
  const qs = next.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** Select bound to one search param. `params` is the current query from the server page. */
export function UrlFilter({
  param,
  value,
  params,
  options,
  label,
  allLabel,
}: {
  param: string
  value: string
  params: Params
  options: { value: string; label: string }[]
  label: string
  allLabel?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  return (
    <NativeSelect
      size="sm"
      aria-label={label}
      value={value}
      aria-busy={pending}
      onChange={(e) =>
        start(() =>
          router.push(href(pathname, params, param, e.target.value), {
            scroll: false,
          })
        )
      }
    >
      {allLabel !== undefined ? (
        <NativeSelectOption value="">{allLabel}</NativeSelectOption>
      ) : null}
      {options.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

/** Segmented control bound to one search param (2–5 options). */
export function UrlToggle({
  param,
  value,
  params,
  options,
  label,
}: {
  param: string
  value: string
  params: Params
  options: { value: string; label: string }[]
  label: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={label}
      aria-busy={pending}
      value={[value]}
      onValueChange={(v: string[]) => {
        const next = v[0]
        if (!next || next === value) return
        start(() =>
          router.replace(href(pathname, params, param, next), {
            scroll: false,
          })
        )
      }}
    >
      {options.map((o) => (
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

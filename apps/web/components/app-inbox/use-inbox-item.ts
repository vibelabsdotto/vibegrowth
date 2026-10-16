"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import type { InboxItem } from "@/lib/growth-types"

export const ITEM_PARAM = "item"

/** DOM id of a list row, used to return focus when the sheet closes. */
export const inboxRowId = (itemId: string) => `inbox-${itemId}`

/**
 * Open inbox item in ?item=<itemId>, set with history.replaceState (no server round
 * trip), so the sheet is deep-linkable. `items` holds every loaded item, not only the
 * filtered rows: an item that leaves the filter after an action stays open.
 */
export function useInboxItem<T extends InboxItem>(
  items: T[],
  param: string = ITEM_PARAM
) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const openId = searchParams.get(param)
  const current = openId
    ? (items.find((i) => i.itemId === openId) ?? null)
    : null

  // Keep the last item rendered while the sheet animates out.
  const [shown, setShown] = React.useState<T | null>(current)
  if (current && current !== shown) setShown(current)

  const setItem = (id: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (id) next.set(param, id)
    else next.delete(param)
    const qs = next.toString()
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
  }

  return {
    item: current ?? shown,
    open: current !== null,
    setItem,
    onClosed: () => setShown(null),
  }
}

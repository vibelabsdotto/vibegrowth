import "server-only"
import { getCtx } from "@/core/db"

/** Shared server-side context for pages and actions. Same database the CLI writes to. */
export function ctx() {
  return getCtx()
}

/** The web app is Max's surface; every write from the browser is attributed to him. */
export const WEB_ACTOR = "max"

export function mediaUrl(rel: string | null | undefined) {
  return rel ? `/media?path=${encodeURIComponent(rel)}` : null
}

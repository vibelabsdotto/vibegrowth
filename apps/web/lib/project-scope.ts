import "server-only"
import { cookies } from "next/headers"

import { PROJECT_COOKIE } from "./project-scope-cookie"

export { PROJECT_COOKIE, PROJECT_COOKIE_MAX_AGE } from "./project-scope-cookie"

/**
 * The project the pages are scoped to ("" = alle Projekte). Single source of truth for
 * project filters: pages read this instead of a ?project= query parameter.
 */
export async function selectedProject(): Promise<string> {
  const store = await cookies()
  return store.get(PROJECT_COOKIE)?.value ?? ""
}

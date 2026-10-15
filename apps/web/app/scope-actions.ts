"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import {
  PROJECT_COOKIE,
  PROJECT_COOKIE_MAX_AGE,
} from "@/lib/project-scope-cookie"

/** Set the project the app is scoped to; "" = alle Projekte. */
export async function selectProject(id: string) {
  const store = await cookies()
  if (id)
    store.set(PROJECT_COOKIE, id, {
      path: "/",
      sameSite: "lax",
      maxAge: PROJECT_COOKIE_MAX_AGE,
    })
  else store.delete(PROJECT_COOKIE)
  revalidatePath("/", "layout")
}

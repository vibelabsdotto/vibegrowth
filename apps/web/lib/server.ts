import "server-only"
import { notFound } from "next/navigation"
import { ApiError, apiFetch } from "@/lib/api"
import type { ProjectRow } from "@/lib/types"

/** Rethrow everything except a 404 from the API, which becomes the Next not-found page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound()
    throw e
  }
}

/** Projects (brands in the shorts module), sorted by name like listBrands. */
export async function listBrands() {
  const rows = await apiFetch<ProjectRow[]>("/projects")
  return [...rows].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
}

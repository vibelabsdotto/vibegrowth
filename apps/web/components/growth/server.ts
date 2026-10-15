import "server-only"
import { ApiError, apiFetch } from "@/lib/api"
import type { Project } from "@/lib/growth-types"
import { selectedProject } from "@/lib/project-scope"

type Query = Record<string, string | number | boolean | null | undefined>

export type Loaded<T> = { data: T; error: null } | { data: null; error: string }

/** GET from apps/api without throwing; pages show the error next to the section that needs it. */
export async function load<T>(path: string, query?: Query): Promise<Loaded<T>> {
  try {
    return { data: await apiFetch<T>(path, { query }), error: null }
  } catch (e) {
    return { data: null, error: errorText(e) }
  }
}

export function errorText(e: unknown) {
  if (e instanceof ApiError) return `${e.message} (${e.code})`
  const cause = (e as { cause?: { code?: string } })?.cause?.code
  if (cause === "ECONNREFUSED") return "API nicht erreichbar"
  return e instanceof Error ? e.message : String(e)
}

/** Lists may come bare or wrapped ({items|rows|…: […]}). */
export function list<T>(v: unknown, ...keys: string[]): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v && typeof v === "object") {
    for (const k of [...keys, "items", "rows", "data"]) {
      const x = (v as Record<string, unknown>)[k]
      if (Array.isArray(x)) return x as T[]
    }
  }
  return []
}

export type Scope = {
  /** Result of GET /projects, for the error state. */
  projectsRes: Loaded<Project[]>
  /** Active (not archived) projects, the choices of the sidebar switcher. */
  projects: Project[]
  /** Project chosen in the switcher, "" = alle Projekte. Unknown or archived ids count as alle. */
  project: string
  /** Display name of the scope ("Alle Projekte" when none is chosen). */
  name: string
}

/** Project scope of a page: the switcher cookie, validated against the project list. */
export async function projectScope(): Promise<Scope> {
  const [projectsRes, chosen] = await Promise.all([
    load<Project[]>("/projects"),
    selectedProject(),
  ])
  const projects = (projectsRes.data ?? []).filter(
    (p) => p.status !== "archived"
  )
  const current = projects.find((p) => p.id === chosen)
  return {
    projectsRes,
    projects,
    project: current?.id ?? "",
    name: current?.name ?? "Alle Projekte",
  }
}

/** Request time for "vor X Std." labels; server components render once per request. */
export function requestTime() {
  return Date.now()
}

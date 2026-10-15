import "server-only"
import { notFound } from "next/navigation"
import { ApiError, apiFetch } from "@/lib/api"
import { selectedProject } from "@/lib/project-scope"
import type { AccountRow, FormatRow, ProjectRow } from "@/lib/types"

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

export type ProjectScope = {
  /** All projects, sorted by name (options for brand selects). */
  projects: ProjectRow[]
  /** Project from the sidebar switcher; null = alle Projekte (also for unknown or archived ids, like the switcher). */
  project: ProjectRow | null
}

/** The switcher's project, validated against the project list. */
export async function projectScope(): Promise<ProjectScope> {
  const [projects, chosen] = await Promise.all([
    listBrands(),
    selectedProject(),
  ])
  const project =
    projects.find((p) => p.id === chosen && p.status !== "archived") ?? null
  return { projects, project }
}

/** Formats of a project: its own, shared ones (no brand) and every format its accounts run. */
export function formatsInScope(
  formats: FormatRow[],
  project: ProjectRow | null,
  accounts: AccountRow[]
) {
  if (!project) return formats
  const used = new Set(
    accounts
      .filter((a) => a.brandId === project.id)
      .map((a) => a.defaultFormatId)
  )
  return formats.filter(
    (f) => f.brandId === project.id || !f.brandId || used.has(f.id)
  )
}

type Scoped = { scopeType: string; scopeId: string | null }

/**
 * Learnings and decisions for a project: its brand scope, its accounts, formats its accounts
 * run or that belong to it, plus global and growth (both apply to every project).
 */
export function knowledgeInScope<T extends Scoped>(
  items: T[],
  project: ProjectRow | null,
  accounts: AccountRow[],
  formats: FormatRow[]
) {
  if (!project) return items
  const own = accounts.filter((a) => a.brandId === project.id)
  const accountIds = new Set(own.map((a) => a.id))
  const formatIds = new Set(
    formats
      .filter(
        (f) =>
          f.brandId === project.id ||
          own.some((a) => a.defaultFormatId === f.id)
      )
      .map((f) => f.id)
  )
  return items.filter((i) =>
    isCrossProject(i)
      ? true
      : i.scopeType === "brand"
        ? i.scopeId === project.id
        : i.scopeType === "account"
          ? accountIds.has(i.scopeId ?? "")
          : i.scopeType === "format"
            ? formatIds.has(i.scopeId ?? "")
            : false
  )
}

/** global and growth apply to all projects; everything else belongs to one. */
export function isCrossProject(i: Scoped) {
  return i.scopeType === "global" || i.scopeType === "growth"
}

/** Label for a learning/decision scope. `withProject` adds the account's project (view "Alle Projekte"). */
export function scopeLabeler(
  accounts: AccountRow[],
  projects: ProjectRow[],
  formats: FormatRow[],
  withProject: boolean
) {
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? id ?? "–"
  return (t: string, id: string | null) => {
    if (t === "global") return "Global (alles)"
    if (t === "growth") return "Growth (alle Projekte)"
    if (t === "brand") return `Projekt ${projectName(id)}`
    if (t === "account") {
      const a = accounts.find((x) => x.id === id)
      const name = a?.name ?? id
      return withProject && a
        ? `Account ${name} · ${projectName(a.brandId)}`
        : `Account ${name}`
    }
    if (t === "format") {
      const f = formats.find((x) => x.id === id)
      return `Format ${f?.name ?? id}`
    }
    return `${t} ${id ?? ""}`.trim()
  }
}

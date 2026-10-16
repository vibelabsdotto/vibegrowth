/** Bereiche (contract §7.9). Pure, usable on server and client. */

export const CATEGORIES = ["web", "shortform", "app", "general"] as const

export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  web: "Web",
  shortform: "Shortform",
  app: "App",
  general: "Allgemein",
}

/** Order of the filter tabs: Alle, Web, Shortform, App, Allgemein. */
export const CATEGORY_TABS: { value: Category | ""; label: string }[] = [
  { value: "", label: "Alle" },
  ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
]

/** ?category= from the URL; anything unknown counts as "alle" (""). */
export function parseCategory(v: string | string[] | undefined): Category | "" {
  const s = Array.isArray(v) ? v[0] : v
  return (CATEGORIES as readonly string[]).includes(s ?? "")
    ? (s as Category)
    : ""
}

export function categoryLabel(c: string | null | undefined) {
  if (!c) return "–"
  return CATEGORY_LABEL[c as Category] ?? c
}

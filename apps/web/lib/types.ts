import type {
  accounts,
  formats,
  inspirations,
  planEntries,
  posts,
} from "@/core/schema"

export type PlanEntryRow = typeof planEntries.$inferSelect
export type AccountRow = typeof accounts.$inferSelect
export type FormatRow = typeof formats.$inferSelect
export type InspirationRow = typeof inspirations.$inferSelect
export type PostRow = Omit<typeof posts.$inferSelect, "slides"> & {
  slides: string[]
}

export type CalendarPost = {
  id: number
  accountId: string
  date: string
  hook: string | null
  slug: string
  status: string
}

export type Lite = { id: string; name: string }
export type InspoLite = { id: number; label: string }

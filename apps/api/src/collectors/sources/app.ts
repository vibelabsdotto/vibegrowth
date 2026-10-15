/**
 * Collector `app`: activation funnel from a Firebase-linked GA4 property, port of app_funnel.py
 * (`collect`, `setup`). Uses the growth OAuth token (google_auth.py).
 *
 * KPI (dims ''): active_users, new_users, active_d7 (active7DayUsers), active_d28
 * (active28DayUsers), event:<name> per funnel event; retention_d1/_d7/_d28 (share 0–1, dated on the
 * cohort start, only once day N lies in the past for the whole weekly cohort) and cohort_users.
 * Breakdowns: {"platform"} for active_users, new_users, event:<name>.
 * Window like app_funnel.py: start = today - days, end = yesterday.
 */
import { googleApi } from "./google-auth.js"
import {
  addDays,
  CollectorError,
  dimsKey,
  errorMessage,
  finish,
  resolveToday,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type FetchFn,
  type KpiRow,
  type SourceCollector,
} from "./types.js"

export interface AppConfig {
  ga4Property?: string | null
  firebaseProject?: string | null
  funnelEvents?: string[]
  keyEvents?: string[]
  eventDimensions?: string[]
  userDimensions?: string[]
}

export const id = "app"
export const label = "App-Analytics (Firebase/GA4 App)"
export const channelKinds: ChannelKind[] = ["ios", "android"]
export const configSchema: ConfigSchema = {
  ga4Property: {
    description:
      "GA4-Property der Firebase-App (properties/…); leer, solange keine lesbare Property verknüpft ist",
    required: true,
    type: "string",
  },
  firebaseProject: {
    description:
      "Firebase-Projekt-ID (Doku: welches Projekt zu verknüpfen ist)",
    required: false,
    type: "string",
  },
  funnelEvents: {
    description: "App-Events, die pro Tag und Plattform gespeichert werden",
    required: false,
    type: "string[]",
    example: ["first_open", "first_entry_created"],
  },
  keyEvents: {
    description: "Schlüssel-Events, die `collectors setup app` anlegt",
    required: false,
    type: "string[]",
  },
  eventDimensions: {
    description:
      "Event-Parameter, die `collectors setup app` als Custom Dimension (EVENT) anlegt",
    required: false,
    type: "string[]",
  },
  userDimensions: {
    description:
      "Nutzer-Eigenschaften, die `collectors setup app` als Custom Dimension (USER) anlegt",
    required: false,
    type: "string[]",
  },
}

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta"
const DATA = "https://analyticsdata.googleapis.com/v1beta"
export const RETENTION_WEEKS = 8
export const RETENTION_DAYS = [1, 7, 28] as const

interface GaRow {
  dimensionValues: Array<{ value: string }>
  metricValues: Array<{ value: string }>
}

const gaDate = (d: string) =>
  `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`

const weekday = (date: string) => {
  // Monday = 0 like Python's date.weekday()
  const [y, m, d] = date.split("-").map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** ISO year and week of a date. */
function isoWeek(date: string): [number, number] {
  const thursday = addDays(date, 3 - weekday(date))
  const year = Number(thursday.slice(0, 4))
  const jan4 = `${year}-01-04`
  const week1Monday = addDays(jan4, -weekday(jan4))
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${week1Monday}T00:00:00Z`)) /
      86_400_000
  )
  return [year, Math.floor(days / 7) + 1]
}

/** Complete ISO weeks (Mon–Sun) before the current one, oldest first (app_funnel.py `retention_cohorts`). */
export function retentionCohorts(today: string, weeks = RETENTION_WEEKS) {
  const monday = addDays(today, -weekday(today))
  const out: { name: string; start: string; end: string }[] = []
  for (let i = weeks; i > 0; i--) {
    const start = addDays(monday, -7 * i)
    const [y, w] = isoWeek(start)
    out.push({
      name: `${y}-W${String(w).padStart(2, "0")}`,
      start,
      end: addDays(start, 6),
    })
  }
  return out
}

/** "properties/123" from "123" or "properties/123"; null when empty. */
export function normaliseProperty(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null
  return `properties/${v.trim().replace(/^properties\//, "")}`
}

function missingProperty(config: AppConfig) {
  const fb = config.firebaseProject
    ? ` (Firebase-Projekt ${config.firebaseProject})`
    : ""
  return `App: keine GA4-Property konfiguriert – die Firebase-App${fb} ist noch mit keiner lesbaren GA4-Property verknüpft. Property eintragen: collectors set app --project <id> --config '{"ga4Property":"properties/…"}'`
}

export async function collectApp(
  config: AppConfig,
  ctx: CollectorContext
): Promise<CollectorResult> {
  const today = resolveToday(ctx)
  const days = Math.max(1, Math.floor(ctx.days || 1))
  const start = addDays(today, -days)
  const end = addDays(today, -1)
  const stats: Record<string, unknown> = { range: [start, end] }
  const prop = normaliseProperty(config.ga4Property)
  if (!prop) {
    const msg = missingProperty(config)
    return finish({ kpi: [], summary: msg, stats, errors: [msg] })
  }
  stats.property = prop
  const kpi: KpiRow[] = []
  const errors: string[] = []
  const report = async (body: Record<string, unknown>) =>
    (
      await googleApi<{ rows?: GaRow[] }>(
        "POST",
        `${DATA}/${prop}:runReport`,
        { limit: 100000, ...body },
        ctx
      )
    ).rows ?? []
  const dateRanges = [{ startDate: start, endDate: end }]
  const push = (date: string, metric: string, value: number, dims = "") =>
    kpi.push({ source: "app", date, metric, dims, value })

  // Daily totals (users de-duplicated across platforms) and rolling active users.
  try {
    const rows = await report({
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "active7DayUsers" },
        { name: "active28DayUsers" },
      ],
    })
    const names = ["active_users", "new_users", "active_d7", "active_d28"]
    for (const r of rows)
      r.metricValues.forEach((m, i) =>
        push(gaDate(r.dimensionValues[0].value), names[i], Number(m.value))
      )
    stats.days = rows.length
  } catch (e) {
    errors.push(`app totals: ${errorMessage(e)}`)
    if (/Zugang/.test(errorMessage(e)))
      return finish({ kpi, summary: `App: ${errors[0]}`, stats, errors })
  }

  // Per platform (app_funnel.py app_daily).
  let activeUserDays = 0
  let newUsers = 0
  try {
    const rows = await report({
      dateRanges,
      dimensions: [{ name: "date" }, { name: "platform" }],
      metrics: [{ name: "activeUsers" }, { name: "newUsers" }],
    })
    for (const r of rows) {
      const [d, platform] = r.dimensionValues.map((x) => x.value)
      const dims = dimsKey({ platform })
      const [a, n] = r.metricValues.map((m) => Number(m.value))
      push(gaDate(d), "active_users", a, dims)
      push(gaDate(d), "new_users", n, dims)
      activeUserDays += a
      newUsers += n
    }
  } catch (e) {
    errors.push(`app platform: ${errorMessage(e)}`)
  }

  // Funnel events per day and platform (app_funnel.py app_events).
  const events = (config.funnelEvents ?? []).filter(
    (e): e is string => typeof e === "string" && !!e.trim()
  )
  const totals: Record<string, number> = {}
  if (events.length) {
    try {
      const rows = await report({
        dateRanges,
        dimensions: [
          { name: "date" },
          { name: "platform" },
          { name: "eventName" },
        ],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: {
          filter: { fieldName: "eventName", inListFilter: { values: events } },
        },
      })
      const daily = new Map<string, number>()
      for (const r of rows) {
        const [d, platform, ev] = r.dimensionValues.map((x) => x.value)
        const count = Number(r.metricValues[0].value)
        push(gaDate(d), `event:${ev}`, count, dimsKey({ platform }))
        const key = `${gaDate(d)}\u0000${ev}`
        daily.set(key, (daily.get(key) ?? 0) + count)
        totals[ev] = (totals[ev] ?? 0) + count
      }
      for (const [key, v] of daily) {
        const [d, ev] = key.split("\u0000")
        push(d, `event:${ev}`, v)
      }
    } catch (e) {
      errors.push(`app events: ${errorMessage(e)}`)
    }
  }

  // N-day retention of weekly install cohorts (app_funnel.py): immature weeks stay empty.
  const cohorts = retentionCohorts(today)
  const retention: Record<string, unknown> = {}
  try {
    const rows = await report({
      dimensions: [{ name: "cohort" }, { name: "cohortNthDay" }],
      metrics: [{ name: "cohortActiveUsers" }, { name: "cohortTotalUsers" }],
      cohortSpec: {
        cohorts: cohorts.map((c) => ({
          name: c.name,
          dimension: "firstSessionDate",
          dateRange: { startDate: c.start, endDate: c.end },
        })),
        cohortsRange: {
          granularity: "DAILY",
          startOffset: 0,
          endOffset: Math.max(...RETENTION_DAYS),
        },
      },
    })
    const active = new Map<string, number>()
    const total = new Map<string, number>()
    for (const r of rows) {
      const [c, nth] = r.dimensionValues.map((x) => x.value)
      const [a, t] = r.metricValues.map((m) => Number(m.value))
      active.set(`${c}\u0000${Number(nth)}`, a)
      total.set(c, Math.max(total.get(c) ?? 0, t))
    }
    for (const c of cohorts) {
      const users = total.get(c.name) ?? 0
      const rates: Record<string, number | null> = {}
      for (const n of RETENTION_DAYS) {
        const mature = addDays(c.end, n) < today
        rates[`d${n}`] =
          users && mature
            ? Math.round(
                ((active.get(`${c.name}\u0000${n}`) ?? 0) / users) * 10000
              ) / 10000
            : null
        if (rates[`d${n}`] !== null)
          push(c.start, `retention_d${n}`, rates[`d${n}`]!)
      }
      if (users) push(c.start, "cohort_users", users)
      retention[c.name] = { users, ...rates }
    }
  } catch (e) {
    errors.push(`app retention: ${errorMessage(e)}`)
  }

  Object.assign(stats, {
    events: totals,
    active_user_days: activeUserDays,
    new_users: newUsers,
    retention,
  })
  const summary = errors.length
    ? `App ${start}–${end}: ${errors.length} Fehler (${errors.join("; ").slice(0, 200)})`
    : `App ${start}–${end}: ${newUsers} neue Nutzer, ${activeUserDays} Nutzer-Tage, ${Object.keys(totals).length} Funnel-Events`
  return finish({
    kpi,
    window: { from: start, to: end },
    summary,
    stats,
    errors,
  })
}

export interface AppSetupResult {
  property: string
  dryRun: boolean
  created: string[]
  existingKeyEvents: string[]
}

/** app_funnel.py `setup`: idempotently create key events and custom dimensions from the config. */
export async function appSetup(
  config: AppConfig,
  ctx: { secretsDir: string; fetch?: FetchFn },
  dryRun = false
): Promise<AppSetupResult> {
  const prop = normaliseProperty(config.ga4Property)
  if (!prop) throw new CollectorError("INVALID", missingProperty(config))
  const keys = await googleApi<{ keyEvents?: { eventName: string }[] }>(
    "GET",
    `${ADMIN}/${prop}/keyEvents?pageSize=200`,
    null,
    ctx
  )
  const dims = await googleApi<{
    customDimensions?: { parameterName: string; scope: string }[]
  }>("GET", `${ADMIN}/${prop}/customDimensions?pageSize=200`, null, ctx)
  const haveKeys = new Set((keys.keyEvents ?? []).map((k) => k.eventName))
  const haveDims = new Set(
    (dims.customDimensions ?? []).map(
      (d) => `${d.parameterName}\u0000${d.scope}`
    )
  )
  const created: string[] = []
  for (const ev of config.keyEvents ?? []) {
    if (haveKeys.has(ev)) continue
    if (!dryRun)
      await googleApi(
        "POST",
        `${ADMIN}/${prop}/keyEvents`,
        {
          eventName: ev,
          countingMethod: "ONCE_PER_EVENT",
        },
        ctx
      )
    created.push(`key_event:${ev}`)
  }
  for (const [scope, list] of [
    ["EVENT", config.eventDimensions ?? []],
    ["USER", config.userDimensions ?? []],
  ] as const) {
    for (const p of list) {
      if (haveDims.has(`${p}\u0000${scope}`)) continue
      if (!dryRun)
        await googleApi(
          "POST",
          `${ADMIN}/${prop}/customDimensions`,
          {
            parameterName: p,
            displayName: p,
            scope,
          },
          ctx
        )
      created.push(`${scope.toLowerCase()}_dimension:${p}`)
    }
  }
  return {
    property: prop,
    dryRun,
    created,
    existingKeyEvents: [...haveKeys].sort(),
  }
}

export const appCollector: SourceCollector<AppConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectApp,
}

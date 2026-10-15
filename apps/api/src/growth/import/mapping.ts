/**
 * growth.db rows → VibeGrowth rows (pure). Measurement tables become kpi_daily / search_daily rows
 * following CONTRACT §7.1 and the metric names of the TS collectors; runs are split per collector.
 */
import { dimsKey, rstripSlash } from "../../collectors/sources"
import { num, parseJsonText, str, isObject, type Row } from "./source"

export interface KpiOut {
  source: string
  date: string
  metric: string
  dims: string
  value: number
}

export interface SearchOut {
  source: "gsc" | "bing"
  date: string
  query: string
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** Collects rows per primary key; a second row with the same key is summed or replaced. */
export class KpiBag {
  readonly rows = new Map<string, KpiOut>()
  collisions = 0
  private key(r: KpiOut) {
    return `${r.source}\u0000${r.date}\u0000${r.metric}\u0000${r.dims}`
  }
  set(r: KpiOut) {
    const k = this.key(r)
    if (this.rows.has(k)) this.collisions++
    this.rows.set(k, r)
  }
  add(r: KpiOut) {
    const k = this.key(r)
    const cur = this.rows.get(k)
    if (cur) cur.value += r.value
    else this.rows.set(k, { ...r })
  }
  list() {
    return [...this.rows.values()]
  }
}

/** PSI measured `url.rstrip("/") + "/"` (growth.py) but stored the bare site URL; TS collector key. */
export const psiUrl = (url: string) => `${rstripSlash(url.trim())}/`

export const PSI_METRICS = [
  "performance",
  "seo",
  "accessibility",
  "best_practices",
  "lcp_ms",
  "cls",
  "tbt_ms",
] as const

/** store_daily installs_overview metric → play metric (play collector), null = not collected. */
export const PLAY_OVERVIEW: Record<string, string | null> = {
  "Daily User Installs": "installs",
  "Daily User Uninstalls": "uninstalls",
  "Active Device Installs": "active_installs",
  "Daily Device Installs": null,
  "Daily Device Uninstalls": null,
  "Daily Device Upgrades": null,
  "Install events": null,
  "Total User Installs": null,
  "Uninstall events": null,
  "Update events": null,
}

/** store_performance_* metric → play metric. */
export const PLAY_PERFORMANCE: Record<string, string> = {
  "Store listing acquisitions": "installs",
  "Store listing visitors": "store_visits",
}

/** Local timestamp of growth.py (no zone, machine time) → ISO UTC like nowIso(). */
export function isoFromLocal(ts: unknown): string | null {
  const s = str(ts)
  if (!s) return null
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(" ", "T"))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** runs.kind / collect sub-source → VibeGrowth collector. */
export const COLLECT_SOURCES: Record<string, string> = {
  gsc: "gsc",
  ga: "ga4",
  bing: "bing",
  psi: "psi",
  app: "app",
}

/** Error text prefix of growth.py collect → collector. */
export function collectorOfError(e: string): string | null {
  const head = e.trim().toLowerCase()
  if (/^psi\b/.test(head)) return "psi"
  if (/^(ga4|ga)\b/.test(head)) return "ga4"
  if (/^gsc\b/.test(head)) return "gsc"
  if (/^bing\b/.test(head)) return "bing"
  if (/^app\b/.test(head)) return "app"
  if (/^(stores?|play|google_play)\b/.test(head)) return "play"
  if (/^(app_store|asc)\b/.test(head)) return "asc"
  return null
}

export interface RunOut {
  key: string
  collector: string
  startedAt: string
  ok: boolean
  summary: string
  error: string | null
  stats: Record<string, unknown>
}

export interface RunSplit {
  runs: RunOut[]
  /** reason when the run produced no collector run */
  skipped: string | null
  unassignedErrors: string[]
}

/** One growth.py run → collector runs (collect is split per source). */
export function splitRun(r: Row): RunSplit {
  const id = Number(r.id)
  const kind = str(r.kind) ?? ""
  const at = isoFromLocal(r.ts)
  const summaryRaw = parseJsonText(r.summary, null)
  const s = isObject(summaryRaw) ? summaryRaw : {}
  const errors = Array.isArray(s.errors)
    ? s.errors.filter((e): e is string => typeof e === "string")
    : []
  const ok = Number(r.ok) === 1
  const base = { startedAt: at ?? "", stats: {} as Record<string, unknown> }
  if (!at)
    return { runs: [], skipped: "Zeitstempel ungültig", unassignedErrors: [] }
  const text = (collector: string, errs: string[], okRun: boolean) =>
    `Website-Growth-Lauf #${id} (${kind}${kind === collector ? "" : ` → ${collector}`}): ${okRun ? "ok" : errs.length ? errs.join("; ").slice(0, 300) : "fehlgeschlagen"}`
  if (kind === "health") {
    const alerts = Array.isArray(s.alerts)
      ? s.alerts.filter((a): a is string => typeof a === "string")
      : []
    return {
      runs: [
        {
          ...base,
          key: `wg:runs:${id}`,
          collector: "health",
          ok,
          summary: text("health", alerts, ok),
          error: ok ? null : alerts.join("; ") || "fehlgeschlagen",
          stats: { ...s, legacyRun: id },
        },
      ],
      skipped: null,
      unassignedErrors: [],
    }
  }
  if (kind === "audit") {
    return {
      runs: [
        {
          ...base,
          key: `wg:runs:${id}`,
          collector: "audit",
          ok,
          summary: text("audit", [], ok),
          error: ok ? null : "Befunde mit Schwere error",
          stats: { ...s, legacyRun: id },
        },
      ],
      skipped: null,
      unassignedErrors: [],
    }
  }
  if (kind === "ai-check") {
    const engines = Array.isArray(s.engines) ? s.engines.map(String) : []
    if (!engines.includes("chatgpt-web"))
      return {
        runs: [],
        skipped:
          "KI-Check ohne Engine chatgpt-web (exa/OpenRouter haben kein Gegenstück in VibeGrowth)",
        unassignedErrors: [],
      }
    return {
      runs: [
        {
          ...base,
          key: `wg:runs:${id}`,
          collector: "geo-chatgpt",
          ok,
          summary: text("geo-chatgpt", errors, ok),
          error: ok ? null : errors.join("; ") || "fehlgeschlagen",
          stats: { ...s, legacyRun: id },
        },
      ],
      skipped: null,
      unassignedErrors: [],
    }
  }
  if (kind === "ai-reparse")
    return {
      runs: [],
      skipped:
        "Neuauswertung vorhandener Belege, keine Erhebung (Ergebnis steckt in ai_checks)",
      unassignedErrors: [],
    }
  if (kind === "collect") {
    const out = isObject(s.out) ? s.out : {}
    const parts = new Map<string, Record<string, unknown>>()
    const part = (c: string) => {
      const p = parts.get(c) ?? {}
      parts.set(c, p)
      return p
    }
    for (const [k, v] of Object.entries(out)) {
      if (k === "stores" && isObject(v)) {
        for (const [store, sv] of Object.entries(v)) {
          if (store === "google_play") part("play").google_play = sv
          else if (store === "app_store") part("asc").app_store = sv
          else if (store === "ga_event_params") part("ga4").ga_event_params = sv
          else part("play")[store] = sv
        }
      } else if (COLLECT_SOURCES[k]) part(COLLECT_SOURCES[k])[k] = v
      else part(`unknown:${k}`)[k] = v
    }
    const byCollector = new Map<string, string[]>()
    const unassigned: string[] = []
    for (const e of errors) {
      const c = collectorOfError(e)
      if (c) {
        part(c)
        byCollector.set(c, [...(byCollector.get(c) ?? []), e])
      } else unassigned.push(e)
    }
    if (unassigned.length && parts.size === 0) part("unknown:collect")
    const runs: RunOut[] = []
    for (const [collector, stats] of parts) {
      if (collector.startsWith("unknown:")) continue
      const errs = [...(byCollector.get(collector) ?? []), ...unassigned]
      const okRun = errs.length === 0
      runs.push({
        ...base,
        key: `wg:runs:${id}:${collector}`,
        collector,
        ok: okRun,
        summary: text(collector, errs, okRun),
        error: okRun ? null : errs.join("; "),
        stats: { ...stats, legacyRun: id },
      })
    }
    const unknown = [...parts.keys()].filter((k) => k.startsWith("unknown:"))
    if (!runs.length)
      return {
        runs: [],
        skipped: unknown.length
          ? `Sammellauf nur mit unbekannten Quellen (${unknown.join(", ")})`
          : "Sammellauf ohne Quelle und ohne Fehler",
        unassignedErrors: unassigned,
      }
    return { runs, skipped: null, unassignedErrors: unassigned }
  }
  return {
    runs: [],
    skipped: `unbekannte Lauf-Art ${kind}`,
    unassignedErrors: [],
  }
}

/** Health kpi of the last health run per local day (same metrics as the TS health collector). */
export function healthKpi(runs: Row[]): KpiOut[] {
  const lastPerDay = new Map<string, Record<string, unknown>>()
  for (const r of runs) {
    if (r.kind !== "health") continue
    const ts = str(r.ts)
    const s = parseJsonText(r.summary, null)
    if (!ts || !isObject(s)) continue
    lastPerDay.set(ts.slice(0, 10), s)
  }
  const out: KpiOut[] = []
  for (const [date, s] of lastPerDay) {
    const home = Array.isArray(s.home) ? s.home : []
    const status = num(home[0])
    const secs = num(home[1])
    if (status === null) continue
    const healthStatus = s.health === undefined ? null : num(s.health)
    const up = status === 200 && (healthStatus === null || healthStatus === 200)
    out.push({
      source: "health",
      date,
      metric: "up",
      dims: "",
      value: up ? 1 : 0,
    })
    if (secs !== null)
      out.push({
        source: "health",
        date,
        metric: "latency_ms",
        dims: "",
        value: Math.round(secs * 1000),
      })
    const tls = num(s.tls_days)
    if (tls !== null)
      out.push({
        source: "health",
        date,
        metric: "tls_days",
        dims: "",
        value: tls,
      })
  }
  return out
}

export { dimsKey }

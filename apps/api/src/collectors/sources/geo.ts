/**
 * Collector `geo-chatgpt`: GEO check in ChatGPT, port of growth.py `ai-check` (brand_matcher,
 * own_url_kind, analyse_answer, the run loop) with the engine from ai_engines.py (chatgpt.ts).
 * Questions come from geo_questions (active) of the project; results become geo_checks rows
 * (GeoService.recordChecks). A run-level blocker (login, limit, bot check) ends the run with an
 * error; a failed question is stored with status=error and the run continues.
 * Evidence files: <evidenceDir>/<project>/<date>/chatgpt-web/run-HHMMSS/NN.{png,json,conversation.json}.
 */
import os from "node:os"
import path from "node:path"
import { BrowserUnavailable } from "./cdp.js"
import {
  ChatgptWeb,
  EngineBlocked,
  domain,
  type EngineAnswer,
} from "./chatgpt.js"
import {
  errorMessage,
  finish,
  localToday,
  type CollectorResult,
  type ConfigSchema,
  type GeoCheckRow,
} from "./types.js"

export interface GeoConfig {
  brandPatterns?: string[]
  brandPatternsAmbiguous?: string[]
  brandContext?: string | null
  /** Base folder for evidence files. */
  evidenceDir?: string | null
  /** Own store listings (growth.py own_url_kind); default from the play/asc collector configs. */
  appStoreId?: string | null
  playPackage?: string | null
  promptTimeout?: number
  budgetMin?: number
  forceSearch?: boolean
}

export const GEO_ENGINE = "chatgpt-web"
export const DEFAULT_EVIDENCE_DIR = path.join(
  os.homedir(),
  ".hermes/artifacts/projects/website-growth/data/ai-evidence"
)

export const configSchema: ConfigSchema = {
  brandPatterns: {
    description:
      "Regex-Muster, die eindeutig die Marke nennen (ohne Groß-/Kleinschreibung)",
    required: true,
    type: "string[]",
  },
  brandPatternsAmbiguous: {
    description:
      "Mehrdeutige Muster (z. B. \\bChrono\\b), zählen nur zusammen mit brandContext",
    required: false,
    type: "string[]",
  },
  brandContext: {
    description: "Regex für den Themenkontext mehrdeutiger Treffer",
    required: false,
    type: "string",
  },
  evidenceDir: {
    description:
      "Ordner für Evidence-Dateien (Screenshot, Antwort, Konversations-JSON); Standard <workspace>/ai-evidence, ohne Workspace ~/.hermes/artifacts/projects/website-growth/data/ai-evidence",
    required: false,
    type: "string",
  },
  appStoreId: {
    description:
      "Eigene App-Store-ID für Zitat-Erkennung (Standard: asc.appId)",
    required: false,
    type: "string",
  },
  playPackage: {
    description:
      "Eigenes Play-Paket für Zitat-Erkennung (Standard: play.package)",
    required: false,
    type: "string",
  },
  promptTimeout: {
    description: "Sekunden Wartezeit auf eine Antwort",
    required: false,
    type: "number",
    default: 240,
  },
  budgetMin: {
    description: "Nach so vielen Minuten keine neue Frage mehr starten",
    required: false,
    type: "number",
    default: 50,
  },
  forceSearch: {
    description:
      "Websuche erzwingen statt ChatGPT entscheiden zu lassen (true/false)",
    required: false,
    type: "string",
    default: false,
  },
}

export type BrandMatch = (text: string, context?: string) => boolean

function regex(p: string): RegExp {
  try {
    return new RegExp(p, "i")
  } catch {
    throw new Error(`geo-chatgpt: ungültiges Regex-Muster ${JSON.stringify(p)}`)
  }
}

/**
 * growth.py `brand_matcher`: brandPatterns always count; brandPatternsAmbiguous only when
 * brandContext also matches the text (or the given context).
 */
export function brandMatcher(config: GeoConfig): BrandMatch {
  const strong = (config.brandPatterns ?? []).map(regex)
  const weak = (config.brandPatternsAmbiguous ?? []).map(regex)
  const ctx = config.brandContext ? regex(config.brandContext) : null
  return (text, context) => {
    if (strong.some((p) => p.test(text))) return true
    return (
      weak.length > 0 &&
      weak.some((p) => p.test(text)) &&
      (ctx === null || ctx.test(context ?? text))
    )
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** growth.py `own_url_kind`: 'site' (own domain), 'store' (own store listing) or null. */
export function ownUrlKind(
  site: {
    url: string | null
    appStoreId?: string | null
    playPackage?: string | null
  },
  url: string
): "site" | "store" | null {
  const host = site.url ? hostOf(site.url) : ""
  const h = hostOf(url)
  if (host && (h === host || h.endsWith(`.${host}`))) return "site"
  if (
    site.appStoreId &&
    h.includes("apps.apple.com") &&
    new RegExp(`/id${escapeRe(String(site.appStoreId))}\\b`).test(url)
  )
    return "store"
  if (
    site.playPackage &&
    h.includes("play.google.com") &&
    new RegExp(`[?&]id=${escapeRe(site.playPackage)}\\b`).test(url)
  )
    return "store"
  return null
}

export interface Analysis {
  mentioned: boolean
  cited: boolean
  linked: string[]
  inSources: string[]
  position: number | null
  competitors: string[]
}

/** growth.py `analyse_answer`. */
export function analyseAnswer(
  match: BrandMatch,
  site: {
    url: string | null
    appStoreId?: string | null
    playPackage?: string | null
  },
  ans: Pick<EngineAnswer, "text" | "brands" | "citedUrls" | "links" | "sources">
): Analysis {
  const text = ans.text || ""
  const mentioned = match(text)
  const brands = ans.brands ?? []
  const idx = brands.findIndex((b) => match(b, text))
  const position = idx >= 0 ? idx + 1 : null
  const kinds = (urls: string[]) =>
    [
      ...new Set(
        urls.map((u) => ownUrlKind(site, u)).filter((k) => k !== null)
      ),
    ].sort()
  const linked = kinds([...(ans.citedUrls ?? []), ...(ans.links ?? [])])
  const inSources = kinds((ans.sources ?? []).map((s) => s.url))
  return {
    mentioned: mentioned || position !== null || linked.length > 0,
    cited: linked.length > 0,
    linked,
    inSources,
    position,
    competitors: brands.filter((b) => !match(b, text)),
  }
}

const pad = (n: number) => String(n).padStart(2, "0")

export interface GeoRunInput {
  project: { id: string; url: string | null; workspace: string | null }
  questions: { id: number; text: string }[]
  /** Only the first N questions (smoke test). */
  limit?: number
  today?: string
  log?: (line: string) => void
}

/** Python brand_key in growth.py, enough for the top-brands line of the summary. */
const brandKey = (b: string) => b.toLowerCase().replace(/\s+/g, " ").trim()

let running: string | null = null

export async function collectGeoChatgpt(
  config: GeoConfig,
  input: GeoRunInput
): Promise<CollectorResult> {
  const today = input.today ?? localToday()
  const all = input.questions
  const questions = input.limit ? all.slice(0, input.limit) : all
  const stats: Record<string, unknown> = {
    engine: GEO_ENGINE,
    questions: questions.length,
    ...(input.limit ? { limit: input.limit } : {}),
  }
  if (!questions.length) {
    const msg = `${input.project.id}: keine aktiven GEO-Fragen (geo question add --project ${input.project.id} --text …)`
    return finish({ kpi: [], summary: msg, stats, errors: [msg] })
  }
  if (
    !(config.brandPatterns ?? []).length &&
    !(config.brandPatternsAmbiguous ?? []).length
  ) {
    const msg = 'geo-chatgpt: Konfiguration "brandPatterns" fehlt'
    return finish({ kpi: [], summary: msg, stats, errors: [msg] })
  }
  let match: BrandMatch
  try {
    match = brandMatcher(config)
  } catch (e) {
    return finish({
      kpi: [],
      summary: errorMessage(e),
      stats,
      errors: [errorMessage(e)],
    })
  }
  // One shared browser: never two GEO runs at the same time in this process.
  if (running) {
    const msg = `GEO-Lauf für ${running} läuft bereits (geteilter Automations-Chrome)`
    return finish({ kpi: [], summary: msg, stats, errors: [msg] })
  }
  running = input.project.id
  const now = new Date()
  const base =
    config.evidenceDir ||
    (input.project.workspace
      ? path.join(input.project.workspace, "ai-evidence")
      : DEFAULT_EVIDENCE_DIR)
  // One folder per run: same-day reruns must not overwrite earlier evidence.
  const evidenceDir = path.join(
    base,
    input.project.id,
    today,
    GEO_ENGINE,
    `run-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
  stats.evidenceDir = evidenceDir
  const site = {
    url: input.project.url,
    appStoreId: config.appStoreId ?? null,
    playPackage: config.playPackage ?? null,
  }
  const budgetMin = Number(config.budgetMin) > 0 ? Number(config.budgetMin) : 50
  const deadline = Date.now() + budgetMin * 60_000
  const checks: GeoCheckRow[] = []
  const errors: string[] = []
  const results: { analysis: Analysis; brands: string[]; domains: string[] }[] =
    []
  let blocked: string | null = null
  const engine = new ChatgptWeb(evidenceDir, {
    promptTimeoutS:
      Number(config.promptTimeout) > 0 ? Number(config.promptTimeout) : 240,
    forceSearch:
      config.forceSearch === true || String(config.forceSearch) === "true",
    log: input.log,
  })
  try {
    await engine.open()
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const n = i + 1
      if (Date.now() > deadline) {
        errors.push(
          `${GEO_ENGINE}: Zeitbudget ${budgetMin} min vor Frage ${n} erschöpft`
        )
        break
      }
      let ans: EngineAnswer
      try {
        ans = await engine.ask(q.text, n)
      } catch (e) {
        if (e instanceof EngineBlocked) throw e
        // One question must never stop the run.
        const err =
          `${e instanceof Error ? e.name : "Error"}: ${errorMessage(e)}`.slice(
            0,
            300
          )
        errors.push(`${GEO_ENGINE} #${n}: ${err}`)
        checks.push({
          questionId: q.id,
          date: today,
          engine: GEO_ENGINE,
          status: "error",
          error: err,
        })
        input.log?.(`#${n} FEHLER ${err}`)
        continue
      }
      const a = analyseAnswer(match, site, ans)
      const domains = [...new Set(ans.citedUrls.map(domain))]
      results.push({ analysis: a, brands: ans.brands, domains })
      checks.push({
        questionId: q.id,
        date: today,
        engine: GEO_ENGINE,
        status: "ok",
        mentioned: a.mentioned,
        position: a.position,
        cited: a.cited,
        inSources: a.inSources.length > 0,
        brands: ans.brands,
        competitors: a.competitors,
        links: ans.links,
        citedUrls: ans.citedUrls,
        sources: ans.sources,
        answer: ans.text,
        model: ans.model,
        evidence: ans.evidence[0] ?? null,
        meta: {
          ...ans.meta,
          in_sources: a.inSources,
          linked: a.linked,
          evidenceFiles: ans.evidence,
          checkedAt: new Date().toISOString(),
        },
        error: null,
      })
    }
  } catch (e) {
    if (e instanceof EngineBlocked) {
      blocked = `${GEO_ENGINE}: ${e.message}`
      errors.push(blocked)
    } else if (e instanceof BrowserUnavailable) {
      blocked = `${GEO_ENGINE}: ${e.message}`
      errors.push(blocked)
    } else
      errors.push(
        `${GEO_ENGINE}: ${e instanceof Error ? e.name : "Error"}: ${errorMessage(e)}`.slice(
          0,
          300
        )
      )
  } finally {
    await engine.close().catch(() => undefined)
    running = null
  }
  const n = results.length
  const mentioned = results.filter((r) => r.analysis.mentioned).length
  const cited = results.filter((r) => r.analysis.cited).length
  const count = (list: string[]) => {
    const m = new Map<string, number>()
    for (const k of list) m.set(k, (m.get(k) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }
  Object.assign(stats, {
    answers: n,
    mentioned,
    cited,
    errors: errors.length,
    blocked,
    topBrands: count(
      results.flatMap((r) => [...new Set(r.brands.map(brandKey))])
    ).slice(0, 6),
    topSources: count(results.flatMap((r) => r.domains)).slice(0, 8),
  })
  // Done when no blocker and at least half of the questions produced an answer (growth.py ai-check).
  const complete = !blocked && n * 2 >= questions.length
  const summary = `KI-Sichtbarkeit ${input.project.id} (${GEO_ENGINE}${input.limit ? `, Probe limit ${input.limit}` : ""}): erwähnt ${mentioned}/${n}, zitiert ${cited}/${n}, Antworten ${n}/${questions.length}, Fehler ${errors.length}`
  const result = finish({
    kpi: [],
    geoChecks: checks,
    summary,
    stats,
    errors: complete ? [] : errors,
  })
  // Single-question errors are stored as status=error; they fail the run only below the 50 % mark.
  if (complete && errors.length) result.stats.questionErrors = errors
  return result
}

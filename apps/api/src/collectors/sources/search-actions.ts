/**
 * Search actions from growth.py: `keywords` (Google autocomplete a–z), `sitemap-submit` (GSC PUT)
 * and `bing-submit` (Bing SubmitUrlBatch after the quota check). Pure functions: no DB access;
 * the API logs every external write as a `changes` entry.
 */
import { bingApi } from "./bing.js"
import { googleApi } from "./google-auth.js"
import { BROWSER_UA, httpFetch } from "./http.js"
import { CollectorError, rstripSlash, type FetchFn } from "./types.js"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface KeywordsResult {
  seeds: string[]
  language: string
  /** suggestion → seed it came from (first seed wins), sorted by seed, then suggestion. */
  suggestions: { suggestion: string; seed: string }[]
  count: number
  failed: number
}

/** growth.py `keywords`: Google autocomplete for every seed plus " a" … " z", " ä", " ö", " ü". */
export async function keywordSuggestions(
  seeds: string[],
  language: string,
  opts: { fast?: boolean; fetch?: FetchFn; delayMs?: number } = {}
): Promise<KeywordsResult> {
  const found = new Map<string, string>()
  let failed = 0
  const suffixes = [
    "",
    ..."abcdefghijklmnopqrstuvwxyzäöü".split("").map((c) => ` ${c}`),
  ]
  for (const seed of seeds) {
    for (const suffix of suffixes) {
      const q = new URLSearchParams({
        client: "firefox",
        hl: language,
        gl: language,
        q: seed + suffix,
      })
      const r = await httpFetch(
        `https://suggestqueries.google.com/complete/search?${q.toString()}`,
        { ua: BROWSER_UA, timeoutS: 15 },
        opts.fetch ?? fetch
      )
      if (r.status !== 200) {
        failed++
        continue
      }
      try {
        const list = (JSON.parse(r.body.toString("utf8")) as unknown[])[1]
        if (Array.isArray(list))
          for (const s of list)
            if (typeof s === "string" && !found.has(s)) found.set(s, seed)
      } catch {
        failed++
      }
      await sleep(opts.delayMs ?? 150)
      if (opts.fast) break
    }
  }
  const suggestions = [...found]
    .map(([suggestion, seed]) => ({ suggestion, seed }))
    .sort((a, b) =>
      a.seed === b.seed
        ? a.suggestion < b.suggestion
          ? -1
          : 1
        : a.seed < b.seed
          ? -1
          : 1
    )
  return { seeds, language, suggestions, count: suggestions.length, failed }
}

export interface SitemapStatus {
  path: string | null
  lastSubmitted: string | null
  isPending: boolean | null
  lastDownloaded: string | null
  errors: string | number | null
  warnings: string | number | null
}

/** growth.py `sitemap-submit`: PUT <site url>/sitemap.xml to Search Console, read the status back. */
export async function sitemapSubmit(
  gscProperty: string,
  siteUrl: string,
  ctx: { secretsDir: string; fetch?: FetchFn }
): Promise<SitemapStatus> {
  const prop = encodeURIComponent(gscProperty)
  const feed = encodeURIComponent(`${rstripSlash(siteUrl)}/sitemap.xml`)
  const url = `https://www.googleapis.com/webmasters/v3/sites/${prop}/sitemaps/${feed}`
  await googleApi("PUT", url, null, ctx)
  const got = await googleApi<Record<string, unknown>>("GET", url, null, ctx)
  const pick = <T>(k: string) => (got[k] ?? null) as T | null
  return {
    path: pick<string>("path"),
    lastSubmitted: pick<string>("lastSubmitted"),
    isPending: pick<boolean>("isPending"),
    lastDownloaded: pick<string>("lastDownloaded"),
    errors: pick<string | number>("errors"),
    warnings: pick<string | number>("warnings"),
  }
}

export interface BingSubmitResult {
  siteUrl: string
  submitted: string[]
  /** Daily quota before the submission. */
  quota: { daily: number | null; monthly: number | null }
  fromSitemap: boolean
}

/** growth.py `bing-submit`: URLs (default: <loc> of the sitemap), quota check, SubmitUrlBatch. */
export async function bingSubmit(
  siteUrl: string,
  urls: string[] | undefined,
  ctx: { secretsDir: string; fetch?: FetchFn }
): Promise<BingSubmitResult> {
  const base = rstripSlash(siteUrl)
  let list = (urls ?? []).filter((u) => u.trim())
  const fromSitemap = list.length === 0
  if (fromSitemap) {
    const r = await httpFetch(`${base}/sitemap.xml`, {}, ctx.fetch ?? fetch)
    if (r.status !== 200)
      throw new CollectorError(
        "EXTERNAL",
        `Sitemap ${base}/sitemap.xml: HTTP ${r.status}`
      )
    list = [...r.text().matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
      (m) => m[1]
    )
    if (!list.length)
      throw new CollectorError(
        "EXTERNAL",
        `Sitemap ${base}/sitemap.xml enthält keine <loc>-URLs`
      )
  }
  const quota =
    (await bingApi<{ DailyQuota?: number; MonthlyQuota?: number } | null>(
      "GetUrlSubmissionQuota",
      ctx,
      { siteUrl: `${base}/` }
    )) ?? {}
  if (list.length > (quota.DailyQuota ?? 0))
    throw new CollectorError(
      "INVALID",
      `${list.length} URLs überschreiten das Bing-Tageskontingent (${quota.DailyQuota ?? 0} pro Tag, ${quota.MonthlyQuota ?? "?"} pro Monat)`
    )
  await bingApi("SubmitUrlBatch", ctx, {
    body: { siteUrl: `${base}/`, urlList: list },
  })
  return {
    siteUrl: `${base}/`,
    submitted: list,
    quota: {
      daily: quota.DailyQuota ?? null,
      monthly: quota.MonthlyQuota ?? null,
    },
    fromSitemap,
  }
}

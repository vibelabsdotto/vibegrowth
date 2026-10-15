/**
 * Source classification for mention targets, ported from growth.py `ai-sources`
 * (SOURCE_KINDS, source_kind, brand_key). Labels map to mention_targets.kind.
 */
import { normalizeDomain } from "./shared"

export const MENTION_KINDS = [
  "app_store",
  "comparison",
  "guide",
  "forum",
  "press",
  "vendor",
  "other",
] as const
export type MentionKind = (typeof MENTION_KINDS)[number]

/** (kind, label in growth.py, regex on the URL); first match wins. */
const SOURCE_KINDS: [MentionKind, string, RegExp][] = [
  [
    "app_store",
    "App-Store",
    /apps\.apple\.com|play\.google\.com|appgallery|galaxy\.store/i,
  ],
  [
    "forum",
    "Forum/Community",
    /reddit\.|gutefrage\.|forum|community|stackexchange|quora\.|\/threads?\/|motor-talk|ms-office-forum/i,
  ],
  ["other", "Video", /youtube\.|youtu\.be|tiktok\.|vimeo\./i],
  [
    "comparison",
    "Verzeichnis/Vergleichsportal",
    new RegExp(
      "capterra|getapp|softwareadvice|g2\\.com|trustradius|omr\\.com|alternativeto|" +
        "chip\\.de/downloads|netzwelt\\.de/download|computerbild\\.de/download|appvizer|trusted\\.de|" +
        "softguide|vergleich\\.org|testberichte|check24|finanztip|mwm\\.ai|appadvice\\.com|" +
        "appbrain\\.com|aptoide\\.com|f-droid\\.org|apkpure|apkmirror|uptodown|softonic|rustore\\.ru|" +
        "dsapp\\.de|wintotal\\.de|appgefahren|iphone-ticker|mobilsicher",
      "i"
    ),
  ],
  [
    "guide",
    "Vergleich/Ratgeber-Artikel",
    /vergleich|beste|best-|\/best|top-?\d|-test|\/test|testsieger|alternativen|ratgeber|empfehlung|uebersicht|übersicht|ranking/i,
  ],
  [
    "other",
    "Recht/Behörde/Verband",
    new RegExp(
      "\\.gov|bund\\.de|bmas\\.de|gesetze-im-internet|dgb\\.de|verdi\\.de|ihk\\.de|arbeitsagentur|" +
        "bundesarbeitsgericht|eur-lex|haufe\\.de|personalwissen",
      "i"
    ),
  ],
  [
    "press",
    "Presse/Magazin",
    new RegExp(
      "spiegel\\.|zeit\\.de|faz\\.net|sueddeutsche|handelsblatt|t3n\\.de|heise\\.de|golem\\.de|stern\\.de|" +
        "focus\\.de|welt\\.de|bild\\.de|merkur\\.de|chip\\.de|computerbild|netzwelt|giga\\.de|curved\\.de|" +
        "techbook|t-online",
      "i"
    ),
  ],
]

/** Kind of one URL: regex table first, then vendor when the domain belongs to a named brand. */
export function sourceKind(
  url: string,
  brandDomains: Set<string>
): MentionKind {
  for (const [kind, , rx] of SOURCE_KINDS) if (rx.test(url)) return kind
  const d = normalizeDomain(url)
  for (const bd of brandDomains)
    if (bd && (d === bd || d.endsWith(`.${bd}`))) return "vendor"
  return "other"
}

/** Most common kind over a domain's URLs; ties keep the first URL's kind (like Counter.most_common). */
export function domainKind(
  urls: string[],
  brandDomains: Set<string>
): MentionKind {
  const counts = new Map<MentionKind, number>()
  for (const u of urls) {
    const k = sourceKind(u, brandDomains)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: MentionKind = "other"
  let n = 0
  for (const [k, c] of counts)
    if (c > n) {
      best = k
      n = c
    }
  return best
}

/** Trailing generic words dropped from brand names (growth.py GENERIC_BRAND_WORDS). */
const GENERIC_BRAND_WORDS =
  /^(zeiterfassung|arbeitszeiterfassung|stundenzettel|stechuhr|stempeluhr|time ?tracker|timesheet|app|apps)$/i

/** Groups spelling variants ("WorkingHours – Zeiterfassung", "WorkingHours (iOS)") under one name. */
export function brandKey(name: string): string {
  const base = name
    .trim()
    .split(/\s+[–—-]\s+|:\s|\s\(/)[0]
    .trim()
  const words = base.split(/\s+/)
  while (words.length > 1 && GENERIC_BRAND_WORDS.test(words[words.length - 1]))
    words.pop()
  return words.join(" ") || name.trim()
}

/** Domains that belong to named brands (heuristic from growth.py: brand token in the domain). */
export function brandDomainsOf(brands: string[], domains: Iterable<string>) {
  const tokens = new Set(
    brands
      .filter((b) => b.trim())
      .map((b) =>
        brandKey(b)
          .toLowerCase()
          .split("–")[0]
          .split(":")[0]
          .trim()
          .split(/\s+/)[0]
          .replace(/[^a-z0-9]/g, "")
      )
      .filter((t) => t.length >= 4)
  )
  const out = new Set<string>()
  for (const d of domains) {
    const flat = d.replace(/-/g, "")
    for (const t of tokens)
      if (flat.includes(t)) {
        out.add(d)
        break
      }
  }
  return out
}

import { detectAll } from "tinyld"

/** Store review languages come as ISO 639-1, BCP 47 or ISO 639-2 ("DEU"). */
const ISO3: Record<string, string> = {
  ara: "ar",
  deu: "de",
  eng: "en",
  fra: "fr",
  fre: "fr",
  ger: "de",
  ita: "it",
  nld: "nl",
  pol: "pl",
  por: "pt",
  rus: "ru",
  spa: "es",
  tur: "tr",
  ukr: "uk",
  uzb: "uz",
}

const NAME: Record<string, string> = {
  ar: "Arabisch",
  de: "Deutsch",
  en: "Englisch",
  es: "Spanisch",
  fr: "Französisch",
  it: "Italienisch",
  nl: "Niederländisch",
  pl: "Polnisch",
  pt: "Portugiesisch",
  ru: "Russisch",
  tr: "Türkisch",
  uk: "Ukrainisch",
  uz: "Usbekisch",
}

const name = (l: string) => NAME[l] ?? l

export function normLang(v: string | null | undefined): string | null {
  if (!v) return null
  const base = v.trim().toLowerCase().split(/[-_]/)[0] ?? ""
  if (/^[a-z]{2}$/.test(base)) return base
  return ISO3[base] ?? null
}

/** Language of a reply text; null when the text is too short or the guess too weak. */
export function textLanguage(text: string): string | null {
  if (text.trim().length < 20) return null
  const [top] = detectAll(text)
  return top && top.accuracy >= 0.3 ? top.lang : null
}

/**
 * Why a store reply must not go out in this language, or null. `requireLanguage`: the payload
 * has to name its language (publishing); an unknown review language skips the comparison.
 */
export function replyLanguageProblem(
  reviewLanguage: string | null | undefined,
  replyLanguage: string | null | undefined,
  text: string,
  requireLanguage: boolean
): string | null {
  const review = normLang(reviewLanguage)
  const declared = normLang(replyLanguage)
  if (requireLanguage && !declared)
    return "Sprache der Antwort fehlt (payload.language)"
  if (review && declared && declared !== review)
    return `Antwort ist als ${name(declared)} angegeben, die Bewertung ist ${name(review)}`
  const detected = textLanguage(text)
  if (review && detected && detected !== review)
    return `Antworttext ist ${name(detected)}, die Bewertung ist ${name(review)}`
  if (!review && declared && detected && detected !== declared)
    return `Antworttext ist ${name(detected)}, angegeben ist ${name(declared)}`
  return null
}

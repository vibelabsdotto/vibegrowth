/**
 * Parsers for the site workspace (backlog.md, posts/ideas.md) and the README "Learnings"
 * section of the website-growth system. Pure functions over Markdown text; files are only read.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { slugify } from "../../core/util"

export const hash = (s: string) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 16)

/** Split one Markdown table row into trimmed cells (escaped \| stays inside a cell). */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim())
}

const isSeparator = (line: string) =>
  /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line.trim())

export interface MdTable {
  /** H2 heading above the table ('' before the first heading). */
  section: string
  header: string[]
  rows: string[][]
}

export interface MdDoc {
  tables: MdTable[]
  /** "- [ ] text" / "- [x] text" items with their H2 section. */
  checkboxes: { section: string; done: boolean; text: string }[]
  /** H2 headings in order. */
  sections: string[]
}

export function parseMarkdown(text: string): MdDoc {
  const lines = text.split(/\r?\n/)
  const doc: MdDoc = { tables: [], checkboxes: [], sections: [] }
  let section = ""
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2) {
      section = h2[1]
      doc.sections.push(section)
      continue
    }
    const cb = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line)
    if (cb) {
      doc.checkboxes.push({
        section,
        done: cb[1].toLowerCase() === "x",
        text: cb[2].trim(),
      })
      continue
    }
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      isSeparator(lines[i + 1])
    ) {
      const table: MdTable = { section, header: cells(line), rows: [] }
      i += 2
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        table.rows.push(cells(lines[i]))
        i++
      }
      i--
      doc.tables.push(table)
    }
  }
  return doc
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß#]+/g, "")

/** Column index by the first matching header name (normalised), -1 when missing. */
function col(header: string[], ...names: string[]) {
  const h = header.map(norm)
  for (const n of names) {
    const i = h.indexOf(norm(n))
    if (i >= 0) return i
  }
  return -1
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "")

/** Title from a long task text: the text itself up to 140 chars, otherwise its first sentence. */
export function shortTitle(text: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= 140) return { title: flat, truncated: false }
  const first = /^(.{20,140}?)(?:[.:;](?:\s|$))/.exec(flat)
  if (first) return { title: first[1].trim(), truncated: true }
  return { title: flat.slice(0, 139).trimEnd() + "…", truncated: true }
}

// ---------- backlog.md ----------

export interface BacklogParsed {
  key: string
  title: string
  detail: string | null
  kind: string
  impact: number
  effort: number
  status: "open" | "doing" | "done" | "dropped"
  doneRef: string | null
  position: number
}

const LEVEL: [RegExp, number][] = [
  [/\b(klein|gering|niedrig|low|small)\b/i, 1],
  [/\b(mittel|medium)\b/i, 2],
  [/\b(groß|gross|hoch|high|large)\b/i, 3],
]
function level(text: string): number | null {
  for (const [re, n] of LEVEL) if (re.test(text)) return n
  return null
}

/**
 * Keyword rules for backlog kind (documented in the mapping), first match wins: checked on the
 * title first, then on title + reason; else other.
 */
const KIND_RULES: [RegExp, string][] = [
  [/(ratgeber|artikel|beitrag|blog-cta|themen|tool-seite)/i, "content"],
  [/(app[- ]store|google[- ]play|\bplay-|\bstore-|\basc\b)/i, "store"],
  [
    /(sitemap|\btitel\b|\btitle\b|search console|\bgsc\b|\bbing\b|weiterleitung|redirect|canonical|indexier|json-ld|keyword)/i,
    "seo",
  ],
  [
    /(\bga4\b|firebase|events?\b|tracking|collector|einwilligung|release|proxy|\bcron\b|src\/)/i,
    "tech",
  ],
  [
    /(erwähnung|outreach|experiment|strategie|kampagne|ki-sichtbarkeit|quellenliste)/i,
    "growth",
  ],
]
export function backlogKind(title: string, more = "") {
  for (const text of [title, `${title} ${more}`])
    for (const [re, kind] of KIND_RULES) if (re.test(text)) return kind
  return "other"
}

function backlogStatus(text: string): BacklogParsed["status"] {
  const t = text.toLowerCase()
  if (/^(erledigt|done|fertig)/.test(t)) return "done"
  if (/^(läuft|in arbeit|doing)/.test(t)) return "doing"
  if (/^(verworfen|gestrichen|dropped|entfällt)/.test(t)) return "dropped"
  return "open"
}

const DONE_SECTION = /^(erledigt|done|abgeschlossen)/i

/**
 * backlog.md: one item per table row (tables with an "Aufgabe" column) and per checkbox item.
 * Status from the Status column, the checkbox or the section heading ("Erledigt").
 * Effort/impact only when the text names them (klein/mittel/groß), else 2.
 */
export function parseBacklog(text: string, site: string) {
  const doc = parseMarkdown(text)
  const items: BacklogParsed[] = []
  const ignoredSections: string[] = []
  let position = 0
  const used = new Set<string>()
  const uniqueKey = (k: string) => {
    let key = k
    for (let n = 2; used.has(key); n++) key = `${k}~${n}`
    used.add(key)
    return key
  }
  const prefix = `wg-ws:${site}:backlog.md`
  for (const t of doc.tables) {
    const iTask = col(t.header, "Aufgabe", "Task", "Titel")
    if (iTask < 0) continue
    const iNo = col(t.header, "#", "Nr")
    const iWhy = col(t.header, "Warum", "Begründung")
    const iEffort = col(t.header, "Aufwand", "Effort")
    const iImpact = col(t.header, "Wirkung", "Impact", "Nutzen")
    const iStatus = col(t.header, "Status")
    const iDate = col(t.header, "Datum", "Date")
    const iProof = col(t.header, "Beleg", "Commit")
    const doneSection = DONE_SECTION.test(t.section)
    for (const row of t.rows) {
      const task = cell(row, iTask)
      if (!task) continue
      const no = cell(row, iNo)
      const why = cell(row, iWhy)
      const effortText = cell(row, iEffort)
      const impactText = cell(row, iImpact)
      const statusText = cell(row, iStatus)
      const date = cell(row, iDate)
      const proof = cell(row, iProof)
      const status = doneSection
        ? "done"
        : statusText
          ? backlogStatus(statusText)
          : "open"
      const { title, truncated } = shortTitle(task)
      const detail = [
        truncated ? task : null,
        why ? `Warum: ${why}` : null,
        effortText ? `Aufwand (Quelle): ${effortText}` : null,
        impactText ? `Wirkung (Quelle): ${impactText}` : null,
        statusText ? `Status (Quelle): ${statusText}` : null,
        date ? `Datum: ${date}` : null,
      ]
        .filter(Boolean)
        .join("\n")
      items.push({
        key: uniqueKey(
          no ? `${prefix}:#${no}` : `${prefix}:${status}:${hash(task)}`
        ),
        title,
        detail: detail || null,
        kind: backlogKind(title, `${task} ${why}`),
        impact: level(impactText) ?? 2,
        effort: level(effortText) ?? 2,
        status,
        doneRef:
          status === "done"
            ? [date, proof].filter(Boolean).join(": ") || null
            : null,
        position: position++,
      })
    }
  }
  for (const c of doc.checkboxes) {
    const { title, truncated } = shortTitle(c.text)
    const status = c.done || DONE_SECTION.test(c.section) ? "done" : "open"
    items.push({
      key: uniqueKey(`${prefix}:item:${hash(c.text)}`),
      title,
      detail: truncated ? c.text : null,
      kind: backlogKind(title, c.text),
      impact: 2,
      effort: level(c.text) ?? 2,
      status,
      doneRef: null,
      position: position++,
    })
  }
  const withItems = new Set([
    ...doc.tables
      .filter((t) => col(t.header, "Aufgabe", "Task", "Titel") >= 0)
      .map((t) => t.section),
    ...doc.checkboxes.map((c) => c.section),
  ])
  for (const s of doc.sections) if (!withItems.has(s)) ignoredSections.push(s)
  return { items, ignoredSections }
}

// ---------- posts/ideas.md ----------

export interface ContentParsed {
  key: string
  title: string
  kind: "blog" | "landing"
  keyword: string | null
  intent: string | null
  brief: string | null
  status: "idea" | "approved" | "draft" | "review" | "live" | "discarded"
  statusText: string
  notes: string | null
  urlPath: string | null
  draftPath: string | null
  position: number
  unknownStatus: boolean
}

const CONTENT_STATUS: [RegExp, ContentParsed["status"]][] = [
  [/^(idee|idea)/i, "idea"],
  [/^(freigegeben|approved)/i, "approved"],
  [/^(entwurf|draft)/i, "draft"],
  [/^(abnahme|review|prüfung)/i, "review"],
  [/^(veröffentlicht|live|online)/i, "live"],
  [/^(verworfen|discarded|abgelehnt)/i, "discarded"],
]

/** Candidate draft files posts/<slug>.md for a topic title. */
function draftFor(postsDir: string, title: string): string | null {
  const base = title.replace(/\([^)]*\)/g, " ").trim()
  const candidates = [
    slugify(base),
    slugify(title),
    slugify(
      base.replace(/[äöü]/g, (c) => ({ ä: "a", ö: "o", ü: "u" })[c] ?? c)
    ),
  ]
  for (const slug of [...new Set(candidates)].filter(Boolean)) {
    const file = path.join(postsDir, `${slug}.md`)
    if (fs.existsSync(file)) return file
  }
  return null
}

/** posts/ideas.md: one content item per row of the topic table. */
export function parseIdeas(text: string, site: string, postsDir: string) {
  const doc = parseMarkdown(text)
  const items: ContentParsed[] = []
  let position = 0
  const used = new Set<string>()
  for (const t of doc.tables) {
    const iTitle = col(t.header, "Thema", "Titel", "Title", "Topic")
    if (iTitle < 0) continue
    const iIntent = col(
      t.header,
      "Suchintention (Beispiele aus Autocomplete)",
      "Suchintention",
      "Intention",
      "Intent"
    )
    const iOwn = col(t.header, "Eigener Beitrag", "Beitrag", "Inhalt")
    const iProduct = col(t.header, "Produktbezug", "Produkt")
    const iStatus = col(t.header, "Status")
    const iKeyword = col(t.header, "Keyword", "Suchbegriff")
    const iUrl = col(t.header, "URL", "Pfad", "Slug")
    for (const row of t.rows) {
      const title = cell(row, iTitle)
      if (!title) continue
      const statusText = cell(row, iStatus) || "idee"
      const match = CONTENT_STATUS.find(([re]) => re.test(statusText))
      const status = match ? match[1] : "idea"
      const rest = statusText.replace(/^\S+\s*/, "").trim()
      const own = cell(row, iOwn)
      const product = cell(row, iProduct)
      const brief = [
        own ? `Eigener Beitrag: ${own}` : null,
        product ? `Produktbezug: ${product}` : null,
      ]
        .filter(Boolean)
        .join("\n")
      let key = `wg-ws:${site}:posts/ideas.md:${slugify(title) || hash(title)}`
      while (used.has(key)) key += "~"
      used.add(key)
      const url = cell(row, iUrl)
      items.push({
        key,
        title,
        kind: /\(tool\)/i.test(title) ? "landing" : "blog",
        keyword: cell(row, iKeyword) || null,
        intent: cell(row, iIntent) || null,
        brief: brief || null,
        status,
        statusText,
        notes: rest ? `Status-Notiz (Quelle): ${rest}` : null,
        urlPath: url ? (url.startsWith("/") ? url : `/${url}`) : null,
        draftPath: draftFor(postsDir, title),
        position: position++,
        unknownStatus: !match,
      })
    }
  }
  return items
}

// ---------- README Learnings ----------

export interface LearningParsed {
  key: string
  date: string
  site: string
  statement: string
  evidence: string | null
}

/** Sentences with an evidence signal; the rest of the entry is the observation. */
const EVIDENCE =
  /(belegt|\bbeleg|\blaut\b|\blauf \d|\bläufe\b|\brun \d|\bcurl\b|\bsiehe\b|studie|research|report|abgeglichen)/i

export function evidenceOf(text: string): string | null {
  const sentences = text
    .split(/(?<=[.!?)])\s+(?=[A-ZÄÖÜ`„(])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const ev = sentences.filter((s) => EVIDENCE.test(s))
  return ev.length ? ev.join(" ") : null
}

/** "## Learnings": bullets "- YYYY-MM-DD, <site>: <text>" (continuation lines appended). */
export function parseLearnings(readme: string) {
  const lines = readme.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+Learnings\b/i.test(l))
  if (start < 0)
    return { found: false, items: [] as LearningParsed[], unparsed: 0 }
  const bullets: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^##\s/.test(l)) break
    if (/^\s*[-*]\s+/.test(l)) bullets.push(l.replace(/^\s*[-*]\s+/, "").trim())
    else if (/^\s{2,}\S/.test(l) && bullets.length)
      bullets[bullets.length - 1] += " " + l.trim()
  }
  const items: LearningParsed[] = []
  let unparsed = 0
  for (const b of bullets) {
    const m = /^(\d{4}-\d{2}-\d{2}),\s*([^:]+?):\s+(.+)$/.exec(b)
    if (!m) {
      unparsed++
      continue
    }
    const [, date, site, text] = m
    items.push({
      key: `wg:README.md:learnings:${hash(`${date}|${site}|${text}`)}`,
      date,
      site: site.trim(),
      statement: text.trim(),
      evidence: evidenceOf(text),
    })
  }
  return { found: true, items, unparsed }
}

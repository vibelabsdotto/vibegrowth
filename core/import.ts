/**
 * Idempotent import of the existing shortform-content folder layout:
 *   <brand>/accounts.md, <brand>/<account>/{journal.md, angles.md, persona/persona.md,
 *   posts/, performance.jsonl, .autopilot/matches.json, analysis/<handle>_<id>/}
 * plus the content-autopilot accounts.json. Every imported row carries a source_key,
 * so a second run creates nothing new and never overwrites edits made in the tool.
 * Files are only read.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { eq } from "drizzle-orm"
import { toRelative } from "./config"
import { tx, type Ctx } from "./db"
import {
  ingestSnapshots,
  readMatches,
  writeMatch,
  type RawSnapshot,
} from "./metrics"
import { scanPostDir } from "./posts"
import {
  accounts,
  brands,
  characters,
  formats,
  formatVersions,
  hooks,
  imageErrors,
  inspirations,
  learnings,
  planEntries,
  posts,
  rules,
} from "./schema"
import {
  addDays,
  germanDate,
  json,
  recordHistory,
  slugify,
  today,
} from "./util"

const ACTOR = "import"

type SourceKeyed = typeof imageErrors | typeof rules | typeof learnings | typeof hooks | typeof planEntries

interface AutopilotAccount {
  id: string
  brand: string
  dir: string
  handle?: string
  language?: string
  format?: string
  project_context_note?: string
}

export interface ImportReport {
  dataDir: string
  created: Record<string, number>
  accounts: {
    id: string
    postFolders: number
    posts: number
    performanceLines: number
    snapshots: number
  }[]
  warnings: string[]
}

const sha = (s: string) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 12)

function read(p: string) {
  try {
    return fs.readFileSync(p, "utf8")
  } catch {
    return null
  }
}

function sections(md: string) {
  const out: { title: string; body: string }[] = []
  let cur: { title: string; lines: string[] } | null = null
  for (const line of md.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      if (cur) out.push({ title: cur.title, body: cur.lines.join("\n") })
      cur = { title: m[1], lines: [] }
    } else if (cur) cur.lines.push(line)
  }
  if (cur) out.push({ title: cur.title, body: cur.lines.join("\n") })
  return out
}

function section(md: string, prefix: string) {
  return (
    sections(md).find((s) =>
      s.title.toLowerCase().startsWith(prefix.toLowerCase())
    )?.body ?? ""
  )
}

function bullets(body: string) {
  return body
    .split("\n")
    .filter((l) => /^- /.test(l))
    .map((l) => l.slice(2).trim())
}

function numbered(body: string) {
  return body
    .split("\n")
    .map((l) => l.match(/^\d+\.\s+(.+)$/)?.[1]?.trim())
    .filter((x): x is string => !!x)
}

function cells(line: string) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim())
}

/** All markdown tables with their nearest preceding heading. */
function tables(md: string) {
  const out: { heading: string; header: string[]; rows: string[][] }[] = []
  const lines = md.split("\n")
  let heading = ""
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,4}\s+(.+)$/)
    if (h) heading = h[1].trim()
    if (
      lines[i].trim().startsWith("|") &&
      lines[i + 1]?.trim().match(/^\|[\s|:-]+\|$/)
    ) {
      const header = cells(lines[i])
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].trim().startsWith("|"))
        rows.push(cells(lines[j++]))
      out.push({ heading, header, rows })
      i = j - 1
    }
  }
  return out
}

const strip = (s: string) => s.replace(/`/g, "").replace(/\*\*/g, "").trim()
const firstSentence = (s: string) =>
  (s.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? s).trim()
const dateIn = (s: string) => germanDate(s)

function ruleKind(text: string) {
  const t = text.toLowerCase()
  if (/\bcta\b|app-name|link-in-bio|engagement/.test(t)) return "cta"
  if (/hook/.test(t)) return "hook"
  if (/caption|rezept immer|quelle/.test(t)) return "caption"
  if (/sprache|overlay|großbuchstaben|klein geschrieben|style:/.test(t))
    return "copy"
  if (/format|dramaturgie|b-roll|pinterest|post pro tag|postet selbst/.test(t))
    return "production"
  return "other"
}

const IMAGE_ERROR_HINT =
  /(aussehen|holzlöffel|in mehr als|bildern gleich|sehen alle cover gleich)/i

export function importContent(
  ctx: Ctx,
  opts: { accountsJson?: string | null } = {}
): ImportReport {
  const dataDir = ctx.config.dataDir
  const created: Record<string, number> = {}
  const warnings: string[] = []
  const bump = (k: string, n = 1) => (created[k] = (created[k] ?? 0) + n)
  const rel = (abs: string) => toRelative(dataDir, abs)

  const autopilot: AutopilotAccount[] = (() => {
    if (!opts.accountsJson) return []
    const raw = read(opts.accountsJson)
    if (!raw) {
      warnings.push(`accounts.json nicht lesbar: ${opts.accountsJson}`)
      return []
    }
    return (JSON.parse(raw) as { accounts: AutopilotAccount[] }).accounts
  })()

  const exists = (table: SourceKeyed, key: string) =>
    !!ctx.db.select({ k: table.sourceKey }).from(table).where(eq(table.sourceKey, key)).get()

  const report: ImportReport["accounts"] = []

  tx(ctx, () => {
    // ---------- brands and accounts ----------
    const brandDirs = fs
      .readdirSync(dataDir, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          !d.name.startsWith(".") &&
          fs.existsSync(path.join(dataDir, d.name, "accounts.md"))
      )

    for (const bd of brandDirs) {
      const brandId = bd.name
      const accountsMd = read(path.join(dataDir, brandId, "accounts.md")) ?? ""
      const brandName =
        accountsMd.match(/^#\s+(.+?)\s+[—-]\s+Accounts/m)?.[1]?.trim() ??
        brandId
      const contextNote = autopilot.find(
        (a) => a.brand === brandId
      )?.project_context_note
      if (!ctx.db.select().from(brands).where(eq(brands.id, brandId)).get()) {
        ctx.db
          .insert(brands)
          .values({
            id: brandId,
            name: brandName,
            notionUrl: contextNote
              ? `https://app.notion.com/p/${contextNote.replace(/-/g, "")}`
              : null,
          })
          .run()
        recordHistory(ctx, {
          actor: ACTOR,
          entity: "brand",
          entityId: brandId,
          action: "import",
        })
        bump("brands")
      }
      const accountTable = tables(accountsMd).find(
        (t) => t.header[0]?.toLowerCase() === "account"
      )

      const accountDirs = fs
        .readdirSync(path.join(dataDir, brandId), { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            !d.name.startsWith(".") &&
            fs.existsSync(path.join(dataDir, brandId, d.name, "posts"))
        )

      for (const ad of accountDirs) {
        const accountId = ad.name
        const accDir = `${brandId}/${accountId}`
        const absAcc = path.join(dataDir, accDir)
        const ap = autopilot.find((a) => a.dir === accDir || a.id === accountId)
        const row = accountTable?.rows.find((r) =>
          r.some((c) => c.includes(`${accountId}/`))
        )
        const name = row ? strip(row[0]) : accountId
        const handle =
          ap?.handle ?? strip(row?.[1] ?? "").match(/@([\w.]+)/)?.[1] ?? null
        const journal = read(path.join(absAcc, "journal.md"))

        // format: autopilot description, then content_format in post manifests, then accounts.md
        const postDirs = fs
          .readdirSync(path.join(absAcc, "posts"), { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => d.name)
          .sort()
        const manifests = postDirs
          .map((p) =>
            read(path.join(absAcc, "posts", p, "render-manifest.json"))
          )
          .filter((m): m is string => !!m)
          .map(
            (m) =>
              JSON.parse(m) as {
                style?: string
                content_format?: string
                slides?: { text_scale?: number }[]
              }
          )
        const latestManifest = manifests.at(-1)
        let formatName: string | null = null
        let formatDescription: string | null = null
        if (ap?.format) {
          const m = ap.format.match(/^(.+?)\s*\((.+)\)\s*$/)
          formatName = (m?.[1] ?? ap.format).trim()
          formatDescription = m?.[2]?.trim() ?? null
        } else {
          formatName =
            [...manifests].reverse().find((m) => m.content_format)
              ?.content_format ??
            accountsMd.match(
              new RegExp(`##\\s+${name}[\\s\\S]*?Content-Format \`([a-z-]+)\``)
            )?.[1] ??
            null
        }
        const formatId = formatName ? slugify(formatName) : null
        if (
          formatId &&
          !ctx.db.select().from(formats).where(eq(formats.id, formatId)).get()
        ) {
          const params: Record<string, unknown> = {}
          if (latestManifest?.style) params.style = latestManifest.style
          const scale = latestManifest?.slides?.find(
            (s) => typeof s.text_scale === "number"
          )?.text_scale
          if (scale) params.text_scale = scale
          ctx.db
            .insert(formats)
            .values({
              id: formatId,
              name: formatName!,
              description: formatDescription,
              brandId,
            })
            .run()
          ctx.db
            .insert(formatVersions)
            .values({
              formatId,
              version: 1,
              description: formatDescription,
              rendererParams: json(params),
              changeNote: "Import aus dem Bestand",
              actor: ACTOR,
            })
            .run()
          recordHistory(ctx, {
            actor: ACTOR,
            entity: "format",
            entityId: formatId,
            action: "import",
          })
          bump("formats")
        }

        // character from persona/persona.md
        const personaDir = path.join(absAcc, "persona")
        const personaMd = read(path.join(personaDir, "persona.md"))
        let characterId: string | null = null
        if (personaMd) {
          characterId = accountId
          if (
            !ctx.db
              .select()
              .from(characters)
              .where(eq(characters.id, characterId))
              .get()
          ) {
            const images = fs
              .readdirSync(personaDir, { withFileTypes: true })
              .filter((f) => f.isFile() && /\.(png|jpe?g|webp)$/i.test(f.name))
              .map((f) => rel(path.join(personaDir, f.name)))
              .sort()
            ctx.db
              .insert(characters)
              .values({
                id: characterId,
                name,
                brandId,
                persona: personaMd.trim(),
                referenceImages: json(images),
                sourceKey: `persona:${accDir}`,
              })
              .run()
            recordHistory(ctx, {
              actor: ACTOR,
              entity: "character",
              entityId: characterId,
              action: "import",
            })
            bump("characters")
          }
        }

        if (
          !ctx.db
            .select()
            .from(accounts)
            .where(eq(accounts.id, accountId))
            .get()
        ) {
          ctx.db
            .insert(accounts)
            .values({
              id: accountId,
              brandId,
              name,
              handle,
              platform: "tiktok",
              language: ap?.language ?? null,
              status: ap ? "active" : "planned",
              dir: accDir,
              defaultFormatId: formatId,
              mode: ap ? "autopilot" : "manual",
              ctaRule: "engagement",
              postsPerDay: 1,
              characterId,
              notionContextId: ap?.project_context_note ?? null,
              notes: row ? strip(row[2] ?? "") || null : null,
            })
            .run()
          recordHistory(ctx, {
            actor: ACTOR,
            entity: "account",
            entityId: accountId,
            action: "import",
          })
          bump("accounts")
        }
        const account = ctx.db
          .select()
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .get()!

        // ---------- inspiration from analysis/<handle>_<id> ----------
        const analysisDir = path.join(absAcc, "analysis")
        const inspoByUrl = new Map<string, number>()
        if (fs.existsSync(analysisDir)) {
          for (const d of fs.readdirSync(analysisDir, {
            withFileTypes: true,
          })) {
            const m = d.isDirectory() && d.name.match(/^(.+)_(\d{15,})$/)
            if (!m) continue
            const dirAbs = path.join(analysisDir, d.name)
            const briefing = read(path.join(dirAbs, "briefing.md"))
            const found = briefing?.match(
              /https:\/\/www\.tiktok\.com\/@[\w.]+\/(?:photo|video)\/\d+/
            )?.[0]
            const url = found ?? `https://www.tiktok.com/@${m[1]}/photo/${m[2]}`
            const key = `analysis:${accDir}:${d.name}`
            const byUrl = ctx.db
              .select()
              .from(inspirations)
              .where(eq(inspirations.url, url))
              .get()
            if (byUrl) {
              inspoByUrl.set(url, byUrl.id)
              continue
            }
            const files = fs
              .readdirSync(dirAbs, { withFileTypes: true })
              .filter((f) => f.isFile() && /\.(png|jpe?g|webp)$/i.test(f.name))
              .map((f) => rel(path.join(dirAbs, f.name)))
              .sort()
              .slice(0, 12)
            const title = briefing?.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
            const res = ctx.db
              .insert(inspirations)
              .values({
                url,
                platform: "tiktok",
                type: "format",
                note: title,
                tags: json([]),
                brandId,
                accountId,
                status: briefing ? "analyzed" : "new",
                files: json(files),
                briefingPath: briefing
                  ? rel(path.join(dirAbs, "briefing.md"))
                  : null,
                actor: ACTOR,
                sourceKey: key,
              })
              .returning()
              .get()
            inspoByUrl.set(url, res.id)
            recordHistory(ctx, {
              actor: ACTOR,
              entity: "inspiration",
              entityId: res.id,
              action: "import",
            })
            bump("inspirations")
          }
        }

        // ---------- journal: rules, image errors, learnings, queue, log, winners ----------
        const logRows: {
          date: string
          slug: string
          topic: string
          hook: string
          direction: string
          why: string
        }[] = []
        if (journal) {
          for (const b of bullets(section(journal, "Leitplanken"))) {
            const date = dateIn(b) ?? "2026-10-13"
            if (IMAGE_ERROR_HINT.test(b)) {
              const parts = b
                .split(/(?<=\.)\s+/)
                .map((s) => s.trim())
                .filter(Boolean)
              for (const part of parts) {
                const key = `journal:${accDir}:image:${sha(part)}`
                if (exists(imageErrors, key)) continue
                ctx.db
                  .insert(imageErrors)
                  .values({
                    title: firstSentence(part).replace(/\.$/, ""),
                    countermeasure: part,
                    formatIds: json(formatId ? [formatId] : []),
                    source: `${accDir}/journal.md, Leitplanken von Max`,
                    actor: "max",
                    sourceKey: key,
                  })
                  .run()
                bump("imageErrors")
              }
              continue
            }
            const key = `journal:${accDir}:rule:${sha(b)}`
            if (exists(rules, key)) continue
            ctx.db
              .insert(rules)
              .values({
                scopeType: "account",
                scopeId: accountId,
                kind: ruleKind(b),
                text: b,
                source: `${accDir}/journal.md, Leitplanken von Max`,
                actor: "max",
                date,
                sourceKey: key,
              })
              .run()
            bump("rules")
          }

          for (const b of bullets(section(journal, "Learnings"))) {
            const m = b.match(/^(\d{1,2}\.\d{1,2}\.\d{4}):\s*(.+)$/)
            const text = m ? m[2] : b
            const key = `journal:${accDir}:learning:${sha(b)}`
            if (exists(learnings, key)) continue
            ctx.db
              .insert(learnings)
              .values({
                scopeType: "account",
                scopeId: accountId,
                statement: firstSentence(text),
                evidence: text,
                date: (m && germanDate(m[1])) || today(),
                actor: "echo",
                source: `${accDir}/journal.md, Learnings`,
                sourceKey: key,
              })
              .run()
            bump("learnings")
          }

          const log = tables(section(journal, "Log"))[0]
          for (const r of log?.rows ?? []) {
            const date = germanDate(r[0])
            const slug = strip(r[1])
              .replace(/^posts\//, "")
              .replace(/\/$/, "")
            if (date && slug)
              logRows.push({
                date,
                slug,
                topic: r[2],
                hook: r[3],
                direction: r[4],
                why: r[5] ?? "",
              })
          }

          for (const r of tables(section(journal, "Gewinner"))[0]?.rows ?? []) {
            if (!r[0]) continue
            const key = `journal:${accDir}:winner:${sha(r[0])}`
            if (exists(hooks, key)) continue
            ctx.db
              .insert(hooks)
              .values({
                accountId,
                text: strip(r[0]),
                mechanism: r[2] || null,
                winner: true,
                actor: "echo",
                source: `${accDir}/journal.md`,
                sourceKey: key,
              })
              .run()
            bump("hooks")
          }
        }

        // log rows become delivered plan entries (created before posts so posts link by date)
        for (const l of logRows) {
          const key = `journal:${accDir}:log:${l.date}:${l.slug}`
          if (exists(planEntries, key)) continue
          const manifest = read(
            path.join(absAcc, "posts", l.slug, "render-manifest.json")
          )
          const ref = manifest
            ? (JSON.parse(manifest) as { source_reference?: string })
                .source_reference
            : undefined
          const inspirationId = ref
            ? (inspoByUrl.get(ref.replace(/\?.*$/, "")) ?? null)
            : null
          ctx.db
            .insert(planEntries)
            .values({
              date: l.date,
              accountId,
              formatId: account.defaultFormatId,
              topic: l.topic,
              hook: l.hook,
              hookDirection: l.direction || null,
              rationale: l.why || null,
              origin: "agent",
              status: "delivered",
              inspirationId,
              createdBy: "echo",
              sourceKey: key,
            })
            .run()
          bump("planEntries")
        }

        // ---------- posts ----------
        const matches = JSON.parse(
          read(path.join(absAcc, ".autopilot", "matches.json")) ?? "{}"
        ) as Record<
          string,
          { post: string | null; dist: number | null; checked: number }
        >
        const perfLines = (read(path.join(absAcc, "performance.jsonl")) ?? "")
          .split("\n")
          .filter((l) => l.trim())
          .map(
            (l) =>
              JSON.parse(l) as RawSnapshot & {
                created_at?: string
                url?: string
              }
          )
        const live = new Map<
          string,
          { id: string; url?: string; created_at?: string }
        >()
        for (const [tid, m] of Object.entries(matches)) {
          if (!m.post) continue
          const snap = perfLines.find((p) => p.id === tid)
          live.set(m.post, {
            id: tid,
            url: snap?.url,
            created_at: snap?.created_at,
          })
        }

        for (const slug of postDirs) {
          const dir = `${accDir}/posts/${slug}`
          if (
            ctx.db
              .select({ id: posts.id })
              .from(posts)
              .where(eq(posts.dir, dir))
              .get()
          )
            continue
          const scan = scanPostDir(dataDir, dir)
          const l = live.get(slug)
          const logged = logRows.find((r) => r.slug === slug)
          const entry = logged
            ? ctx.db
                .select()
                .from(planEntries)
                .where(
                  eq(
                    planEntries.sourceKey,
                    `journal:${accDir}:log:${logged.date}:${logged.slug}`
                  )
                )
                .get()
            : undefined
          const res = ctx.db
            .insert(posts)
            .values({
              accountId,
              planEntryId: entry?.id ?? null,
              dir,
              slug: scan.slug,
              date: scan.date,
              hook: scan.hook,
              caption: scan.caption,
              slideCount: scan.slideCount,
              slides: json(scan.slides),
              contactSheet: scan.contactSheet,
              mp4: scan.mp4,
              zip: scan.zip,
              deliveredAt: logged ? `${logged.date}T05:00:00.000Z` : null,
              tiktokId: l?.id ?? null,
              tiktokUrl: l?.url ?? null,
              postedAt: l?.created_at ?? null,
              status: l ? "posted" : logged ? "delivered" : "produced",
            })
            .returning()
            .get()
          if (entry && l)
            ctx.db
              .update(planEntries)
              .set({ status: "posted" })
              .where(eq(planEntries.id, entry.id))
              .run()
          recordHistory(ctx, {
            actor: ACTOR,
            entity: "post",
            entityId: res.id,
            action: "import",
          })
          bump("posts")
        }

        // ---------- angles ----------
        const queue = journal ? numbered(section(journal, "Warteschlange")) : []
        const queueIds = new Set(
          queue.map((q) => q.match(/^([A-Z]\d+)\b/)?.[1]).filter(Boolean)
        )
        const anglesMd = read(path.join(absAcc, "angles.md"))
        let ideaPos = 100
        for (const t of anglesMd ? tables(anglesMd) : []) {
          const col = (re: RegExp) => t.header.findIndex((h) => re.test(h))
          const iAngle = col(/^angle$/i)
          if (iAngle < 0) continue
          const iId = col(/^id$/i)
          const iHook = col(/hook/i)
          const iStatus = col(/^status$/i)
          for (const r of t.rows) {
            const angle = strip(r[iAngle] ?? "")
            if (!angle) continue
            const id = iId >= 0 ? strip(r[iId]) : ""
            const label = id ? `${id} ${angle}` : angle
            const joined = r.join(" ")
            const postRef = joined.match(/posts\/([\w-]+)\/?/)?.[1]
            if (postRef) {
              const p = ctx.db
                .select()
                .from(posts)
                .where(eq(posts.dir, `${accDir}/posts/${postRef}`))
                .get()
              if (p && !p.angle)
                ctx.db
                  .update(posts)
                  .set({ angle: label })
                  .where(eq(posts.id, p.id))
                  .run()
              continue
            }
            const status = iStatus >= 0 ? r[iStatus] : ""
            if (
              /produziert|verworfen|live/i.test(joined) ||
              !/idee/i.test(status)
            )
              continue
            if (id && queueIds.has(id)) continue
            const key = `angles:${accDir}:${id || sha(angle)}`
            if (exists(planEntries, key)) continue
            const hook = iHook >= 0 ? strip(r[iHook]).replace(/^"|"$/g, "") : ""
            ctx.db
              .insert(planEntries)
              .values({
                date: null,
                accountId,
                formatId: account.defaultFormatId,
                topic: angle,
                angle: [id, t.heading].filter(Boolean).join(" · ") || null,
                hookDirection: hook ? `Beispiel-Hook: ${hook}` : null,
                rationale: `Offener Angle aus angles.md (${t.heading})`,
                origin: "agent",
                status: "idea",
                position: ideaPos++,
                createdBy: "echo",
                sourceKey: key,
              })
              .run()
            bump("ideas")
          }
        }

        // queue becomes planned entries on the next free days (explicit dates win)
        let cursor = addDays(today(), 1)
        const taken = new Set(
          ctx.db
            .select({ date: planEntries.date })
            .from(planEntries)
            .where(eq(planEntries.accountId, accountId))
            .all()
            .map((e) => e.date)
        )
        queue.forEach((q, i) => {
          const key = `journal:${accDir}:queue:${sha(q)}`
          if (exists(planEntries, key)) return
          // "(... jetzt Sa 17.10.)": a weekday-prefixed date is the slot the agent already picked
          const explicit = [
            ...q.matchAll(
              /\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?\s+(\d{1,2})\.(\d{1,2})\./g
            ),
          ].at(-1)
          let date: string
          if (
            explicit &&
            Number(explicit[2]) >= 1 &&
            Number(explicit[2]) <= 12
          ) {
            date = `${today().slice(0, 4)}-${String(explicit[2]).padStart(2, "0")}-${String(explicit[1]).padStart(2, "0")}`
          } else {
            while (taken.has(cursor)) cursor = addDays(cursor, 1)
            date = cursor
          }
          taken.add(date)
          const direction =
            q.match(/Hook-Richtung:\s*(.+?)(?:\.\s|\.?$)/)?.[1]?.trim() ?? null
          const topic = firstSentence(q.replace(/\s*\(.*?\)\s*/g, " "))
            .replace(/\.$/, "")
            .trim()
          ctx.db
            .insert(planEntries)
            .values({
              date,
              accountId,
              formatId: account.defaultFormatId,
              topic,
              angle: q.match(/^([A-Z]\d+)\b/)?.[1] ?? null,
              hookDirection: direction,
              rationale: `Warteschlange Platz ${i + 1} aus journal.md: ${q}`,
              origin: "agent",
              status: "planned",
              position: i,
              createdBy: "echo",
              sourceKey: key,
            })
            .run()
          bump("planEntries")
        })

        // ---------- metrics ----------
        const cache = readMatches(ctx, accountId)
        for (const [tid, m] of Object.entries(matches)) {
          if (!cache[tid])
            writeMatch(ctx, accountId, tid, {
              post: m.post,
              dist: m.dist,
              checked: m.checked,
            })
        }
        const ing = ingestSnapshots(ctx, accountId, perfLines, ACTOR)
        if (ing.inserted) bump("snapshots", ing.inserted)

        const dbPosts = ctx.db
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.accountId, accountId))
          .all().length
        const snapCount = ctx.sqlite
          .prepare(
            "SELECT COUNT(*) n FROM metric_snapshots WHERE account_id = ?"
          )
          .get(accountId) as { n: number }
        report.push({
          id: accountId,
          postFolders: postDirs.length,
          posts: dbPosts,
          performanceLines: perfLines.length,
          snapshots: snapCount.n,
        })
      }
    }
  })

  return { dataDir, created, accounts: report, warnings }
}

import { Injectable } from "@nestjs/common"
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm"
import {
  channels,
  geoChecks,
  geoQuestions,
  mentionTargets,
  projects,
} from "../../core/schema"
import {
  assertDate,
  getById,
  json,
  nowIso,
  parseJson,
  patchRow,
  recordHistory,
  VGError,
} from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import {
  listOf,
  normalizeDomain,
  oneOf,
  optDate,
  requireProject,
  round,
} from "./shared"
import { brandDomainsOf, brandKey, domainKind, MENTION_KINDS } from "./sources"

export const GEO_STATUS = ["ok", "error"] as const
export const MENTION_STATUS = [
  "new",
  "contacted",
  "listed",
  "rejected",
  "ignored",
] as const

export interface GeoSource {
  url: string
  title?: string | null
  domain?: string | null
}

export interface GeoCheckInput {
  projectId?: string
  /** alias of projectId (kpi ingest style) */
  project?: string
  questionId?: number
  question?: string
  date: string
  engine: string
  status?: string
  mentioned?: boolean
  position?: number | null
  cited?: boolean
  inSources?: boolean
  brands?: string[]
  competitors?: unknown[]
  links?: string[]
  citedUrls?: string[]
  sources?: (GeoSource | string)[]
  answer?: string | null
  model?: string | null
  evidence?: string | null
  meta?: Record<string, unknown>
  error?: string | null
  sourceKey?: string | null
}

type GeoCheckRow = typeof geoChecks.$inferSelect
type MentionRow = typeof mentionTargets.$inferSelect

export function geoCheckOut(c: GeoCheckRow) {
  return {
    ...c,
    brands: parseJson<string[]>(c.brands, []),
    competitors: parseJson<unknown[]>(c.competitors, []),
    links: parseJson<string[]>(c.links, []),
    citedUrls: parseJson<string[]>(c.citedUrls, []),
    sources: parseJson<GeoSource[]>(c.sources, []),
    meta: parseJson<Record<string, unknown>>(c.meta, {}),
  }
}

function names(list: unknown[]): string[] {
  return list
    .map((x) =>
      typeof x === "string"
        ? x
        : typeof x === "object" && x && "name" in x
          ? String(x.name)
          : ""
    )
    .filter((s) => s.trim())
}

function cleanSources(list: (GeoSource | string)[] | undefined): GeoSource[] {
  return (list ?? []).flatMap((s) => {
    const url = typeof s === "string" ? s : s?.url
    if (typeof url !== "string" || !url.trim()) return []
    const title = typeof s === "string" ? null : (s.title ?? null)
    return [
      {
        url: url.trim(),
        title,
        domain:
          (typeof s !== "string" && s.domain
            ? normalizeDomain(s.domain)
            : null) || normalizeDomain(url),
      },
    ]
  })
}

function strings(list: unknown[] | undefined, field: string): string[] {
  if (list === undefined) return []
  if (!Array.isArray(list))
    throw new VGError("INVALID", `${field} muss eine Liste sein`)
  return list.filter((x): x is string => typeof x === "string" && !!x.trim())
}

/** Domains of the project itself (project url, channel urls): no mention targets. */
function ownDomains(projectUrl: string | null, channelUrls: (string | null)[]) {
  return [projectUrl, ...channelUrls]
    .map((u) => normalizeDomain(u))
    .filter(Boolean)
}

@Injectable()
export class GeoService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  // ---------- questions ----------

  listQuestions(f: { project?: string; all?: boolean }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(geoQuestions.projectId, f.project))
    if (!f.all) conds.push(eq(geoQuestions.active, true))
    const qs = this.ctx.db
      .select()
      .from(geoQuestions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(geoQuestions.projectId), asc(geoQuestions.id))
      .all()
    if (!qs.length) return []
    const checks = this.ctx.db
      .select({
        questionId: geoChecks.questionId,
        date: geoChecks.date,
        engine: geoChecks.engine,
        status: geoChecks.status,
        mentioned: geoChecks.mentioned,
        position: geoChecks.position,
        cited: geoChecks.cited,
      })
      .from(geoChecks)
      .where(
        inArray(
          geoChecks.questionId,
          qs.map((q) => q.id)
        )
      )
      .orderBy(desc(geoChecks.date), asc(geoChecks.engine))
      .all()
    return qs.map((q) => {
      const own = checks.filter((c) => c.questionId === q.id)
      const last = own[0]
      return {
        ...q,
        checks: own.length,
        lastCheck: last
          ? {
              date: last.date,
              engine: last.engine,
              status: last.status,
              mentioned: last.mentioned,
              position: last.position,
              cited: last.cited,
            }
          : null,
      }
    })
  }

  addQuestion(
    input: {
      projectId: string
      text: string
      active?: boolean
      sourceKey?: string | null
    },
    actor: string
  ) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const project = requireProject(ctx, input.projectId)
      const text = input.text?.trim()
      if (!text) throw new VGError("INVALID", "text fehlt")
      const dup = ctx.db
        .select()
        .from(geoQuestions)
        .where(
          and(
            eq(geoQuestions.projectId, project.id),
            eq(geoQuestions.text, text)
          )
        )
        .get()
      if (dup)
        throw new VGError(
          "CONFLICT",
          `Frage existiert bereits für ${project.id} (ID ${dup.id})`
        )
      return this.insertQuestion(
        project.id,
        text,
        input.active ?? true,
        input.sourceKey ?? null,
        actor
      )
    })
  }

  private insertQuestion(
    projectId: string,
    text: string,
    active: boolean,
    sourceKey: string | null,
    actor: string
  ) {
    const row = this.ctx.db
      .insert(geoQuestions)
      .values({ projectId, text, active, sourceKey })
      .returning()
      .get()
    recordHistory(this.ctx, {
      actor,
      entity: "geo_question",
      entityId: row.id,
      action: "create",
      after: row,
    })
    return row
  }

  updateQuestion(
    id: number,
    p: { text?: string; active?: boolean },
    actor: string
  ) {
    const ctx = this.ctx
    return this.database.tx(() => {
      const q = getById(ctx, geoQuestions, id, "GEO-Frage")
      const patch: Record<string, unknown> = {}
      if (p.text !== undefined) {
        const text = p.text?.trim()
        if (!text) throw new VGError("INVALID", "text darf nicht leer sein")
        const dup = ctx.db
          .select()
          .from(geoQuestions)
          .where(
            and(
              eq(geoQuestions.projectId, q.projectId),
              eq(geoQuestions.text, text)
            )
          )
          .get()
        if (dup && dup.id !== id)
          throw new VGError(
            "CONFLICT",
            `Frage existiert bereits (ID ${dup.id})`
          )
        patch.text = text
      }
      if (p.active !== undefined) patch.active = p.active
      return patchRow(ctx, geoQuestions, "geo_question", id, patch, actor)
    })
  }

  // ---------- checks ----------

  /**
   * Upsert per (project, question, date, engine); the question is resolved by id or by text within
   * the project (created when new). Afterwards the mention targets of all touched domains are
   * recomputed from every ok check of the project.
   */
  recordChecks(checks: GeoCheckInput[], actor: string) {
    const ctx = this.ctx
    if (!Array.isArray(checks) || !checks.length)
      throw new VGError("INVALID", "checks ist leer")
    return this.database.tx(() => {
      let inserted = 0
      let updated = 0
      const createdQuestions: {
        id: number
        projectId: string
        text: string
      }[] = []
      const touched = new Map<string, Set<string>>()
      const ids: number[] = []
      checks.forEach((c, i) => {
        const at = `checks[${i}]`
        const project = requireProject(ctx, c.projectId ?? c.project)
        let question: typeof geoQuestions.$inferSelect | undefined
        if (c.questionId !== undefined && c.questionId !== null) {
          question = getById(ctx, geoQuestions, c.questionId, "GEO-Frage")
          if (question.projectId !== project.id)
            throw new VGError(
              "INVALID",
              `${at}: Frage ${question.id} gehört zu Projekt ${question.projectId}, nicht zu ${project.id}`
            )
        } else {
          const text = c.question?.trim()
          if (!text)
            throw new VGError(
              "INVALID",
              `${at}: questionId oder question fehlt`
            )
          question = ctx.db
            .select()
            .from(geoQuestions)
            .where(
              and(
                eq(geoQuestions.projectId, project.id),
                eq(geoQuestions.text, text)
              )
            )
            .get()
          if (!question) {
            question = this.insertQuestion(project.id, text, true, null, actor)
            createdQuestions.push({
              id: question.id,
              projectId: project.id,
              text,
            })
          }
        }
        const date = assertDate(c.date, `${at}.date`)
        const engine = c.engine?.trim()
        if (!engine) throw new VGError("INVALID", `${at}: engine fehlt`)
        const sources = cleanSources(c.sources)
        const links = strings(c.links, `${at}.links`)
        const citedUrls = strings(c.citedUrls, `${at}.citedUrls`)
        const values = {
          projectId: project.id,
          questionId: question.id,
          date,
          engine,
          status: oneOf(c.status ?? "ok", GEO_STATUS, `${at}.status`),
          mentioned: !!c.mentioned,
          position: c.position ?? null,
          cited: !!c.cited,
          inSources: !!c.inSources,
          brands: json(strings(c.brands, `${at}.brands`)),
          competitors: json(c.competitors ?? []),
          links: json(links),
          citedUrls: json(citedUrls),
          sources: json(sources),
          answer: c.answer ?? null,
          model: c.model ?? null,
          evidence: c.evidence ?? null,
          meta: json(c.meta ?? {}),
          error: c.error ?? null,
          sourceKey: c.sourceKey ?? null,
        }
        const existing = ctx.db
          .select({ id: geoChecks.id })
          .from(geoChecks)
          .where(
            and(
              eq(geoChecks.projectId, project.id),
              eq(geoChecks.questionId, question.id),
              eq(geoChecks.date, date),
              eq(geoChecks.engine, engine)
            )
          )
          .get()
        let id: number
        if (existing) {
          ctx.db
            .update(geoChecks)
            .set({ ...values, updatedAt: nowIso() })
            .where(eq(geoChecks.id, existing.id))
            .run()
          id = existing.id
          updated++
        } else {
          id = ctx.db.insert(geoChecks).values(values).returning().get().id
          inserted++
        }
        ids.push(id)
        const set = touched.get(project.id) ?? new Set<string>()
        for (const u of [...links, ...citedUrls]) set.add(normalizeDomain(u))
        for (const s of sources) set.add(s.domain ?? normalizeDomain(s.url))
        touched.set(project.id, set)
      })
      const mentions = { created: [] as string[], updated: 0 }
      for (const [projectId, domains] of touched) {
        const r = this.refreshMentionTargets(projectId, domains)
        mentions.created.push(...r.created)
        mentions.updated += r.updated
      }
      for (const projectId of touched.keys()) {
        const own = checks.filter(
          (c) => (c.projectId ?? c.project) === projectId
        )
        recordHistory(ctx, {
          actor,
          entity: "geo_checks",
          entityId: projectId,
          action: "import",
          after: {
            checks: own.length,
            dates: [...new Set(own.map((c) => c.date))].sort(),
            engines: [...new Set(own.map((c) => c.engine))].sort(),
            inserted,
            updated,
            mentionTargetsCreated: mentions.created.length,
            mentionTargetsUpdated: mentions.updated,
          },
        })
      }
      return {
        inserted,
        updated,
        ids,
        createdQuestions,
        mentionTargets: mentions,
      }
    })
  }

  /** Recompute seen/cited counts, dates, example URL and kind for the given domains of a project. */
  private refreshMentionTargets(projectId: string, domains: Set<string>) {
    const ctx = this.ctx
    const project = getById(ctx, projects, projectId, "Projekt")
    const own = ownDomains(
      project.url,
      ctx.db
        .select({ url: channels.url })
        .from(channels)
        .where(eq(channels.projectId, projectId))
        .all()
        .map((c) => c.url)
    )
    const isOwn = (d: string) => own.some((o) => d === o || d.endsWith(`.${o}`))
    const wanted = new Set([...domains].filter((d) => d && !isOwn(d)))
    if (!wanted.size) return { created: [], updated: 0 }
    const checks = ctx.db
      .select()
      .from(geoChecks)
      .where(
        and(eq(geoChecks.projectId, projectId), eq(geoChecks.status, "ok"))
      )
      .all()
      .map(geoCheckOut)
    const agg = new Map<
      string,
      {
        seen: number
        cited: number
        first: string
        last: string
        urls: Map<string, string>
        citedUrl: string | null
      }
    >()
    const allBrands: string[] = []
    for (const c of checks) {
      allBrands.push(...c.brands, ...names(c.competitors))
      const citedDomains = new Map<string, string>()
      for (const u of [...c.citedUrls, ...c.links]) {
        const d = normalizeDomain(u)
        if (wanted.has(d) && !citedDomains.has(d)) citedDomains.set(d, u)
      }
      const seenDomains = new Map<string, GeoSource>()
      for (const s of c.sources) {
        const d = s.domain || normalizeDomain(s.url)
        if (wanted.has(d) && !seenDomains.has(d)) seenDomains.set(d, s)
      }
      for (const d of new Set([
        ...citedDomains.keys(),
        ...seenDomains.keys(),
      ])) {
        const a = agg.get(d) ?? {
          seen: 0,
          cited: 0,
          first: c.date,
          last: c.date,
          urls: new Map<string, string>(),
          citedUrl: null,
        }
        if (citedDomains.has(d)) {
          a.cited++
          a.citedUrl ??= citedDomains.get(d)!
        }
        if (seenDomains.has(d)) a.seen++
        if (c.date < a.first) a.first = c.date
        if (c.date > a.last) a.last = c.date
        for (const u of [...c.citedUrls, ...c.links])
          if (normalizeDomain(u) === d && !a.urls.has(u)) a.urls.set(u, "")
        for (const s of c.sources)
          if ((s.domain || normalizeDomain(s.url)) === d && !a.urls.get(s.url))
            a.urls.set(s.url, s.title ?? "")
        agg.set(d, a)
      }
    }
    const brandDomains = brandDomainsOf(allBrands, agg.keys())
    const created: string[] = []
    let updated = 0
    for (const [domain, a] of agg) {
      const urls = [...a.urls.keys()]
      const kind = domainKind(urls, brandDomains)
      const example =
        a.citedUrl ??
        [...a.urls.entries()].sort(
          (x, y) => y[1].length - x[1].length
        )[0]?.[0] ??
        null
      const existing = ctx.db
        .select()
        .from(mentionTargets)
        .where(
          and(
            eq(mentionTargets.projectId, projectId),
            eq(mentionTargets.domain, domain)
          )
        )
        .get()
      if (existing) {
        ctx.db
          .update(mentionTargets)
          .set({
            seenCount: a.seen,
            citedCount: a.cited,
            firstSeen: a.first,
            lastSeen: a.last,
            url: existing.url ?? example,
            kind,
            updatedAt: nowIso(),
          })
          .where(eq(mentionTargets.id, existing.id))
          .run()
        updated++
      } else {
        ctx.db
          .insert(mentionTargets)
          .values({
            projectId,
            domain,
            url: example,
            kind,
            seenCount: a.seen,
            citedCount: a.cited,
            firstSeen: a.first,
            lastSeen: a.last,
            status: "new",
          })
          .run()
        created.push(domain)
      }
    }
    return { created, updated }
  }

  listChecks(f: {
    project?: string
    date?: string
    engine?: string
    question?: number
    limit?: number
  }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(geoChecks.projectId, f.project))
    const date = optDate(f.date, "date")
    if (date) conds.push(eq(geoChecks.date, date))
    if (f.engine) conds.push(eq(geoChecks.engine, f.engine))
    if (f.question) conds.push(eq(geoChecks.questionId, f.question))
    const q = this.ctx.db
      .select({ check: geoChecks, question: geoQuestions.text })
      .from(geoChecks)
      .innerJoin(geoQuestions, eq(geoQuestions.id, geoChecks.questionId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(
        desc(geoChecks.date),
        asc(geoChecks.engine),
        asc(geoChecks.questionId)
      )
    return (f.limit ? q.limit(f.limit) : q)
      .all()
      .map((r) => ({ ...geoCheckOut(r.check), question: r.question }))
  }

  /** Per run (date × engine): mention rate, average position, cited rate; top competitors of the latest run; source domains by kind. */
  summary(projectId: string) {
    const ctx = this.ctx
    const project = requireProject(ctx, projectId)
    const checks = ctx.db
      .select()
      .from(geoChecks)
      .where(eq(geoChecks.projectId, project.id))
      .orderBy(desc(geoChecks.date), asc(geoChecks.engine))
      .all()
      .map(geoCheckOut)
    const runs = new Map<string, typeof checks>()
    for (const c of checks) {
      const k = `${c.date}|${c.engine}`
      runs.set(k, [...(runs.get(k) ?? []), c])
    }
    const runList = [...runs.entries()].map(([k, list]) => {
      const [date, engine] = k.split("|")
      const ok = list.filter((c) => c.status === "ok")
      const positions = ok
        .filter((c) => c.mentioned && c.position !== null)
        .map((c) => c.position!)
      const rate = (n: number) => (ok.length ? round(n / ok.length) : null)
      return {
        date,
        engine,
        checks: list.length,
        ok: ok.length,
        errors: list.length - ok.length,
        mentioned: ok.filter((c) => c.mentioned).length,
        mentionRate: rate(ok.filter((c) => c.mentioned).length),
        avgPosition: positions.length
          ? round(positions.reduce((a, b) => a + b, 0) / positions.length, 1)
          : null,
        citedRate: rate(ok.filter((c) => c.cited).length),
        inSourcesRate: rate(ok.filter((c) => c.inSources).length),
      }
    })
    const latest = checks.find((c) => c.status === "ok")?.date ?? null
    const comp = new Map<
      string,
      {
        name: string
        count: number
        positions: number[]
        variants: Set<string>
      }
    >()
    // The project itself is no competitor (brands lists name it too).
    const own = new Set([
      project.id.toLowerCase(),
      brandKey(project.name).toLowerCase(),
    ])
    for (const c of checks) {
      if (c.date !== latest || c.status !== "ok") continue
      const list = names(c.competitors).length ? names(c.competitors) : c.brands
      const seen = new Set<string>()
      list.forEach((n, i) => {
        const key = brandKey(n)
        if (seen.has(key) || own.has(key.toLowerCase())) return
        seen.add(key)
        const s = comp.get(key) ?? {
          name: key,
          count: 0,
          positions: [],
          variants: new Set(),
        }
        s.count++
        const pos = c.brands.findIndex((b) => brandKey(b) === key)
        s.positions.push(pos >= 0 ? pos + 1 : i + 1)
        if (n !== key) s.variants.add(n)
        comp.set(key, s)
      })
    }
    const competitors = [...comp.values()]
      .map((s) => ({
        name: s.name,
        count: s.count,
        avgPosition: round(
          s.positions.reduce((a, b) => a + b, 0) / s.positions.length,
          1
        ),
        variants: [...s.variants].sort(),
      }))
      .sort(
        (a, b) =>
          b.count - a.count || (a.avgPosition ?? 99) - (b.avgPosition ?? 99)
      )
      .slice(0, 20)
    const targets = ctx.db
      .select()
      .from(mentionTargets)
      .where(eq(mentionTargets.projectId, project.id))
      .all()
      .sort(mentionOrder)
    const sourceDomains = MENTION_KINDS.map((kind) => ({
      kind,
      domains: targets
        .filter((t) => t.kind === kind)
        .map((t) => ({
          id: t.id,
          domain: t.domain,
          url: t.url,
          seen: t.seenCount,
          cited: t.citedCount,
          status: t.status,
        })),
    })).filter((g) => g.domains.length)
    const questions = ctx.db
      .select()
      .from(geoQuestions)
      .where(eq(geoQuestions.projectId, project.id))
      .all()
    return {
      project: project.id,
      questions: {
        total: questions.length,
        active: questions.filter((q) => q.active).length,
      },
      latest,
      runs: runList,
      competitors,
      sourceDomains,
    }
  }

  // ---------- mention targets ----------

  listMentions(f: { project?: string; status?: string; kind?: string }) {
    const conds: SQL[] = []
    if (f.project) conds.push(eq(mentionTargets.projectId, f.project))
    const statuses = listOf(f.status, MENTION_STATUS, "status")
    if (statuses) conds.push(inArray(mentionTargets.status, statuses))
    const kinds = listOf(f.kind, MENTION_KINDS, "kind")
    if (kinds) conds.push(inArray(mentionTargets.kind, kinds))
    return this.ctx.db
      .select()
      .from(mentionTargets)
      .where(conds.length ? and(...conds) : undefined)
      .all()
      .sort(
        (a, b) => a.projectId.localeCompare(b.projectId) || mentionOrder(a, b)
      )
  }

  updateMention(
    id: number,
    p: {
      status?: string
      contact?: string | null
      notes?: string | null
      kind?: string
    },
    actor: string
  ) {
    const ctx = this.ctx
    return this.database.tx(() => {
      getById(ctx, mentionTargets, id, "Erwähnungs-Ziel")
      const patch: Record<string, unknown> = {}
      if (p.status !== undefined)
        patch.status = oneOf(p.status, MENTION_STATUS, "status")
      if (p.kind !== undefined)
        patch.kind = oneOf(p.kind, MENTION_KINDS, "kind")
      if (p.contact !== undefined) patch.contact = p.contact
      if (p.notes !== undefined) patch.notes = p.notes
      return patchRow(ctx, mentionTargets, "mention_target", id, patch, actor)
    })
  }
}

/** Cited first, then seen, then domain. */
export function mentionOrder(a: MentionRow, b: MentionRow) {
  return (
    b.citedCount - a.citedCount ||
    b.seenCount - a.seenCount ||
    a.domain.localeCompare(b.domain)
  )
}

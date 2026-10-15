import type { Ctx } from "./db"
import {
  getAccount,
  getCharacter,
  getFormat,
  listAccounts,
  listImageErrors,
  listRules,
} from "./catalog"
import { listDecisions, listHooks, listLearnings } from "./knowledge"
import { accountStats } from "./metrics"
import { horizon, listPlan, nextEntry } from "./plan"
import { listPosts } from "./posts"
import { brands } from "./schema"
import { addDays, getById, today } from "./util"

export const CTA_MEANING: Record<string, string> = {
  none: "Kein CTA und keine Engagement-Zeile.",
  engagement:
    'Kein App-CTA: kein App-Name, kein Download- oder Link-in-Bio-Hinweis. Engagement gehört rein (Fragen an die Zuschauer, "send this to", "save this", "follow for more").',
  app: "App-CTA erlaubt. Engagement-Zeilen ebenfalls.",
}

/**
 * The format an account works with on a date, always in its current version:
 * the format set on the day's open plan entry, otherwise the account's active format.
 */
export function activeFormat(ctx: Ctx, accountId: string, date = today()) {
  const account = getAccount(ctx, accountId)
  const entry = nextEntry(ctx, accountId, date).entry
  if (entry?.formatId)
    return {
      format: getFormat(ctx, entry.formatId),
      source: "plan" as const,
      planEntryId: entry.id,
    }
  return {
    format: account.defaultFormatId
      ? getFormat(ctx, account.defaultFormatId)
      : null,
    source: "account" as const,
    planEntryId: null,
  }
}

/** Accounts whose active format on the date is this format. */
export function accountsUsingFormat(
  ctx: Ctx,
  formatId: string,
  date = today()
) {
  return listAccounts(ctx).flatMap((a) => {
    const active = activeFormat(ctx, a.id, date)
    return active.format?.id === formatId
      ? [{ id: a.id, name: a.name, status: a.status, source: active.source }]
      : []
  })
}

/**
 * Everything a morning run needs for one account in one call. Read-only.
 */
export function buildContext(ctx: Ctx, accountId: string, date = today()) {
  const account = getAccount(ctx, accountId)
  const brand = getById(ctx, brands, account.brandId, "Brand")
  const character = account.characterId
    ? getCharacter(ctx, account.characterId)
    : null
  const active = activeFormat(ctx, account.id, date)
  const format = active.format

  const rules = {
    format: format
      ? listRules(ctx, {
          scopeType: "format",
          scopeId: format.id,
          status: "active",
          formatVersion: format.currentVersion,
        })
      : [],
    account: listRules(ctx, {
      scopeType: "account",
      scopeId: account.id,
      status: "active",
    }),
    brand: listRules(ctx, {
      scopeType: "brand",
      scopeId: brand.id,
      status: "active",
    }),
  }
  const imageErrors = listImageErrors(ctx, {
    formatId: format?.id,
    status: "active",
  }).filter((e) => format || e.formatIds.length === 0)
  const stats = accountStats(ctx, account.id)
  const statsByPost = new Map(
    stats.posts.filter((p) => p.postId).map((p) => [p.postId!, p])
  )
  const recentPosts = listPosts(ctx, { accountId: account.id })
    .slice(0, 10)
    .map((p) => {
      const s = statsByPost.get(p.id)
      return {
        id: p.id,
        dir: p.dir,
        date: p.date,
        hook: p.hook,
        angle: p.angle,
        status: p.status,
        tiktokUrl: p.tiktokUrl,
        metrics: s
          ? {
              ageH: s.latest.ageH,
              plays: s.latest.plays,
              likes: s.latest.likes,
              saves: s.latest.saves,
              comments: s.latest.comments,
              shares: s.latest.shares,
              plays24: s.plays24,
              plays48: s.plays48,
              plays7d: s.plays7d,
              winner: s.winner,
            }
          : null,
      }
    })
  const day = nextEntry(ctx, account.id, date)
  const h = horizon(ctx, account.id, date, 21)
  const upcoming = listPlan(ctx, {
    accountId: account.id,
    from: date,
    to: addDays(date, 20),
  })
  const ideas = listPlan(ctx, { accountId: account.id, ideas: true }).slice(
    0,
    25
  )

  const warnings: string[] = []
  if (!format) warnings.push("Account hat kein aktives Format.")
  if (format && !format.current?.guide)
    warnings.push(`Format ${format.name} hat keinen Leitfaden.`)
  if (!day.entry)
    warnings.push(
      `Kein offener Eintrag für ${date}. Thema selbst wählen und per "plan add" eintragen.`
    )
  if (h.freeDays.length)
    warnings.push(
      `Planhorizont: ${h.freeDays.length} freie Tage in den nächsten 21 Tagen, erster ${h.firstGap}. Mit "plan fill" auffüllen.`
    )
  if (!stats.lastPull)
    warnings.push('Noch keine Zahlen. "metrics pull" ausführen.')

  return {
    generatedAt: new Date().toISOString(),
    date,
    account: {
      ...account,
      brand: { id: brand.id, name: brand.name, notionUrl: brand.notionUrl },
    },
    character,
    format: format
      ? {
          id: format.id,
          name: format.name,
          /** plan: set on today's plan entry; account: the account's active format */
          source: active.source,
          planEntryId: active.planEntryId,
          version: format.currentVersion,
          description: format.current?.description ?? format.description,
          guide: format.current?.guide ?? null,
          skills: format.current?.skills ?? [],
          examples: format.current?.examples ?? [],
          rendererParams: format.current?.rendererParams ?? {},
        }
      : null,
    cta: {
      rule: account.ctaRule,
      meaning: CTA_MEANING[account.ctaRule] ?? account.ctaRule,
    },
    rules,
    imageErrors,
    learnings: listLearnings(ctx, {
      accountId: account.id,
      formatId: format?.id ?? null,
      status: "active",
    }),
    decisions: listDecisions(ctx, {
      accountId: account.id,
      formatId: format?.id ?? null,
    }).slice(0, 20),
    today: day.entry,
    todayAll: day.all,
    upcoming,
    horizon: h,
    ideas,
    recentPosts,
    metrics: {
      median: stats.median,
      winnerThreshold: stats.winnerThreshold,
      lastPull: stats.lastPull,
      winners: stats.posts
        .filter((p) => p.winner)
        .map((p) => ({
          tiktokId: p.tiktokId,
          postId: p.postId,
          plays: p.latest.plays,
          url: p.url,
        })),
    },
    winnerHooks: listHooks(ctx, { accountId: account.id, winners: true }),
    warnings,
  }
}

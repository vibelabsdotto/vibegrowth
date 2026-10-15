/**
 * Collector `audit`: port of growth.py `cmd_audit` (site checks, sitemap crawl, on-page checks,
 * duplicates, broken internal links, orphan check only after a complete crawl, audit_ignore).
 * Returns `audit` (issues + page data); diffing against the previous run is the audit service's job.
 * Severity `warn` from growth.py is written as `warning` (CONTRACT §6 audit_issues).
 */
import {
  errorMessage,
  finish,
  requireString,
  rstripSlash,
  type AuditIssue,
  type AuditPage,
  type AuditSeverity,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type SourceCollector,
} from './types.js';
import { BROWSER_UA, hostnameOf, httpFetch, pathOf, urljoin } from './http.js';
import { countWords, jsonldTypes, parsePage, type PageInfo } from './html.js';

export interface AuditConfig {
  url: string;
  /** Paths that must answer HTTP 200 (sites.json `key_paths`). */
  keyPaths?: string[];
  /** Accepted findings: [path-or-url, code] pairs or {url|path, code} objects (sites.json `audit_ignore`). */
  ignore?: Array<[string, string] | { url?: string; path?: string; code: string }>;
  /** Seconds above which a page counts as slow. Default 2.5. */
  slowSeconds?: number;
}

export const id = 'audit';
export const label = 'Technischer Site-Audit';
export const channelKinds: ChannelKind[] = ['website'];
export const configSchema: ConfigSchema = {
  url: { description: 'Basis-URL der Website (kanonischer Origin); Sitemap unter <url>/sitemap.xml', required: true, type: 'string' },
  keyPaths: {
    description: 'Wichtige Pfade, die HTTP 200 liefern müssen (Befund key_path_status sonst)',
    required: false,
    type: 'string[]',
    example: ['/', '/blog', '/download', '/sitemap.xml', '/robots.txt', '/blog/rss.xml'],
  },
  ignore: {
    description: 'Akzeptierte Befunde als [Pfad oder URL, code], z. B. [["/kontakt","title_length"]]',
    required: false,
    type: 'array',
    default: [],
  },
  slowSeconds: { description: 'Antwortzeit, ab der eine Seite als langsam gilt (Sekunden)', required: false, type: 'number', default: 2.5 },
};

export const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Googlebot', 'Bingbot', 'Applebot-Extended', 'CCBot',
];

type Rule = [string, string];

/** growth.py `robots_rules`: user-agent (lower case) → [(allow|disallow, value)]. */
export function robotsRules(txt: string): Map<string, Rule[]> {
  const groups = new Map<string, Rule[]>();
  let cur: string[] = [];
  let lastWasAgent = false;
  for (const raw of txt.split(/\r\n|\r|\n/)) {
    const line = raw.split('#', 1)[0].trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (k === 'user-agent') {
      cur = lastWasAgent ? cur : [];
      cur.push(v.toLowerCase());
      if (!groups.has(v.toLowerCase())) groups.set(v.toLowerCase(), []);
      lastWasAgent = true;
    } else if (k === 'allow' || k === 'disallow') {
      for (const ua of cur) groups.get(ua)?.push([k, v]);
      lastWasAgent = false;
    }
  }
  return groups;
}

export function botBlockedRoot(groups: Map<string, Rule[]>, bot: string): boolean {
  const rules = groups.get(bot.toLowerCase()) ?? groups.get('*') ?? [];
  return rules.some(([k, v]) => k === 'disallow' && v === '/') && !rules.some(([k, v]) => k === 'allow' && v === '/');
}

const pyRepr = (s: string) => (s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`);
const pyList = (a: string[]) => `[${a.map(pyRepr).join(', ')}]`;

export async function collectAudit(config: AuditConfig, ctx: CollectorContext): Promise<CollectorResult> {
  const f = ctx.fetch ?? fetch;
  let base: string;
  let host: string | null;
  try {
    base = rstripSlash(requireString(config as unknown as Record<string, unknown>, 'url', 'audit'));
    host = hostnameOf(base);
    if (!host) throw new Error(`audit: ungültige url ${base}`);
  } catch (e) {
    return finish({ kpi: [], summary: errorMessage(e), stats: {}, errors: [errorMessage(e)] });
  }
  const slowS = config.slowSeconds ?? 2.5;
  const issues: AuditIssue[] = [];
  const issue = (url: string, code: string, sev: 'error' | 'warn' | 'info', detail = '') =>
    issues.push({ url, code, severity: sev === 'warn' ? 'warning' : sev, detail });

  // ---- site level
  const robots = await httpFetch(`${base}/robots.txt`, {}, f);
  const groups = robots.status === 200 ? robotsRules(robots.text()) : new Map<string, Rule[]>();
  const blocked = AI_BOTS.filter((b) => botBlockedRoot(groups, b));
  if (robots.status !== 200) issue('/robots.txt', 'robots_missing', 'error', `HTTP ${robots.status}`);
  for (const b of blocked) issue('/robots.txt', 'bot_blocked', b === 'CCBot' || b === 'Google-Extended' ? 'warn' : 'error', b);
  const sm = await httpFetch(`${base}/sitemap.xml`, {}, f);
  const urls = sm.status === 200 ? [...sm.text().matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]) : [];
  if (sm.status !== 200 || urls.length === 0) issue('/sitemap.xml', 'sitemap_missing', 'error', `HTTP ${sm.status}, ${urls.length} urls`);
  for (const u of urls) if (!u.startsWith(base)) issue(u, 'sitemap_foreign_url', 'error', 'sitemap URL outside canonical origin');
  if (!robots.text().toLowerCase().includes('sitemap:')) issue('/robots.txt', 'robots_no_sitemap', 'warn');
  const llms = await httpFetch(`${base}/llms.txt`, {}, f);
  if (llms.status !== 200) issue('/llms.txt', 'llms_txt_missing', 'info', 'optional; low evidence of use by AI crawlers');
  for (const variant of [`http://${host}/`, `https://www.${host}/`]) {
    const r = await httpFetch(variant, { follow: false }, f);
    if (r.status === 302 || r.status === 307) issue(variant, 'redirect_temporary', 'warn', `HTTP ${r.status}; permanent 301/308 preferred`);
  }
  const soft = await httpFetch(`${base}/__growth-audit-404-probe`, {}, f);
  if (soft.status !== 404) issue('/__growth-audit-404-probe', 'soft_404', 'error', `HTTP ${soft.status}`);
  const home = await httpFetch(`${base}/`, { ua: BROWSER_UA }, f);
  if (!('strict-transport-security' in home.headers)) issue('/', 'no_hsts', 'warn', 'Strict-Transport-Security header missing');
  for (const h of ['x-content-type-options', 'referrer-policy']) if (!(h in home.headers)) issue('/', 'missing_header', 'info', h);

  // ---- key paths (sites.json key_paths; growth.py stores them but never checked them)
  const keyPathStatus: Record<string, number> = {};
  for (const kp of config.keyPaths ?? []) {
    const p = kp.startsWith('/') ? kp : `/${kp}`;
    const r = p === '/' ? home : await httpFetch(base + p, { ua: BROWSER_UA }, f);
    keyPathStatus[p] = r.status;
    if (r.status !== 200) issue(p, 'key_path_status', 'error', `HTTP ${r.status}`);
  }

  // ---- page level
  const pages = new Map<string, Record<string, unknown>>();
  const titles = new Map<string, string[]>();
  const descs = new Map<string, string[]>();
  const internal = new Set<string>();
  for (const u of urls) {
    const r = await httpFetch(u, { ua: BROWSER_UA }, f);
    let p: PageInfo = parsePage('');
    if (r.status === 200) {
      try {
        p = parsePage(r.text());
      } catch (e) {
        issue(u, 'parse_error', 'warn', errorMessage(e).slice(0, 80));
      }
    }
    const path = pathOf(u);
    const words = countWords(p.text);
    const { types, errors: ldErr } = jsonldTypes(p.jsonld);
    const desc = p.meta['description'];
    pages.set(u, {
      status: r.status,
      final: r.url,
      ms: Math.floor(r.elapsed * 1000),
      bytes: r.body.length,
      title: p.title,
      desc: desc ?? null,
      canonical: p.canonical,
      h1: p.h1,
      h2: p.h2.slice(0, 12),
      lang: p.lang,
      robots: p.meta['robots'] ?? null,
      og_image: p.meta['og:image'] ?? null,
      og_title: p.meta['og:title'] ?? null,
      twitter: p.meta['twitter:card'] ?? null,
      jsonld: types,
      words,
      imgs: p.imgs,
      imgs_no_alt: p.imgsNoAlt,
      links: p.links.length,
    });
    if (r.status !== 200) {
      issue(u, 'status', 'error', `HTTP ${r.status}`);
      continue;
    }
    if (rstripSlash(r.url) !== rstripSlash(u)) issue(u, 'sitemap_redirect', 'error', `redirects to ${r.url}`);
    if (!p.title) {
      issue(u, 'title_missing', 'error');
    } else {
      titles.set(p.title, [...(titles.get(p.title) ?? []), path]);
      const len = [...p.title].length;
      if (len < 25 || len > 65) issue(u, 'title_length', 'warn', `${len} chars: ${p.title}`);
    }
    if (!desc) {
      issue(u, 'desc_missing', 'error');
    } else {
      descs.set(desc, [...(descs.get(desc) ?? []), path]);
      const len = [...desc].length;
      if (len < 70 || len > 165) issue(u, 'desc_length', 'warn', `${len} chars`);
    }
    if (!p.canonical) {
      issue(u, 'canonical_missing', 'error');
    } else {
      const c = urljoin(u, p.canonical);
      if (rstripSlash(c) !== rstripSlash(u)) issue(u, 'canonical_mismatch', 'error', `canonical ${c}`);
    }
    if ((p.meta['robots'] ?? '').toLowerCase().includes('noindex')) issue(u, 'noindex_in_sitemap', 'error');
    if (p.h1.length !== 1) issue(u, 'h1_count', 'warn', `${p.h1.length} h1`);
    if (!p.lang) issue(u, 'lang_missing', 'warn');
    if (!p.meta['og:image']) issue(u, 'og_image_missing', 'warn');
    if (ldErr.length) issue(u, 'jsonld_invalid', 'error', ldErr.join('; '));
    if (types.length === 0) issue(u, 'jsonld_missing', 'info', 'no structured data');
    if (p.imgsNoAlt) issue(u, 'img_alt_missing', 'warn', `${p.imgsNoAlt}/${p.imgs} images without alt`);
    if (path.includes('/blog/') && rstripSlash(path) !== '/blog' && words < 400) issue(u, 'thin_content', 'warn', `${words} words`);
    if (r.elapsed > slowS) issue(u, 'slow_response', 'warn', `${r.elapsed.toFixed(1)}s`);
    for (const href of p.links) {
      const full = urljoin(u, href.split('#')[0]);
      if (hostnameOf(full) === host) internal.add(full);
    }
  }
  for (const [t, ps] of titles) if (ps.length > 1) issue(ps[0], 'title_duplicate', 'warn', `${pyRepr(t)} on ${pyList(ps)}`);
  for (const [, ps] of descs) if (ps.length > 1) issue(ps[0], 'desc_duplicate', 'warn', `on ${pyList(ps)}`);

  const sitemapSet = new Set(urls.map(rstripSlash));
  const checkedLinks: string[] = [];
  for (const link of [...internal].sort()) {
    if (sitemapSet.has(rstripSlash(link))) continue;
    checkedLinks.push(link);
    const r = await httpFetch(link, { follow: false, ua: BROWSER_UA }, f);
    if (r.status >= 400 || r.status === 0) issue(link, 'broken_internal_link', 'error', `HTTP ${r.status}`);
  }
  // Orphan check only when every sitemap page was fetched (a single network error must not
  // produce false orphan findings).
  const linked = new Set([...internal].map(rstripSlash));
  const allFetched = [...pages.values()].every((d) => d.status === 200);
  if (allFetched) {
    for (const u of urls) {
      if (!linked.has(rstripSlash(u)) && rstripSlash(u) !== base) {
        issue(u, 'orphan_page', 'warn', 'in sitemap but not linked from any sitemap page');
      }
    }
  }

  // ---- accepted findings
  const ignore = new Set<string>();
  for (const entry of config.ignore ?? []) {
    const [p, code] = Array.isArray(entry) ? entry : [entry.url ?? entry.path ?? '', entry.code];
    if (!p || !code) continue;
    ignore.add(`${p.startsWith('/') ? base + p : p}\u0000${code}`);
  }
  const before = issues.length;
  const kept = issues.filter((i) => !ignore.has(`${i.url}\u0000${i.code}`) && !ignore.has(`${base}${i.url}\u0000${i.code}`));

  const counts = { error: 0, warning: 0, info: 0 } as Record<AuditSeverity, number>;
  for (const i of kept) counts[i.severity] += 1;
  const pageData: AuditPage[] = [...pages].map(([url, data]) => ({ url, data }));
  const summary = `Audit ${base}: ${urls.length} Seiten, Befunde error ${counts.error}, warning ${counts.warning}, info ${counts.info}, blockierte Bots ${blocked.length ? blocked.join(', ') : 'keine'}`;
  // Findings are data, not a failed run: the run only fails when the sitemap could not be crawled.
  // `audit.ok` (no error findings) is growth.py's run status and goes to audit_runs.ok.
  const errors = urls.length === 0 ? [`Sitemap nicht auswertbar: HTTP ${sm.status}, 0 URLs`] : [];
  return finish({
    kpi: [],
    audit: { pages: urls.length, ok: counts.error === 0, issues: kept, pageData },
    summary,
    stats: {
      pages: urls.length,
      blocked_bots: blocked,
      llms_txt: llms.status === 200,
      issues: counts,
      ignored: before - kept.length,
      internal_links: internal.size,
      checked_links: checkedLinks.length,
      orphan_check: allFetched,
      key_paths: keyPathStatus,
    },
    errors,
  });
}

export const auditCollector: SourceCollector<AuditConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectAudit,
};

/**
 * Minimal HTML tokenizer + page extractor, port of growth.py `PageParser` (Python html.parser based).
 * No dependency: start/end tags, attributes, comments, raw text for <script>/<style>, char refs.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', shy: '\u00ad',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ccedil: 'ç', oacute: 'ó', uacute: 'ú', iacute: 'í',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  bdquo: '„', ldquo: '“', rdquo: '”', sbquo: '‚', lsquo: '‘', rsquo: '’', bull: '•', middot: '·',
  euro: '€', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷', para: '¶', sect: '§',
  thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003', zwj: '\u200d', zwnj: '\u200c', larr: '←', rarr: '→',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '\ufffd';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '\ufffd';
      }
    }
    return NAMED[ent] ?? m;
  });
}

export type Attrs = Record<string, string | null>;

export interface HtmlHandler {
  start(tag: string, attrs: Attrs): void;
  end(tag: string): void;
  data(text: string): void;
}

const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

function parseAttrs(src: string): Attrs {
  const out: Attrs = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(src))) {
    const raw = m[2] ?? m[3] ?? m[4];
    out[m[1].toLowerCase()] = raw === undefined ? null : decodeEntities(raw);
  }
  return out;
}

/** Find the closing '>' of a tag starting at `from`, skipping quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let q: string | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

export function tokenize(html: string, h: HtmlHandler): void {
  let i = 0;
  const n = html.length;
  let buf = '';
  const flush = () => {
    if (buf) {
      h.data(decodeEntities(buf));
      buf = '';
    }
  };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      buf += html.slice(i);
      break;
    }
    buf += html.slice(i, lt);
    const next = html[lt + 1] ?? '';
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (next === '!' || next === '?') {
      const e = html.indexOf('>', lt + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (next === '/' && /[A-Za-z]/.test(html[lt + 2] ?? '')) {
      const e = html.indexOf('>', lt + 2);
      if (e < 0) {
        buf += html.slice(lt);
        break;
      }
      const name = html.slice(lt + 2, e).trim().split(/\s/)[0].toLowerCase();
      flush();
      h.end(name);
      i = e + 1;
      continue;
    }
    if (/[A-Za-z]/.test(next)) {
      const e = tagEnd(html, lt + 1);
      if (e < 0) {
        buf += html.slice(lt);
        break;
      }
      const inner = html.slice(lt + 1, e);
      const nameMatch = /^[^\s/>]+/.exec(inner);
      const name = (nameMatch ? nameMatch[0] : '').toLowerCase();
      const selfClosing = inner.endsWith('/');
      const attrs = parseAttrs(inner.slice(name.length, selfClosing ? -1 : undefined));
      flush();
      h.start(name, attrs);
      i = e + 1;
      if (selfClosing) {
        h.end(name);
        continue;
      }
      if (name === 'script' || name === 'style') {
        const re = new RegExp(`</${name}[\\s>/]`, 'ig');
        re.lastIndex = i;
        const m = re.exec(html);
        const stop = m ? m.index : n;
        if (stop > i) h.data(html.slice(i, stop));
        i = stop;
      }
      continue;
    }
    buf += '<';
    i = lt + 1;
  }
  flush();
}

export interface PageInfo {
  title: string | null;
  meta: Record<string, string>;
  links: string[];
  canonical: string | null;
  h1: string[];
  h2: string[];
  lang: string | null;
  jsonld: string[];
  imgs: number;
  imgsNoAlt: number;
  text: string[];
}

const SKIP = new Set(['script', 'style', 'noscript', 'svg']);

/** Same extraction rules as growth.py PageParser. */
export function parsePage(html: string): PageInfo {
  const p: PageInfo = { title: null, meta: {}, links: [], canonical: null, h1: [], h2: [], lang: null, jsonld: [], imgs: 0, imgsNoAlt: 0, text: [] };
  let inTag: string | null = null;
  let buf: string[] = [];
  let skip = 0;
  tokenize(html, {
    start(tag, a) {
      if (tag === 'html') {
        p.lang = a.lang ?? null;
      } else if (tag === 'title') {
        inTag = 'title';
        buf = [];
      } else if (tag === 'meta') {
        const k = a.name || a.property;
        if (k) p.meta[k.toLowerCase()] = a.content ?? '';
      } else if (tag === 'link' && (a.rel ?? '').split(/\s+/).includes('canonical')) {
        p.canonical = a.href ?? null;
      } else if (tag === 'a' && a.href) {
        p.links.push(a.href);
      } else if (tag === 'h1' || tag === 'h2') {
        inTag = tag;
        buf = [];
      } else if (tag === 'script' && a.type === 'application/ld+json') {
        inTag = 'jsonld';
        buf = [];
      } else if (SKIP.has(tag)) {
        skip += 1;
      } else if (tag === 'img') {
        p.imgs += 1;
        if (!('alt' in a) || a.alt === null) p.imgsNoAlt += 1;
      }
    },
    end(tag) {
      if (inTag === 'jsonld' && tag === 'script') {
        p.jsonld.push(buf.join(''));
        inTag = null;
      } else if (SKIP.has(tag) && skip) {
        skip -= 1;
      } else if (inTag === tag) {
        const val = buf.join('').replace(/\s+/g, ' ').trim();
        if (tag === 'title') p.title = val;
        else if (tag === 'h1') p.h1.push(val);
        else if (tag === 'h2') p.h2.push(val);
        inTag = null;
      }
    },
    data(d) {
      if (inTag) buf.push(d);
      if (!skip && inTag !== 'jsonld') p.text.push(d);
    },
  });
  return p;
}

/** growth.py `jsonld_types`: sorted unique @type values and parse errors (max 80 chars each). */
export function jsonldTypes(blocks: string[]): { types: string[]; errors: string[] } {
  const types = new Set<string>();
  const errors: string[] = [];
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) {
      o.forEach(walk);
    } else if (o && typeof o === 'object') {
      const t = (o as Record<string, unknown>)['@type'];
      if (t) (Array.isArray(t) ? t : [t]).forEach((x) => types.add(String(x)));
      Object.values(o).forEach(walk);
    }
  };
  for (const b of blocks) {
    try {
      walk(JSON.parse(b));
    } catch (e) {
      errors.push((e instanceof Error ? e.message : String(e)).slice(0, 80));
    }
  }
  return { types: [...types].sort(), errors };
}

/** Word count like Python `re.findall(r"\w+", " ".join(text))` (Unicode word characters). */
export function countWords(text: string[]): number {
  return (text.join(' ').match(/[\p{L}\p{N}_]+/gu) ?? []).length;
}

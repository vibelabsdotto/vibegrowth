/**
 * Engine `chatgpt-web`, port of website-growth/scripts/ai_engines.py (ChatGPTWeb,
 * parse_chatgpt_conversation, helpers). ChatGPT in Max's logged-in shared Chrome (CDP), temporary
 * chat, "Nicht personalisiert", default model, web search left to ChatGPT (or forced).
 * Every answer is normalised to EngineAnswer; brand detection and scoring live in geo.ts.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { CdpBrowser, CdpError, CdpTab, cdpUrl, sleep } from "./cdp.js"

/** Run-level blocker (login missing, rate limit, bot challenge): stop the whole run. */
export class EngineBlocked extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EngineBlocked"
  }
}

/** Single prompt failed; the run continues with the next prompt. */
export class PromptFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PromptFailed"
  }
}

export interface EngineSource {
  url: string
  title: string
  domain: string
}

export interface EngineAnswer {
  text: string
  raw: string
  brands: string[]
  links: string[]
  citedUrls: string[]
  sources: EngineSource[]
  model: string | null
  meta: Record<string, unknown>
  evidence: string[]
}

/** Drop tracking params ChatGPT appends (utm_source=chatgpt.com) so URLs dedupe. */
export function cleanUrl(u: string): string {
  let p: URL
  try {
    p = new URL(u)
  } catch {
    return u
  }
  const q = [...p.searchParams].filter(([k]) => !k.startsWith("utm_"))
  const qs = new URLSearchParams(q).toString()
  // urlsplit keeps an empty path empty ("https://x.de" stays without a slash).
  const emptyPath = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(?:[?#]|$)/i.test(u)
  return `${p.protocol}//${p.host}${emptyPath ? "" : p.pathname}${qs ? `?${qs}` : ""}`
}

export function domain(u: string): string {
  let h: string
  try {
    h = new URL(u).hostname.toLowerCase()
  } catch {
    h = ""
  }
  return h.startsWith("www.") ? h.slice(4) : h
}

// --------------------------------------------------------------------------- page scripts (verbatim)

const STATE_JS = String.raw`(() => {
  const body = document.body ? document.body.innerText : '';
  const pb = [...document.querySelectorAll('button')].find(b => /^(nicht |not )?personali[sz](iert|ed)$/i.test(b.innerText.trim()));
  const comp = document.querySelector('[contenteditable="true"][data-composer-input], [contenteditable="true"].ProseMirror, #prompt-textarea');
  return {
    url: location.href,
    title: document.title,
    composer: !!comp,
    personal: pb ? pb.innerText.trim() : null,
    temporary: /Temporärer Chat|Temporary chat/i.test(body),
    challenge: /Just a moment|Einen Moment/i.test(document.title) || !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
    limit: /(Limit|limit).{0,40}(erreicht|reached)|Zu viele Anfragen|Too many requests/.test(body),
  };
})()`

const SESSION_JS = String.raw`(async () => {
  try { const s = await (await fetch('/api/auth/session', {credentials: 'include'})).json(); return !!(s && s.accessToken); }
  catch (e) { return false; }
})()`

// Conversation JSON from the web app's own backend, fetched inside the page with the page's session.
// The access token never leaves the browser; only the conversation JSON is returned.
const CONV_JS = (id: string) => String.raw`(async (id) => {
  const s = await (await fetch('/api/auth/session', {credentials: 'include'})).json();
  const r = await fetch('/backend-api/conversation/' + id, {headers: {Authorization: 'Bearer ' + s.accessToken}});
  return {status: r.status, body: r.status === 200 ? await r.text() : ''};
})(${JSON.stringify(id)})`

const ANSWER_DOM_JS = String.raw`(() => {
  const heads = [...document.querySelectorAll('[data-conversation-role="assistant"], [data-message-author-role="assistant"]')];
  const h = heads[heads.length - 1];
  let el = h && (h.closest('[data-content-search-unit-key]') || h.closest('[data-message-id]') || h.parentElement);
  if (el && el.innerText.trim().length < 40) el = el.parentElement;
  const turns = [...document.querySelectorAll('[data-talvt-turn-state]')];
  return {
    text: el ? el.innerText : '',
    turn_state: turns.length ? turns[turns.length - 1].getAttribute('data-talvt-turn-state') : null,
    stop: !!document.querySelector('[data-testid="stop-button"], button[aria-label*="stopp" i], button[aria-label*="Stop streaming" i], button[aria-label*="beenden" i]'),
    links: el ? [...el.querySelectorAll('a[href^="http"]')].map(a => a.href) : [],
    pills: el ? [...el.querySelectorAll('button[aria-label^="Open "], a[aria-label^="Open "]')].map(b => b.getAttribute('aria-label').slice(5)) : [],
  };
})()`

const COMPOSER = `'[contenteditable="true"][data-composer-input], [contenteditable="true"].ProseMirror, #prompt-textarea'`

// --------------------------------------------------------------------------- conversation parser

const REF_RE = /turn\d+(?:search|news|view|fetch|image|product)\d+/g
const ENTITY_TAG_RE = /<Entity\b[^>]*?\bvalue="([^"]+)"/g
const ENTITY_PUA_RE = /\ue200entity\ue202([\s\S]*?)\ue201/g
const LINK_RE = /<Link\b[^>]*?\burl="([^"]+)"|\]\((https?:\/\/[^)\s]+)\)/g
const BOLD_RE = /\*\*(?:\d+\.\s*)?([^*\n]{2,60}?)\*\*/g
const NUM_HEAD_RE =
  /^[ \t]*(?:#{1,4}[ \t]*)?\*\*\d+\.[ \t]*(.{2,200}?)\*\*[ \t]*$/gm

function puaEntityName(payload: string): string | null {
  try {
    const v: unknown = JSON.parse(payload)
    return Array.isArray(v) && v.length > 1 ? (v[1] as string) : null
  } catch {
    return null
  }
}

function stripMarkup(raw: string): string {
  let t = raw.replace(/<Entity\b[^>]*?\bvalue="([^"]+)"[^>]*>/g, "$1")
  t = t.replace(/<Link\b[^>]*?\btitle="([^"]+)"[^>]*>/g, "$1")
  t = t.replace(ENTITY_PUA_RE, (_m, p: string) => puaEntityName(p) ?? "")
  t = t.replace(/[\ue200-\ue2ff][^\ue201]*\ue201?/g, "")
  t = t.replace(/\{@[^}]*\}/g, "")
  t = t.replace(/<[^>\n]+\/?>/g, "")
  return t.replace(/\n{3,}/g, "\n\n").trim()
}

/** Python str.strip(chars). */
const stripChars = (s: string, chars: string) => {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

/** Fallback brand list for answers without entity markup: bold list items / headings, in order. */
export function boldNames(raw: string): string[] {
  const out: string[] = []
  for (const m of (raw || "").matchAll(BOLD_RE)) {
    const name = stripChars(m[1], " :–-")
    if (name && name.split(/\s+/).length <= 6 && !out.includes(name))
      out.push(name)
  }
  return out
}

/** Untyped JSON of the ChatGPT web backend, read through the helpers below. */
export type Json = Record<string, unknown>

const obj = (v: unknown): Json =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {}
const objs = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : [])
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
const str = (v: unknown): string => (typeof v === "string" ? v : "")
/** Python's str() of a scalar for f-strings (None for null/undefined). */
const py = (v: unknown): string =>
  v === undefined || v === null
    ? "None"
    : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : JSON.stringify(v)

export interface ParsedConversation {
  complete: boolean
  reason?: string
  raw?: string
  text?: string
  brands?: string[]
  brandsSource?: string
  links?: string[]
  citedUrls?: string[]
  sources?: EngineSource[]
  model?: string | null
  meta?: Record<string, unknown>
}

/** Normalise a /backend-api/conversation payload: final answer, entities, citations, consulted sources. */
export function parseChatgptConversation(conv: Json): ParsedConversation {
  const mapping = obj(conv.mapping)
  const chain: Json[] = []
  let node = str(conv.current_node)
  while (node && node in mapping) {
    const n = obj(mapping[node])
    chain.push(n)
    node = str(n.parent)
  }
  chain.reverse()
  const msgs: Json[] = chain.filter((n) => n.message).map((n) => obj(n.message))
  const role = (m: Json) => obj(m.author).role
  const isAnswer = (m: Json) => {
    const md = obj(m.metadata)
    const c = obj(m.content)
    return (
      role(m) === "assistant" &&
      !md.is_thinking_preamble_message &&
      c.content_type === "text" &&
      m.recipient === "all" &&
      strs(c.parts).some((p) => p.trim())
    )
  }
  // The answer is the last message of the active branch. Thinking preambles are assistant text too,
  // so an earlier text message must never count as the final answer on its own.
  const final: Json = msgs.length ? msgs[msgs.length - 1] : {}
  const md = obj(final.metadata)
  if (!isAnswer(final)) {
    const c = obj(final.content)
    return {
      complete: false,
      reason: `last=${py(role(final))}/${py(c.content_type)}/${py(final.recipient)}/${py(final.status)}`,
    }
  }
  // Long answers arrive as several visible text messages: every answer message after the last user message.
  let lastUser = -1
  msgs.forEach((m, i) => {
    if (role(m) === "user") lastUser = i
  })
  const answerMsgs = msgs.slice(lastUser + 1).filter(isAnswer)
  const raw = answerMsgs.flatMap((m) => strs(obj(m.content).parts)).join("\n\n")
  const finish = obj(md.finish_details)
  const complete =
    final.status === "finished_successfully" &&
    !!(Object.keys(finish).length || md.is_complete)
  const metaList = (m: Json, key: string) => objs(obj(m.metadata)[key])
  // Consulted search results, keyed by their citation ref ("turn<idx>search<n>").
  const refs = new Map<string, string>()
  const sources: EngineSource[] = []
  const seen = new Set<string>()
  for (const m of msgs) {
    for (const g of metaList(m, "search_result_groups")) {
      for (const e of objs(g.entries)) {
        const url = cleanUrl(str(e.url))
        if (!url) continue
        const rid = obj(e.ref_id)
        if (
          rid.turn_index !== undefined &&
          rid.turn_index !== null &&
          rid.ref_type
        ) {
          const key = `turn${py(rid.turn_index)}${py(rid.ref_type)}${py(rid.ref_index)}`
          if (!refs.has(key)) refs.set(key, url)
        }
        if (!seen.has(url)) {
          seen.add(url)
          sources.push({
            url,
            title: str(e.title).slice(0, 200),
            domain: domain(url),
          })
        }
      }
    }
  }
  const cited: string[] = []
  const addCited = (u: string) => {
    if (u && !cited.includes(u)) cited.push(u)
  }
  for (const m of raw.matchAll(REF_RE)) {
    const u = refs.get(m[0])
    if (u) addCited(u)
  }
  for (const c of answerMsgs.flatMap((m) => metaList(m, "citations")))
    addCited(cleanUrl(str(obj(c.metadata).url)))
  for (const cr of answerMsgs.flatMap((m) =>
    metaList(m, "content_references")
  )) {
    for (const it of [...objs(cr.items), ...(cr.url ? [cr] : [])])
      addCited(cleanUrl(str(it.url)))
  }
  const links: string[] = []
  for (const m of raw.matchAll(LINK_RE)) {
    const u = cleanUrl(m[1] || m[2])
    if (!links.includes(u)) links.push(u)
  }
  // safe_urls also holds the pages behind inline images/cards (e.g. a download page shown as app tile).
  for (const s of answerMsgs.flatMap((m) => strs(obj(m.metadata).safe_urls))) {
    const u = cleanUrl(s)
    let pathname: string
    try {
      pathname = new URL(u).pathname
    } catch {
      pathname = ""
    }
    if (
      u.startsWith("http") &&
      !links.includes(u) &&
      !/openai\.com|chatgpt\.com|oaiusercontent/.test(u) &&
      !/\.(png|jpe?g|webp|gif|svg)$/i.test(pathname)
    )
      links.push(u)
  }
  // Named products in order of appearance.
  const ents: [number, string | null][] = [
    ...[...raw.matchAll(ENTITY_TAG_RE)].map((m): [number, string | null] => [
      m.index,
      m[1],
    ]),
    ...[...raw.matchAll(ENTITY_PUA_RE)].map((m): [number, string | null] => [
      m.index,
      puaEntityName(m[1]),
    ]),
  ].sort((a, b) => a[0] - b[0])
  // Numbered headings ("**2. Standort-Zeiterfassung**") name products that carry no entity markup.
  for (const m of raw.matchAll(NUM_HEAD_RE)) {
    const name = stripChars(stripMarkup(m[1]), " *:–-")
    if (
      name.length >= 2 &&
      name.length <= 70 &&
      !ents.some(([, e]) => {
        const el = (e ?? "").toLowerCase()
        return (
          el.includes(name.toLowerCase()) || name.toLowerCase().includes(el)
        )
      })
    )
      ents.push([m.index, name])
  }
  ents.sort((a, b) => a[0] - b[0])
  const brands: string[] = []
  for (const [, name] of ents)
    if (name && !brands.includes(name)) brands.push(name)
  const model =
    str(md.resolved_model_slug) ||
    str(md.model_slug) ||
    str(conv.default_model_slug) ||
    null
  return {
    complete,
    raw,
    text: stripMarkup(raw),
    brands,
    brandsSource: brands.length ? "entities" : "none",
    links,
    citedUrls: cited,
    sources,
    model,
    meta: {
      conversation_id: conv.conversation_id ?? null,
      is_temporary_chat: conv.is_temporary_chat ?? null,
      memory_scope: conv.memory_scope ?? null,
      finish: finish.type ?? null,
      searched: sources.length > 0,
    },
  }
}

// --------------------------------------------------------------------------- engine

interface PageState {
  url?: string
  title?: string
  composer?: boolean
  personal?: string | null
  temporary?: boolean
  challenge?: boolean
  limit?: boolean
}

interface AnswerDom {
  text?: string
  turn_state?: string | null
  stop?: boolean
  links?: string[]
  pills?: string[]
}

type Point = { x: number; y: number }

const uniform = (a: number, b: number) => a + Math.random() * (b - a)

export interface ChatgptWebOptions {
  promptTimeoutS?: number
  forceSearch?: boolean
  /** Seconds between two prompts, uniformly random (ai_engines.py default 8–20). */
  pause?: [number, number]
  log?: (line: string) => void
}

export class ChatgptWeb {
  static readonly engine = "chatgpt-web"
  static readonly START_URL = "https://chatgpt.com/?temporary-chat=true"
  private browser: CdpBrowser | null = null
  private tab: CdpTab | null = null
  private personalized: boolean | null = null
  private asked = 0
  readonly promptTimeoutS: number
  readonly forceSearch: boolean
  readonly pause: [number, number]
  readonly log: (line: string) => void

  constructor(
    readonly evidenceDir: string,
    opts: ChatgptWebOptions = {}
  ) {
    this.promptTimeoutS = opts.promptTimeoutS ?? 240
    this.forceSearch = opts.forceSearch ?? false
    this.pause = opts.pause ?? [8, 20]
    this.log = opts.log ?? (() => undefined)
  }

  /** Attach to the shared Chrome, open an own tab, start a temporary chat. Never launches Chrome. */
  async open() {
    this.browser = await CdpBrowser.connect(cdpUrl())
    this.tab = await this.browser.openTab(ChatgptWeb.START_URL)
    await this.freshChat(true)
  }

  /** Close the own tab and the socket (Chrome keeps running). */
  async close() {
    if (this.tab) await this.tab.close()
    this.tab = null
    this.browser?.close()
    this.browser = null
  }

  private get t(): CdpTab {
    if (!this.tab) throw new CdpError("kein Tab")
    return this.tab
  }

  private async state(): Promise<PageState> {
    return (await this.t.js<PageState>(STATE_JS)) ?? {}
  }

  private checkBlockers(st: PageState) {
    if (st.challenge)
      throw new EngineBlocked(
        "ChatGPT zeigt eine Bot-Prüfung (Cloudflare); bitte einmal manuell im Automations-Chrome lösen"
      )
    if (st.limit) throw new EngineBlocked("ChatGPT meldet ein Nutzungslimit")
    const url = st.url ?? ""
    if (url.includes("auth.") || url.includes("/auth/"))
      throw new EngineBlocked(
        "ChatGPT ist im Automations-Chrome nicht eingeloggt"
      )
  }

  private async freshChat(first = false) {
    await this.t.navigate(ChatgptWeb.START_URL, 2.5)
    let st = await this.t.waitFor<PageState>(
      `(() => { const s = ${STATE_JS}; return (s.composer || s.challenge) ? s : null; })()`,
      40
    )
    if (!st) {
      st = await this.state()
      this.checkBlockers(st)
      throw new PromptFailed(
        `composer not found (title=${JSON.stringify(st.title ?? null)})`
      )
    }
    this.checkBlockers(st)
    if (first && !(await this.t.js<boolean>(SESSION_JS)))
      throw new EngineBlocked(
        "ChatGPT ist im Automations-Chrome nicht eingeloggt (keine Session)"
      )
    if (!st.temporary) throw new PromptFailed("temporary chat not active")
    if (
      ["personalisiert", "personalized"].includes(
        (st.personal ?? "").toLowerCase()
      )
    ) {
      await this.disablePersonalisation()
      st = await this.state()
    }
    this.personalized = ["personalisiert", "personalized"].includes(
      (st.personal ?? "").toLowerCase()
    )
  }

  /** Temporary chat menu "Nicht personalisiert": ignores memory, custom instructions, plugins. */
  private async disablePersonalisation() {
    const pos = await this.t
      .js<Point | null>(String.raw`(() => { const b=[...document.querySelectorAll('button')].find(b=>/^personali[sz](iert|ed)$/i.test(b.innerText.trim()));
            if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`)
    if (!pos) return
    await this.t.click(pos.x, pos.y)
    const item = await this.t.waitFor<Point>(
      String.raw`(() => { const it=[...document.querySelectorAll('[role=menuitemradio],[role=menuitem]')]
            .find(e=>/^(nicht personalisiert|not personali[sz]ed)/i.test(e.innerText.trim())); if(!it) return null;
            const r=it.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`,
      5,
      0.5
    )
    if (item) {
      await this.t.click(item.x, item.y)
      await sleep(1500)
    }
    await this.t.navigate(ChatgptWeb.START_URL, 2.5)
    await this.t.waitFor(`(() => ${STATE_JS})().composer`, 30)
  }

  /** Force the "Websuche" tool via the + menu (only with forceSearch; default lets ChatGPT decide). */
  private async enableSearch(): Promise<boolean> {
    const pos = await this.t
      .js<Point | null>(String.raw`(() => { const b=document.querySelector('[data-testid="composer-plus-btn"], button[aria-label*="hinzufügen" i], button[aria-label*="Add files" i]');
            if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`)
    if (!pos) return false
    await this.t.click(pos.x, pos.y)
    const item = await this.t.waitFor<Point>(
      String.raw`(() => { const it=[...document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=option]')]
            .find(e=>/^(Websuche|Web search|Search)/i.test(e.innerText.trim())); if(!it) return null;
            const r=it.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`,
      5,
      0.5
    )
    if (!item) {
      await this.t.key("Escape", "Escape", 27)
      return false
    }
    await this.t.click(item.x, item.y)
    await sleep(800)
    return true
  }

  private async send(prompt: string) {
    const ok = await this.t.js<boolean>(
      `(() => { const c=document.querySelector(${COMPOSER}); if(!c) return false; c.focus(); return true; })()`
    )
    if (!ok) throw new PromptFailed("composer not focusable")
    await this.t.insertText(prompt)
    await sleep(600)
    const typed =
      (await this.t.js<string>(
        `(() => { const c=document.querySelector(${COMPOSER}); return c ? (c.innerText || c.value || '') : ''; })()`
      )) ?? ""
    if (!typed.includes(prompt.slice(0, 30)))
      throw new PromptFailed("prompt did not land in composer")
    await this.t.key("Enter", "Enter", 13, "\r")
    if (await this.t.waitFor("location.pathname.includes('/c/')", 20, 1)) return
    const pos = await this.t
      .js<Point | null>(String.raw`(() => { const b=document.querySelector('[data-testid="send-button"], button[aria-label="Senden"], button[aria-label*="Send" i]');
            if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`)
    if (pos) await this.t.click(pos.x, pos.y)
    if (!(await this.t.waitFor("location.pathname.includes('/c/')", 20, 1))) {
      this.checkBlockers(await this.state())
      throw new PromptFailed("message was not sent (no conversation id)")
    }
  }

  private async fetchConversation(id: string): Promise<Json | null> {
    const r =
      (await this.t.js<{ status?: number; body?: string }>(CONV_JS(id), 40)) ??
      {}
    if (r.status !== 200 || !r.body) return null
    try {
      return JSON.parse(r.body) as Json
    } catch {
      return null
    }
  }

  private async conversationId(): Promise<string> {
    const raw =
      (await this.t.js<string>("location.pathname.split('/c/')[1] || ''")) ?? ""
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }

  async ask(prompt: string, idx: number): Promise<EngineAnswer> {
    if (this.asked) {
      await sleep(uniform(this.pause[0], this.pause[1]) * 1000)
      await this.freshChat()
    }
    this.asked++
    const forced = this.forceSearch ? await this.enableSearch() : false
    const t0 = Date.now()
    await this.send(prompt)
    let convId = await this.conversationId()
    let parsed: ParsedConversation | null = null
    let dom: AnswerDom = {}
    let lastApi = 0
    let apiNote = "not fetched"
    let lastConv: Json | null = null
    await fs.mkdir(this.evidenceDir, { recursive: true })
    let stableLen = -1
    let stableHits = 0
    let done = false
    while (Date.now() - t0 < this.promptTimeoutS * 1000) {
      await sleep(3000)
      dom = (await this.t.js<AnswerDom>(ANSWER_DOM_JS)) ?? {}
      const n = (dom.text ?? "").length
      stableHits = n === stableLen && n > 0 ? stableHits + 1 : 0
      stableLen = n
      const domDone =
        (dom.turn_state === "complete" || stableHits >= 3) && !dom.stop && n > 0
      // The URL first carries a client placeholder ("local-chatgpt:...") until the server id arrives.
      const cid = await this.conversationId()
      if (cid && !cid.startsWith("local")) convId = cid
      if (
        (domDone || Date.now() - lastApi > 20_000) &&
        !convId.startsWith("local")
      ) {
        lastApi = Date.now()
        const conv = await this.fetchConversation(convId)
        if (conv) {
          lastConv = conv
          const p = parseChatgptConversation(conv)
          apiNote = p.reason ?? "incomplete"
          if (p.complete) {
            parsed = p
            done = true
            break
          }
        } else apiNote = "fetch failed"
        if (domDone && stableHits >= 6) {
          // API unreadable but UI finished: keep the DOM result
          done = true
          break
        }
      }
      this.checkBlockers(await this.state())
    }
    if (!done)
      throw new PromptFailed(`no complete answer after ${this.promptTimeoutS}s`)
    await sleep(1500)
    dom = (await this.t.js<AnswerDom>(ANSWER_DOM_JS)) ?? dom
    const stem = path.join(this.evidenceDir, String(idx).padStart(2, "0"))
    let shot: string | null
    try {
      await this.t
        .js(String.raw`(() => { const h=[...document.querySelectorAll('[data-conversation-role="assistant"],[data-message-author-role="assistant"]')].pop();
                if(h) (h.parentElement||h).scrollIntoView({block:'start'}); })()`)
      await sleep(800)
      // Only the conversation column: the sidebar shows the account's private chat titles.
      const clip = await this.t.js<{
        x: number
        y: number
        width: number
        height: number
      } | null>(
        String.raw`(() => { const m=document.querySelector('main') || document.body; const r=m.getBoundingClientRect();
                return {x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - Math.max(0, r.x)),
                        height: Math.min(r.height, innerHeight - Math.max(0, r.y))}; })()`
      )
      shot = await this.t.screenshot(
        `${stem}.png`,
        clip && clip.width > 200 ? clip : null
      )
    } catch (e) {
      if (!(e instanceof CdpError)) throw e
      shot = null
    }
    const p: ParsedConversation = parsed ?? {
      complete: false,
      raw: dom.text ?? "",
      text: dom.text ?? "",
      brands: [],
      brandsSource: "none",
      links: [],
      citedUrls: [],
      sources: [],
      model: null,
      meta: { api: apiNote, conversation_id: convId },
    }
    const text = (dom.text ?? "").trim() || p.text || ""
    const links = [
      ...new Set([
        ...(p.links ?? []),
        ...(dom.links ?? [])
          .filter(
            (u) => !u.includes("chatgpt.com") && !u.includes("openai.com")
          )
          .map(cleanUrl),
      ]),
    ]
    const meta = {
      ...(p.meta ?? {}),
      personalized: this.personalized,
      forced_search: forced,
      brands_source: p.brandsSource ?? null,
      pills: dom.pills ?? [],
      duration_s: Math.round((Date.now() - t0) / 100) / 10,
    }
    const convPath = `${stem}.conversation.json`
    if (lastConv) await fs.writeFile(convPath, JSON.stringify(lastConv))
    const out: EngineAnswer = {
      text,
      raw: p.raw ?? "",
      brands: p.brands ?? [],
      links,
      citedUrls: p.citedUrls ?? [],
      sources: p.sources ?? [],
      model: p.model ?? null,
      meta,
      evidence: shot ? [shot] : [],
    }
    const rawPath = `${stem}.json`
    // Same field names as ai_engines.py, so stored evidence stays re-parseable by both systems.
    await fs.writeFile(
      rawPath,
      JSON.stringify(
        {
          text: out.text,
          raw: out.raw,
          brands: out.brands,
          links: out.links,
          cited_urls: out.citedUrls,
          sources: out.sources,
          model: out.model,
          meta: out.meta,
          evidence: out.evidence,
          prompt,
          engine: ChatgptWeb.engine,
        },
        null,
        1
      )
    )
    out.evidence.push(rawPath)
    if (lastConv) out.evidence.push(convPath)
    this.log(
      `#${idx} ${out.brands.length} Marken, ${out.sources.length} Quellen`
    )
    return out
  }
}

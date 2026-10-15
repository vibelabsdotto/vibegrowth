/**
 * Minimal Chrome DevTools Protocol client, port of website-growth/scripts/cdp.py.
 * Attaches to the shared automation Chrome (VIBEGROWTH_CDP_URL, default http://127.0.0.1:9224, skill
 * browser-automation) over Node's global WebSocket: one browser-level socket, flattened target
 * sessions. Only what the GEO engine needs: own tabs, JS evaluation, input, screenshots.
 */
import { promises as fs } from "node:fs"

export class CdpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CDPError"
  }
}

export class BrowserUnavailable extends CdpError {
  constructor(message: string) {
    super(message)
    this.name = "BrowserUnavailable"
  }
}

export function cdpUrl(): string {
  return (
    process.env.VIBEGROWTH_CDP_URL ||
    process.env.GROWTH_CDP_URL ||
    "http://127.0.0.1:9224"
  ).replace(/\/+$/, "")
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function browserWsUrl(base = cdpUrl()): Promise<string> {
  try {
    const r = await fetch(`${base}/json/version`, {
      signal: AbortSignal.timeout(5000),
    })
    const j = (await r.json()) as { webSocketDebuggerUrl?: string }
    if (!j.webSocketDebuggerUrl) throw new Error("ohne webSocketDebuggerUrl")
    return j.webSocketDebuggerUrl
  } catch (e) {
    const cause =
      e instanceof Error && e.cause instanceof Error
        ? `: ${e.cause.message}`
        : ""
    throw new BrowserUnavailable(
      `Automations-Chrome nicht erreichbar unter ${base}: ${e instanceof Error ? e.message : String(e)}${cause}`
    )
  }
}

type Json = Record<string, unknown>

interface Pending {
  resolve: (v: Json) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/** Browser-level CDP connection. Use `openTab()` for a task-owned tab. */
export class CdpBrowser {
  private id = 0
  private readonly pending = new Map<number, Pending>()
  private closed = false

  private constructor(
    private readonly ws: WebSocket,
    private readonly timeoutS: number
  ) {
    ws.onmessage = (ev: MessageEvent) => {
      let d: { id?: number; error?: { message?: string }; result?: Json }
      try {
        d = JSON.parse(String(ev.data)) as typeof d
      } catch {
        return
      }
      if (d.id === undefined) return // events are not used
      const p = this.pending.get(d.id)
      if (!p) return
      this.pending.delete(d.id)
      clearTimeout(p.timer)
      if (d.error) p.reject(new CdpError(d.error.message ?? "CDP-Fehler"))
      else p.resolve(d.result ?? {})
    }
    ws.onclose = () => this.failAll("websocket closed by browser")
    ws.onerror = () => this.failAll("websocket error")
  }

  static async connect(base = cdpUrl(), timeoutS = 60): Promise<CdpBrowser> {
    const url = await browserWsUrl(base)
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CdpError("websocket handshake timeout")),
        timeoutS * 1000
      )
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new CdpError("websocket handshake failed"))
      }
    })
    return new CdpBrowser(ws, timeoutS)
  }

  private failAll(reason: string) {
    this.closed = true
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new CdpError(reason))
      this.pending.delete(id)
    }
  }

  call(
    method: string,
    params: Json = {},
    session?: string,
    timeoutS?: number
  ): Promise<Json> {
    if (this.closed) return Promise.reject(new CdpError("websocket closed"))
    const id = ++this.id
    const msg: Json = { id, method, params }
    if (session) msg.sessionId = session
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id)
          reject(new CdpError(`${method}: timeout`))
        },
        (timeoutS ?? this.timeoutS) * 1000
      )
      this.pending.set(id, {
        resolve,
        reject: (e) => reject(new CdpError(`${method}: ${e.message}`)),
        timer,
      })
      this.ws.send(JSON.stringify(msg))
    })
  }

  async pages(): Promise<{ targetId: string; url: string; type: string }[]> {
    const r = await this.call("Target.getTargets")
    return (
      r.targetInfos as { targetId: string; url: string; type: string }[]
    ).filter((t) => t.type === "page")
  }

  async openTab(url: string): Promise<CdpTab> {
    const r = await this.call("Target.createTarget", { url, background: true })
    return this.attach(r.targetId as string)
  }

  async attach(targetId: string): Promise<CdpTab> {
    const r = await this.call("Target.attachToTarget", {
      targetId,
      flatten: true,
    })
    const tab = new CdpTab(this, targetId, r.sessionId as string)
    await tab.call("Page.enable")
    await tab.call("Runtime.enable")
    // Hidden background tabs throttle timers and can stall streaming UIs.
    await tab.call("Emulation.setFocusEmulationEnabled", { enabled: true })
    return tab
  }

  close() {
    this.closed = true
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

export class CdpTab {
  constructor(
    readonly browser: CdpBrowser,
    readonly targetId: string,
    readonly session: string
  ) {}

  call(method: string, params: Json = {}, timeoutS?: number) {
    return this.browser.call(method, params, this.session, timeoutS)
  }

  async js<T = unknown>(expr: string, timeoutS = 30): Promise<T> {
    const r = await this.call(
      "Runtime.evaluate",
      { expression: expr, returnByValue: true, awaitPromise: true },
      timeoutS
    )
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails as {
        text?: string
        exception?: { description?: string }
      }
      throw new CdpError(
        `js: ${ex.exception?.description ?? ex.text ?? ""}`.slice(0, 300)
      )
    }
    return (r.result as { value?: T } | undefined)?.value as T
  }

  async navigate(url: string, settleS = 2) {
    await this.call("Page.navigate", { url })
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      await sleep(500)
      try {
        if ((await this.js("document.readyState")) === "complete") break
      } catch {
        /* page still loading */
      }
    }
    await sleep(settleS * 1000)
  }

  /** Poll a JS expression until truthy; returns its value or null on timeout. */
  async waitFor<T = unknown>(
    expr: string,
    timeoutS = 30,
    intervalS = 1
  ): Promise<T | null> {
    const deadline = Date.now() + timeoutS * 1000
    while (Date.now() < deadline) {
      try {
        const v = await this.js<T>(expr)
        if (v) return v
      } catch {
        /* retry */
      }
      await sleep(intervalS * 1000)
    }
    return null
  }

  async click(x: number, y: number) {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.call("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      })
      await sleep(50)
    }
  }

  async key(key: string, code: string, vk: number, text?: string) {
    await this.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode: vk,
      ...(text ? { text, unmodifiedText: text } : {}),
    })
    await this.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: vk,
    })
  }

  insertText(text: string) {
    return this.call("Input.insertText", { text })
  }

  /** PNG of the viewport, or of `clip` = {x, y, width, height} in CSS pixels. */
  async screenshot(
    file: string,
    clip?: { x: number; y: number; width: number; height: number } | null
  ): Promise<string> {
    const r = await this.call(
      "Page.captureScreenshot",
      { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) },
      60
    )
    await fs.writeFile(file, Buffer.from(r.data as string, "base64"))
    return file
  }

  async close() {
    try {
      await this.browser.call("Target.closeTarget", {
        targetId: this.targetId,
      })
    } catch {
      /* tab already gone */
    }
  }
}

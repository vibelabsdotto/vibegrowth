/**
 * HTTP helper, port of growth.py `fetch`: never throws, network errors come back as status 0;
 * network errors and 5xx on GET are retried once after 2 s.
 */
import type { FetchFn } from './types.js';

export const UA = 'Mozilla/5.0 (compatible; VibeLabsGrowthBot/1.0; +https://vibelabs.to)';
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

export interface HttpResponse {
  /** HTTP status, 0 on network error. */
  status: number;
  /** Final URL after redirects (request URL when not followed or on error). */
  url: string;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body: Buffer;
  /** Seconds from request start until the body was read. */
  elapsed: number;
  text(): string;
  json<T = unknown>(): T;
}

export interface HttpOptions {
  method?: string;
  follow?: boolean;
  ua?: string;
  timeoutS?: number;
  body?: string | URLSearchParams;
  headers?: Record<string, string>;
  retries?: number;
  /** Retry also non-GET requests (only for idempotent reads such as Google report POSTs). */
  retryAnyMethod?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeResponse(status: number, url: string, headers: Record<string, string>, body: Buffer, elapsed: number): HttpResponse {
  return {
    status,
    url,
    headers,
    body,
    elapsed,
    text: () => body.toString('utf8'),
    json: <T>() => JSON.parse(body.toString('utf8')) as T,
  };
}

async function fetchOnce(fetchImpl: FetchFn, url: string, o: HttpOptions): Promise<HttpResponse> {
  const headers: Record<string, string> = {
    'User-Agent': o.ua ?? UA,
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
    ...(o.headers ?? {}),
  };
  const t0 = performance.now();
  try {
    const res = await fetchImpl(url, {
      method: o.method ?? 'GET',
      headers,
      body: o.body,
      redirect: o.follow === false ? 'manual' : 'follow',
      signal: AbortSignal.timeout((o.timeoutS ?? 30) * 1000),
    });
    const body = Buffer.from(await res.arrayBuffer());
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      h[k.toLowerCase()] = v;
    });
    // Like urllib's geturl(): the request URL unless a redirect happened (fetch would normalise
    // "https://host" to "https://host/").
    return makeResponse(res.status, res.redirected && res.url ? res.url : url, h, body, (performance.now() - t0) / 1000);
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : '';
    const msg = e instanceof Error ? `${e.name}: ${e.message}${cause}` : String(e);
    return makeResponse(0, url, {}, Buffer.from(msg), (performance.now() - t0) / 1000);
  }
}

export async function httpFetch(url: string, options: HttpOptions = {}, fetchImpl: FetchFn = fetch): Promise<HttpResponse> {
  const method = (options.method ?? 'GET').toUpperCase();
  let retries = options.retries ?? 1;
  let r = await fetchOnce(fetchImpl, url, options);
  while (retries > 0 && (method === 'GET' || options.retryAnyMethod) && (r.status === 0 || r.status >= 500)) {
    await sleep(2000);
    r = await fetchOnce(fetchImpl, url, options);
    retries -= 1;
  }
  return r;
}

/** Python `urllib.parse.urljoin` approximation: absolute references stay untouched. */
export function urljoin(base: string, ref: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;
  try {
    const u = new URL(ref, base);
    if (ref === '') u.hash = '';
    return u.href;
  } catch {
    return ref;
  }
}

export function hostnameOf(url: string): string | null {
  try {
    const h = new URL(url).hostname;
    return h ? h.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

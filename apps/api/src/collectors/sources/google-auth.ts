/**
 * Google OAuth helper, port of website-growth/scripts/google_auth.py (`access_token`, `api`).
 * Reads `google-growth-oauth-client.json` + `google-growth-oauth-token.json` from secretsDir.
 * The only write: when Google rotates the refresh token, it is stored back into the same token
 * file (0600). Access tokens stay in memory. Nothing secret is ever logged or returned.
 */
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { CollectorError, redact, type ChannelKind, type ConfigSchema, type FetchFn } from './types.js';
import { httpFetch } from './http.js';

export const GOOGLE_CLIENT_FILE = 'google-growth-oauth-client.json';
export const GOOGLE_TOKEN_FILE = 'google-growth-oauth-token.json';

/** Helper, no collector of its own: no project config, used by gsc and ga4. */
export const configSchema: ConfigSchema = {};
export const channelKinds: ChannelKind[] = [];

interface ClientFile {
  installed?: { client_id?: string; client_secret?: string; token_uri?: string };
  web?: { client_id?: string; client_secret?: string; token_uri?: string };
}

interface TokenFile {
  refresh_token?: string;
  [k: string]: unknown;
}

const cache = new Map<string, { token: string; exp: number }>();

async function readJson<T>(file: string, label: string): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new CollectorError('CONFIG', `Zugang fehlt: ${label} nicht in secretsDir gefunden`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new CollectorError('CONFIG', `Zugang unlesbar: ${label} ist kein gültiges JSON`);
  }
}

async function writePrivate(file: string, obj: unknown): Promise<void> {
  const fh = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  try {
    await fh.writeFile(JSON.stringify(obj, null, 1));
  } finally {
    await fh.close();
  }
}

/** Fresh access token (cached in memory until 60 s before expiry). */
export async function googleAccessToken(secretsDir: string, fetchImpl: FetchFn = fetch): Promise<string> {
  const tokenPath = path.join(secretsDir, GOOGLE_TOKEN_FILE);
  const hit = cache.get(tokenPath);
  if (hit && Date.now() / 1000 < hit.exp - 60) return hit.token;

  const clientFile = await readJson<ClientFile>(path.join(secretsDir, GOOGLE_CLIENT_FILE), GOOGLE_CLIENT_FILE);
  const c = clientFile.installed ?? clientFile.web;
  if (!c?.client_id || !c.client_secret) {
    throw new CollectorError('CONFIG', `Zugang unvollständig: ${GOOGLE_CLIENT_FILE} ohne client_id/client_secret`);
  }
  const t = await readJson<TokenFile>(tokenPath, GOOGLE_TOKEN_FILE);
  if (!t.refresh_token) {
    throw new CollectorError('CONFIG', `Zugang unvollständig: ${GOOGLE_TOKEN_FILE} ohne refresh_token (google_auth.py login)`);
  }
  const body = new URLSearchParams({
    client_id: c.client_id,
    client_secret: c.client_secret,
    refresh_token: t.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await httpFetch(
    c.token_uri ?? 'https://oauth2.googleapis.com/token',
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutS: 30, retryAnyMethod: true },
    fetchImpl,
  );
  const secrets = [c.client_secret, t.refresh_token];
  if (r.status !== 200) {
    let reason: string;
    try {
      const j = r.json<{ error?: string; error_description?: string }>();
      reason = [j.error, j.error_description].filter(Boolean).join(': ');
    } catch {
      reason = r.status === 0 ? 'Netzwerkfehler' : '';
    }
    throw new CollectorError('EXTERNAL', redact(`Google-OAuth-Refresh HTTP ${r.status}${reason ? ` (${reason})` : ''}`, secrets));
  }
  const j = r.json<{ access_token?: string; expires_in?: number; refresh_token?: string; scope?: string }>();
  if (!j.access_token) throw new CollectorError('EXTERNAL', 'Google-OAuth-Refresh ohne access_token');
  if (j.refresh_token && j.refresh_token !== t.refresh_token) {
    // Rotation: keep every other field of the token file, replace the refresh token.
    await writePrivate(tokenPath, { ...t, refresh_token: j.refresh_token, scope: j.scope ?? t.scope });
  }
  cache.set(tokenPath, { token: j.access_token, exp: Date.now() / 1000 + Number(j.expires_in ?? 3600) });
  return j.access_token;
}

/** JSON request with the growth OAuth token (google_auth.py `api`). Throws a short error on HTTP failure. */
export async function googleApi<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body: unknown,
  ctx: { secretsDir: string; fetch?: FetchFn },
  timeoutS = 60,
): Promise<T> {
  const fetchImpl = ctx.fetch ?? fetch;
  const token = await googleAccessToken(ctx.secretsDir, fetchImpl);
  const r = await httpFetch(
    url,
    {
      method,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeoutS,
      // Reads (GET, report POSTs) are idempotent: one retry on network error/5xx.
      retryAnyMethod: method !== 'PUT',
    },
    fetchImpl,
  );
  if (r.status < 200 || r.status >= 300) {
    const detail = redact(r.text().slice(0, 400), [token]);
    throw new CollectorError('EXTERNAL', `${method} ${url.split('?')[0]} -> HTTP ${r.status}: ${detail}`);
  }
  return (r.body.length ? r.json<T>() : ({} as T));
}

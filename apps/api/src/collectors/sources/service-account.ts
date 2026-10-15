/**
 * Google service account (Play Console), port of store_attribution.py `sa_token` and `_gcs`.
 * Key file: `GROWTH_PLAY_SA_JSON` (or `VIBEGROWTH_PLAY_SA_JSON`), else the default profile of
 * gpc's `~/.playconsole-cli/config.json` → `credentials_path`. The JWT is signed with node:crypto;
 * the key stays in memory, access tokens are cached in memory only. Nothing is written.
 */
import { createSign } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { httpFetch } from "./http.js"
import { CollectorError, redact, type FetchFn } from "./types.js"

export const GCS_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only"
const GPC_CONFIG = ".playconsole-cli/config.json"

const expandHome = (p: string) =>
  p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p

interface ServiceAccount {
  client_email?: string
  private_key?: string
  token_uri?: string
}

/** Path of the Play service account key (never its content). */
export async function playCredentialsPath(): Promise<string> {
  const env =
    process.env.VIBEGROWTH_PLAY_SA_JSON || process.env.GROWTH_PLAY_SA_JSON
  if (env) return expandHome(env)
  const cfgPath = path.join(os.homedir(), GPC_CONFIG)
  let cfg: {
    default_profile?: string
    profiles?: Record<string, { credentials_path?: string }>
  }
  try {
    cfg = JSON.parse(await fs.readFile(cfgPath, "utf8")) as typeof cfg
  } catch {
    throw new CollectorError(
      "CONFIG",
      `Zugang fehlt: Play-Service-Account weder über GROWTH_PLAY_SA_JSON noch ~/${GPC_CONFIG} gefunden`
    )
  }
  const p = cfg.profiles?.[cfg.default_profile ?? ""]?.credentials_path
  if (!p)
    throw new CollectorError(
      "CONFIG",
      `Zugang fehlt: ~/${GPC_CONFIG} ohne credentials_path im Standardprofil`
    )
  return expandHome(p)
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64url").replace(/=+$/, "")

const cache = new Map<string, { token: string; exp: number }>()

/** OAuth access token of the Play service account for `scope` (JWT bearer grant). */
export async function serviceAccountToken(
  scope: string,
  fetchImpl: FetchFn = fetch
): Promise<string> {
  const hit = cache.get(scope)
  if (hit && hit.exp > Date.now() / 1000 + 60) return hit.token
  const file = await playCredentialsPath()
  let sa: ServiceAccount
  try {
    sa = JSON.parse(await fs.readFile(file, "utf8")) as ServiceAccount
  } catch {
    throw new CollectorError(
      "CONFIG",
      "Zugang unlesbar: Play-Service-Account-Datei fehlt oder ist kein JSON"
    )
  }
  if (!sa.client_email || !sa.private_key || !sa.token_uri)
    throw new CollectorError(
      "CONFIG",
      "Zugang unvollständig: Play-Service-Account ohne client_email/private_key/token_uri"
    )
  const now = Math.floor(Date.now() / 1000)
  const input = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    })
  )}`
  let signature: string
  try {
    signature = b64url(
      createSign("RSA-SHA256").update(input).sign(sa.private_key)
    )
  } catch {
    throw new CollectorError(
      "CONFIG",
      "Zugang unlesbar: privater Schlüssel des Play-Service-Accounts ungültig"
    )
  }
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${input}.${signature}`,
  })
  const r = await httpFetch(
    sa.token_uri,
    {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeoutS: 30,
      retryAnyMethod: true,
    },
    fetchImpl
  )
  if (r.status !== 200) {
    let reason = r.status === 0 ? "Netzwerkfehler" : ""
    try {
      const j = r.json<{ error?: string; error_description?: string }>()
      reason = [j.error, j.error_description].filter(Boolean).join(": ")
    } catch {
      /* keep reason */
    }
    throw new CollectorError(
      "EXTERNAL",
      redact(
        `Token des Play-Service-Accounts: HTTP ${r.status}${reason ? ` (${reason})` : ""}`,
        [signature]
      )
    )
  }
  const tok = r.json<{ access_token?: string; expires_in?: number }>()
  if (!tok.access_token)
    throw new CollectorError(
      "EXTERNAL",
      "Token des Play-Service-Accounts: Antwort ohne access_token"
    )
  cache.set(scope, {
    token: tok.access_token,
    exp: Date.now() / 1000 + Number(tok.expires_in ?? 3600),
  })
  return tok.access_token
}

/**
 * Cloud Storage JSON API (store_attribution.py `_gcs`): object list (`objectPath` '') or one object.
 * 404 → null. `media` returns the raw bytes.
 */
export async function gcs(
  bucket: string,
  objectPath: string,
  opts: { params?: Record<string, string>; media?: boolean; fetch?: FetchFn }
): Promise<Buffer | Record<string, unknown> | null> {
  const fetchImpl = opts.fetch ?? fetch
  const token = await serviceAccountToken(GCS_SCOPE, fetchImpl)
  const q = new URLSearchParams({
    ...(opts.params ?? {}),
    ...(opts.media ? { alt: "media" } : {}),
  })
  const url =
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o` +
    (objectPath ? `/${encodeURIComponent(objectPath)}` : "") +
    (q.size ? `?${q.toString()}` : "")
  const r = await httpFetch(
    url,
    { headers: { Authorization: `Bearer ${token}` }, timeoutS: 60 },
    fetchImpl
  )
  if (r.status === 404) return null
  if (r.status !== 200)
    throw new CollectorError(
      "EXTERNAL",
      redact(
        `GCS ${bucket}/${objectPath} HTTP ${r.status}: ${r.text().slice(0, 200)}`,
        [token]
      )
    )
  return opts.media ? r.body : r.json<Record<string, unknown>>()
}

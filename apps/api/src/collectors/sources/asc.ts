/**
 * Collector `asc`: App Store Connect Analytics Reports. Port of the App Store part of
 * store_attribution.py: the Python system has no App Store collector, only the access check via
 * the `asc` CLI (`asc analytics requests`). Without an asc profile (API key with role Admin or
 * Sales and Reports / Finance) every run ends with ok:false and a hint; with access but without
 * a readable ONGOING report request the run names that blocker.
 */
import { execFile } from "node:child_process"
import {
  errorMessage,
  finish,
  requireString,
  type ChannelKind,
  type CollectorResult,
  type ConfigSchema,
  type SourceCollector,
} from "./types.js"

export interface AscConfig {
  appId: string
  providerId?: string | null
  /** asc CLI profile (sites.json `asc_profile`); null = no key with analytics role registered. */
  profile?: string | null
}

export const id = "asc"
export const label = "App Store Connect"
export const channelKinds: ChannelKind[] = ["ios"]
export const configSchema: ConfigSchema = {
  appId: {
    description: "Apple-App-ID, z. B. 6504710904",
    required: true,
    type: "string",
  },
  providerId: {
    description: "Provider-ID für App-Analytics-Kampagnen",
    required: false,
    type: "string",
  },
  profile: {
    description:
      "asc-CLI-Profil mit API-Key (Rolle Admin für den ONGOING-Request, sonst Vertrieb und Berichte/Finanzen); leer = kein Zugang",
    required: false,
    type: "string",
  },
}

export const ASC_NO_PROFILE =
  'App Store: keine Daten, API-Key mit Analytics-Rolle fehlt (asc-Profil nicht konfiguriert: collectors set asc --project <id> --config \'{"profile":"<asc-profil>"}\')'

/** Runs the asc CLI (read-only subcommands only). Returns exit code and combined output. */
export function runAsc(
  args: string[],
  profile: string | null | undefined,
  timeoutMs = 120_000
): Promise<{ code: number; text: string }> {
  const cmd = [...args, ...(profile ? ["--profile", profile] : [])]
  return new Promise((resolve) => {
    execFile(
      process.env.VIBEGROWTH_ASC_BIN || "asc",
      cmd,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const text = `${stdout ?? ""}${stderr ?? ""}`.trim()
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT")
          resolve({
            code: 127,
            text: "asc-CLI nicht gefunden (brew install asc)",
          })
        else
          resolve({
            code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
            text,
          })
      }
    )
  })
}

export interface AscCheck {
  ok: boolean
  profile?: string
  requests?: number
  ongoing?: number
  note?: string | null
  error?: string
}

/** store_attribution.py `check` for the App Store (asc analytics requests). */
export async function checkAsc(config: Partial<AscConfig>): Promise<AscCheck> {
  const appId = typeof config.appId === "string" ? config.appId.trim() : ""
  if (!appId) return { ok: false, error: 'asc: Konfiguration "appId" fehlt' }
  const profile = config.profile || null
  const { code, text } = await runAsc(
    ["analytics", "requests", "--app", appId, "--output", "json"],
    profile
  )
  if (code === 0) {
    let reqs: {
      attributes?: { accessType?: string; stoppedDueToInactivity?: boolean }
    }[] = []
    try {
      reqs = (JSON.parse(text) as { data?: typeof reqs }).data ?? []
    } catch {
      reqs = []
    }
    const ongoing = reqs.filter(
      (r) =>
        r.attributes?.accessType === "ONGOING" &&
        !r.attributes?.stoppedDueToInactivity
    )
    return {
      ok: ongoing.length > 0,
      requests: reqs.length,
      ongoing: ongoing.length,
      note: ongoing.length
        ? null
        : "kein aktiver ONGOING-Request; braucht einmalig einen Admin-Key",
    }
  }
  const forbidden = /forbidden|does not allow/i.test(text)
  return {
    ok: false,
    profile: profile ?? "(asc default)",
    error: forbidden
      ? "API-Key ohne Rolle Admin/Vertrieb und Berichte/Finanzen"
      : text.slice(0, 300),
  }
}

export async function collectAsc(config: AscConfig): Promise<CollectorResult> {
  const stats: Record<string, unknown> = {}
  try {
    requireString(config as unknown as Record<string, unknown>, "appId", "asc")
  } catch (e) {
    return finish({
      kpi: [],
      summary: errorMessage(e),
      stats,
      errors: [errorMessage(e)],
    })
  }
  if (!config.profile) {
    stats.profile = null
    return finish({
      kpi: [],
      summary: ASC_NO_PROFILE,
      stats,
      errors: [ASC_NO_PROFILE],
    })
  }
  const check = await checkAsc(config)
  stats.check = check
  const error = check.ok
    ? "App Store: Zugang vorhanden (ONGOING-Request aktiv), der Abruf der Analytics-Reports ist noch nicht umgesetzt (auch im Python-System nicht)"
    : `App Store: ${check.error ?? check.note ?? "kein Zugang"}`
  return finish({ kpi: [], summary: error, stats, errors: [error] })
}

export const ascCollector: SourceCollector<AscConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectAsc,
}

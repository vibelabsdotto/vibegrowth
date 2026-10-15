import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface VibeGrowthConfig {
  /** Content folder with <brand>/<account>/posts/... */
  dataDir: string
  /** SQLite file */
  dbPath: string
}

const CONFIG_DIR = path.join(os.homedir(), ".config")
const CONFIG_FILE = path.join(CONFIG_DIR, "vibegrowth", "config.json")
/** Read as fallback; VibeGrowth was called VibeShorts before. */
const LEGACY_CONFIG_FILE = path.join(CONFIG_DIR, "vibeshorts", "config.json")

export function configFilePath() {
  return CONFIG_FILE
}

/** VIBEGROWTH_<name>, falling back to the old VIBESHORTS_<name>. */
export function env(name: string): string | undefined {
  return process.env[`VIBEGROWTH_${name}`] ?? process.env[`VIBESHORTS_${name}`]
}

function expand(p: string) {
  return path.resolve(
    p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p
  )
}

interface ConfigFile {
  dataDir?: string
  dbPath?: string
  /** Python with Pillow for the renderer and metrics pull */
  python?: string
  /** tiktok_pull.py module that provides the TikTok session and cookie jar */
  tiktokPullScript?: string
  /** Folder with collector credentials (OAuth tokens, API keys). Only referenced, never copied. */
  secretsDir?: string
}

function readJson(file: string): ConfigFile {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return {}
  }
}

/** The new file wins key by key over the legacy one. */
function readConfigFile(): ConfigFile {
  return { ...readJson(LEGACY_CONFIG_FILE), ...readJson(CONFIG_FILE) }
}

/** Merge the given keys into ~/.config/vibegrowth/config.json. */
export function writeConfigFile(cfg: ConfigFile) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const value: ConfigFile = { ...readConfigFile() }
  for (const [k, v] of Object.entries(cfg) as [
    keyof ConfigFile,
    string | undefined,
  ][]) {
    if (v) value[k] = k === "python" && !v.includes("/") ? v : expand(v)
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(value, null, 2) + "\n")
  return value
}

export function toolConfig() {
  const file = readConfigFile()
  const python =
    env("PYTHON") ??
    file.python ??
    (fs.existsSync("/opt/homebrew/bin/python3")
      ? "/opt/homebrew/bin/python3"
      : "python3")
  const secrets = env("SECRETS_DIR") ?? file.secretsDir
  return {
    python,
    tiktokPullScript: env("TIKTOK_PULL") ?? file.tiktokPullScript ?? null,
    secretsDir: secrets ? expand(secrets) : null,
  }
}

export class ConfigError extends Error {}

/**
 * Resolution order: explicit override > VIBEGROWTH_DATA_DIR / VIBEGROWTH_DB (or the old VIBESHORTS_*)
 * > ~/.config/vibegrowth/config.json > ~/.config/vibeshorts/config.json.
 * The database lives with the content, not the code: <dataDir>/.vibegrowth/vibegrowth.db,
 * or the existing <dataDir>/.vibeshorts/vibeshorts.db from before the rename.
 */
export function resolveConfig(
  override: Partial<VibeGrowthConfig> = {}
): VibeGrowthConfig {
  const file = readConfigFile()
  const dataDirRaw = override.dataDir ?? env("DATA_DIR") ?? file.dataDir
  if (!dataDirRaw) {
    throw new ConfigError(
      `Kein Datenordner gesetzt. Einmalig "vibegrowth init --data-dir <pfad>" ausführen oder VIBEGROWTH_DATA_DIR setzen.`
    )
  }
  const dataDir = expand(dataDirRaw)
  const dbRaw = override.dbPath ?? env("DB") ?? file.dbPath
  return { dataDir, dbPath: dbRaw ? expand(dbRaw) : defaultDbPath(dataDir) }
}

function defaultDbPath(dataDir: string) {
  const legacy = path.join(dataDir, ".vibeshorts", "vibeshorts.db")
  if (fs.existsSync(legacy)) return legacy
  return path.join(dataDir, ".vibegrowth", "vibegrowth.db")
}

/** Resolve a stored relative path against the data dir and refuse anything outside it. */
export function resolveInDataDir(dataDir: string, rel: string) {
  const abs = path.resolve(dataDir, rel)
  const root = path.resolve(dataDir)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new ConfigError(`Pfad liegt außerhalb des Datenordners: ${rel}`)
  }
  return abs
}

export function toRelative(dataDir: string, abs: string) {
  const rel = path.relative(path.resolve(dataDir), path.resolve(abs))
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ConfigError(`Pfad liegt außerhalb des Datenordners: ${abs}`)
  }
  return rel.split(path.sep).join("/")
}

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface VibeShortsConfig {
  /** Content folder with <brand>/<account>/posts/... */
  dataDir: string
  /** SQLite file */
  dbPath: string
}

const CONFIG_FILE = path.join(
  os.homedir(),
  ".config",
  "vibeshorts",
  "config.json"
)

export function configFilePath() {
  return CONFIG_FILE
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
}

function readConfigFile(): ConfigFile {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
  } catch {
    return {}
  }
}

/** Merge the given keys into ~/.config/vibeshorts/config.json. */
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
    process.env.VIBESHORTS_PYTHON ??
    file.python ??
    (fs.existsSync("/opt/homebrew/bin/python3")
      ? "/opt/homebrew/bin/python3"
      : "python3")
  return {
    python,
    tiktokPullScript:
      process.env.VIBESHORTS_TIKTOK_PULL ?? file.tiktokPullScript ?? null,
  }
}

export class ConfigError extends Error {}

/**
 * Resolution order: explicit override > VIBESHORTS_DATA_DIR / VIBESHORTS_DB > ~/.config/vibeshorts/config.json.
 * The database defaults to <dataDir>/.vibeshorts/vibeshorts.db so it lives with the content, not the code.
 */
export function resolveConfig(
  override: Partial<VibeShortsConfig> = {}
): VibeShortsConfig {
  const file = readConfigFile()
  const dataDirRaw =
    override.dataDir ?? process.env.VIBESHORTS_DATA_DIR ?? file.dataDir
  if (!dataDirRaw) {
    throw new ConfigError(
      `Kein Datenordner gesetzt. Einmalig "vibeshorts init --data-dir <pfad>" ausführen oder VIBESHORTS_DATA_DIR setzen.`
    )
  }
  const dataDir = expand(dataDirRaw)
  const dbRaw = override.dbPath ?? process.env.VIBESHORTS_DB ?? file.dbPath
  const dbPath = dbRaw
    ? expand(dbRaw)
    : path.join(dataDir, ".vibeshorts", "vibeshorts.db")
  return { dataDir, dbPath }
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

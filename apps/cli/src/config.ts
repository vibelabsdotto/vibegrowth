/** Local config file for `init` (same rules as apps/api/src/core/config.ts). */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface ConfigFile {
  dataDir?: string
  dbPath?: string
  python?: string
  tiktokPullScript?: string
  secretsDir?: string
}

const configDir = () => path.join(os.homedir(), ".config")
export const configFilePath = () =>
  path.join(configDir(), "vibegrowth", "config.json")
const legacyConfigFilePath = () =>
  path.join(configDir(), "vibeshorts", "config.json")

function expand(p: string) {
  return path.resolve(
    p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p
  )
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
  return { ...readJson(legacyConfigFilePath()), ...readJson(configFilePath()) }
}

/** Merge the given keys into ~/.config/vibegrowth/config.json. */
export function writeConfigFile(cfg: ConfigFile) {
  const file = configFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const value: ConfigFile = { ...readConfigFile() }
  for (const [k, v] of Object.entries(cfg) as [
    keyof ConfigFile,
    string | undefined,
  ][]) {
    if (v) value[k] = k === "python" && !v.includes("/") ? v : expand(v)
  }
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
  return value
}

/** DB path the API derives from this config (env overrides as in the API). */
export function resolvedDbPath(cfg: ConfigFile) {
  const env = (n: string) =>
    process.env[`VIBEGROWTH_${n}`] ?? process.env[`VIBESHORTS_${n}`]
  const dataDir = expand(env("DATA_DIR") ?? cfg.dataDir ?? ".")
  const db = env("DB") ?? cfg.dbPath
  if (db) return expand(db)
  const legacy = path.join(dataDir, ".vibeshorts", "vibeshorts.db")
  if (fs.existsSync(legacy)) return legacy
  return path.join(dataDir, ".vibegrowth", "vibegrowth.db")
}

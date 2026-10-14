#!/usr/bin/env node
// Prefers the bundled CLI; falls back to tsx in a fresh checkout without a build.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
process.env.VIBESHORTS_APP_ROOT ??= root
const bundle = join(root, "dist", "cli.mjs")
if (existsSync(bundle)) {
  await import(pathToFileURL(bundle).href)
} else {
  const tsx = join(root, "node_modules", ".bin", "tsx")
  const r = spawnSync(tsx, [join(root, "cli", "index.ts"), ...process.argv.slice(2)], { stdio: "inherit" })
  process.exit(r.status ?? 1)
}

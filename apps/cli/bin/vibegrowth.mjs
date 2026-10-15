#!/usr/bin/env node
// Prefers the bundled CLI; falls back to tsx in a fresh checkout without a build.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

// The CLI talks to apps/api over HTTP (VIBEGROWTH_API_URL, default http://127.0.0.1:4311).
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const bundle = join(root, "dist", "cli.mjs")
if (existsSync(bundle)) {
  await import(pathToFileURL(bundle).href)
} else {
  const tsx = [
    join(root, "node_modules", ".bin", "tsx"),
    join(root, "..", "..", "node_modules", ".bin", "tsx"),
  ].find(existsSync)
  if (!tsx) {
    process.stderr.write(
      'Fehler (ERROR): CLI nicht gebaut und tsx fehlt. "npm install" und "npm run build --workspace apps/cli" ausführen.\n'
    )
    process.exit(1)
  }
  const r = spawnSync(
    tsx,
    [join(root, "src", "index.ts"), ...process.argv.slice(2)],
    { stdio: "inherit" }
  )
  process.exit(r.status ?? 1)
}

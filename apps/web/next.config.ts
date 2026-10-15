import path from "node:path"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Monorepo: npm hoists deps to the repo root, tracing and Turbopack start there.
  outputFileTracingRoot: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  ),
  serverExternalPackages: ["better-sqlite3"],
}

export default nextConfig

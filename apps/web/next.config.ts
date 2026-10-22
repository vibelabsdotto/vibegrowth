import path from "node:path"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Monorepo: npm hoists deps to the repo root, tracing and Turbopack start there.
  outputFileTracingRoot: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  ),
  // /api/* and /media reach apps/api through route handlers (lib/forward.ts), resolved
  // per request: rewrites would bake the build shell's VIBEGROWTH_API_URL into the build.
}

export default nextConfig

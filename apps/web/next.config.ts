import path from "node:path"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Monorepo: npm hoists deps to the repo root, tracing and Turbopack start there.
  outputFileTracingRoot: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  ),
  // Browser requests for data and media go to apps/api (contract §4).
  async rewrites() {
    const api = (
      process.env.VIBEGROWTH_API_URL ?? "http://127.0.0.1:4311"
    ).replace(/\/$/, "")
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/media", destination: `${api}/api/media` },
    ]
  },
}

export default nextConfig

/** `serve`: start API (apps/api/dist/main.js) and web (next) from this repo, loopback only. */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { Command } from "commander"
import { fail, g, int } from "./common"
import { CliError, env } from "./http"

/** Repo root: the bundle sits in apps/cli/dist, the source in apps/cli/src. */
function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, "..", "..", "..")
}

function nextBin(root: string) {
  return [
    path.join(
      root,
      "apps",
      "web",
      "node_modules",
      "next",
      "dist",
      "bin",
      "next"
    ),
    path.join(root, "node_modules", "next", "dist", "bin", "next"),
  ].find((p) => fs.existsSync(p))
}

export function registerServe(program: Command) {
  program
    .command("serve")
    .description("Web-App lokal starten (nur 127.0.0.1)")
    .option("--port <n>", "", int, 4310)
    .option("--dev", "Entwicklungsmodus")
    .option(
      "--api-port <n>",
      "Port der API (Standard VIBEGROWTH_API_PORT oder 4311)",
      int
    )
    .action(async (o: { port: number; dev?: boolean; apiPort?: number }) => {
      try {
        const root = repoRoot()
        const apiDir = path.join(root, "apps", "api")
        const webDir = path.join(root, "apps", "web")
        const apiMain = path.join(apiDir, "dist", "main.js")
        const apiPort = o.apiPort ?? (Number(env("API_PORT")) || 4311)
        if (!fs.existsSync(apiMain))
          throw new CliError(
            "INVALID",
            `API nicht gebaut. Einmal "npm run build --workspace apps/api" in ${root} ausführen.`
          )
        if (!o.dev && !fs.existsSync(path.join(webDir, ".next", "BUILD_ID")))
          throw new CliError(
            "INVALID",
            `Kein Build vorhanden. Einmal "npm run build --workspace apps/web" in ${root} ausführen oder --dev nutzen.`
          )
        const next = nextBin(root)
        if (!next)
          throw new CliError("INVALID", `next fehlt. "npm install" in ${root}.`)
        const apiUrl = `http://127.0.0.1:${apiPort}`
        const dataDir = g().dataDir
        const children: ChildProcess[] = []
        const stopAll = (code: number) => {
          for (const c of children) if (c.exitCode === null) c.kill("SIGTERM")
          process.exit(code)
        }
        const api = spawn(process.execPath, [apiMain], {
          cwd: apiDir,
          stdio: "inherit",
          env: {
            ...process.env,
            VIBEGROWTH_API_PORT: String(apiPort),
            ...(dataDir ? { VIBEGROWTH_DATA_DIR: path.resolve(dataDir) } : {}),
          },
        })
        children.push(api)
        const web = spawn(
          process.execPath,
          [
            next,
            o.dev ? "dev" : "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(o.port),
          ],
          {
            cwd: webDir,
            stdio: "inherit",
            env: { ...process.env, VIBEGROWTH_API_URL: apiUrl },
          }
        )
        children.push(web)
        for (const c of children) c.on("exit", (code) => stopAll(code ?? 0))
        for (const sig of ["SIGINT", "SIGTERM"] as const)
          process.on(sig, () => stopAll(0))
        process.stderr.write(
          `VibeGrowth läuft auf http://127.0.0.1:${o.port}, API ${apiUrl} (Repo: ${root.replace(os.homedir(), "~")})\n`
        )
      } catch (e) {
        fail(e)
      }
    })
}

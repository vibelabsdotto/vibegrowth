/** Program, global options and shared helpers for all commands. */
import fs from "node:fs"
import { Command } from "commander"
import { CliError, env, request, type Query } from "./http"
import { printHuman } from "./print"

/** "vibegrowth", or "vibeshorts" when called through the old name (kept as alias). */
export function cliName() {
  return env("CLI_NAME") ?? "vibegrowth"
}

export const program = new Command()

type Globals = { json?: boolean; actor: string; dataDir?: string }
export const g = () => program.opts<Globals>()

export function out(value: unknown) {
  if (g().json) process.stdout.write(JSON.stringify(value, null, 2) + "\n")
  else printHuman(value)
}

export function fail(e: unknown): never {
  const code = e instanceof CliError ? e.code : "ERROR"
  const message = e instanceof Error ? e.message : String(e)
  if (g().json)
    process.stdout.write(
      JSON.stringify({ error: { code, message } }, null, 2) + "\n"
    )
  else process.stderr.write(`Fehler (${code}): ${message}\n`)
  process.exit(code === "LOCKED" ? 3 : 1)
}

/** Wrap an action: run it, print, exit with status. `partial`: exit 2 when the result lists errors. */
export function run<A extends unknown[]>(
  fn: (...args: A) => unknown,
  opts: { partial?: boolean } = {}
) {
  return async (...args: A) => {
    try {
      const result = await fn(...args)
      if (
        opts.partial &&
        Array.isArray((result as { errors?: unknown[] } | null)?.errors) &&
        (result as { errors: unknown[] }).errors.length
      )
        process.exitCode = 2
      out(result)
    } catch (e) {
      fail(e)
    }
  }
}

const LONG = 30 * 60_000

export const api = {
  get: (path: string, query?: Query) =>
    request(path, { query, actor: g().actor }),
  post: (path: string, body: unknown = {}, long = false) =>
    request(path, {
      method: "POST",
      body,
      actor: g().actor,
      ...(long ? { timeoutMs: LONG } : {}),
    }),
  patch: (path: string, body: unknown) =>
    request(path, { method: "PATCH", body, actor: g().actor }),
  put: (path: string, body: unknown) =>
    request(path, { method: "PUT", body, actor: g().actor }),
  del: (path: string) => request(path, { method: "DELETE", actor: g().actor }),
}

export const int = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n))
    throw new CliError("INVALID", `Keine ganze Zahl: ${v}`)
  return n
}
export const list = (v?: string) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined
export const nullable = (v?: string) =>
  v === undefined ? undefined : v === "" || v === "null" ? null : v

export function parseJsonOption(
  raw: string,
  option: string
): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new CliError("INVALID", `${option} ist kein gültiges JSON`)
  }
  return value as Record<string, unknown>
}

export function readText(file: string) {
  return fs.readFileSync(file === "-" ? 0 : file, "utf8")
}

export function readJsonInput(file?: string): unknown {
  const raw =
    file === "-" || !file
      ? fs.readFileSync(0, "utf8")
      : fs.readFileSync(file, "utf8")
  return JSON.parse(raw)
}

/** `--project <id>` as alias for `--brand` (contract §1). Fills `brand` while parsing, before the mandatory check. */
export function projectAlias(cmd: Command) {
  cmd.option("--project <id>", "Projekt (= --brand)")
  cmd.on("option:project", (v: string) =>
    cmd.setOptionValueWithSource("brand", v, "cli")
  )
  return cmd
}

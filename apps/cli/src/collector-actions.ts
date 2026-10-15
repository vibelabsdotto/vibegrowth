/** Actions from growth.py next to the collectors (contract §7.5 additions): search submit/keywords, app setup, store check. */
import type { Command, OptionValues } from "commander"
import { api, g, run } from "./common"
import { CliError, request } from "./http"

/** Options of the command and its parents (e.g. --project of `search`). */
const opts = <T extends OptionValues>(cmd: Command) => cmd.optsWithGlobals<T>()

function sub(program: Command, name: string): Command {
  const cmd = program.commands.find((c) => c.name() === name)
  if (!cmd) throw new Error(`Befehl ${name} fehlt`)
  return cmd
}

/** GEO runs take up to the collector budget (50 min) plus the last answer. */
const GEO_TIMEOUT = 60 * 60_000

export function registerCollectorActions(program: Command) {
  const searchCmd = sub(program, "search")
  searchCmd
    .command("sitemap-submit")
    .description(
      "Sitemap (<url>/sitemap.xml) an die Search Console übermitteln, protokolliert als Änderung (seo)"
    )
    .action(
      run((_o: unknown, cmd: Command) =>
        api.post(
          "/search/sitemap-submit",
          { project: opts<{ project: string }>(cmd).project },
          true
        )
      )
    )
  searchCmd
    .command("bing-submit")
    .description(
      "URLs an Bing übermitteln (Standard: alle URLs der Sitemap), vorher Kontingent prüfen; protokolliert als Änderung (seo)"
    )
    .option("--url <url...>", "nur diese URLs")
    .action(
      run((_o: unknown, cmd: Command) => {
        const o = opts<{ project: string; url?: string[] }>(cmd)
        return api.post(
          "/search/bing-submit",
          { project: o.project, urls: o.url },
          true
        )
      })
    )
  searchCmd
    .command("keywords")
    .description(
      "Google-Autocomplete a–z für Seeds (Standard: projects.config.seedKeywords), nur lesend"
    )
    .option("--seed <seed...>", "Seed-Keywords (ohne Komma)")
    .option("--fast", "nur die Seeds selbst, ohne a–z")
    .action(
      run((_o: unknown, cmd: Command) => {
        const o = opts<{ project: string; seed?: string[]; fast?: boolean }>(
          cmd
        )
        if (o.seed?.some((s) => s.includes(",")))
          throw new CliError("INVALID", "--seed ohne Komma angeben")
        return request("/search/keywords", {
          query: { project: o.project, seed: o.seed?.join(","), fast: o.fast },
          actor: g().actor,
          timeoutMs: 30 * 60_000,
        })
      })
    )

  const collectorsCmd = sub(program, "collectors")
  collectorsCmd
    .command("setup <collector>")
    .description(
      "GA4-App-Property einrichten: Key Events und Custom Dimensions aus der Collector-Config app anlegen (nur app)"
    )
    .requiredOption("--project <id>")
    .option("--dry-run", "nur anzeigen, was angelegt würde")
    .action(
      run((collector: string, o: { project: string; dryRun?: boolean }) => {
        if (collector !== "app")
          throw new CliError(
            "INVALID",
            `setup gibt es nur für app, nicht für ${collector}`
          )
        return api.post("/collectors/app/setup", {
          project: o.project,
          dryRun: o.dryRun ?? false,
        })
      })
    )
  collectorsCmd
    .command("check-stores")
    .description(
      "Zugänge zu Google Play (Cloud-Storage-Exporte) und App Store (asc) prüfen; Exit 2, wenn einer fehlt"
    )
    .requiredOption("--project <id>")
    .action(
      run(async (o: { project: string }) => {
        const r = (await api.get("/collectors/stores/check", {
          project: o.project,
        })) as { ok?: boolean }
        if (!r.ok) process.exitCode = 2
        return r
      })
    )
}

/** POST /geo/run with optional --limit (smoke test) and a timeout above the collector budget. */
export function geoRun(o: { project: string; engine: string; limit?: number }) {
  return request("/geo/run", {
    method: "POST",
    body: { project: o.project, engine: o.engine, limit: o.limit },
    actor: g().actor,
    timeoutMs: GEO_TIMEOUT,
  })
}

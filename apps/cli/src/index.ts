#!/usr/bin/env node
import fs from "node:fs"
import { Command, Option } from "commander"
import {
  api,
  fail,
  g,
  int,
  list,
  nullable,
  parseJsonOption,
  program,
  projectAlias,
  readJsonInput,
  readText,
  run,
  cliName,
} from "./common"
import { configFilePath, resolvedDbPath, writeConfigFile } from "./config"
import { registerGrowth } from "./growth"
import { registerImportGrowth } from "./import-growth"
import { apiUrl, CliError, env, seg } from "./http"
import { registerServe } from "./serve"

// Allowed values, as in apps/api/src/core (catalog, plan, knowledge).
const ACCOUNT_STATUS = ["active", "paused", "planned"]
const CTA_RULES = ["none", "engagement", "app"]
const RULE_KINDS = [
  "hook",
  "copy",
  "image",
  "caption",
  "cta",
  "production",
  "other",
]
const PLAN_STATUS = [
  "idea",
  "planned",
  "in_production",
  "delivered",
  "posted",
  "skipped",
]
const INSPO_TYPES = ["format", "hook", "sound", "visual", "topic", "trend"]
const INSPO_STATUS = ["new", "analyzed", "adapted", "discarded"]

program
  .name(cliName())
  .description(
    "VibeGrowth: Shortform und Website-/App-Growth für alle Projekte, lokal. Jede Ausgabe mit --json maschinenlesbar."
  )
  .option("--json", "JSON ausgeben")
  .option(
    "--actor <name>",
    "wer schreibt (max, echo, cron:jule …)",
    env("ACTOR") ?? "agent"
  )
  .option(
    "--data-dir <path>",
    "Datenordner (sonst VIBEGROWTH_DATA_DIR oder Config)"
  )
  .showHelpAfterError()

// ---------- setup ----------

program
  .command("init")
  .description(
    "Datenordner und Werkzeuge in ~/.config/vibegrowth/config.json eintragen und die Datenbank anlegen"
  )
  .option("--data-dir <path>", "Content-Ordner (Pflicht)")
  .option(
    "--db <path>",
    "SQLite-Datei (Standard <data-dir>/.vibegrowth/vibegrowth.db, bestehende .vibeshorts/vibeshorts.db wird weiter genutzt)"
  )
  .option("--python <path>", "Python mit Pillow für Renderer und Zahlen-Abruf")
  .option(
    "--tiktok-pull <path>",
    "tiktok_pull.py (Session und Cookies für den Zahlen-Abruf)"
  )
  .action(
    run(
      async (o: {
        dataDir?: string
        db?: string
        python?: string
        tiktokPull?: string
      }) => {
        // --data-dir is also a global option; commander hands it to the program.
        const dataDir = o.dataDir ?? g().dataDir
        if (!dataDir)
          throw new CliError("INVALID", "init braucht --data-dir <pfad>")
        if (!fs.existsSync(dataDir))
          throw new CliError("NOT_FOUND", `Datenordner fehlt: ${dataDir}`)
        const written = writeConfigFile({
          dataDir,
          dbPath: o.db,
          python: o.python,
          tiktokPullScript: o.tiktokPull,
        })
        // The API opens and migrates the database; init only checks whether it runs.
        let apiStatus: unknown
        try {
          apiStatus = await api.get("/health")
        } catch (e) {
          apiStatus = {
            ok: false,
            url: apiUrl(),
            error: e instanceof Error ? e.message : String(e),
          }
        }
        const dbPath = resolvedDbPath(written)
        const apiDb = (apiStatus as { dbPath?: string }).dbPath
        return {
          config: configFilePath(),
          ...written,
          dbPath,
          api: apiStatus,
          ...(apiDb && apiDb !== dbPath
            ? {
                warnings: [
                  `Die laufende API nutzt ${apiDb}. Nach init die API neu starten, damit sie ${dbPath} nutzt.`,
                ],
              }
            : {}),
        }
      }
    )
  )

program
  .command("import")
  .description(
    "Bestand idempotent übernehmen (Accounts, Personas, Journale, Angles, Posts, Zahlen, Analysen)"
  )
  .option(
    "--accounts-json <path>",
    "content-autopilot/references/accounts.json"
  )
  .action(
    run((o: { accountsJson?: string }) =>
      api.post("/import", { accountsJson: o.accountsJson }, true)
    )
  )

program
  .command("context")
  .description(
    "Alles für einen Morgenlauf: Account, Charakter, Format, Regeln, Bildfehler, CTA, Learnings, Entscheidungen, Eintrag des Tages, Posts mit Zahlen"
  )
  .option("--account <id>")
  .option(
    "--project <id>",
    "Growth-Kontext eines Projekts statt eines Accounts (Funnel, Freigaben, Content, Backlog, Experimente …)"
  )
  .option("--date <YYYY-MM-DD>")
  .action(
    run(
      (
        o: { account?: string; project?: string; date?: string },
        cmd: Command
      ) => {
        if (o.account === undefined && o.project === undefined)
          cmd.error(
            "error: required option '--account <id>' or '--project <id>' not specified"
          )
        if (o.account !== undefined && o.project !== undefined)
          throw new CliError(
            "INVALID",
            "context nimmt --account oder --project, nicht beides"
          )
        return o.account !== undefined
          ? api.get("/context", { account: o.account, date: o.date })
          : projectContext(o.project!, o.date)
      }
    )
  )

/** Contract §7.5: GET /context?project=; older growth builds served /context/project. */
async function projectContext(project: string, date?: string) {
  try {
    return await api.get("/context", { project, date })
  } catch (e) {
    if (
      e instanceof CliError &&
      e.code === "NOT_FOUND" &&
      e.message.startsWith("Cannot GET")
    )
      return api.get("/context/project", { project, date })
    throw e
  }
}

// ---------- accounts & characters ----------

const accountsCmd = program
  .command("accounts")
  .description("Accounts anzeigen und pflegen")
projectAlias(
  accountsCmd.command("list", { isDefault: true }).option("--brand <id>")
)
  .option("--status <status>")
  .action(
    run((o: { brand?: string; status?: string }) =>
      api.get("/accounts", { brand: o.brand, status: o.status })
    )
  )
accountsCmd
  .command("show <id>")
  .action(run((id: string) => api.get(`/accounts/${seg(id)}`)))
function accountOptions(cmd: Command) {
  return cmd
    .option("--name <name>")
    .option("--handle <handle>")
    .option("--platform <platform>")
    .option("--language <lang>")
    .addOption(new Option("--status <status>").choices(ACCOUNT_STATUS))
    .option(
      "--format <id>",
      "Aktives Format (beim Ändern Pflicht: --reason, wird als Pivot gespeichert)"
    )
    .option("--mode <mode>", "z. B. autopilot, manual, test")
    .addOption(new Option("--cta <rule>").choices(CTA_RULES))
    .option("--posts-per-day <n>", "Posts pro Tag", int)
    .option("--character <id>")
    .option("--notion-context <id>")
    .option("--notes <text>")
}
type AccountOpts = {
  name?: string
  handle?: string
  platform?: string
  language?: string
  status?: string
  format?: string
  mode?: string
  cta?: string
  postsPerDay?: number
  character?: string
  notionContext?: string
  notes?: string
}
const accountPatch = (o: AccountOpts) => ({
  name: o.name,
  handle: nullable(o.handle),
  platform: o.platform,
  language: nullable(o.language),
  status: o.status,
  defaultFormatId: nullable(o.format),
  mode: nullable(o.mode),
  ctaRule: o.cta,
  postsPerDay: o.postsPerDay,
  characterId: nullable(o.character),
  notionContextId: nullable(o.notionContext),
  notes: nullable(o.notes),
})
accountOptions(
  projectAlias(
    accountsCmd
      .command("add <id>")
      .description("Account samt Ordnerstruktur anlegen")
      .requiredOption("--brand <id>")
  )
)
  .option(
    "--dir <path>",
    "Ordner relativ zum Datenordner (Standard <brand>/<id>)"
  )
  .action(
    run((id: string, o: AccountOpts & { brand: string; dir?: string }) =>
      api.post("/accounts", {
        id,
        brandId: o.brand,
        dir: o.dir,
        ...accountPatch(o),
        name: o.name ?? id,
      })
    )
  )
accountOptions(accountsCmd.command("update <id>"))
  .option("--reason <text>", "Begründung für den Wechsel des aktiven Formats")
  .action(
    run((id: string, o: AccountOpts & { reason?: string }) => {
      const patch = accountPatch(o)
      if (o.reason !== undefined && patch.defaultFormatId === undefined)
        throw new CliError("INVALID", "--reason gehört zu --format")
      return api.patch(`/accounts/${seg(id)}`, { ...patch, reason: o.reason })
    })
  )

const charsCmd = program.command("characters").description("KI-Charaktere")
charsCmd
  .command("list", { isDefault: true })
  .action(run(() => api.get("/characters")))
charsCmd
  .command("show <id>")
  .action(run((id: string) => api.get(`/characters/${seg(id)}`)))
function charOptions(cmd: Command) {
  return cmd
    .option("--name <name>")
    .option("--brand <id>")
    .option("--persona <text>")
    .option("--voice <text>")
    .option("--look <text>")
    .option("--dos <text>")
    .option("--donts <text>")
}
type CharOpts = {
  name?: string
  brand?: string
  persona?: string
  voice?: string
  look?: string
  dos?: string
  donts?: string
}
const charPatch = (o: CharOpts) => ({
  name: o.name,
  brandId: nullable(o.brand),
  persona: nullable(o.persona),
  voice: nullable(o.voice),
  look: nullable(o.look),
  dos: nullable(o.dos),
  donts: nullable(o.donts),
})
projectAlias(charOptions(charsCmd.command("add <id>")))
  .option("--account <id>", "gleich diesem Account zuordnen")
  .action(
    run((id: string, o: CharOpts & { account?: string }) =>
      api.post("/characters", {
        id,
        ...charPatch(o),
        name: o.name ?? id,
        account: o.account,
      })
    )
  )
projectAlias(charOptions(charsCmd.command("update <id>"))).action(
  run((id: string, o: CharOpts) =>
    api.patch(`/characters/${seg(id)}`, charPatch(o))
  )
)
charsCmd
  .command("add-image <id> <path>")
  .description("Referenzbild anhängen (Pfad im Datenordner)")
  .action(
    run((id: string, p: string) =>
      api.post(`/characters/${seg(id)}/images`, { path: p })
    )
  )

// ---------- formats, rules, image errors ----------

const formatsCmd = program
  .command("formats")
  .description("Formate mit Versionen")
formatsCmd
  .command("list", { isDefault: true })
  .action(run(() => api.get("/formats")))
formatsCmd
  .command("show <id>")
  .action(run((id: string) => api.get(`/formats/${seg(id)}`)))
function formatOptions(cmd: Command) {
  return cmd
    .option("--description <text>")
    .option(
      "--guide <markdown>",
      "Leitfaden als Markdown (Slide-Aufbau, Produktion, Abnahme)"
    )
    .option(
      "--guide-file <path>",
      "Leitfaden aus einer Datei lesen, - für stdin"
    )
    .addOption(
      new Option("--slides <text>", "alter Name für --guide").hideHelp()
    )
    .option(
      "--skills <list>",
      'Werkzeug-Skills, kommagetrennt, z. B. "pinterest,bg-removal" ("" = keine)'
    )
    .option(
      "--examples <paths>",
      'bestätigte Beispielposts relativ zum Datenordner, kommagetrennt ("" = keine)'
    )
    .option("--params <json>", "Renderer-Parameter als JSON-Objekt")
}
type FormatOpts = {
  description?: string
  guide?: string
  guideFile?: string
  slides?: string
  skills?: string
  examples?: string
  params?: string
}
function formatFields(o: FormatOpts) {
  const given = [o.guide, o.guideFile, o.slides].filter((v) => v !== undefined)
  if (given.length > 1)
    throw new CliError(
      "INVALID",
      "Leitfaden nur über eine Option: --guide, --guide-file oder --slides"
    )
  const guide =
    o.guideFile !== undefined ? readText(o.guideFile) : (o.guide ?? o.slides)
  return {
    description: nullable(o.description),
    guide: guide === undefined ? undefined : guide.trim() ? guide : null,
    rendererParams:
      o.params === undefined
        ? undefined
        : parseJsonOption(o.params, "--params"),
    skills: o.skills === undefined ? undefined : (list(o.skills) ?? []),
    examples: o.examples === undefined ? undefined : (list(o.examples) ?? []),
  }
}
formatOptions(
  projectAlias(
    formatsCmd
      .command("add <id>")
      .requiredOption("--name <name>")
      .option("--brand <id>")
  )
).action(
  run((id: string, o: FormatOpts & { name: string; brand?: string }) =>
    api.post("/formats", {
      id,
      name: o.name,
      brandId: o.brand,
      ...formatFields(o),
    })
  )
)
formatOptions(
  formatsCmd
    .command("version <id>")
    .description(
      "Neue Formatversion (Pivot). Nicht angegebene Felder und aktive Regeln werden übernommen."
    )
    .requiredOption("--note <text>", "Begründung")
    .option("--no-carry-rules", "Regeln nicht übernehmen")
).action(
  run((id: string, o: FormatOpts & { note: string; carryRules: boolean }) =>
    api.post(`/formats/${seg(id)}/versions`, {
      changeNote: o.note,
      carryRules: o.carryRules,
      ...formatFields(o),
    })
  )
)
formatOptions(
  formatsCmd
    .command("update <id>")
    .description(
      "Format und aktuelle Version korrigieren, ohne neue Version und ohne Pivot"
    )
    .option("--name <name>")
).action(
  run((id: string, o: FormatOpts & { name?: string }) =>
    api.patch(`/formats/${seg(id)}`, { name: o.name, ...formatFields(o) })
  )
)

const rulesCmd = program
  .command("rules")
  .description("Regeln für Format, Account oder Brand")
projectAlias(
  rulesCmd
    .command("list", { isDefault: true })
    .option("--format <id>")
    .option("--account <id>")
    .option("--brand <id>")
)
  .option("--all", "auch ersetzte")
  .action(
    run(
      (o: {
        format?: string
        account?: string
        brand?: string
        all?: boolean
      }) =>
        api.get("/rules", {
          format: o.format,
          account: o.account,
          brand: o.brand,
          all: o.all,
        })
    )
  )
projectAlias(
  rulesCmd
    .command("add")
    .option("--format <id>")
    .option("--account <id>")
    .option("--brand <id>")
)
  .addOption(new Option("--kind <kind>").choices(RULE_KINDS).default("other"))
  .requiredOption("--text <text>")
  .requiredOption("--source <text>", "Quelle (wer, wo, wann)")
  .option("--date <YYYY-MM-DD>")
  .action(
    run(
      (o: {
        format?: string
        account?: string
        brand?: string
        kind: string
        text: string
        source: string
        date?: string
      }) => {
        const scope = o.format
          ? ["format", o.format]
          : o.account
            ? ["account", o.account]
            : o.brand
              ? ["brand", o.brand]
              : null
        if (!scope)
          throw new CliError(
            "INVALID",
            "Geltungsbereich fehlt: --format, --account oder --brand"
          )
        return api.post("/rules", {
          scopeType: scope[0],
          scopeId: scope[1],
          kind: o.kind,
          text: o.text,
          source: o.source,
          date: o.date,
        })
      }
    )
  )
rulesCmd
  .command("replace <id>")
  .requiredOption("--text <text>")
  .requiredOption("--source <text>")
  .option("--kind <kind>")
  .action(
    run((id: string, o: { text: string; source: string; kind?: string }) =>
      api.post(`/rules/${int(id)}/replace`, {
        text: o.text,
        source: o.source,
        kind: o.kind,
      })
    )
  )
rulesCmd
  .command("retire <id>")
  .action(run((id: string) => api.post(`/rules/${int(id)}/retire`)))

const ieCmd = program
  .command("image-errors")
  .description("Bekannte Bildfehler mit Gegenmaßnahme")
ieCmd
  .command("list", { isDefault: true })
  .option("--format <id>")
  .option("--all", "auch erledigte")
  .action(
    run((o: { format?: string; all?: boolean }) =>
      api.get("/image-errors", { format: o.format, all: o.all })
    )
  )
ieCmd
  .command("add")
  .requiredOption("--title <text>")
  .requiredOption("--fix <text>", "Gegenmaßnahme im Prompt")
  .option("--detect <text>", "woran man ihn erkennt")
  .option("--formats <ids>", "kommagetrennt, leer = alle")
  .option("--example <path>")
  .requiredOption("--source <text>")
  .action(
    run(
      (o: {
        title: string
        fix: string
        detect?: string
        formats?: string
        example?: string
        source: string
      }) =>
        api.post("/image-errors", {
          title: o.title,
          countermeasure: o.fix,
          detection: o.detect,
          formatIds: list(o.formats),
          exampleImage: o.example,
          source: o.source,
        })
    )
  )
ieCmd
  .command("update <id>")
  .option("--title <text>")
  .option("--fix <text>")
  .option("--detect <text>")
  .option("--formats <ids>")
  .addOption(new Option("--status <status>").choices(["active", "resolved"]))
  .action(
    run(
      (
        id: string,
        o: {
          title?: string
          fix?: string
          detect?: string
          formats?: string
          status?: string
        }
      ) =>
        api.patch(`/image-errors/${int(id)}`, {
          title: o.title,
          countermeasure: o.fix,
          detection: nullable(o.detect),
          formatIds: list(o.formats),
          status: o.status,
        })
    )
  )

// ---------- plan ----------

const planCmd = program.command("plan").description("Content-Plan")
projectAlias(
  planCmd
    .command("list", { isDefault: true })
    .option("--account <id>")
    .option("--brand <id>")
)
  .option("--from <date>")
  .option("--to <date>")
  .option("--status <status>")
  .option("--ideas", "Ideen-Pool ohne Datum")
  .action(
    run(
      (o: {
        account?: string
        brand?: string
        from?: string
        to?: string
        status?: string
        ideas?: boolean
      }) =>
        api.get("/plan", {
          account: o.account,
          brand: o.brand,
          from: o.from,
          to: o.to,
          status: o.status,
          ideas: o.ideas,
        })
    )
  )
planCmd
  .command("show <id>")
  .action(run((id: string) => api.get(`/plan/${int(id)}`)))
planCmd
  .command("next")
  .description("Eintrag des Tages")
  .requiredOption("--account <id>")
  .option("--date <date>")
  .action(
    run((o: { account: string; date?: string }) =>
      api.get("/plan/next", { account: o.account, date: o.date })
    )
  )
function entryOptions(cmd: Command) {
  return cmd
    .option("--date <date>", "YYYY-MM-DD, leer = Ideen-Pool")
    .option(
      "--format <id>",
      'nur für ein abweichendes Format an diesem Tag; leer ("") = aktives Format des Accounts'
    )
    .option("--topic <text>")
    .option("--angle <text>")
    .option("--hook-direction <text>")
    .option("--hook <text>")
    .option("--rationale <text>", "Begründung")
    .addOption(new Option("--status <status>").choices(PLAN_STATUS))
    .option("--inspiration <id>", "Inspiration", int)
    .option("--hook-id <id>", "Gewinner-Hook", int)
    .option("--comment <text>")
}
type EntryOpts = {
  date?: string
  format?: string
  topic?: string
  angle?: string
  hookDirection?: string
  hook?: string
  rationale?: string
  status?: string
  inspiration?: number
  hookId?: number
  comment?: string
}
const entryPatch = (o: EntryOpts) => ({
  date: nullable(o.date),
  formatId: nullable(o.format),
  topic: o.topic,
  angle: nullable(o.angle),
  hookDirection: nullable(o.hookDirection),
  hook: nullable(o.hook),
  rationale: nullable(o.rationale),
  status: o.status,
  inspirationId: o.inspiration,
  hookId: o.hookId,
  comment: nullable(o.comment),
})
entryOptions(planCmd.command("add").requiredOption("--account <id>"))
  .option("--lock", "gleich sperren")
  .action(
    run((o: EntryOpts & { account: string; lock?: boolean }) =>
      api.post("/plan", {
        accountId: o.account,
        ...entryPatch(o),
        topic: o.topic ?? "",
        locked: o.lock,
      })
    )
  )
entryOptions(planCmd.command("update <id>")).action(
  run((id: string, o: EntryOpts) =>
    api.patch(`/plan/${int(id)}`, entryPatch(o))
  )
)
planCmd
  .command("move <id> <date>")
  .action(
    run((id: string, date: string) =>
      api.post(`/plan/${int(id)}/move`, { date })
    )
  )
planCmd
  .command("lock <id>")
  .option("--unlock", "entsperren (nur Max)")
  .action(
    run((id: string, o: { unlock?: boolean }) =>
      api.post(`/plan/${int(id)}/lock`, { locked: !o.unlock })
    )
  )
planCmd
  .command("skip <id>")
  .option("--reason <text>")
  .action(
    run((id: string, o: { reason?: string }) =>
      api.post(`/plan/${int(id)}/skip`, { reason: o.reason })
    )
  )
planCmd
  .command("delete <id>")
  .action(run((id: string) => api.del(`/plan/${int(id)}`)))
planCmd
  .command("fill")
  .description(
    "Freie Tage auffüllen. Schreibt nur freie Tage, gesperrte und Max-Einträge bleiben unberührt."
  )
  .requiredOption("--account <id>")
  .option("--weeks <n>", "Horizont in Wochen", int, 3)
  .option("--from <date>")
  .option(
    "--file <path>",
    "JSON-Liste neuer Einträge ({topic, angle, hookDirection, hook, rationale, …}); '-' = stdin. Ohne: Ideen-Pool"
  )
  .action(
    run(
      (o: { account: string; weeks: number; from?: string; file?: string }) => {
        const entries = o.file ? readJsonInput(o.file) : undefined
        if (entries && !Array.isArray(entries))
          throw new CliError("INVALID", "--file muss eine JSON-Liste sein")
        return api.post("/plan/fill", {
          account: o.account,
          weeks: o.weeks,
          from: o.from,
          entries,
        })
      }
    )
  )
planCmd
  .command("horizon")
  .requiredOption("--account <id>")
  .option("--days <n>", "", int, 21)
  .action(
    run((o: { account: string; days: number }) =>
      api.get("/plan/horizon", { account: o.account, days: o.days })
    )
  )

// ---------- posts ----------

const postCmd = program.command("post").alias("posts").description("Posts")
postCmd
  .command("list", { isDefault: true })
  .option("--account <id>")
  .option("--status <status>")
  .action(
    run((o: { account?: string; status?: string }) =>
      api.get("/posts", { account: o.account, status: o.status })
    )
  )
postCmd
  .command("show <id>")
  .action(run((id: string) => api.get(`/posts/${seg(id)}`)))
postCmd
  .command("register")
  .description(
    "Post aus seinem Ordner anlegen oder aktualisieren und mit dem Planeintrag verknüpfen"
  )
  .requiredOption("--account <id>")
  .requiredOption(
    "--dir <path>",
    "Ordnername unter posts/, relativ oder absolut"
  )
  .option("--entry <id>", "Planeintrag", int)
  .option("--delivered", "an Max geliefert")
  .option("--hook <text>")
  .option("--angle <text>")
  .option("--notes <text>")
  .action(
    run(
      (o: {
        account: string
        dir: string
        entry?: number
        delivered?: boolean
        hook?: string
        angle?: string
        notes?: string
      }) =>
        api.post("/posts/register", {
          accountId: o.account,
          dir: o.dir,
          planEntryId: o.entry,
          delivered: o.delivered,
          hook: o.hook,
          angle: o.angle,
          notes: o.notes,
        })
    )
  )
postCmd
  .command("posted <id>")
  .option("--tiktok-id <id>")
  .option("--url <url>")
  .option("--at <iso>")
  .action(
    run((id: string, o: { tiktokId?: string; url?: string; at?: string }) =>
      api.post(`/posts/${seg(id)}/posted`, {
        tiktokId: o.tiktokId,
        url: o.url,
        postedAt: o.at,
      })
    )
  )

// ---------- metrics ----------

const metricsCmd = program.command("metrics").description("Zahlen")
metricsCmd
  .command("pull")
  .description(
    "Öffentliche TikTok-Zahlen abrufen und den Posts zuordnen (eine Abfrage pro Account, frisch < 60 min wird übersprungen)"
  )
  .option("--account <id>")
  .option("--force")
  .action(
    run(
      (o: { account?: string; force?: boolean }) =>
        api.post("/metrics/pull", { account: o.account, force: o.force }, true),
      { partial: true }
    )
  )
metricsCmd
  .command("show")
  .option("--account <id>")
  .option("--post <id>")
  .action(
    run((o: { account?: string; post?: string }) =>
      api.get("/metrics", { account: o.account, post: o.post })
    )
  )

// ---------- learnings, decisions, hooks, inspiration ----------

function scopeFrom(o: {
  account?: string
  brand?: string
  format?: string
  growth?: boolean
}) {
  // --growth with --project/--brand: growth scope of that project
  if (o.growth && !o.account && !o.format)
    return { scopeType: "growth", scopeId: o.brand ?? null }
  if (o.account) return { scopeType: "account", scopeId: o.account }
  if (o.brand) return { scopeType: "brand", scopeId: o.brand }
  if (o.format) return { scopeType: "format", scopeId: o.format }
  if (o.growth) return { scopeType: "growth", scopeId: null }
  return { scopeType: "global", scopeId: null }
}

const learningCmd = program
  .command("learning")
  .alias("learnings")
  .description("Learnings mit Beleg")
learningCmd
  .command("list", { isDefault: true })
  .option("--account <id>")
  .option("--all", "auch überholte")
  .action(
    run((o: { account?: string; all?: boolean }) =>
      api.get("/learnings", { account: o.account, all: o.all })
    )
  )
projectAlias(
  learningCmd.command("add").option("--account <id>").option("--brand <id>")
)
  .option("--format <id>")
  .option(
    "--growth",
    "gilt für die Growth-Arbeit aller Projekte (nicht für Shorts)"
  )
  .requiredOption("--statement <text>")
  .requiredOption("--evidence <text>", "Beleg: Posts und Zahlen")
  .option("--posts <ids>", "Post-IDs als Beleg, kommagetrennt")
  .option("--date <date>")
  .option("--source <text>")
  .addOption(
    new Option(
      "--category <category>",
      "Growth-Kategorie (Standard: aus dem Geltungsbereich abgeleitet)"
    ).choices(["web", "shortform", "app", "general"])
  )
  .action(
    run(
      (o: {
        account?: string
        brand?: string
        format?: string
        statement: string
        evidence: string
        posts?: string
        date?: string
        source?: string
        category?: string
      }) =>
        api.post("/learnings", {
          ...scopeFrom(o),
          statement: o.statement,
          evidence: o.evidence,
          evidencePostIds: list(o.posts)?.map(int),
          date: o.date,
          source: o.source,
          category: o.category,
        })
    )
  )
learningCmd
  .command("outdate <id>")
  .action(run((id: string) => api.post(`/learnings/${int(id)}/outdate`)))

const decisionCmd = program
  .command("decision")
  .alias("decisions")
  .description("Entscheidungen und Pivots mit Begründung")
decisionCmd
  .command("list", { isDefault: true })
  .option("--account <id>")
  .action(
    run((o: { account?: string }) =>
      api.get("/decisions", { account: o.account })
    )
  )
projectAlias(
  decisionCmd
    .command("add")
    .requiredOption("--title <text>")
    .requiredOption("--rationale <text>")
    .option("--pivot", "als Pivot markieren")
    .option("--account <id>")
    .option("--brand <id>")
)
  .option("--format <id>")
  .option(
    "--growth",
    "Growth-Entscheidung eines Projekts (mit --project, nicht für Shorts)"
  )
  .option("--date <date>")
  .option("--supersedes <id>", "ersetzt Entscheidung", int)
  .option("--source <text>")
  .addOption(
    new Option(
      "--category <category>",
      "Growth-Kategorie (Standard: aus dem Geltungsbereich abgeleitet)"
    ).choices(["web", "shortform", "app", "general"])
  )
  .action(
    run(
      (o: {
        title: string
        rationale: string
        pivot?: boolean
        account?: string
        brand?: string
        format?: string
        date?: string
        supersedes?: number
        source?: string
        category?: string
      }) =>
        api.post("/decisions", {
          category: o.category,
          ...scopeFrom(o),
          title: o.title,
          rationale: o.rationale,
          kind: o.pivot ? "pivot" : "decision",
          date: o.date,
          supersedesId: o.supersedes,
          source: o.source,
        })
    )
  )

const hookCmd = program
  .command("hook")
  .alias("hooks")
  .description("Hook-Bibliothek")
hookCmd
  .command("list", { isDefault: true })
  .option("--account <id>")
  .option("--winners")
  .action(
    run((o: { account?: string; winners?: boolean }) =>
      api.get("/hooks", { account: o.account, winners: o.winners })
    )
  )
hookCmd
  .command("add")
  .requiredOption("--account <id>")
  .requiredOption("--text <text>")
  .option("--mechanism <text>")
  .option("--post <id>", "Ursprungspost")
  .option("--winner")
  .action(
    run(
      (o: {
        account: string
        text: string
        mechanism?: string
        post?: string
        winner?: boolean
      }) =>
        // The API resolves post (ID or folder) to originPostId via getPost, as the old CLI did.
        api.post("/hooks", {
          accountId: o.account,
          text: o.text,
          mechanism: o.mechanism,
          post: o.post,
          winner: o.winner,
        })
    )
  )
hookCmd
  .command("winner <id>")
  .option("--unset")
  .action(
    run((id: string, o: { unset?: boolean }) =>
      api.post(`/hooks/${int(id)}/winner`, { winner: !o.unset })
    )
  )
hookCmd
  .command("update <id>")
  .description("Text oder Mechanismus eines Hooks korrigieren")
  .option("--text <text>", "neuer Text; \\n wird zu einem Zeilenumbruch")
  .option("--mechanism <text>", "neuer Mechanismus; 'null' leert ihn")
  .action(
    run((id: string, o: { text?: string; mechanism?: string }) =>
      api.patch(`/hooks/${int(id)}`, {
        text: o.text?.replace(/\\n/g, "\n"),
        mechanism: nullable(o.mechanism),
      })
    )
  )
hookCmd
  .command("variant <id>")
  .description("Variante eines Gewinner-Hooks (max. 3)")
  .requiredOption("--text <text>")
  .option("--mechanism <text>")
  .action(
    run((id: string, o: { text: string; mechanism?: string }) =>
      api.post(`/hooks/${int(id)}/variants`, {
        text: o.text,
        mechanism: o.mechanism,
      })
    )
  )

const inspoCmd = program.command("inspo").description("Inspiration und Trends")
projectAlias(
  inspoCmd
    .command("list", { isDefault: true })
    .option("--account <id>")
    .option("--brand <id>")
)
  .option("--status <status>")
  .option("--type <type>")
  .action(
    run(
      (o: {
        account?: string
        brand?: string
        status?: string
        type?: string
      }) =>
        api.get("/inspo", {
          account: o.account,
          brand: o.brand,
          status: o.status,
          type: o.type,
        })
    )
  )
inspoCmd
  .command("show <id>")
  .action(run((id: string) => api.get(`/inspo/${int(id)}`)))
projectAlias(
  inspoCmd
    .command("add <url>")
    .addOption(
      new Option("--type <type>").choices(INSPO_TYPES).default("format")
    )
    .option("--note <text>")
    .option("--tags <tags>")
    .option("--account <id>")
    .option("--brand <id>")
).action(
  run(
    (
      url: string,
      o: {
        type: string
        note?: string
        tags?: string
        account?: string
        brand?: string
      }
    ) =>
      api.post("/inspo", {
        url,
        type: o.type,
        note: o.note,
        tags: list(o.tags),
        accountId: o.account,
        brandId: o.brand,
      })
  )
)
inspoCmd
  .command("update <id>")
  .addOption(new Option("--status <status>").choices(INSPO_STATUS))
  .addOption(new Option("--type <type>").choices(INSPO_TYPES))
  .option("--note <text>")
  .option("--tags <tags>")
  .option("--account <id>")
  .option("--briefing <path>")
  .action(
    run(
      (
        id: string,
        o: {
          status?: string
          type?: string
          note?: string
          tags?: string
          account?: string
          briefing?: string
        }
      ) =>
        api.patch(`/inspo/${int(id)}`, {
          status: o.status,
          type: o.type,
          note: nullable(o.note),
          tags: list(o.tags),
          accountId: o.account,
          briefingPath: nullable(o.briefing),
        })
    )
  )

program
  .command("history")
  .description("Verlauf aller Änderungen")
  .option("--entity <name>")
  .option("--id <id>")
  .option("--by <actor>")
  .option("--limit <n>", "", int, 50)
  .action(
    run((o: { entity?: string; id?: string; by?: string; limit: number }) =>
      api.get("/history", {
        entity: o.entity,
        id: o.id,
        by: o.by,
        limit: o.limit,
      })
    )
  )

// ---------- files ----------

program
  .command("render")
  .description(
    "Slides, MP4 und Kontaktbogen aus render-manifest.json rendern (Renderer-Parameter aus dem Format)"
  )
  .requiredOption("--post <id>", "Post-ID oder Ordner")
  .option("--no-video", "nur JPGs, Kontaktbogen und Bericht")
  .option(
    "--finalize <stem>",
    "Canvas-Post: rendern, technisch prüfen und Upload-ZIP bauen"
  )
  .option("--zip <name>", "ZIP-Name für --finalize")
  .action(
    run(
      (o: {
        post: string
        video: boolean
        finalize?: string
        zip?: string
      }) => {
        if (o.finalize && !o.zip)
          throw new CliError("INVALID", "--finalize braucht --zip <name>.zip")
        return api.post(
          "/render",
          {
            post: o.post,
            video: o.video,
            finalize: o.finalize ? { stem: o.finalize, zip: o.zip } : undefined,
          },
          true
        )
      }
    )
  )

program
  .command("open <kind> <id>")
  .description("Ordner im Finder öffnen: post, account oder inspo")
  .action(
    run((kind: string, id: string) => {
      if (!["post", "account", "inspo"].includes(kind))
        throw new CliError("INVALID", "kind muss post, account oder inspo sein")
      return api.post("/open", { kind, id })
    })
  )

registerServe(program)
registerGrowth(program)
registerImportGrowth(program)

program.parseAsync().catch(fail)

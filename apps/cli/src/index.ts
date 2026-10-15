#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { Command, Option } from "commander"
import * as cat from "../../api/src/core/catalog"
import {
  configFilePath,
  ConfigError,
  env,
  resolveConfig,
  writeConfigFile,
} from "../../api/src/core/config"
import { accountsUsingFormat, activeFormat, buildContext } from "../../api/src/core/context"
import { appRoot, openDb, tx, type Ctx } from "../../api/src/core/db"
import { folderFor, openPath, renderPost } from "../../api/src/core/files"
import { importContent } from "../../api/src/core/import"
import * as know from "../../api/src/core/knowledge"
import { accountStats, postStats, pullMetrics } from "../../api/src/core/metrics"
import * as plan from "../../api/src/core/plan"
import {
  getPost,
  listPosts,
  markPosted,
  registerPost,
  unregisteredPostDirs,
} from "../../api/src/core/posts"
import { VSError } from "../../api/src/core/util"
import { printHuman } from "./print"

/** "vibegrowth", or "vibeshorts" when called through the old name (kept as alias). */
function cliName() {
  return env("CLI_NAME") ?? "vibegrowth"
}

const program = new Command()
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

type Globals = { json?: boolean; actor: string; dataDir?: string }
const g = () => program.opts<Globals>()

let ctxCache: Ctx | null = null
function ctx() {
  if (!ctxCache) ctxCache = openDb(resolveConfig({ dataDir: g().dataDir }))
  return ctxCache
}

function out(value: unknown) {
  if (g().json) process.stdout.write(JSON.stringify(value, null, 2) + "\n")
  else printHuman(value)
}

function fail(e: unknown): never {
  const code =
    e instanceof VSError
      ? e.code
      : e instanceof ConfigError
        ? "CONFIG"
        : "ERROR"
  const message = e instanceof Error ? e.message : String(e)
  if (g().json)
    process.stdout.write(
      JSON.stringify({ error: { code, message } }, null, 2) + "\n"
    )
  else process.stderr.write(`Fehler (${code}): ${message}\n`)
  process.exit(code === "LOCKED" ? 3 : 1)
}

/** Wrap an action: run it (writes inside one IMMEDIATE transaction), print, exit with status. */
function run<A extends unknown[]>(
  fn: (...args: A) => unknown,
  opts: { write?: boolean } = {}
) {
  return async (...args: A) => {
    try {
      const result = opts.write
        ? tx(ctx(), () => fn(...args))
        : await fn(...args)
      out(await result)
    } catch (e) {
      fail(e)
    }
  }
}

const int = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n))
    throw new VSError("INVALID", `Keine ganze Zahl: ${v}`)
  return n
}
const list = (v?: string) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined
const nullable = (v?: string) =>
  v === undefined ? undefined : v === "" || v === "null" ? null : v

function parseParams(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new VSError("INVALID", "--params ist kein gültiges JSON")
  }
  return value as Record<string, unknown>
}

function readJsonInput(file?: string): unknown {
  const raw =
    file === "-" || !file
      ? fs.readFileSync(0, "utf8")
      : fs.readFileSync(file, "utf8")
  return JSON.parse(raw)
}

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
      (o: {
        dataDir?: string
        db?: string
        python?: string
        tiktokPull?: string
      }) => {
        // --data-dir is also a global option; commander hands it to the program.
        const dataDir = o.dataDir ?? g().dataDir
        if (!dataDir)
          throw new VSError("INVALID", "init braucht --data-dir <pfad>")
        if (!fs.existsSync(dataDir))
          throw new VSError("NOT_FOUND", `Datenordner fehlt: ${dataDir}`)
        const written = writeConfigFile({
          dataDir,
          dbPath: o.db,
          python: o.python,
          tiktokPullScript: o.tiktokPull,
        })
        const c = openDb(resolveConfig())
        return { config: configFilePath(), ...written, dbPath: c.config.dbPath }
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
    run((o: { accountsJson?: string }) => {
      const c = ctx()
      const key = "import.accounts_json"
      const stored = c.sqlite
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(key) as { value: string } | undefined
      const accountsJson = o.accountsJson ?? stored?.value ?? null
      if (o.accountsJson)
        c.sqlite
          .prepare(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
          )
          .run(key, o.accountsJson)
      return importContent(c, { accountsJson })
    })
  )

program
  .command("context")
  .description(
    "Alles für einen Morgenlauf: Account, Charakter, Format, Regeln, Bildfehler, CTA, Learnings, Entscheidungen, Eintrag des Tages, Posts mit Zahlen"
  )
  .requiredOption("--account <id>")
  .option("--date <YYYY-MM-DD>")
  .action(
    run((o: { account: string; date?: string }) =>
      buildContext(ctx(), o.account, o.date)
    )
  )

// ---------- accounts & characters ----------

const accountsCmd = program
  .command("accounts")
  .description("Accounts anzeigen und pflegen")
accountsCmd
  .command("list", { isDefault: true })
  .option("--brand <id>")
  .option("--status <status>")
  .action(
    run((o: { brand?: string; status?: string }) =>
      cat.listAccounts(ctx(), { brandId: o.brand, status: o.status })
    )
  )
accountsCmd.command("show <id>").action(
  run((id: string) => {
    const c = ctx()
    const a = cat.getAccount(c, id)
    const active = activeFormat(c, id)
    return {
      ...a,
      activeFormat: active.format
        ? {
            id: active.format.id,
            name: active.format.name,
            version: active.format.currentVersion,
            source: active.source,
          }
        : null,
      character: a.characterId ? cat.getCharacter(c, a.characterId) : null,
      rules: cat.listRules(c, {
        scopeType: "account",
        scopeId: id,
        status: "active",
      }),
      learnings: know.listLearnings(c, { accountId: id, status: "active" }),
      stats: accountStats(c, id),
      unregisteredPostDirs: unregisteredPostDirs(c, id),
    }
  })
)
function accountOptions(cmd: Command) {
  return cmd
    .option("--name <name>")
    .option("--handle <handle>")
    .option("--platform <platform>")
    .option("--language <lang>")
    .addOption(new Option("--status <status>").choices([...cat.ACCOUNT_STATUS]))
    .option(
      "--format <id>",
      "Aktives Format (beim Ändern Pflicht: --reason, wird als Pivot gespeichert)"
    )
    .option("--mode <mode>", "z. B. autopilot, manual, test")
    .addOption(new Option("--cta <rule>").choices([...cat.CTA_RULES]))
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
  accountsCmd
    .command("add <id>")
    .description("Account samt Ordnerstruktur anlegen")
    .requiredOption("--brand <id>")
)
  .option(
    "--dir <path>",
    "Ordner relativ zum Datenordner (Standard <brand>/<id>)"
  )
  .action(
    run(
      (id: string, o: AccountOpts & { brand: string; dir?: string }) =>
        cat.createAccount(
          ctx(),
          {
            id,
            brandId: o.brand,
            dir: o.dir,
            ...accountPatch(o),
            name: o.name ?? id,
          } as cat.AccountInput,
          g().actor
        ),
      { write: true }
    )
  )
accountOptions(accountsCmd.command("update <id>"))
  .option("--reason <text>", "Begründung für den Wechsel des aktiven Formats")
  .action(
    run(
      (id: string, o: AccountOpts & { reason?: string }) => {
        const c = ctx()
        const { defaultFormatId, ...rest } = accountPatch(o)
        if (o.reason !== undefined && defaultFormatId === undefined)
          throw new VSError("INVALID", "--reason gehört zu --format")
        const pivot =
          defaultFormatId === undefined
            ? null
            : know.setActiveFormat(c, id, defaultFormatId, o.reason, g().actor)
        const account = cat.updateAccount(c, id, rest, g().actor)
        return pivot ? { ...account, pivot } : account
      },
      { write: true }
    )
  )

const charsCmd = program.command("characters").description("KI-Charaktere")
charsCmd
  .command("list", { isDefault: true })
  .action(run(() => cat.listCharacters(ctx())))
charsCmd
  .command("show <id>")
  .action(run((id: string) => cat.getCharacter(ctx(), id)))
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
charOptions(charsCmd.command("add <id>"))
  .option("--account <id>", "gleich diesem Account zuordnen")
  .action(
    run(
      (id: string, o: CharOpts & { account?: string }) => {
        const c = ctx()
        const ch = cat.createCharacter(
          c,
          { id, ...charPatch(o), name: o.name ?? id },
          g().actor
        )
        if (o.account)
          cat.updateAccount(c, o.account, { characterId: ch.id }, g().actor)
        return ch
      },
      { write: true }
    )
  )
charOptions(charsCmd.command("update <id>")).action(
  run(
    (id: string, o: CharOpts) =>
      cat.updateCharacter(ctx(), id, charPatch(o), g().actor),
    { write: true }
  )
)
charsCmd
  .command("add-image <id> <path>")
  .description("Referenzbild anhängen (Pfad im Datenordner)")
  .action(
    run(
      (id: string, p: string) =>
        cat.addCharacterImage(ctx(), id, p.startsWith("/") ? p : p, g().actor),
      { write: true }
    )
  )

// ---------- formats, rules, image errors ----------

const formatsCmd = program
  .command("formats")
  .description("Formate mit Versionen")
formatsCmd
  .command("list", { isDefault: true })
  .action(run(() => cat.listFormats(ctx())))
formatsCmd.command("show <id>").action(
  run((id: string) => {
    const c = ctx()
    const f = cat.getFormat(c, id)
    return {
      ...f,
      activeAccounts: accountsUsingFormat(c, id),
      rules: cat.listRules(c, {
        scopeType: "format",
        scopeId: id,
        formatVersion: f.currentVersion,
      }),
      imageErrors: cat.listImageErrors(c, { formatId: id }),
    }
  })
)
function formatOptions(cmd: Command) {
  return cmd
    .option("--description <text>")
    .option(
      "--guide <markdown>",
      "Leitfaden als Markdown (Slide-Aufbau, Produktion, Abnahme)"
    )
    .option("--guide-file <path>", "Leitfaden aus einer Datei lesen, - für stdin")
    .addOption(new Option("--slides <text>", "alter Name für --guide").hideHelp())
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
function formatFields(o: FormatOpts): cat.FormatVersionInput {
  const given = [o.guide, o.guideFile, o.slides].filter((v) => v !== undefined)
  if (given.length > 1)
    throw new VSError(
      "INVALID",
      "Leitfaden nur über eine Option: --guide, --guide-file oder --slides"
    )
  const guide =
    o.guideFile !== undefined
      ? fs.readFileSync(o.guideFile === "-" ? 0 : o.guideFile, "utf8")
      : (o.guide ?? o.slides)
  return {
    description: nullable(o.description),
    guide: guide === undefined ? undefined : guide.trim() ? guide : null,
    rendererParams: o.params === undefined ? undefined : parseParams(o.params),
    skills: o.skills === undefined ? undefined : (list(o.skills) ?? []),
    examples: o.examples === undefined ? undefined : (list(o.examples) ?? []),
  }
}
formatOptions(
  formatsCmd
    .command("add <id>")
    .requiredOption("--name <name>")
    .option("--brand <id>")
).action(
  run(
    (id: string, o: FormatOpts & { name: string; brand?: string }) =>
      cat.createFormat(
        ctx(),
        { id, name: o.name, brandId: o.brand, ...formatFields(o) },
        g().actor
      ),
    { write: true }
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
  run(
    (id: string, o: FormatOpts & { note: string; carryRules: boolean }) =>
      cat.newFormatVersion(
        ctx(),
        id,
        { changeNote: o.note, carryRules: o.carryRules, ...formatFields(o) },
        g().actor
      ),
    { write: true }
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
  run(
    (id: string, o: FormatOpts & { name?: string }) =>
      cat.updateFormat(
        ctx(),
        id,
        { name: o.name, ...formatFields(o) },
        g().actor
      ),
    { write: true }
  )
)

const rulesCmd = program
  .command("rules")
  .description("Regeln für Format, Account oder Brand")
rulesCmd
  .command("list", { isDefault: true })
  .option("--format <id>")
  .option("--account <id>")
  .option("--brand <id>")
  .option("--all", "auch ersetzte")
  .action(
    run(
      (o: {
        format?: string
        account?: string
        brand?: string
        all?: boolean
      }) => {
        const scope = o.format
          ? ["format", o.format]
          : o.account
            ? ["account", o.account]
            : o.brand
              ? ["brand", o.brand]
              : [undefined, undefined]
        return cat.listRules(ctx(), {
          scopeType: scope[0],
          scopeId: scope[1],
          status: o.all ? undefined : "active",
        })
      }
    )
  )
rulesCmd
  .command("add")
  .option("--format <id>")
  .option("--account <id>")
  .option("--brand <id>")
  .addOption(
    new Option("--kind <kind>").choices([...cat.RULE_KINDS]).default("other")
  )
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
          throw new VSError(
            "INVALID",
            "Geltungsbereich fehlt: --format, --account oder --brand"
          )
        return cat.addRule(
          ctx(),
          {
            scopeType: scope[0],
            scopeId: scope[1],
            kind: o.kind,
            text: o.text,
            source: o.source,
            date: o.date,
          },
          g().actor
        )
      },
      { write: true }
    )
  )
rulesCmd
  .command("replace <id>")
  .requiredOption("--text <text>")
  .requiredOption("--source <text>")
  .option("--kind <kind>")
  .action(
    run(
      (id: string, o: { text: string; source: string; kind?: string }) =>
        cat.replaceRule(ctx(), int(id), o, g().actor),
      { write: true }
    )
  )
rulesCmd
  .command("retire <id>")
  .action(
    run((id: string) => cat.retireRule(ctx(), int(id), g().actor), {
      write: true,
    })
  )

const ieCmd = program
  .command("image-errors")
  .description("Bekannte Bildfehler mit Gegenmaßnahme")
ieCmd
  .command("list", { isDefault: true })
  .option("--format <id>")
  .option("--all", "auch erledigte")
  .action(
    run((o: { format?: string; all?: boolean }) =>
      cat.listImageErrors(ctx(), {
        formatId: o.format,
        status: o.all ? undefined : "active",
      })
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
        cat.addImageError(
          ctx(),
          {
            title: o.title,
            countermeasure: o.fix,
            detection: o.detect,
            formatIds: list(o.formats),
            exampleImage: o.example,
            source: o.source,
          },
          g().actor
        ),
      { write: true }
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
        cat.updateImageError(
          ctx(),
          int(id),
          {
            title: o.title,
            countermeasure: o.fix,
            detection: nullable(o.detect),
            formatIds: list(o.formats),
            status: o.status,
          },
          g().actor
        ),
      { write: true }
    )
  )

// ---------- plan ----------

const planCmd = program.command("plan").description("Content-Plan")
planCmd
  .command("list", { isDefault: true })
  .option("--account <id>")
  .option("--brand <id>")
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
        plan.listPlan(ctx(), {
          accountId: o.account,
          brandId: o.brand,
          from: o.from,
          to: o.to,
          status: o.status,
          ideas: o.ideas,
        })
    )
  )
planCmd
  .command("show <id>")
  .action(run((id: string) => plan.getEntry(ctx(), int(id))))
planCmd
  .command("next")
  .description("Eintrag des Tages")
  .requiredOption("--account <id>")
  .option("--date <date>")
  .action(
    run((o: { account: string; date?: string }) =>
      plan.nextEntry(ctx(), o.account, o.date)
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
    .addOption(new Option("--status <status>").choices([...plan.PLAN_STATUS]))
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
    run(
      (o: EntryOpts & { account: string; lock?: boolean }) =>
        plan.addEntry(
          ctx(),
          {
            accountId: o.account,
            ...entryPatch(o),
            topic: o.topic ?? "",
            locked: o.lock,
          } as plan.EntryInput,
          g().actor
        ),
      { write: true }
    )
  )
entryOptions(planCmd.command("update <id>")).action(
  run(
    (id: string, o: EntryOpts) =>
      plan.updateEntry(ctx(), int(id), entryPatch(o), g().actor),
    { write: true }
  )
)
planCmd
  .command("move <id> <date>")
  .action(
    run(
      (id: string, date: string) =>
        plan.moveEntry(ctx(), int(id), date, g().actor),
      { write: true }
    )
  )
planCmd
  .command("lock <id>")
  .option("--unlock", "entsperren (nur Max)")
  .action(
    run(
      (id: string, o: { unlock?: boolean }) =>
        plan.lockEntry(ctx(), int(id), !o.unlock, g().actor),
      { write: true }
    )
  )
planCmd
  .command("skip <id>")
  .option("--reason <text>")
  .action(
    run(
      (id: string, o: { reason?: string }) =>
        plan.skipEntry(ctx(), int(id), o.reason, g().actor),
      { write: true }
    )
  )
planCmd
  .command("delete <id>")
  .action(
    run((id: string) => plan.deleteEntry(ctx(), int(id), g().actor), {
      write: true,
    })
  )
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
        const entries = o.file
          ? (readJsonInput(o.file) as Omit<
              plan.EntryInput,
              "accountId" | "date"
            >[])
          : undefined
        if (entries && !Array.isArray(entries))
          throw new VSError("INVALID", "--file muss eine JSON-Liste sein")
        return plan.fillPlan(
          ctx(),
          o.account,
          { weeks: o.weeks, from: o.from, entries },
          g().actor
        )
      },
      { write: true }
    )
  )
planCmd
  .command("horizon")
  .requiredOption("--account <id>")
  .option("--days <n>", "", int, 21)
  .action(
    run((o: { account: string; days: number }) =>
      plan.horizon(ctx(), o.account, undefined, o.days)
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
      listPosts(ctx(), { accountId: o.account, status: o.status })
    )
  )
postCmd.command("show <id>").action(
  run((id: string) => {
    const c = ctx()
    const p = getPost(c, id)
    return {
      ...p,
      metrics: postStats(c, p.id),
      planEntry: p.planEntryId ? plan.getEntry(c, p.planEntryId) : null,
    }
  })
)
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
        registerPost(
          ctx(),
          {
            accountId: o.account,
            dir: o.dir,
            planEntryId: o.entry,
            delivered: o.delivered,
            hook: o.hook,
            angle: o.angle,
            notes: o.notes,
          },
          g().actor
        ),
      { write: true }
    )
  )
postCmd
  .command("posted <id>")
  .option("--tiktok-id <id>")
  .option("--url <url>")
  .option("--at <iso>")
  .action(
    run(
      (id: string, o: { tiktokId?: string; url?: string; at?: string }) =>
        markPosted(
          ctx(),
          id,
          { tiktokId: o.tiktokId, url: o.url, postedAt: o.at },
          g().actor
        ),
      {
        write: true,
      }
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
    run(async (o: { account?: string; force?: boolean }) => {
      const r = await pullMetrics(
        ctx(),
        { accountId: o.account, force: o.force },
        g().actor
      )
      if (r.errors.length) process.exitCode = 2
      return r
    })
  )
metricsCmd
  .command("show")
  .option("--account <id>")
  .option("--post <id>")
  .action(
    run((o: { account?: string; post?: string }) => {
      const c = ctx()
      if (o.post) return postStats(c, getPost(c, o.post).id)
      if (o.account) return accountStats(c, o.account)
      return cat
        .listAccounts(c, { status: "active" })
        .map((a) => accountStats(c, a.id))
    })
  )

// ---------- learnings, decisions, hooks, inspiration ----------

function scopeFrom(o: { account?: string; brand?: string; format?: string }) {
  if (o.account) return { scopeType: "account", scopeId: o.account }
  if (o.brand) return { scopeType: "brand", scopeId: o.brand }
  if (o.format) return { scopeType: "format", scopeId: o.format }
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
      know.listLearnings(ctx(), {
        accountId: o.account,
        status: o.all ? undefined : "active",
      })
    )
  )
learningCmd
  .command("add")
  .option("--account <id>")
  .option("--brand <id>")
  .option("--format <id>")
  .requiredOption("--statement <text>")
  .requiredOption("--evidence <text>", "Beleg: Posts und Zahlen")
  .option("--posts <ids>", "Post-IDs als Beleg, kommagetrennt")
  .option("--date <date>")
  .option("--source <text>")
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
      }) =>
        know.addLearning(
          ctx(),
          {
            ...scopeFrom(o),
            statement: o.statement,
            evidence: o.evidence,
            evidencePostIds: list(o.posts)?.map(int),
            date: o.date,
            source: o.source,
          },
          g().actor
        ),
      { write: true }
    )
  )
learningCmd
  .command("outdate <id>")
  .action(
    run(
      (id: string) =>
        know.setLearningStatus(ctx(), int(id), "outdated", g().actor),
      { write: true }
    )
  )

const decisionCmd = program
  .command("decision")
  .alias("decisions")
  .description("Entscheidungen und Pivots mit Begründung")
decisionCmd
  .command("list", { isDefault: true })
  .option("--account <id>")
  .action(
    run((o: { account?: string }) =>
      know.listDecisions(ctx(), { accountId: o.account })
    )
  )
decisionCmd
  .command("add")
  .requiredOption("--title <text>")
  .requiredOption("--rationale <text>")
  .option("--pivot", "als Pivot markieren")
  .option("--account <id>")
  .option("--brand <id>")
  .option("--format <id>")
  .option("--date <date>")
  .option("--supersedes <id>", "ersetzt Entscheidung", int)
  .option("--source <text>")
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
      }) =>
        know.addDecision(
          ctx(),
          {
            ...scopeFrom(o),
            title: o.title,
            rationale: o.rationale,
            kind: o.pivot ? "pivot" : "decision",
            date: o.date,
            supersedesId: o.supersedes,
            source: o.source,
          },
          g().actor
        ),
      { write: true }
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
      know.listHooks(ctx(), { accountId: o.account, winners: o.winners })
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
        know.addHook(
          ctx(),
          {
            accountId: o.account,
            text: o.text,
            mechanism: o.mechanism,
            originPostId: o.post ? getPost(ctx(), o.post).id : null,
            winner: o.winner,
          },
          g().actor
        ),
      { write: true }
    )
  )
hookCmd
  .command("winner <id>")
  .option("--unset")
  .action(
    run(
      (id: string, o: { unset?: boolean }) =>
        know.setHookWinner(ctx(), int(id), !o.unset, g().actor),
      { write: true }
    )
  )
hookCmd
  .command("variant <id>")
  .description("Variante eines Gewinner-Hooks (max. 3)")
  .requiredOption("--text <text>")
  .option("--mechanism <text>")
  .action(
    run(
      (id: string, o: { text: string; mechanism?: string }) =>
        know.addHookVariant(ctx(), int(id), o.text, g().actor, o.mechanism),
      { write: true }
    )
  )

const inspoCmd = program.command("inspo").description("Inspiration und Trends")
inspoCmd
  .command("list", { isDefault: true })
  .option("--account <id>")
  .option("--brand <id>")
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
        know.listInspirations(ctx(), {
          accountId: o.account,
          brandId: o.brand,
          status: o.status,
          type: o.type,
        })
    )
  )
inspoCmd
  .command("show <id>")
  .action(run((id: string) => know.getInspiration(ctx(), int(id))))
inspoCmd
  .command("add <url>")
  .addOption(
    new Option("--type <type>").choices([...know.INSPO_TYPES]).default("format")
  )
  .option("--note <text>")
  .option("--tags <tags>")
  .option("--account <id>")
  .option("--brand <id>")
  .action(
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
        know.addInspiration(
          ctx(),
          {
            url,
            type: o.type,
            note: o.note,
            tags: list(o.tags),
            accountId: o.account,
            brandId: o.brand,
          },
          g().actor
        ),
      { write: true }
    )
  )
inspoCmd
  .command("update <id>")
  .addOption(new Option("--status <status>").choices([...know.INSPO_STATUS]))
  .addOption(new Option("--type <type>").choices([...know.INSPO_TYPES]))
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
        know.updateInspiration(
          ctx(),
          int(id),
          {
            status: o.status,
            type: o.type,
            note: nullable(o.note),
            tags: list(o.tags),
            accountId: o.account,
            briefingPath: nullable(o.briefing),
          },
          g().actor
        ),
      { write: true }
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
      know.listHistory(ctx(), {
        entity: o.entity,
        entityId: o.id,
        actor: o.by,
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
          throw new VSError("INVALID", "--finalize braucht --zip <name>.zip")
        return renderPost(
          ctx(),
          o.post,
          {
            video: o.video,
            finalize: o.finalize
              ? { stem: o.finalize, zip: o.zip! }
              : undefined,
          },
          g().actor
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
        throw new VSError("INVALID", "kind muss post, account oder inspo sein")
      return openPath(
        ctx(),
        folderFor(ctx(), kind as "post" | "account" | "inspo", id)
      )
    })
  )

program
  .command("serve")
  .description("Web-App lokal starten (nur 127.0.0.1)")
  .option("--port <n>", "", int, 4310)
  .option("--dev", "Entwicklungsmodus")
  .action(async (o: { port: number; dev?: boolean }) => {
    try {
      const cfg = resolveConfig({ dataDir: g().dataDir })
      const root = appRoot()
      if (!o.dev && !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
        throw new VSError(
          "INVALID",
          `Kein Build vorhanden. Einmal "npm run build" in ${root} ausführen oder --dev nutzen.`
        )
      }
      const nextBin = path.join(
        root,
        "node_modules",
        "next",
        "dist",
        "bin",
        "next"
      )
      const child = spawn(
        process.execPath,
        [
          nextBin,
          o.dev ? "dev" : "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(o.port),
        ],
        {
          cwd: root,
          stdio: "inherit",
          env: {
            ...process.env,
            VIBEGROWTH_DATA_DIR: cfg.dataDir,
            VIBEGROWTH_DB: cfg.dbPath,
            VIBEGROWTH_APP_ROOT: root,
          },
        }
      )
      process.stderr.write(
        `VibeGrowth läuft auf http://127.0.0.1:${o.port} (Daten: ${cfg.dataDir.replace(os.homedir(), "~")})\n`
      )
      child.on("exit", (code) => process.exit(code ?? 0))
    } catch (e) {
      fail(e)
    }
  })

program.parseAsync().catch(fail)

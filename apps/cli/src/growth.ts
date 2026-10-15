/** Growth commands (contract §7.5). Bodies use the camelCase fields of the growth services. */
import { Option, type Command } from "commander"
import {
  api,
  int,
  nullable,
  parseJsonOption,
  readJsonInput,
  readText,
  run,
} from "./common"
import { CliError, seg } from "./http"

const PROJECT_KIND = ["app", "website", "tool", "other"]
const PROJECT_STATUS = ["active", "paused", "archived"]
const CHANNEL_KIND = [
  "website",
  "ios",
  "android",
  "youtube",
  "instagram",
  "other",
]
const CHANNEL_STATUS = ["active", "paused", "planned"]
const APPROVAL_KIND = [
  "hook",
  "format",
  "blog_topic",
  "draft",
  "store_text",
  "strategy",
  "other",
]
const APPROVAL_STATUS = [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
  "withdrawn",
]
const REF_TYPE = [
  "plan_entry",
  "content",
  "format",
  "hook",
  "experiment",
  "backlog",
]
const CONTENT_KIND = ["blog", "landing", "store_text", "other"]
const CONTENT_STATUS = [
  "idea",
  "approved",
  "draft",
  "review",
  "live",
  "discarded",
]
const BACKLOG_KIND = ["seo", "tech", "content", "store", "growth", "other"]
const BACKLOG_STATUS = ["open", "doing", "done", "dropped"]
const EXP_TARGET = ["page", "post", "store", "other"]
const EXP_STATUS = ["running", "evaluated", "stopped"]
const EXP_VERDICT = ["win", "loss", "neutral", "inconclusive"]
const CHANGE_KIND = [
  "deploy",
  "content",
  "seo",
  "store",
  "config",
  "shorts",
  "other",
]
const MENTION_STATUS = ["new", "contacted", "listed", "rejected", "ignored"]
const SEARCH_SOURCE = ["gsc", "bing"]

const choice = (flags: string, values: string[], description?: string) =>
  new Option(flags, description).choices(values)

/** Markdown from --x or --x-file (- = stdin), never both. */
function textOrFile(
  value: string | undefined,
  file: string | undefined,
  name: string
) {
  if (value !== undefined && file !== undefined)
    throw new CliError(
      "INVALID",
      `${name} nur über eine Option: --${name} oder --${name}-file`
    )
  return file !== undefined ? readText(file) : value
}

export function registerGrowth(program: Command) {
  // ---------- projects & channels ----------

  const projectsCmd = program
    .command("projects")
    .description("Projekte (Marken/Produkte) mit Kanälen und Collectors")
  projectsCmd
    .command("list", { isDefault: true })
    .addOption(choice("--status <status>", PROJECT_STATUS))
    .action(
      run((o: { status?: string }) =>
        api.get("/projects", { status: o.status })
      )
    )
  projectsCmd
    .command("show <id>")
    .description("Projekt mit Kanälen, Collectors und Accounts")
    .action(run((id: string) => api.get(`/projects/${seg(id)}`)))
  function projectOptions(cmd: Command) {
    return cmd
      .option("--url <url>")
      .addOption(choice("--kind <kind>", PROJECT_KIND))
      .addOption(choice("--status <status>", PROJECT_STATUS))
      .option("--language <lang>")
      .option("--repo <path>", "Repo-Pfad oder URL")
      .option("--workspace <path>", "Arbeitsordner der Agents")
      .option("--notion-url <url>")
      .option("--notes <text>")
      .option("--config <json>", "Projekt-Config als JSON (z. B. funnel)")
  }
  type ProjectOpts = {
    name?: string
    url?: string
    kind?: string
    status?: string
    language?: string
    repo?: string
    workspace?: string
    notionUrl?: string
    notes?: string
    config?: string
  }
  const projectPatch = (o: ProjectOpts) => ({
    name: o.name,
    url: nullable(o.url),
    kind: o.kind,
    status: o.status,
    language: nullable(o.language),
    repo: nullable(o.repo),
    workspace: nullable(o.workspace),
    notionUrl: nullable(o.notionUrl),
    notes: nullable(o.notes),
    config:
      o.config === undefined
        ? undefined
        : parseJsonOption(o.config, "--config"),
  })
  projectOptions(
    projectsCmd.command("add <id>").requiredOption("--name <name>")
  ).action(
    run((id: string, o: ProjectOpts) =>
      api.post("/projects", { id, ...projectPatch(o) })
    )
  )
  projectOptions(
    projectsCmd.command("update <id>").option("--name <name>")
  ).action(
    run((id: string, o: ProjectOpts) =>
      api.patch(`/projects/${seg(id)}`, projectPatch(o))
    )
  )

  const channelsCmd = program
    .command("channels")
    .description(
      "Kanäle eines Projekts (Website, Apps, YouTube …); TikTok-Accounts erscheinen virtuell"
    )
  channelsCmd
    .command("list", { isDefault: true })
    .option("--project <id>")
    .action(
      run((o: { project?: string }) =>
        api.get("/channels", { project: o.project })
      )
    )
  function channelOptions(cmd: Command) {
    return cmd
      .option("--name <name>")
      .option("--url <url>")
      .option("--handle <handle>")
      .option("--external-id <id>", "z. B. Bundle-ID, Paketname, Kanal-ID")
      .addOption(choice("--status <status>", CHANNEL_STATUS))
      .option("--notes <text>")
  }
  type ChannelOpts = {
    name?: string
    url?: string
    handle?: string
    externalId?: string
    status?: string
    notes?: string
  }
  const channelPatch = (o: ChannelOpts) => ({
    name: o.name,
    url: nullable(o.url),
    handle: nullable(o.handle),
    externalId: nullable(o.externalId),
    status: o.status,
    notes: nullable(o.notes),
  })
  channelOptions(
    channelsCmd
      .command("add <id>")
      .requiredOption("--project <id>")
      .addOption(choice("--kind <kind>", CHANNEL_KIND).makeOptionMandatory())
  ).action(
    run((id: string, o: ChannelOpts & { project: string; kind: string }) =>
      api.post("/channels", {
        id,
        project: o.project,
        kind: o.kind,
        ...channelPatch(o),
      })
    )
  )
  channelOptions(
    channelsCmd
      .command("update <id>")
      .addOption(choice("--kind <kind>", CHANNEL_KIND))
  ).action(
    run((id: string, o: ChannelOpts & { kind?: string }) =>
      api.patch(`/channels/${seg(id)}`, { kind: o.kind, ...channelPatch(o) })
    )
  )

  // ---------- collectors & KPIs ----------

  const collectorsCmd = program
    .command("collectors")
    .description(
      "Datenquellen pro Projekt (gsc, ga4, bing, psi, app, play, asc, health, audit, geo-chatgpt)"
    )
  collectorsCmd
    .command("list", { isDefault: true })
    .option("--project <id>")
    .action(
      run((o: { project?: string }) =>
        api.get("/collectors", { project: o.project })
      )
    )
  collectorsCmd
    .command("set <collector>")
    .description(
      "Collector ein-/ausschalten und Config mergen (null löscht einen Schlüssel)"
    )
    .requiredOption("--project <id>")
    .option("--enable")
    .option("--disable")
    .option("--config <json>", "Config-Teil als JSON-Objekt")
    .action(
      run(
        (
          collector: string,
          o: {
            project: string
            enable?: boolean
            disable?: boolean
            config?: string
          }
        ) => {
          if (o.enable && o.disable)
            throw new CliError(
              "INVALID",
              "--enable oder --disable, nicht beides"
            )
          return api.put(`/collectors/${seg(o.project)}/${seg(collector)}`, {
            enabled: o.enable ? true : o.disable ? false : undefined,
            config:
              o.config === undefined
                ? undefined
                : parseJsonOption(o.config, "--config"),
          })
        }
      )
    )
  collectorsCmd
    .command("runs")
    .description("Letzte Collector-Läufe")
    .option("--project <id>")
    .option("--collector <id>")
    .option("--limit <n>", "Standard 50", int)
    .action(
      run((o: { project?: string; collector?: string; limit?: number }) =>
        api.get("/collector-runs", {
          project: o.project,
          collector: o.collector,
          limit: o.limit,
        })
      )
    )

  program
    .command("collect")
    .description(
      "Eingeschaltete Collectors laufen lassen (Exit 2, wenn einer fehlschlägt)"
    )
    .option("--project <id>")
    .option("--collector <id>")
    .option("--days <n>", "Tage rückwirkend", int, 10)
    .action(
      run(
        (o: { project?: string; collector?: string; days: number }) =>
          api.post(
            "/collect",
            { project: o.project, collector: o.collector, days: o.days },
            true
          ),
        { partial: true }
      )
    )

  const kpiCmd = program.command("kpi").description("Tageswerte (kpi_daily)")
  kpiCmd
    .command("list", { isDefault: true })
    .requiredOption("--project <id>")
    .option("--source <id>")
    .option("--metric <name>")
    .option("--from <date>")
    .option("--to <date>")
    .option("--dims <json>", 'Aufschlüsselung, "" = nur Tagessummen')
    .action(
      run(
        (o: {
          project: string
          source?: string
          metric?: string
          from?: string
          to?: string
          dims?: string
        }) =>
          api.get("/kpi", {
            project: o.project,
            source: o.source,
            metric: o.metric,
            from: o.from,
            to: o.to,
            dims: o.dims,
          })
      )
    )
  kpiCmd
    .command("ingest")
    .description(
      "Zeilen upserten: JSON-Liste oder {rows:[{project,source,date,metric,dims?,value,channel?}]}"
    )
    .requiredOption("--file <path>", "'-' = stdin")
    .action(
      run((o: { file: string }) => {
        const input = readJsonInput(o.file)
        const rows = Array.isArray(input)
          ? input
          : (input as { rows?: unknown })?.rows
        if (!Array.isArray(rows))
          throw new CliError(
            "INVALID",
            "--file muss eine JSON-Liste oder {rows:[…]} sein"
          )
        return api.post("/kpi/ingest", { rows })
      })
    )

  program
    .command("funnel")
    .description(
      "Funnel eines Projekts: Stufen, Vorwoche, Conversion, schwächste Stufe"
    )
    .requiredOption("--project <id>")
    .option("--days <n>", "", int, 7)
    .option("--end <date>", "letzter Tag (Standard gestern)")
    .action(
      run((o: { project: string; days: number; end?: string }) =>
        api.get("/funnel", { project: o.project, days: o.days, end: o.end })
      )
    )

  program
    .command("overview")
    .description(
      "Alle Projekte: Ampel, Funnel, Freigaben, Experimente, letzter Collect"
    )
    .option("--days <n>", "", int, 7)
    .action(
      run((o: { days: number }) => api.get("/overview", { days: o.days }))
    )

  program
    .command("search")
    .description("Suchanfragen und Seiten aus GSC/Bing, aggregiert")
    .requiredOption("--project <id>")
    .addOption(choice("--source <source>", SEARCH_SOURCE))
    .option("--days <n>", "", int, 28)
    .option("--end <date>", "letzter Tag (Standard gestern)")
    .option("--page <path>", "nur diese Seite")
    .option("--opportunities", "Position 4–20 mit Impressionen")
    .option("--limit <n>", "Standard 500", int)
    .action(
      run(
        (o: {
          project: string
          source?: string
          days: number
          end?: string
          page?: string
          opportunities?: boolean
          limit?: number
        }) =>
          api.get("/search", {
            project: o.project,
            source: o.source,
            days: o.days,
            end: o.end,
            page: o.page,
            opportunities: o.opportunities,
            limit: o.limit,
          })
      )
    )

  const auditCmd = program.command("audit").description("Technisches SEO-Audit")
  auditCmd
    .command("run")
    .requiredOption("--project <id>")
    .action(
      run(
        (o: { project: string }) =>
          api.post("/audit/run", { project: o.project }, true),
        { partial: true }
      )
    )
  auditCmd
    .command("show", { isDefault: true })
    .requiredOption("--project <id>")
    .option("--diff", "neue und entfallene Befunde gegen den vorherigen Lauf")
    .action(
      run((o: { project: string; diff?: boolean }) =>
        api.get("/audit", { project: o.project, diff: o.diff })
      )
    )

  program
    .command("health")
    .description(
      "Erreichbarkeit, TLS und Latenz prüfen (Collector health, Exit 2 bei Befund)"
    )
    .option("--project <id>")
    .option("--all", "alle Projekte (Standard ohne --project)")
    .action(
      run(
        (o: { project?: string; all?: boolean }) => {
          if (o.project && o.all)
            throw new CliError("INVALID", "--project oder --all, nicht beides")
          return api.post("/health-check", { project: o.project }, true)
        },
        { partial: true }
      )
    )

  // ---------- approvals ----------

  const approvalsCmd = program
    .command("approvals")
    .description("Wartet auf Max: Vorschläge, die nur max entscheidet")
  approvalsCmd
    .command("list", { isDefault: true })
    .option(
      "--status <list>",
      `${APPROVAL_STATUS.join(", ")} oder all, kommagetrennt`,
      "pending"
    )
    .option("--project <id>")
    .option("--account <id>")
    .action(
      run((o: { status: string; project?: string; account?: string }) =>
        api.get("/approvals", {
          status: o.status,
          project: o.project,
          account: o.account,
        })
      )
    )
  approvalsCmd
    .command("show <id>")
    .action(run((id: string) => api.get(`/approvals/${seg(id)}`)))
  approvalsCmd
    .command("add")
    .description("Freigabe anfragen (statt Markdown-Datei)")
    .requiredOption("--project <id>")
    .addOption(choice("--kind <kind>", APPROVAL_KIND).makeOptionMandatory())
    .requiredOption("--title <text>")
    .option("--body <markdown>", "Begründung und Vorschlag als Markdown")
    .option("--body-file <path>", "Body aus Datei, - für stdin")
    .option("--payload <json>", "strukturierter Vorschlag als JSON")
    .option("--account <id>")
    .addOption(choice("--ref-type <type>", REF_TYPE))
    .option("--ref-id <id>")
    .action(
      run(
        (o: {
          project: string
          kind: string
          title: string
          body?: string
          bodyFile?: string
          payload?: string
          account?: string
          refType?: string
          refId?: string
        }) => {
          if ((o.refType === undefined) !== (o.refId === undefined))
            throw new CliError(
              "INVALID",
              "--ref-type und --ref-id nur zusammen"
            )
          return api.post("/approvals", {
            projectId: o.project,
            accountId: o.account,
            kind: o.kind,
            title: o.title,
            body: textOrFile(o.body, o.bodyFile, "body"),
            payload:
              o.payload === undefined
                ? undefined
                : parseJsonOption(o.payload, "--payload"),
            refType: o.refType,
            refId: o.refId,
          })
        }
      )
    )
  approvalsCmd
    .command("decide <id>")
    .description("Entscheiden (nur max)")
    .option("--approve")
    .option("--reject")
    .option("--changes", "Änderung erbeten")
    .option("--note <text>")
    .action(
      run(
        (
          id: string,
          o: {
            approve?: boolean
            reject?: boolean
            changes?: boolean
            note?: string
          }
        ) => {
          const picked = [
            o.approve && "approved",
            o.reject && "rejected",
            o.changes && "changes_requested",
          ].filter(Boolean)
          if (picked.length !== 1)
            throw new CliError(
              "INVALID",
              "Genau eins von --approve, --reject, --changes angeben"
            )
          return api.post(`/approvals/${seg(id)}/decide`, {
            decision: picked[0],
            note: o.note,
          })
        }
      )
    )
  approvalsCmd
    .command("withdraw <id>")
    .description("Eigene Anfrage zurückziehen")
    .action(run((id: string) => api.post(`/approvals/${seg(id)}/withdraw`)))

  // ---------- content & backlog ----------

  const contentCmd = program
    .command("content")
    .description("Content-Pipeline (Blog, Landingpages, Store-Texte)")
  contentCmd
    .command("list", { isDefault: true })
    .option("--project <id>")
    .option("--status <list>", `${CONTENT_STATUS.join(", ")}, kommagetrennt`)
    .option("--kind <list>", `${CONTENT_KIND.join(", ")}, kommagetrennt`)
    .action(
      run((o: { project?: string; status?: string; kind?: string }) =>
        api.get("/content", {
          project: o.project,
          status: o.status,
          kind: o.kind,
        })
      )
    )
  contentCmd
    .command("show <id>")
    .description("Eintrag, bei live mit Zahlen seit live_date")
    .action(run((id: string) => api.get(`/content/${seg(id)}`)))
  function contentOptions(cmd: Command) {
    return cmd
      .option("--channel <id>")
      .option("--keyword <text>")
      .option("--intent <text>")
      .option("--brief <markdown>")
      .option("--brief-file <path>", "Brief aus Datei, - für stdin")
      .addOption(choice("--status <status>", CONTENT_STATUS))
      .option("--draft-path <path>", "absoluter Pfad zum Entwurf")
      .option("--url-path <path>", "z. B. /blog/ueberstunden")
      .option("--live-date <date>")
      .option("--approval <id>", "Freigabe", int)
      .option("--notes <text>")
      .option("--position <n>", "", int)
  }
  type ContentOpts = {
    title?: string
    kind?: string
    channel?: string
    keyword?: string
    intent?: string
    brief?: string
    briefFile?: string
    status?: string
    draftPath?: string
    urlPath?: string
    liveDate?: string
    approval?: number
    notes?: string
    position?: number
  }
  const contentPatch = (o: ContentOpts) => ({
    title: o.title,
    kind: o.kind,
    channelId: nullable(o.channel),
    keyword: nullable(o.keyword),
    intent: nullable(o.intent),
    brief: nullable(textOrFile(o.brief, o.briefFile, "brief")),
    status: o.status,
    draftPath: nullable(o.draftPath),
    urlPath: nullable(o.urlPath),
    liveDate: nullable(o.liveDate),
    approvalId: o.approval,
    notes: nullable(o.notes),
    position: o.position,
  })
  contentOptions(
    contentCmd
      .command("add")
      .requiredOption("--project <id>")
      .requiredOption("--title <text>")
      .addOption(choice("--kind <kind>", CONTENT_KIND).default("blog"))
  ).action(
    run((o: ContentOpts & { project: string }) =>
      api.post("/content", { projectId: o.project, ...contentPatch(o) })
    )
  )
  contentOptions(
    contentCmd
      .command("update <id>")
      .option("--title <text>")
      .addOption(choice("--kind <kind>", CONTENT_KIND))
  ).action(
    run((id: string, o: ContentOpts) =>
      api.patch(`/content/${seg(id)}`, contentPatch(o))
    )
  )

  const backlogCmd = program
    .command("backlog")
    .description("Growth-Backlog mit Impact/Aufwand")
  backlogCmd
    .command("list", { isDefault: true })
    .option("--project <id>")
    .option("--status <list>", `${BACKLOG_STATUS.join(", ")}, kommagetrennt`)
    .action(
      run((o: { project?: string; status?: string }) =>
        api.get("/backlog", { project: o.project, status: o.status })
      )
    )
  function backlogOptions(cmd: Command) {
    return cmd
      .option("--detail <text>")
      .option("--impact <n>", "1–3", int)
      .option("--effort <n>", "1–3", int)
      .addOption(choice("--status <status>", BACKLOG_STATUS))
      .option("--source <text>", "woher (Audit, GSC, Max …)")
      .option("--done-ref <ref>", "Commit, URL oder Änderung")
      .option("--position <n>", "", int)
  }
  type BacklogOpts = {
    title?: string
    kind?: string
    detail?: string
    impact?: number
    effort?: number
    status?: string
    source?: string
    doneRef?: string
    position?: number
  }
  const backlogPatch = (o: BacklogOpts) => ({
    title: o.title,
    detail: nullable(o.detail),
    kind: o.kind,
    impact: o.impact,
    effort: o.effort,
    status: o.status,
    source: nullable(o.source),
    doneRef: nullable(o.doneRef),
    position: o.position,
  })
  backlogOptions(
    backlogCmd
      .command("add")
      .requiredOption("--project <id>")
      .requiredOption("--title <text>")
      .addOption(choice("--kind <kind>", BACKLOG_KIND).default("other"))
  ).action(
    run((o: BacklogOpts & { project: string }) =>
      api.post("/backlog", { projectId: o.project, ...backlogPatch(o) })
    )
  )
  backlogOptions(
    backlogCmd
      .command("update <id>")
      .option("--title <text>")
      .addOption(choice("--kind <kind>", BACKLOG_KIND))
  ).action(
    run((id: string, o: BacklogOpts) =>
      api.patch(`/backlog/${seg(id)}`, backlogPatch(o))
    )
  )

  // ---------- experiments & changes ----------

  const expCmd = program
    .command("exp")
    .description("Experimente mit Baseline- und Nachher-Fenster")
  expCmd
    .command("list", { isDefault: true })
    .option("--project <id>")
    .option("--status <list>", `${EXP_STATUS.join(", ")}, kommagetrennt`)
    .action(
      run((o: { project?: string; status?: string }) =>
        api.get("/experiments", { project: o.project, status: o.status })
      )
    )
  expCmd
    .command("show <id>")
    .description(
      "Experiment mit Tagesreihe der Metrik und Änderungen im Zeitraum"
    )
    .action(run((id: string) => api.get(`/experiments/${seg(id)}`)))
  function expOptions(cmd: Command) {
    return cmd
      .option("--hypothesis <text>")
      .option("--channel <id>")
      .option("--baseline-days <n>", "", int)
      .option("--eval-days <n>", "", int)
  }
  type ExpOpts = {
    title?: string
    hypothesis?: string
    channel?: string
    targetType?: string
    target?: string
    metric?: string
    start?: string
    baselineDays?: number
    evalDays?: number
    status?: string
    verdict?: string
  }
  const expPatch = (o: ExpOpts) => ({
    title: o.title,
    hypothesis: nullable(o.hypothesis),
    channelId: nullable(o.channel),
    targetType: o.targetType,
    target: o.target,
    metric: o.metric,
    startDate: o.start,
    baselineDays: o.baselineDays,
    evalDays: o.evalDays,
    status: o.status,
    verdict: nullable(o.verdict),
  })
  expOptions(
    expCmd
      .command("add")
      .requiredOption("--project <id>")
      .requiredOption("--title <text>")
      .addOption(choice("--target-type <type>", EXP_TARGET).default("page"))
      .requiredOption(
        "--target <ref>",
        "Seite (Pfad), Post-ID, Store-Eintrag …"
      )
      .requiredOption(
        "--metric <metric>",
        "clicks, impressions, ctr, position oder <source>:<metric>"
      )
      .requiredOption("--start <date>", "Start (Tag der Änderung)")
  ).action(
    run((o: ExpOpts & { project: string }) =>
      api.post("/experiments", { projectId: o.project, ...expPatch(o) })
    )
  )
  expOptions(
    expCmd
      .command("update <id>")
      .option("--title <text>")
      .addOption(choice("--target-type <type>", EXP_TARGET))
      .option("--target <ref>")
      .option("--metric <metric>")
      .option("--start <date>")
      .addOption(choice("--status <status>", EXP_STATUS))
      .addOption(choice("--verdict <verdict>", EXP_VERDICT))
  ).action(
    run((id: string, o: ExpOpts) =>
      api.patch(`/experiments/${seg(id)}`, expPatch(o))
    )
  )
  expCmd
    .command("eval")
    .description("Fällige Experimente auswerten")
    .option("--project <id>")
    .action(
      run((o: { project?: string }) =>
        api.post("/experiments/evaluate", { project: o.project })
      )
    )

  const changesCmd = program
    .command("changes")
    .description("Änderungs-Log (Deploys, Content, SEO, Store …)")
  changesCmd
    .command("list", { isDefault: true })
    .option("--project <id>")
    .option("--from <date>")
    .option("--to <date>")
    .addOption(choice("--kind <kind>", CHANGE_KIND))
    .action(
      run(
        (o: { project?: string; from?: string; to?: string; kind?: string }) =>
          api.get("/changes", {
            project: o.project,
            from: o.from,
            to: o.to,
            kind: o.kind,
          })
      )
    )
  changesCmd
    .command("add")
    .requiredOption("--project <id>")
    .addOption(choice("--kind <kind>", CHANGE_KIND).makeOptionMandatory())
    .requiredOption("--summary <text>")
    .option("--ref <ref>", "Commit, PR oder URL")
    .option("--exp <id>", "zugehöriges Experiment", int)
    .option("--channel <id>")
    .option("--date <date>", "Standard heute")
    .action(
      run(
        (o: {
          project: string
          kind: string
          summary: string
          ref?: string
          exp?: number
          channel?: string
          date?: string
        }) =>
          api.post("/changes", {
            projectId: o.project,
            channelId: o.channel,
            date: o.date,
            kind: o.kind,
            summary: o.summary,
            ref: o.ref,
            experimentId: o.exp,
          })
      )
    )

  // ---------- GEO, mentions, store ----------

  const geoCmd = program
    .command("geo")
    .description(
      "Sichtbarkeit in KI-Antworten (ChatGPT): Fragen, Checks, Auswertung"
    )
  geoCmd
    .command("questions")
    .option("--project <id>")
    .option("--active", "nur aktive")
    .option("--inactive", "nur inaktive")
    .action(
      run((o: { project?: string; active?: boolean; inactive?: boolean }) =>
        api.get("/geo/questions", {
          project: o.project,
          active: o.active ? "true" : o.inactive ? "false" : undefined,
        })
      )
    )
  const questionCmd = geoCmd.command("question").description("Frage pflegen")
  questionCmd
    .command("add")
    .requiredOption("--project <id>")
    .requiredOption("--text <text>")
    .action(
      run((o: { project: string; text: string }) =>
        api.post("/geo/questions", { projectId: o.project, text: o.text })
      )
    )
  questionCmd
    .command("update <id>")
    .option("--text <text>")
    .option("--active")
    .option("--inactive")
    .action(
      run(
        (
          id: string,
          o: { text?: string; active?: boolean; inactive?: boolean }
        ) => {
          if (o.active && o.inactive)
            throw new CliError(
              "INVALID",
              "--active oder --inactive, nicht beides"
            )
          return api.patch(`/geo/questions/${seg(id)}`, {
            text: o.text,
            active: o.active ? true : o.inactive ? false : undefined,
          })
        }
      )
    )
  geoCmd
    .command("record")
    .description("Checks upserten: JSON-Liste oder {checks:[…]}")
    .requiredOption("--file <path>", "'-' = stdin")
    .action(
      run((o: { file: string }) => {
        const input = readJsonInput(o.file)
        const checks = Array.isArray(input)
          ? input
          : (input as { checks?: unknown })?.checks
        if (!Array.isArray(checks))
          throw new CliError(
            "INVALID",
            "--file muss eine JSON-Liste oder {checks:[…]} sein"
          )
        return api.post("/geo/checks", { checks })
      })
    )
  geoCmd
    .command("list")
    .requiredOption("--project <id>")
    .option("--date <date>")
    .option("--engine <engine>")
    .action(
      run((o: { project: string; date?: string; engine?: string }) =>
        api.get("/geo/checks", {
          project: o.project,
          date: o.date,
          engine: o.engine,
        })
      )
    )
  geoCmd
    .command("summary")
    .requiredOption("--project <id>")
    .action(
      run((o: { project: string }) =>
        api.get("/geo/summary", { project: o.project })
      )
    )
  geoCmd
    .command("run")
    .description("Fragen im Automations-Chrome stellen (Collector geo-chatgpt)")
    .requiredOption("--project <id>")
    .option("--engine <engine>", "", "chatgpt-web")
    .action(
      run(
        (o: { project: string; engine: string }) =>
          api.post("/geo/run", { project: o.project, engine: o.engine }, true),
        { partial: true }
      )
    )

  const mentionsCmd = program
    .command("mentions")
    .description(
      "Erwähnungs-Ziele aus KI-Quellen (Vergleiche, Foren, Presse …)"
    )
  mentionsCmd
    .command("list", { isDefault: true })
    .option("--project <id>")
    .option("--status <list>", `${MENTION_STATUS.join(", ")}, kommagetrennt`)
    .action(
      run((o: { project?: string; status?: string }) =>
        api.get("/mentions", { project: o.project, status: o.status })
      )
    )
  mentionsCmd
    .command("update <id>")
    .addOption(choice("--status <status>", MENTION_STATUS))
    .option("--contact <text>")
    .option("--notes <text>")
    .action(
      run(
        (
          id: string,
          o: { status?: string; contact?: string; notes?: string }
        ) =>
          api.patch(`/mentions/${seg(id)}`, {
            status: o.status,
            contact: nullable(o.contact),
            notes: nullable(o.notes),
          })
      )
    )

  const storeCmd = program
    .command("store")
    .description(
      "App Store und Google Play: Installs, Bewertung, Kampagnen, Reviews"
    )
  storeCmd
    .command("summary", { isDefault: true })
    .requiredOption("--project <id>")
    .option("--days <n>", "", int, 28)
    .action(
      run((o: { project: string; days: number }) =>
        api.get("/store/summary", { project: o.project, days: o.days })
      )
    )
  storeCmd
    .command("reviews")
    .requiredOption("--project <id>")
    .option("--store <store>", "app_store oder google_play")
    .option("--limit <n>", "", int, 20)
    .action(
      run((o: { project: string; store?: string; limit: number }) =>
        api.get("/store/reviews", {
          project: o.project,
          store: o.store,
          limit: o.limit,
        })
      )
    )
}

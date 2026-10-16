# VibeGrowth: Kontrakt v1

Verbindlich für `apps/api`, `apps/web`, `apps/cli`. Abweichungen nur nach Absprache mit Byte, dann dieses Dokument im selben Commit anpassen.

VibeGrowth vereint VibeShorts (Shortform-Studio, Stand Commit `702c6c5`) und das Website-Growth-System (`~/.hermes/artifacts/projects/website-growth/`, Python) in einem lokalen Tool auf dem VibeLabs-Stack: Next.js (Web), NestJS + Drizzle + better-sqlite3 (API), TypeScript-CLI für Agents. Kein Hosting, kein Login, alles auf `127.0.0.1`. Aufbau wie `~/Coding/vibe-crm` (Monorepo `apps/api|web|cli`), ohne Better Auth.

## 0. Harte Randbedingung: Produktion bricht nicht

Echos Crons rufen täglich ab 05:50 `vibeshorts … --json --actor …` auf. Deshalb gilt für jeden Befehl, den die CLI am Commit `702c6c5` kannte (`git show 702c6c5:cli/index.ts`):

- gleicher Befehl, gleiche Optionen (Namen, Kurzformen, Defaults, `choices`, Pflichtoptionen), gleiche Aliase (`post`/`posts`, `learning`/`learnings`, `decision`/`decisions`, `hook`/`hooks`);
- byte-gleiche JSON-Ausgabe mit `--json` (Feldnamen, Feldreihenfolge, Typen, `JSON.stringify(value, null, 2)` + `\n`), abgesehen von `generatedAt`;
- gleiche Exit-Codes: `0` ok, `1` Fehler, `2` Teilfehler (`metrics pull` mit `errors.length > 0`), `3` `LOCKED`;
- Fehler mit `--json` auf stdout als `{"error":{"code","message"}}`, ohne `--json` auf stderr als `Fehler (<code>): <message>`; gleiche Fehlertexte.

Prüfung: alte und neue CLI gegen dieselbe DB-Kopie laufen lassen und vergleichen. Werkzeuge in `~/.hermes/profiles/byte/cache/scratch/vibegrowth-baseline/`: `snap.sh <bin> <outdir>` sammelt die Lese-Ausgaben, `python3 cmp.py <dir-a> <dir-b>` vergleicht sie ohne `generatedAt`. Referenz war bis zum Umbau die alte CLI in `.hermes/frozen/bin/vibeshorts.mjs`; dieser Stand existiert nicht mehr. Seitdem ist die Referenz ein Build von `HEAD` vor der Änderung (`git archive HEAD` in den Scratch-Ordner, dort bauen), der als Dev-API auf einer eigenen Kopie derselben DB-Sicherung läuft; der neue Stand läuft ebenso auf einer zweiten Kopie (mit seiner Migration). Ziel: `diffs: 0` und byte-gleiche Dateien ohne `generatedAt`.

Produktionsdatenbank: `/Users/maxmannstein/VibeLabs/shortform-content/.vibeshorts/vibeshorts.db`. Entwicklung und Proben arbeiten nie darauf, sondern auf einer Kopie (§9).

## 1. Begriffe

- **Projekt**: Marke oder Produkt (Chrono, Amelie, UBulk, Featurama, OpenFibu …). Physisch die Tabelle `projects` (vorher `brands`). Im Shorts-Modul heißt der Fremdschlüssel weiter `brand_id`/`brandId` und der Geltungsbereich weiter `brand` (Regeln, Learnings, Entscheidungen). Das ist dieselbe Projekt-ID, Grund ist die JSON-Kompatibilität (§0). Neue CLI-Optionen heißen `--project`; bei Shorts-Befehlen ist `--project` ein Alias für `--brand`.
- **Kanal**: Website, iOS-App, Android-App, YouTube, Instagram … eines Projekts (Tabelle `channels`). TikTok-Kanäle sind die bestehenden `accounts`; sie erscheinen in Kanal-Listen als virtuelle Kanäle `{id: <account-id>, kind: "tiktok", virtual: true}` und stehen nicht in `channels`.
- **Collector**: Abruf-Modul für eine Quelle (Search Console, GA4 …), pro Projekt einschaltbar, mit eigener Konfiguration (Tabelle `collectors`).
- **KPI**: Tageswert einer Quelle (`kpi_daily`). Basis für Funnel, Übersicht und Experimente.
- **Freigabe** („Wartet auf Max“): Vorschlag eines Agents, den nur der Akteur `max` entscheidet (Tabelle `approvals`).
- **Akteur**: wer schreibt. CLI `--actor` (Default `agent`; die Env `VIBEGROWTH_ACTOR`/`VIBESHORTS_ACTOR` setzt ihn ebenfalls), Browser immer `max`.
- **Kategorie** (Bereich): `web`, `shortform`, `app` oder `general` (Allgemein). Jede Growth-Zeile hat eine, gespeichert oder abgeleitet (§7.9).
- **Strategie**: Vorgehen pro Projekt und Kategorie (Tabelle `strategies`). Shortform-Strategien sind die Formate (§7.10).
- **App-Inbox**: Feature-Requests aus Featurama und Store-Bewertungen mit Antwortstatus (§7.8).

## 2. Repo-Aufbau

```text
apps/api/        NestJS 12 + drizzle + better-sqlite3. Port 4311, bindet nur 127.0.0.1, Präfix /api
  drizzle/       SQL-Migrationen 0000–0006 + meta/_journal.json
  renderer/      Python-Renderer, TikTok-Zahlen-Abruf, OFL-Fonts
  src/
    core/        Domänenschicht aus VibeShorts: schema.ts (einzige Schemaquelle), db.ts (Öffnen + Migrator),
                 config.ts, util.ts (VGError), Fachlogik. Services kapseln diese Funktionen
    database/    DatabaseService: hält den Ctx aus core/db.ts, tx()
    common/      @Actor() (Header X-Actor), JSON-Exception-Filter, Fehlerklassen
    shorts/      Controller für accounts, characters, formats, rules, image-errors, plan, posts, metrics,
                 knowledge (learnings, decisions, hooks, inspo, history), context, import, render, open, media
    growth/data/ projects, channels, collectors, collect, kpi, search, audit, funnel, Collector-Aktionen
    growth/work/ approvals, content, backlog, experiments, changes, geo, mentions, store, overview, context --project
    growth/import/ import-growth (Website-Growth-System übernehmen)
    collectors/  definitions/ (ein Collector pro Datei), sources/ (TS-Ports aus growth.py), registry.ts
apps/web/        Next.js 16, App Router, ohne DB-Zugriff. Port 4310, nur 127.0.0.1
apps/cli/        TypeScript + commander, mit esbuild nach dist/cli.mjs gebündelt. bins vibegrowth, vibeshorts
docs/            CONTRACT.md, api-shorts.md (Shorts-Endpunkte im Detail)
skills/vibegrowth/SKILL.md
```

Root `package.json`: npm-Workspaces `apps/*`, Skripte `build`, `typecheck`, `lint`, `format`, `dev:api`, `dev:web`, `db:generate`. Ein Lockfile im Root.

Python bleibt nur für zwei Dinge, die an fremder Infrastruktur hängen: Slide-Renderer (Pillow, Pixel-Gleichheit mit bestehenden Posts) und TikTok-Zahlen (`tiktok_pull.py` aus Echos Profil, `curl_cffi`-Session). Beide ruft die API per `spawnSync(python, …)` mit JSON auf stdin auf. Alle Growth-Collectors sind TypeScript.

## 3. Konfiguration

Config-Datei `~/.config/vibegrowth/config.json`, als Fallback `~/.config/vibeshorts/config.json` (die neue Datei gewinnt Schlüssel für Schlüssel). Felder: `dataDir`, `dbPath`, `python`, `tiktokPullScript`, `secretsDir`. DB-Default `<dataDir>/.vibegrowth/vibegrowth.db`; existiert `<dataDir>/.vibeshorts/vibeshorts.db`, wird diese weiter genutzt.

Env-Variablen. Alle `VIBEGROWTH_*` in der ersten Tabelle werden auch unter dem alten Namen `VIBESHORTS_*` gelesen; der neue Name gewinnt.

| Env | Default | Zweck |
| --- | --- | --- |
| `VIBEGROWTH_DATA_DIR` | Config `dataDir` | Datenordner (Content) |
| `VIBEGROWTH_DB` | Config `dbPath`, sonst DB-Default | SQLite-Datei |
| `VIBEGROWTH_PYTHON` | Config `python`, sonst `/opt/homebrew/bin/python3` oder `python3` | Python für Renderer und TikTok-Zahlen |
| `VIBEGROWTH_TIKTOK_PULL` | Config `tiktokPullScript` | `tiktok_pull.py` |
| `VIBEGROWTH_SECRETS_DIR` | Config `secretsDir` | Ordner mit Collector-Zugängen (§7.2). Dateien werden nur gelesen, nie kopiert, nie ausgegeben, nie geloggt |
| `VIBEGROWTH_API_PORT` | `4311` | API-Port |
| `VIBEGROWTH_API_URL` | `http://127.0.0.1:4311` | CLI und Web → API |
| `VIBEGROWTH_ACTOR` | `agent` | Akteur der CLI, wenn `--actor` fehlt |
| `VIBEGROWTH_APP_ROOT` | cwd | Ordner mit `drizzle/`, falls die API nicht aus `apps/api` startet |
| `VIBEGROWTH_CLI_NAME` | `vibegrowth` | Programmname in Hilfe und Meldungen (`bin/vibeshorts.mjs` setzt `vibeshorts`) |

Nur in dieser Schreibweise, ohne `VIBESHORTS_`-Fallback:

| Env | Default | Zweck |
| --- | --- | --- |
| `VIBEGROWTH_CDP_URL` (Fallback `GROWTH_CDP_URL`) | `http://127.0.0.1:9224` | Automations-Chrome für `geo-chatgpt` |
| `VIBEGROWTH_PLAY_SA_JSON` (Fallback `GROWTH_PLAY_SA_JSON`) | `~/.playconsole-cli/config.json` → `credentials_path` | Play-Service-Account |
| `VIBEGROWTH_ASC_BIN` | `asc` | asc-CLI für die Collectors `asc` und `reviews` und für `app publish` (App Store) |
| `VIBEGROWTH_FEATURAMA_BIN` | `/opt/homebrew/bin/featurama`, sonst `featurama` | Featurama-CLI für den Collector `featurama` und `app publish` (Featurama) |
| `GOOGLE_PSI_API_KEY` | Datei `google-growth-api-key` | PageSpeed-Key |

## 4. Transport (API)

- Basis `http://127.0.0.1:4311/api`. JSON rein, JSON raus (Body-Limit 5 MB). `GET /api/health` → `{ok:true, dbPath, dataDir, version}`.
- Akteur per Header `X-Actor`, ohne Header `agent`.
- Jeder Schreibvorgang: eine Service-Methode, `BEGIN IMMEDIATE` (`tx`), `history`-Eintrag mit Akteur, Entität, ID, Aktion, Vorher/Nachher der geänderten Felder. Keine Schreibzugriffe an Services vorbei. Gilt auch für Collector-Ergebnisse (Akteur = aufrufender Akteur, z. B. `cron:growth`); Massendaten wie `kpi_daily` schreiben einen `history`-Eintrag pro Lauf, nicht pro Zeile.
- Einträge mit `locked` oder `origin = max` ändert nur `max`. Freigaben entscheidet nur `max`.
- Fehler: Body `{"error":{"code","message"}}`. Status: `INVALID` 400, `NOT_FOUND` 404, `CONFLICT` 409, `LOCKED` 423, `EXTERNAL` 502, `CONFIG` 500, sonst `ERROR` 500. Validierungsfehler (`ValidationPipe`, unbekannte Body-Felder) kommen als `INVALID`. Die CLI kennt zusätzlich den Code `API`: Server nicht erreichbar oder Zeitüberschreitung, Exit 1.
- Statuscodes: POST, das einen Datensatz anlegt (z. B. `/accounts`, `/plan`, `/projects`, `/channels`, `/approvals`, `/content`, `/backlog`, `/experiments`, `/changes`, `/geo/questions`), antwortet mit 201. Aktionen (`/collect`, `/approvals/:id/decide`, `/geo/run`, `/import/growth` …) und alle übrigen Routen mit 200.
- Response-Bodies im Shorts-Teil sind exakt die Rückgabewerte der Funktionen aus `core/*.ts` am Commit `702c6c5` bzw. das, was `cli/index.ts` dort zusammensetzt (z. B. `accounts show`, `formats show`, `post show`). Logik portieren, nicht neu erfinden.
- `GET /api/media?path=<rel>` liefert Dateien aus dem Datenordner (Pfad-Guard, Endungs-Allowlist, Range für MP4).
- Browser-seitig leitet Next per `rewrites` `/api/*` und `/media` an die API weiter.

### 4.1 Body-Feldnamen

Die Module benennen Projekt- und Referenzfelder im JSON-Body unterschiedlich. Das ist so gebaut und gilt; Clients müssen es pro Route richtig setzen. Query-Parameter heißen überall `project`.

| Bereich | Routen | Feldnamen im Body | Validierung |
| --- | --- | --- | --- |
| Shorts | alle Shorts-Routen | camelCase der `core`-Inputs: `accountId`, `brandId`, `formatId`, `planEntryId` …; Ausnahmen wie bisher: `/plan/fill {account}`, `/metrics/pull {account}`, `/characters {account}`, `/hooks {post}` | ohne DTO, `core` prüft |
| Growth-Daten | `POST /projects` (`id`), `POST /channels`, `POST /collect`, `POST /health-check`, `POST /audit/run`, `POST /geo/run`, `POST /search/sitemap-submit`, `POST /search/bing-submit`, `POST /collectors/app/setup` | `project` (Projekt-ID); `/channels` zusätzlich `externalId`; `/kpi/ingest` Zeilen mit `project` und `channel` | `onlyKeys`: unbekannte Felder → `INVALID` |
| Growth-Arbeit | `POST /approvals`, `/content`, `/backlog`, `/experiments`, `/changes`, `/geo/questions`, `/strategies`, `PATCH /knowledge/:type/:id` | `projectId`, `channelId`, `accountId`, `approvalId`, `experimentId`, `refType`, `refId`, `draftPath`, `urlPath`, `liveDate`, `doneRef`, `notionUrl`, `targetType`, `startDate`, `baselineDays`, `evalDays`, `sourceKey`, `category` | DTO mit `whitelist` + `forbidNonWhitelisted` → `INVALID`. Ausnahmen `POST /experiments/evaluate {project?}` und `POST /app/publish {project?, dryRun?}` |
| GEO-Checks | `POST /geo/checks {checks:[…]}` | je Check `projectId` oder `project`, `questionId` oder `question` (Fragetext) | DTO |
| Import | `POST /import/growth` | `db`, `sites`, `workspaceRoot` | eigene Prüfung |

`PUT /collectors/:project/:collector` nimmt das Projekt im Pfad, Body `{enabled?, config?}`.

## 5. Shorts-Endpunkte (1:1 zu den bisherigen CLI-Befehlen)

Query-Parameter für Filter, JSON-Body für Schreibvorgänge mit den camelCase-Feldern der jeweiligen `core`-Input-Typen. Die CLI übersetzt ihre Optionen so wie bisher `cli/index.ts` (`nullable`, `list`, `int`, `accountPatch`, `entryPatch`, `formatFields` …) und schickt das Ergebnis. Details pro Route: `docs/api-shorts.md`.

| CLI | Methode + Pfad | core-Referenz |
| --- | --- | --- |
| `context --account <id> [--date]` | `GET /context?account=&date=` | `buildContext` (Weiche zu `context --project`: §7.6) |
| `import [--accounts-json]` | `POST /import {accountsJson?}` | settings-Key `import.accounts_json` + `importContent` |
| `accounts list [--brand] [--status]` | `GET /accounts?brand=&status=` | `listAccounts` |
| `accounts show <id>` | `GET /accounts/:id` | Zusammensetzung aus `cli/index.ts` |
| `accounts add <id> …` | `POST /accounts` | `createAccount` |
| `accounts update <id> … [--format --reason]` | `PATCH /accounts/:id` | `setActiveFormat` + `updateAccount`, Rückgabe wie CLI (`pivot`) |
| `characters list\|show\|add\|update\|add-image` | `GET /characters`, `GET /characters/:id`, `POST /characters {…, account?}`, `PATCH /characters/:id`, `POST /characters/:id/images {path}` | catalog |
| `formats list\|show\|add\|version\|update` | `GET /formats`, `GET /formats/:id`, `POST /formats`, `POST /formats/:id/versions`, `PATCH /formats/:id` | catalog; `--guide-file` liest die CLI lokal und schickt `guide` |
| `rules list\|add\|replace\|retire` | `GET /rules?format=&account=&brand=&all=`, `POST /rules`, `POST /rules/:id/replace`, `POST /rules/:id/retire` | catalog |
| `image-errors list\|add\|update` | `GET /image-errors?format=&all=`, `POST /image-errors`, `PATCH /image-errors/:id` | catalog |
| `plan list` | `GET /plan?account=&brand=&from=&to=&status=&ideas=` | `listPlan` |
| `plan show <id>` | `GET /plan/:id` | `getEntry` |
| `plan next` | `GET /plan/next?account=&date=` | `nextEntry` |
| `plan add` | `POST /plan` | `addEntry` |
| `plan update <id>` | `PATCH /plan/:id` | `updateEntry` |
| `plan move <id> <date>` | `POST /plan/:id/move {date}` | `moveEntry` |
| `plan lock <id> [--unlock]` | `POST /plan/:id/lock {locked}` | `lockEntry` |
| `plan skip <id>` | `POST /plan/:id/skip {reason?}` | `skipEntry` |
| `plan delete <id>` | `DELETE /plan/:id` | `deleteEntry` |
| `plan fill` | `POST /plan/fill {account, weeks, from?, entries?}` | `fillPlan` (`--file` liest die CLI lokal) |
| `plan horizon` | `GET /plan/horizon?account=&days=` | `horizon` |
| `post list\|show\|register\|posted` | `GET /posts?account=&status=`, `GET /posts/:idOrDir`, `POST /posts/register`, `POST /posts/:idOrDir/posted` | posts |
| `metrics pull [--account] [--force]` | `POST /metrics/pull {account?, force?}` | `pullMetrics`; CLI setzt Exit 2 bei `errors.length` |
| `metrics show [--account\|--post]` | `GET /metrics?account=&post=` | wie CLI |
| `learning list\|add\|outdate` | `GET /learnings?account=&all=`, `POST /learnings`, `POST /learnings/:id/outdate` | knowledge |
| `decision list\|add` | `GET /decisions?account=`, `POST /decisions` | knowledge |
| `hook list\|add\|winner\|variant` | `GET /hooks?account=&winners=`, `POST /hooks`, `POST /hooks/:id/winner {winner}`, `POST /hooks/:id/variants` | knowledge |
| `inspo list\|show\|add\|update` | `GET /inspo?…`, `GET /inspo/:id`, `POST /inspo`, `PATCH /inspo/:id` | knowledge |
| `history` | `GET /history?entity=&id=&by=&limit=` | `listHistory` |
| `render --post …` | `POST /render {post, video, finalize?}` | `renderPost`; unregistrierter Post-Ordner wird vorher registriert, Foto-Posts (`photo-mode`) bekommen das Upload-ZIP, Antwort dann mit `zip` |
| `open <kind> <id>` | `POST /open {kind, id}` | `openPath`/`folderFor` |

Nur für die Web-App (kein CLI-Befehl): `PATCH /plan/:id` mit `locked`, `POST /accounts` mit `newCharacter`, `PATCH /posts/:idOrDir`, `POST /learnings/:id/status` (siehe `docs/api-shorts.md`).

`--project <id>` ist bei allen Shorts-Befehlen mit `--brand` ein Alias dafür (`accounts list|add`, `characters add|update`, `formats add`, `rules list|add`, `plan list`, `learning add`, `decision add`, `inspo list|add`). Sonst keine Änderung.

CLI-lokal bleiben `init` (schreibt `dataDir`, `dbPath`, `python`, `tiktokPullScript` in die Config und fragt `GET /health`; die API legt die DB beim Start an und migriert sie) und `serve` (§10).

## 6. Schema

`apps/api/src/core/schema.ts` ist die einzige Schemaquelle. Bestehende Tabellen und Spalten (Commit `702c6c5`, `core/schema.ts`) bleiben unverändert, außer:

- `brands` → `projects` (`ALTER TABLE brands RENAME TO projects`; SQLite zieht die FKs in `accounts`, `characters`, `formats`, `inspirations` mit). Bestehend: `id`, `name`, `notion_url`, `notes`. Neu: `url` TEXT, `kind` TEXT NOT NULL DEFAULT `'app'` (`app|website|tool|other`), `status` TEXT NOT NULL DEFAULT `'active'` (`active|paused|archived`), `language` TEXT, `repo` TEXT, `workspace` TEXT, `config` TEXT NOT NULL DEFAULT `'{}'` (JSON, bekannte Schlüssel: `funnel` §7.3, `seedKeywords` für `search keywords`).

Migrationen: Ledger ist die Tabelle `_migrations(tag, applied_at)`; der Migrator aus `core/db.ts` liest das Journal und wendet fehlende Tags in einer `IMMEDIATE`-Transaktion an. Neue Migrationen anhängen, nie bestehende ändern.

| Migration | Inhalt |
| --- | --- |
| `0000_init`, `0001_format_guide_skills_examples`, `0002_plan_format_follows_account` | VibeShorts-Bestand |
| `0003_projects_growth` | `brands` → `projects` mit neuen Spalten, alle Growth-Tabellen |
| `0004_import_source_keys` | `source_key` TEXT + UNIQUE-Index auf `audit_runs` und `collector_runs` (für `import-growth`) |
| `0005_growth_learning_scope` | Scope `growth` für Learnings und Entscheidungen |
| `0006_categories_strategies_app_inbox` | `category` TEXT NULL an `learnings`, `decisions`, `experiments`, `backlog_items`, `approvals`, `changes`, `content_items`; `backlog_items.notion_url`; `store_reviews.last_modified`, `reply_at`, `reply_state`, `needs_reply`; neue Tabellen `strategies`, `feature_requests`. Nur `ADD COLUMN`/`CREATE TABLE`, keine Rebuilds |

Alle neuen Tabellen: `created_at`/`updated_at` TEXT ISO wie im Bestand, JSON-Spalten als TEXT mit Default `'[]'`/`'{}'`, `source_key` TEXT UNIQUE wo importiert wird.

| Tabelle | Spalten (Kurzform) |
| --- | --- |
| `channels` | `id` TEXT PK (z. B. `chrono-web`), `project_id` → projects, `kind` (`website\|ios\|android\|youtube\|instagram\|other`), `name`, `url`, `handle`, `external_id`, `status` (`active\|paused\|planned`, Default `active`), `notes` |
| `collectors` | PK (`project_id`, `collector`), `enabled` INT bool Default 0, `config` JSON `'{}'`, `updated_at` |
| `collector_runs` | `id` PK, `project_id`, `collector`, `started_at`, `finished_at`, `ok` INT bool, `summary`, `error`, `stats` JSON, `actor`, `source_key` |
| `kpi_daily` | PK (`project_id`, `source`, `date`, `metric`, `dims`), `dims` TEXT NOT NULL DEFAULT `''` (sonst stabiles JSON mit sortierten Schlüsseln), `value` REAL, `channel_id` NULL, `updated_at` |
| `search_daily` | PK (`project_id`, `source` (`gsc\|bing`), `date`, `query`, `page`), `clicks`, `impressions`, `ctr`, `position` (REAL). `page` = `''`, wenn die Quelle keine Seite liefert |
| `audit_runs` | `id` PK, `project_id`, `at`, `pages` INT, `ok` INT bool, `source_key` |
| `audit_issues` | `id` PK, `run_id` → audit_runs, `project_id`, `url`, `code`, `severity` (`error\|warning\|info`), `detail` |
| `audit_pages` | `id` PK, `run_id`, `project_id`, `url`, `data` JSON; UNIQUE(`run_id`, `url`) |
| `experiments` | `id` PK, `project_id`, `channel_id` NULL, `title`, `hypothesis`, `target_type` (`page\|post\|store\|other`), `target`, `metric` (`clicks\|impressions\|ctr\|position\|<source>:<metric>`), `start_date`, `baseline_days` Default 28, `eval_days` Default 28, `status` (`running\|evaluated\|stopped`), `result` JSON NULL, `verdict` NULL (`win\|loss\|neutral\|inconclusive`), `actor`, `source_key` |
| `changes` | `id` PK, `project_id`, `channel_id` NULL, `date`, `kind` (`deploy\|content\|seo\|store\|config\|shorts\|other`), `summary`, `ref`, `experiment_id` NULL, `actor`, `source_key` |
| `approvals` | `id` PK, `project_id`, `account_id` NULL, `kind` (`hook\|format\|blog_topic\|draft\|store_text\|strategy\|other`), `title`, `body` (Markdown), `payload` JSON, `ref_type` NULL (`plan_entry\|content\|format\|hook\|experiment\|backlog`), `ref_id` NULL, `status` (`pending\|approved\|rejected\|changes_requested\|withdrawn`), `requested_by`, `decided_by`, `decided_at`, `decision_note` |
| `content_items` | `id` PK, `project_id`, `channel_id` NULL, `kind` (`blog\|landing\|store_text\|other`), `title`, `keyword`, `intent`, `brief`, `status` (`idea\|approved\|draft\|review\|live\|discarded`), `draft_path` (absolut, außerhalb des Datenordners erlaubt, nur Verweis), `url_path` (z. B. `/blog/ueberstunden`), `live_date`, `approval_id` NULL, `notes`, `position`, `actor`, `source_key` |
| `backlog_items` | `id` PK, `project_id`, `title`, `detail`, `kind` (`seo\|tech\|content\|store\|growth\|other`), `impact` INT 1–3, `effort` INT 1–3, `status` (`open\|doing\|done\|dropped`), `source`, `done_ref`, `position`, `actor`, `source_key` |
| `geo_questions` | `id` PK, `project_id`, `text`, `active` INT bool Default 1, `source_key`; UNIQUE(`project_id`, `text`) |
| `geo_checks` | `id` PK, `project_id`, `question_id` → geo_questions, `date`, `engine`, `status` (`ok\|error`), `mentioned` INT bool, `position` INT NULL, `cited` INT bool, `in_sources` INT bool, `brands` JSON, `competitors` JSON, `links` JSON, `cited_urls` JSON, `sources` JSON, `answer`, `model`, `evidence` (Pfad), `meta` JSON, `error`, `source_key`; UNIQUE(`project_id`, `question_id`, `date`, `engine`) |
| `mention_targets` | `id` PK, `project_id`, `domain`, `url`, `kind` (`app_store\|comparison\|guide\|forum\|press\|vendor\|other`), `seen_count`, `cited_count`, `first_seen`, `last_seen`, `status` (`new\|contacted\|listed\|rejected\|ignored`), `contact`, `notes`; UNIQUE(`project_id`, `domain`) |
| `store_reviews` | `id` PK, `project_id`, `store` (`app_store\|google_play`), `review_id`, `date`, `rating` INT, `title`, `body`, `language` (App Store: Territorium ISO-3, z. B. `DEU`), `version`, `reply`, `last_modified` (letzte Änderung der Bewertung), `reply_at` (letzte Änderung der Antwort), `reply_state` (Apple `PUBLISHED\|PENDING_PUBLISH`), `needs_reply` INT bool; UNIQUE(`project_id`, `store`, `review_id`) |
| `strategies` | `id` TEXT PK (Slug), `project_id` NULL (= für alle Projekte), `category` (`web\|app\|general`), `name`, `summary`, `guide` (Markdown), `status` (`active\|paused\|retired`, Default `active`), `skills` JSON `'[]'`, `source`, `actor` |
| `feature_requests` | `id` PK, `project_id`, `featurama_project_id`, `request_id`, `title`, `body`, `status` (Featurama-Status), `votes` INT, `approved` INT bool (in Featurama freigegeben), `platform`, `app_version`, `requested_at`, `last_user_comment_at`, `last_developer_comment_at`, `needs_reply` INT bool, `comment_count` INT, `comments` JSON `[{id, role, author, content, createdAt}]` (`author` nur bei Entwicklern), `url`; UNIQUE(`project_id`, `request_id`). Keine E-Mail-Adressen, keine Geräte-IDs, aus `deviceInfo` nur Plattform und App-Version |

`category` ist an allen sieben Tabellen nullable: `null` heißt abgeleitet (§7.9). `backlog_items.kind` kennt zusätzlich `bug`, `feature`, `ux`; `changes.kind` zusätzlich `reply`; `approvals.kind` zusätzlich `reply`, `task`, `content`. Migration `0007` (nur `ADD COLUMN`): `feature_requests` und `store_reviews` bekommen `no_reply_last_seen`, `no_reply_at` (schreibt nur Max über die Inbox, nie ein Collector), `content_items` bekommt `planned_date`.

Enums sind Whitelists im Service (`INVALID` sonst), keine CHECK-Constraints, keine Trigger.

## 7. Growth-Modul

### 7.1 KPI-Konventionen (Collector → `kpi_daily`)

Jeder Collector schreibt Tagessummen mit `dims = ''` und darf zusätzlich Aufschlüsselungen mit `dims`-JSON schreiben. Pflicht-Metriken (Quelle → Metrik):

| Quelle | Metriken mit `dims=''` | Aufschlüsselungen |
| --- | --- | --- |
| `gsc` | `clicks`, `impressions`, `ctr`, `position` | Query×Seite in `search_daily` |
| `bing` | `clicks`, `impressions` | Queries in `search_daily` |
| `ga4` | `sessions`, `users`, `engaged`, `key_events`, `event:<name>` (z. B. `event:download_click`) | `{"channel","landing"}` für `sessions`; `{"param","value"}` für Event-Parameter |
| `psi` | - | `{"strategy","url"}` → `performance`, `seo`, `accessibility`, `best_practices`, `lcp_ms`, `cls`, `tbt_ms` |
| `app` | `active_users`, `new_users`, `event:<name>` (z. B. `event:first_entry_created`), `retention_d1`, `retention_d7`, `retention_d28` (Anteil 0–1, auf das Kohortenstart-Datum), `active_d7`, `active_d28` | `{"platform"}` |
| `play` | `installs`, `store_visits`, `uninstalls`, `rating` | `{"source","utm_campaign","country"}` |
| `asc` | `installs`, `impressions`, `product_page_views`, `rating` | `{"campaign","source"}` |
| `health` | `up` (0/1), `tls_days`, `latency_ms` | - |

### 7.2 Collectors

IDs: `health`, `audit`, `gsc`, `ga4`, `bing`, `psi`, `app`, `play`, `asc`, `reviews`, `featurama`, `geo-chatgpt`. Ein Collector ist eine Datei in `collectors/definitions/` plus ein Eintrag in `registry.ts`: `{id, label, channelKinds, configSchema, secrets, defaults?, run(project, config, options) → {ok, kpi, summary, stats, errors, …}}`. Collectors fassen die DB nie an. Sie liefern normalisierte Zeilen; `CollectService` schreibt sie in einer Transaktion über die Growth-Services (`kpi_daily`, `search_daily`, Audit-Tabellen, `geo_checks`, `store_reviews`) samt `collector_runs`-Zeile und einem `history`-Eintrag.

Konfiguration pro Projekt in `collectors.config`, gemergt über die `defaults` (Pflichtfelder fett):

| Collector | Config | Zugang |
| --- | --- | --- |
| `health` | **`url`** (Default `projects.url`), `path` (z. B. `/api/health`), `tlsMinDays` (14), `slowSeconds` (3) | keiner |
| `audit` | **`url`** (Default `projects.url`), `keyPaths`, `ignore` (`[[pfad, code]]`), `slowSeconds` (2.5) | keiner |
| `gsc` | **`property`** (z. B. `sc-domain:chrono-app.net`) | Google-OAuth |
| `ga4` | **`property`** (z. B. `properties/558994740`), `eventParams` (z. B. `{"download_click":["placement"]}`) | Google-OAuth |
| `bing` | **`url`** (Default `projects.url`) | `bing-webmaster-api-key` |
| `psi` | `urls`, `url` (Default `projects.url`), `strategies` (`mobile`, `desktop`) | `google-growth-api-key` oder `GOOGLE_PSI_API_KEY` |
| `app` | **`ga4Property`**, `firebaseProject`, `funnelEvents`, `keyEvents`, `eventDimensions`, `userDimensions` | Google-OAuth |
| `play` | **`package`**, **`gcsBucket`** | Play-Service-Account |
| `asc` | **`appId`**, `providerId`, `profile` (asc-CLI-Profil) | asc-CLI |
| `reviews` | `package` (Default `play.package`), `gcsBucket` (Default `play.gcsBucket`), `appId` (Default `asc.appId`), `ascProfile` (leer = Standardprofil der asc-CLI), `csvMonths` (3) | Play-Service-Account (Scopes `androidpublisher`, `devstorage.read_only`), asc-CLI |
| `featurama` | **`featuramaProjectId`**, `context` (Kontext der Featurama-CLI, Default `hosted`) | Featurama-CLI (`~/.config/featurama/config.json`, Token liest nur die CLI) |
| `geo-chatgpt` | **`brandPatterns`**, `brandPatternsAmbiguous`, `brandContext`, `evidenceDir`, `appStoreId` (Default `asc.appId`), `playPackage` (Default `play.package`), `promptTimeout` (240), `budgetMin` (50), `forceSearch` | Automations-Chrome; Fragen aus `geo_questions` |

Zugänge in `secretsDir` (Dateinamen wie im Growth-System): `google-growth-oauth-client.json` und `google-growth-oauth-token.json` (Google-OAuth für `gsc`, `ga4`, `app`, `search sitemap-submit`, `collectors setup app`), `google-growth-api-key` (`psi`), `bing-webmaster-api-key` (`bing`, `search bing-submit`). Play-Service-Account über `VIBEGROWTH_PLAY_SA_JSON`/`GROWTH_PLAY_SA_JSON` oder `~/.playconsole-cli/config.json` → `credentials_path` des Standardprofils. `asc` über das Profil der asc-CLI. Fehlt ein Zugang, endet der Lauf mit `ok:false` und einer klaren Meldung, ohne Secret-Inhalte. Der OAuth-Refresh schreibt den Token zurück in dieselbe Datei, sonst schreibt VibeGrowth nichts in `secretsDir`.

### 7.3 Funnel

Stufen (Standard, pro Projekt in `projects.config.funnel` überschreibbar):

| key | Label | Quelle(n) | Aggregation |
| --- | --- | --- | --- |
| `impression` | Impressionen | `gsc:impressions` + `bing:impressions` | Summe |
| `click` | Klicks | `gsc:clicks` + `bing:clicks` | Summe |
| `visit` | Besuche | `ga4:sessions` | Summe |
| `download_click` | Download-Klicks | `ga4:event:download_click` | Summe |
| `install` | Installationen | `play:installs` + `asc:installs` | Summe |
| `first_entry` | Erster Eintrag | `app:event:first_entry_created` | Summe |
| `active_d7` | Aktiv D7 | `app:active_d7` | letzter Wert im Fenster |
| `active_d28` | Aktiv D28 | `app:active_d28` | letzter Wert im Fenster |

Override: Liste (oder `{stages:[…]}`) von `{key, label?, sources?, agg?}` mit `agg` `sum|last`. Bekannte Keys erben fehlende Felder vom Standard. `PATCH /projects/:id` prüft das beim Schreiben.

`GET /funnel?project=&days=7&end=YYYY-MM-DD` (Default `end` = gestern) → `{project, window:{from,to}, prevWindow:{from,to}, stages:[{key,label,value,prev,delta (relativ, null bei prev=0), conversion (value/vorherige Stufe, null bei erster Stufe oder 0), prevConversion, hasData}], weakest: <key der Stufe mit der niedrigsten conversion unter Stufen mit Daten>}`. Stufen ohne jede Quelle mit Daten: `value:null, hasData:false`.

### 7.4 Übersicht

`GET /overview?days=7` → eine Zeile pro Projekt mit `status != archived`: `{project:{id,name,url,kind}, funnel:{stages (key/value/prev/delta)}, weakest, light ("green"|"yellow"|"red"), reasons:[…], pendingApprovals, runningExperiments, lastCollect, collectorErrors:[{collector, error, at}], shorts:{accounts, postsLast7d, playsLast7d}}`. Ampel: `red`, wenn der letzte `health`-Lauf `up=0` meldet oder eine Funnel-Stufe mit Daten mehr als 40 % unter Vorwoche liegt; `yellow` bei mehr als 20 % Rückgang, fehlgeschlagenem Collector-Lauf in den letzten 48 h oder offenen Freigaben älter als 3 Tage; sonst `green`. `reasons` nennt jeden Auslöser in einem deutschen Satz.

### 7.5 Endpunkte und CLI

| CLI | API |
| --- | --- |
| `projects [list] [--status]\|show <id>\|add <id> --name …\|update <id> …` | `GET /projects?status=`, `GET /projects/:id` (mit `channels`, `collectors`, `accounts`), `POST /projects`, `PATCH /projects/:id` (Felder gesetzt, `null` leert; `config` wird gemergt, `null` löscht einen Schlüssel) |
| `channels [list] [--project]\|add <id> --project --kind …\|update <id>` | `GET /channels?project=`, `POST /channels`, `PATCH /channels/:id` |
| `collectors [list] [--project]` | `GET /collectors?project=` (alle Collector-Typen mit `enabled`, `config`, letztem Lauf, `configSchema`) |
| `collectors set <collector> --project <id> [--enable\|--disable] [--config <json>]` | `PUT /collectors/:project/:collector {enabled?, config?}` (Config wird gemergt, `null` löscht Schlüssel) |
| `collectors runs [--project] [--collector] [--limit]` | `GET /collector-runs?project=&collector=&ok=&limit=` (Default 50) |
| `collectors setup app --project <id> [--dry-run]` | `POST /collectors/app/setup {project, dryRun?}`: legt Key Events und Custom Dimensions aus der Config von `app` in der GA4-Property an; ohne `dryRun` und mit Neuanlagen ein `changes`-Eintrag (`config`). Nur `app`, sonst CLI-Fehler `INVALID` |
| `collectors check-stores --project <id>` | `GET /collectors/stores/check?project=` → `{project, ok, google_play?, app_store?}`; geprüft wird, was konfiguriert ist (`play.package`/`gcsBucket`, `asc.appId`). CLI Exit 2, wenn `ok` false |
| `collect [--project] [--collector] [--days 10]` | `POST /collect {project?, collector?, days?}` → `{runs:[{project,collector,ok,summary,stats,error}], errors:[…]}`; nur eingeschaltete Collectors; CLI Exit 2 bei Fehlern |
| `kpi [list] --project [--source] [--metric] [--from] [--to] [--dims]` | `GET /kpi?…&channel=` (`dims` `""` oder `total` = nur Tagessummen) |
| `kpi ingest --file <json\|->` | `POST /kpi/ingest {rows:[{project,source,date,metric,dims?,value,channel?}]}` (Upsert; die CLI nimmt auch eine nackte Liste) |
| `funnel --project [--days] [--end]` | `GET /funnel?…` |
| `overview [--days]` | `GET /overview?…` |
| `search --project [--source] [--days 28] [--end] [--page] [--opportunities] [--limit]` | `GET /search?…` → Query/Seite aggregiert; `opportunities` = Position 4–20 mit Impressionen, absteigend nach Impressionen; `limit` Default 500 |
| `search sitemap-submit --project <id>` | `POST /search/sitemap-submit {project}`: `<projects.url>/sitemap.xml` an die Property aus `gsc.property`; danach `changes`-Eintrag (`seo`) |
| `search bing-submit --project <id> [--url <url…>]` | `POST /search/bing-submit {project, urls?}`: ohne `urls` alle URLs der Sitemap, vorher Kontingent prüfen; danach `changes`-Eintrag (`seo`) |
| `search keywords --project <id> [--seed <seed…>] [--fast]` | `GET /search/keywords?project=&seed=&fast=`: Google-Autocomplete a–z, nur lesend. Ohne `seed` aus `projects.config.seedKeywords`, Sprache aus `projects.language` (Default `de`) |
| `audit run --project` / `audit [show] --project [--diff]` | `POST /audit/run {project}`, `GET /audit?project=&diff=` (`diff`: neue und entfallene Befunde gegen den vorherigen Lauf) |
| `health [--project\|--all]` | `POST /health-check {project?}` (Collector `health` direkt: mit `project` auch, wenn ausgeschaltet, ohne `project` alle Projekte mit eingeschaltetem `health`); CLI Exit 2 bei Befund |
| `approvals [list] [--status pending] [--project] [--account] [--kind] [--category]\|show <id>\|add … [--payload\|--payload-file] [--category]\|decide <id> --approve\|--reject\|--changes [--note] [--text\|--text-file]\|withdraw <id>` | `GET /approvals?project=&status=&kind=&account=&category=&limit=` (ohne `status` alle; die CLI schickt Default `pending`; `all` = alle; Listen kommagetrennt), `GET /approvals/:id`, `POST /approvals` (`reply`/`task`: Payload §7.8), `POST /approvals/:id/decide {decision, note?, text?, noReply?}` (`decision` `approved\|rejected\|changes_requested`; nur `max`, sonst `LOCKED`; `text` nur bei `reply` mit `approved`; `noReply` nur bei `reply` mit `rejected`, CLI `--no-reply`), `POST /approvals/:id/withdraw` (nur der anfragende Akteur oder `max`, sonst `LOCKED`) |
| `content [list] [--project] [--status] [--kind] [--category]\|show <id>\|add … [--planned-date]\|update <id> … [--planned-date <d>]` | `GET /content?project=&status=&kind=&category=`, `GET /content/:id` (bei `live`: Zahlen seit `live_date` aus `search_daily` und `kpi_daily` `ga4:sessions` dims landing), `POST /content`, `PATCH /content/:id` |
| `backlog [list] [--project] [--status] [--kind] [--category]\|add\|update <id> [--category] [--notion-url]` | `GET /backlog?project=&status=&kind=&category=`, `GET /backlog/:id` (ohne CLI-Befehl), `POST /backlog`, `PATCH /backlog/:id` |
| `exp [list] [--category]\|show <id>\|add …\|update <id>\|eval [--project]` | `GET /experiments?project=&status=&category=`, `GET /experiments/:id` (mit Tagesreihe der Metrik und `changes` im Zeitraum), `POST /experiments`, `PATCH /experiments/:id`, `POST /experiments/evaluate {project?}` |
| `changes [list] [--project] [--from] [--to] [--kind] [--category]\|add --project --kind --summary [--ref] [--exp] [--channel] [--date] [--category]` | `GET /changes?project=&from=&to=&kind=&experiment=&category=&limit=`, `POST /changes` |
| `geo questions [--project] [--active\|--inactive\|--all]\|geo question add --project --text\|geo question update <id> [--text] [--active\|--inactive]` | `GET /geo/questions?project=&all=` (ohne `all` nur aktive), `POST /geo/questions`, `PATCH /geo/questions/:id` |
| `geo record --file <json\|->` | `POST /geo/checks {checks:[…]}` (höchstens 1000; Upsert, aktualisiert `mention_targets`) |
| `geo list --project [--date] [--engine]\|geo summary --project` | `GET /geo/checks?project=&date=&engine=&question=&limit=`, `GET /geo/summary?project=` (pro Lauf: Nennungsquote, Ø-Position, zitiert-Quote; Top-Konkurrenten; Quellen-Domains gruppiert) |
| `geo run --project [--engine chatgpt-web] [--limit <n>]` | `POST /geo/run {project, engine?, limit?}` → Antwort wie `/collect`. Läuft `geo-chatgpt` auch, wenn ausgeschaltet; `engine` nur `chatgpt-web`; `limit` = nur die ersten N Fragen. CLI-Timeout 60 min, Exit 2 bei Fehler |
| `mentions [list] [--project] [--status]\|update <id> [--status] [--contact] [--notes]` | `GET /mentions?project=&status=&kind=`, `PATCH /mentions/:id` |
| `store [summary] --project [--days 28]\|store reviews --project [--store] [--limit 20] [--needs-reply]` | `GET /store/summary?project=&days=&end=` (Installs, Bewertung, Kampagnen aus `kpi_daily`), `GET /store/reviews?project=&store=&rating=&needsReply=&limit=` (API-Default 50) |
| `strategies [list] [--project] [--category] [--status]\|show <id>\|add --category --name [--project] [--id] …\|update <id> …` | `GET /strategies?project=&category=&status=`, `GET /strategies/:id`, `POST /strategies`, `PATCH /strategies/:id` (§7.10) |
| `knowledge [list] [--project] [--category] [--type learning\|decision] [--status]\|update <type> <id> --category <c\|none>` | `GET /knowledge?project=&category=&type=&status=`, `PATCH /knowledge/:type/:id {category}` (§7.9) |
| `app inbox --project [--type feature_request\|review] [--needs-reply] [--state <liste>] [--limit]` | `GET /app/inbox?project=&type=&needsReply=&state=&limit=` (§7.8) |
| `app reply --project --target --item <id> --text\|--text-file` | `POST /app/inbox/reply {project, target, itemId, text}` → 201, nur `max` (§7.8) |
| `app no-reply --project --target --item <id>` | `POST /app/inbox/no-reply {project, target, itemId}`, nur `max` (§7.8) |
| `calendar [--project] [--from] [--to] [--category]` | `GET /calendar?project=&from=&to=&category=` (unten) |
| `app publish [--project] [--dry-run]` | `POST /app/publish {project?, dryRun?}` (§7.8); CLI-Timeout 30 min, Exit 2 bei Fehlern |
| `context --project <id> [--date]` | `GET /context?project=&date=` bzw. `GET /context/project?…` (§7.6) |
| `import-growth --db <growth.db> --sites <sites.json> [--workspace-root <dir>]` | `POST /import/growth {db, sites, workspaceRoot?}` (§7.7) |

`[list]`, `[show]`, `[summary]`: Standard-Unterbefehl, darf fehlen (`vibegrowth projects --json` = `projects list`).

`geo questions --inactive` und `--all` holen mit `all=1` alle Fragen; `--inactive` filtert in der CLI auf inaktive.

Externe Aktionen (`sitemap-submit`, `bing-submit`, `collectors setup app`) laufen ohne Transaktion und protokollieren jede externe Änderung danach als einen `changes`-Eintrag über `ChangesService`.

Freigabe-Wirkung: Eine Entscheidung bewirkt sofort etwas, alles in derselben Transaktion mit `history`. `approvals add` mit `refType content` verknüpft das Content-Item mit der Freigabe, falls es noch keine hat. `decide`:

| Fall | `approved` | `rejected` |
| --- | --- | --- |
| `ref_type content` | Item `idea` → `approved`, `approval_id` gesetzt | bei `kind content\|blog_topic`: Item → `discarded` (außer `live`) |
| `ref_type plan_entry` | Planeintrag gesperrt (`locked=true`) | – |
| `kind task` | Aufgabe angelegt (§7.8), `ref_type backlog` | – |
| `kind reply` | wie §7.8; `payload.task` legt zusätzlich eine Aufgabe an | mit `noReply`: Inbox-Item `no_reply` für `payload.lastSeen` |
| `kind strategy` | `payload` → `strategies`-Zeile `active` im Projekt der Freigabe, `source` „Freigabe #<id>“ (§7.10) | – |
| `ref_type backlog` (außer `task`) | Aufgabe bleibt offen, `source` + „Freigabe #<id> bestätigt“, eine Notiz wird als Auftrag an `detail` angehängt | Aufgabe → `dropped` (außer `done`) |

`changes_requested` ändert nur die Freigabe. Die Antwort enthält `effects:[{entity,id,change}]` mit jeder ausgelösten Änderung.

Automatisch: `content add` durch einen anderen Akteur als `max` mit Status `idea` (ohne `sourceKey`) legt eine offene Freigabe `kind content` mit `refType content` an; die Antwort trägt deren `approvalId`.

Kalender: `GET /calendar?project=&from=&to=&category=` (Default `from` heute − 14, `to` `from` + 56) → `{project, from, to, items}`, nach Datum sortiert. Planeinträge mit Datum (`type:"plan_entry"`, `category:"shortform"`, `projectId` über den Account, `accountId`, `accountName`, `title` = Thema, `status`, `formatId`, `locked`, `origin`) und Content (`type:"content"`, nicht `discarded`, Datum = `live_date` bei `live`, sonst `planned_date` oder `live_date`; `dateKind` `planned\|live`, `kind`, `status`, `plannedDate`, `liveDate`, `urlPath`, `approvalId`). Die Shorts-Plan-Routen bleiben unverändert.

Growth-Antworten von `approvals`, `backlog`, `experiments`, `changes`, `content` (Listen, Einzelzeilen, Schreibantworten, `context --project`) tragen `category` immer gefüllt (gespeichert oder abgeleitet). Shorts-Antworten bleiben ohne `category` (§0).

Experiment-Auswertung (`evaluate`): fällig, wenn `start_date + eval_days <= gestern`. Baseline-Fenster `[start - baseline_days, start - 1]`, Nachher-Fenster `[start, start + eval_days - 1]`. Metrik `clicks|impressions|ctr|position` aus `search_daily` (gsc), gefiltert auf `page` = `target` (Pfad-Suffix-Vergleich), sonst `kpi_daily`. `result = {baseline, after, change}`; Urteil `inconclusive` bei weniger als 50 Impressionen in einem Fenster (nur Suchmetriken), sonst `win` bei ≥ +10 % (bei `position`: ≤ −10 %), `loss` umgekehrt, sonst `neutral`. Status → `evaluated`.

### 7.6 `context --project`

Ein Aufruf mit allem für einen Agentenlauf, nur lesend:

```text
{generatedAt, date, project (config als Objekt), light, channels, collectors:[{collector,enabled,lastRun}], funnel,
 kpiSummary (7 Tage vs. Vorwoche je Quelle/Metrik mit dims=''), search:{opportunities (Top 20)}, audit:{lastRun, openErrors},
 approvals:{pending, recentDecisions (14 Tage)}, content:{byStatus, items (nicht discarded)}, backlog:{open (impact desc, effort asc)},
 experiments:{running, recent}, changes (28 Tage), geo:{summary, questions}, mentions (status new|contacted), store,
 rules (brand-Scope), learnings (brand + global + growth, aktiv, mit category), decisions (brand + global + growth, 20, mit category),
 strategies:{web,app,general,shortform} (aktive Strategien je Kategorie, shortform = Formate des Projekts),
 appInbox (counts wie GET /app/inbox), shorts:{accounts:[{id,name,status,activeFormat,horizon:{filledDays,days,firstGap}}]}, warnings:[…]}
```

`warnings` beginnt mit den Ampel-Gründen und nennt fehlende Collectors, fehlende Funnel-Daten, fällige Experimente, offene Audit-Fehler, fehlende GEO-Fragen und unbeantwortete Einträge der App-Inbox. Der Shorts-Kontext `context --account` bleibt unverändert.

Weiche `GET /context`: Der Shorts-Controller ist zuerst registriert. Mit `account` liefert er `context --account` exakt wie bisher. Ohne `account`, aber mit `project`, reicht er die Anfrage an den Growth-Handler weiter. `GET /context/project?project=&date=` erreicht den Growth-Kontext direkt. Die CLI ruft `GET /context?project=` und weicht nur bei `NOT_FOUND` mit `Cannot GET …` (ältere API) auf `/context/project` aus.

### 7.7 `import-growth`

Übernimmt das Website-Growth-System einmalig und idempotent: `sites.json` → `projects`, `channels`, `collectors`, `geo_questions`; `growth.db` → `collector_runs`, `kpi_daily`, `search_daily`, Audit-Tabellen, `geo_checks`, `changes`, `experiments`; mit `workspaceRoot` zusätzlich `<site>/backlog.md` und `<site>/posts/` → `backlog_items`/`content_items` und README → `learnings`. Quellen werden nur gelesen. Jede Zeile trägt einen deterministischen `source_key` (oder ihren natürlichen Schlüssel); bestehende Zeilen werden nie überschrieben, außer Messwerte in `kpi_daily`/`search_daily` (Upsert auf den Primärschlüssel). Ein Lauf ist eine Transaktion mit einem `history`-Eintrag. Antwort: `{source:{db,sites,workspaceRoot,rows}, imported, updated, unchanged, skipped, warnings, mapping}`. Die CLI macht Pfade absolut (`~` aufgelöst), weil die API relativ zu ihrem eigenen cwd auflösen würde.

### 7.8 App-Inbox, Vorschläge und `app publish`

**Inbox.** Der Collector `featurama` liest alle Requests eines Featurama-Projekts über die Featurama-CLI (`tool call listFeatureRequests`, `approval all`, Seiten zu 100 bis `totalCount`), dazu die Threads (`listFeatureRequestComments`) aller Requests mit Kommentaren. Zur Kontrolle liest er die Zählungen `needsReply + approved` und `approval pending` und legt Spiegel- und Featurama-Zahl in `stats` ab. `needs_reply` übernimmt den Wert von Featurama (kein Entwicklerkommentar oder Nutzerkommentar danach). Der Collector `reviews` liest Google Play über die Play Developer API (Text-Bewertungen der letzten 7 Tage) und die Bewertungs-CSVs aus dem Play-Bucket (`csvMonths`). Die CSVs übernehmen spätere Antworten nicht, deshalb bestätigt er jede CSV-Zeile ohne Antwort einzeln per API (höchstens 60 pro Lauf, schon beantwortete und seitdem unveränderte Bewertungen nicht). App Store über `asc reviews list --paginate --include-response`. `needs_reply`: Text-Bewertung ohne Antwort; bei Google auch, wenn die Bewertung nach der Antwort geändert wurde. `StoreService` führt Zeilen zusammen (leere Felder behalten den gespeicherten Wert, die neuere Antwort gewinnt) und berechnet `needs_reply` neu. CSV-Zeilen tragen die echte Review-ID aus `Review Link`; Zeilen mit der alten ID (Zeitpunkt + Gerät) werden beim nächsten Lauf umbenannt.

`GET /app/inbox?project=&type=&needsReply=&state=&limit=` (Default 200) → `{project, counts:{featureRequests:{total, needsReply, pending, byState}, reviews:{total, needsReply, byState, ratingsOnly, google_play, app_store}}, items:[…]}`. Items sortiert: braucht Antwort zuerst, dann nach `state`, dann letzte Aktivität. Jedes Item hat `type` (`feature_request|review`), `target` (`featurama|google_play|app_store`), `itemId`, `projectRef`, `lastSeen` (genau die Werte für eine `reply`-Payload), `state`, `needsReply`, `lastActivity`, `approvals:[{id, kind, status, title, published, publish}]` (verknüpfte `reply`/`task`-Vorschläge) und die Spalten der Quelle (`feature_requests` mit `comments` als Liste, `store_reviews`). Feature-Requests zählen als „braucht Antwort“ nur, wenn sie in Featurama freigegeben sind. Bewertungen ohne Text erscheinen nicht als Item (`ratingsOnly`).

`state` je Item (Filter `state=` kommagetrennt): `no_reply`, solange `no_reply_at` gesetzt ist und `lastSeen` gleich `no_reply_last_seen` (neue Nutzeraktivität öffnet das Item wieder); sonst nach der neuesten offenen `reply`-Freigabe (pending oder freigegeben und nicht veröffentlicht): `proposal` (pending), `approved` (geht beim nächsten `app publish` raus), `error` bzw. `stale` (letzter Versuch; `stale` nur, solange das Ziel noch eine Antwort braucht); sonst `open` (Quelle meldet Antwortbedarf) oder `answered`. `needsReply` ist nur bei `open` `true` (Feature-Requests zusätzlich nur, wenn in Featurama freigegeben).

**Max-Aktionen (nur `max`, sonst `LOCKED`).** `POST /app/inbox/reply {project, target, itemId, text}`: legt eine `reply`-Freigabe mit `requestedBy max`, `status approved` an (Prüfungen wie bei `reply`), lehnt offene Agent-Vorschläge des Items ab und hebt `no_reply` auf; `app publish` nimmt sie mit. `POST /app/inbox/no-reply {project, target, itemId}`: setzt `no_reply_last_seen` = aktueller `lastSeen` und `no_reply_at`, lehnt offene Vorschläge ab → `{project, target, itemId, state:"no_reply", lastSeen, noReplyLastSeen, noReplyAt, effects}`.

**Vorschläge.** `approvals add --kind reply|task` (Kategorie `app`, wenn nicht gesetzt). Prüfung beim Anlegen, unbekannte Payload-Felder → `INVALID`:

- `reply`: `{target, itemId, text, language?, projectRef?, lastSeen?, summary?, task?}`. `summary`: 1–2 Sätze, was passiert ist. `task`: nächster Schritt im Schema von `task` (mit `title`), wird beim Bestätigen eine Aufgabe. Das Item muss im Spiegel stehen (`NOT_FOUND` mit Hinweis auf `collect --collector featurama|reviews`). `projectRef` (Featurama-Projekt, Play-Paket, App-ID) und `lastSeen` (`lastUserCommentAt` bzw. `last_modified`) kommen ohne Angabe aus dem Spiegel; ein abweichendes `projectRef` → `INVALID`. Textlänge: Google Play höchstens 350, App Store 5970, Featurama 10000 Zeichen, sonst `INVALID`. Pro Item eine offene Antwort (pending oder freigegeben und nicht veröffentlicht), sonst `CONFLICT`.
- `task`: `{title?, detail?, kind (bug|feature|ux|store|other, Default other), impact (1–3, Default 2), effort (1–3, Default 2), sources:[{type, id}]}`; `title` fehlt → Titel der Freigabe.

`decide --approve --text …` (nur `max`, nur `reply`): ersetzt `payload.text` und setzt `payload.editedBy`; der Originaltext steht in `history` (`before.payload`). Effekt `{entity:"approval", change:"Antworttext geändert"}`. Freigabe von `task` legt ein Aufgaben-Item an (`backlog_items`, `category app`, `source` „Freigabe <id>, <type> <id> …“, `source_key approval:<id>`), setzt `ref_type backlog`/`ref_id` an der Freigabe und meldet `{entity:"backlog", change:"Aufgabe angelegt"}`. Den Notion-Link trägt der Agent danach mit `backlog update <id> --notion-url …` ein.

**`app publish`.** `POST /app/publish {project?, dryRun?}` bearbeitet freigegebene `reply`-Freigaben ohne `payload.published`, außer `stale`. Pro Freigabe, nacheinander, ohne Wiederholung im selben Lauf:

1. Frisch lesen. Featurama: Thread des Requests. Google: Bewertung per ID. App Store: `asc reviews response for-review`.
2. Gibt es schon eine Entwicklerantwort mit genau diesem Text → `already_published` (zählt als veröffentlicht, kein Posten).
3. `stale`, wenn das Ziel beantwortet ist (Featurama: kein Bedarf mehr; Google: Antwort vorhanden und Bewertung danach nicht geändert; App Store: Antwort vorhanden) oder sich `lastSeen` geändert hat (Featurama: letzter Nutzerkommentar; Google: `lastModified`, sekundengenau). `payload.publish = {state:"stale", at, reason}`; der Agent legt bei Bedarf einen neuen Vorschlag an.
4. Posten: Featurama `addFeatureRequestComment` (Entwicklerkommentar, öffentlich, löst ggf. eine E-Mail an den Einreicher aus), Google `POST …/reviews/{id}:reply` (ersetzt eine bestehende Antwort), App Store `asc reviews respond`. Zurücklesen (Google bis zu 8× im Abstand von 3 s).
5. In einer kurzen Transaktion: `payload.published = {at, ref, verified}`, `changes`-Eintrag (`kind reply`, `category app`, `ref` Request-URL bzw. Review-/Antwort-ID), Spiegelzeile beantwortet (`needs_reply` 0).

Fehler → `payload.publish = {state:"error", at, reason}`, der nächste Lauf versucht es wieder (und erkennt einen doch geposteten Text über Schritt 2). `dryRun` liest nur und schreibt nichts: Ergebnis `would_post|already_published|stale` mit `request` (Weg, Ziel, Textlänge) und `text`. Antwort `{dryRun, results:[{approvalId, project, target, itemId, state, reason?, ref?, verified?}], errors:[{approvalId, error}]}`. Läuft schon ein Publish, `CONFLICT`.

### 7.9 Kategorien

Gespeicherte Kategorie gewinnt; ohne gilt:

| Tabelle | Ableitung |
| --- | --- |
| `learnings`, `decisions` | Scope `account\|format\|brand` → `shortform`, `growth` → `web`, `global` → `general` |
| `experiments` | `target_type` `post` → `shortform`, `store` → `app`, sonst `web` |
| `backlog_items` | `kind` `store\|bug\|feature\|ux` → `app`, sonst `web` |
| `approvals` | `kind` `store_text\|reply\|task` → `app`; `hook\|format`, mit `account_id` oder `ref_type` `plan_entry\|hook\|format` → `shortform`; sonst `web` |
| `changes` | `kind` `shorts` → `shortform`, `store\|reply` → `app`, sonst `web` |
| `content_items` | `kind` `store_text` → `app`, sonst `web` |

Filter `?category=web,app` (kommagetrennt) auf `/approvals`, `/backlog`, `/experiments`, `/changes`, `/content`, `/knowledge`, `/strategies`; unbekannte Werte → `INVALID`. Schreiben: `category` im Body von `POST`/`PATCH` dieser Routen, `null` (CLI `--category none`) löscht und leitet wieder ab.

Learnings und Entscheidungen sind Shorts-Tabellen: `GET /learnings`, `/decisions`, `context --account`, `accounts show` geben `category` nicht aus. `POST /learnings` und `POST /decisions` nehmen `category` an (CLI `learning add|decision add --category`), die Antwort bleibt ohne. Die Growth-Sicht ist `GET /knowledge?project=&category=&type=&status=` → Liste `{type:"learning"|"decision", …Zeile, projectId (Projekt des Scopes, null bei global/growth), category}`, nach Datum absteigend. Mit `project`: Zeilen des Projekts (Brand, seine Accounts und Formate) plus `global` und `growth`. `status` (nur Learnings): Default `active`, `outdated`, `all`. Entscheidungen (`type decision`) sind immer projektbezogen: Scope `brand` oder `growth` mit `scope_id` = Projekt, Scope `account`, wenn `accounts.brand_id` = Projekt; dazu `accountId` (bei `account`, sonst `null`). Globale Entscheidungen bleiben in der DB und in der Shorts-Sicht, `/knowledge` zeigt sie nicht. `decision add --growth` braucht ein Projekt (`--project`, gespeichert als `scope_id`), sonst `INVALID`. `PATCH /knowledge/:type/:id {category}` setzt die Kategorie; Zeilen mit `actor max` ändert nur `max`.

### 7.10 Strategien

`GET /strategies?project=&category=&status=` → gespeicherte Strategien (`kind:"strategy"`, `skills` als Liste; mit `project` die des Projekts und die projektübergreifenden) und die Formate als Shortform-Strategien (`kind:"format"`, `category:"shortform"`, `projectId` = `formats.brand_id`, `summary` = Beschreibung der aktuellen Version, `skills`, `version`, `status:"active"`, `url:"/formats/<id>"`, `accounts:[{id, name, status, source:"account"|"plan", dates?}]`). `accounts` ermittelt die Strategien-Sicht selbst: `source account` = `accounts.default_format_id`, `source plan` = Planeinträge der nächsten 7 Tage mit diesem `format_id` (Liste `dates`). Formate erscheinen nur, wenn der Filter `shortform` (oder keine Kategorie) und `active` (oder keinen Status) zulässt. `GET /strategies/:id` liefert eine Strategie oder, bei einer Format-ID, das Format mit `guide`.

Agents schlagen Strategien als Freigabe vor: `approvals add --kind strategy` mit `payload {id?, category (web|app|general), name, summary, guide, skills?}` (`id` Default Slug aus `name`; fehlende Pflichtfelder oder unbekannte Felder → `INVALID`, vergebene ID → `CONFLICT`). Bestätigen legt die Strategie aktiv an (§7.5 Freigabe-Wirkung).

`POST /strategies {id?, projectId?, category, name, summary?, guide?, status?, skills?, source?}` → 201; `id` Default Slug aus `name`; `category` nur `web|app|general` (`shortform` → `INVALID` mit Hinweis auf `formats add`); vergebene ID oder Format-ID → `CONFLICT`. `PATCH /strategies/:id` mit denselben Feldern (`projectId: null` = für alle Projekte); Strategien mit `actor max` ändert nur `max`; eine Format-ID → `INVALID` mit Hinweis auf `formats update`.

## 8. Web (`apps/web`)

- Keine DB, kein `core`-Import. Server Components lesen über die API (serverseitig `VIBEGROWTH_API_URL`), Schreibvorgänge über Server Actions, die die API mit `X-Actor: max` aufrufen und `revalidatePath("/", "layout")`. Rückgabe der Actions `{ok,data}|{ok:false,error}`.
- `proxy.ts` lehnt fremde Hosts ab. `rewrites`: `/media` und `/api/:path*` → API.
- Stil: shadcn base-nova, Base UI, Geist, Drawer von rechts, Toasts über `toast.add`. Charts: shadcn `chart` (Recharts), Animationen aus.
- Navigation (Sidebar-Gruppen nach Bereich, Projekt-Picker oben, Scope im Cookie `vg_project`): Allgemein (Übersicht `/`, Wartet auf Max `/approvals` mit Badge, Aufgaben `/tasks`, Kalender `/calendar`, Experimente & Log `/experiments`, Strategien `/strategies`, Learnings `/learnings`, Entscheidungen `/decisions`, Verlauf `/history`); Web (Content `/content`, Suche & Audit `/search`, GEO `/geo`); App (Feature Requests `/feature-requests`, Bewertungen `/reviews`, beide mit Badge = `state` offen + Vorschlag, Store `/store`, Funnel `/funnel`); Shortform (Posts, Accounts, Hooks, Inspiration). Alle Badges zählen im Projekt-Scope. Weiterleitungen in `proxy.ts`: `/backlog` → `/tasks`, `/formats` → `/strategies?category=shortform`, `/projects/<id>` setzt den Scope und öffnet `/`. Format-Detailseiten bleiben unter `/formats/<id>`.
- Bereich-Filter: Tabs Alle/Web/Shortform/App/Allgemein (`?category=`, serverseitig an die API) auf Aufgaben, Experimente & Log, Learnings und Entscheidungen (beide über `/knowledge`), Strategien, Wartet auf Max; in Listen ein dezentes Bereich-Label.
- Übersicht: bei „Alle Projekte“ eine Zeile pro Projekt (Ampel, Funnel-Stufen mit Wert und Δ zur Vorwoche, schwächste Stufe markiert, offene Freigaben, laufende Experimente, letzter Collect); bei gewähltem Projekt das Cockpit (Funnel als Stufenleiste mit Conversion, offene Freigaben, Experimente, Aufgaben-Top, App-Inbox-Zähler, aktive Strategien, Learnings und Entscheidungen des Projekts, Collector-Schalter mit Konfiguration im Drawer und „Jetzt abrufen“, Kanäle, Shorts-Accounts).
- Wartet auf Max: einziger Eingang für Entscheidungen. Kompakte Liste der offenen Freigaben (Art, Projekt, Bereich, Titel, eine Zeile Zusammenfassung), Filter Bereich und Art, darunter einklappbar „Zuletzt entschieden“. Ein Klick öffnet einen Sheet von rechts (mobil volle Breite), Deep-Link `/approvals?item=<id>`. Inhalt je Art: `reply` mit Zusammenfassung, Bewertung bzw. Featurama-Thread, editierbarem Antworttext (Google-Zähler x/350) und optionalem nächsten Schritt (`payload.task`), Buttons „Bestätigen“ (schickt `text` nur bei Änderung), „Keine Antwort nötig“ (`rejected` + `noReply`), „Ablehnen“; `strategy` mit Name, Bereich, Zusammenfassung und Leitfaden; Content-Ideen mit Titel, Art, Keyword und Brief; `task` mit Aufgabe und Quellen; übrige Arten mit Vorschlag. Jede Art sagt, was nach dem Bestätigen passiert; Notiz optional. Nach der Entscheidung öffnet der Sheet den nächsten offenen Eintrag und zeigt dort das Ergebnis aus `effects`; nach dem letzten schließt er mit Toast.
- Weitere Seiten: Content-Pipeline (gruppiert nach Status, Detail-Drawer, Zahlen bei live); Aufgaben (gruppiert nach Status, Impact/Aufwand, Bereich, Notion-Link); Experimente & Log (Liste; Detail mit Liniendiagramm der Metrik, Markierungen für `changes`, Baseline- und Nachher-Fenster schattiert; Log-Tabelle aller Änderungen und Diagramm Klicks/Besuche); Strategien (Abschnitte je Bereich, Shortform = Formate mit Accounts; Detail `/strategies/<id>` mit Leitfaden, Bearbeiten, Status); Suche & Audit (Suchanfragen mit Chancen, letzter Audit-Lauf mit neuen/behobenen Befunden); GEO (Nennungsquote und Ø-Position je Lauf, Matrix Fragen × Lauf, Konkurrenten, Quellen-Domains, Erwähnungs-Ziele mit Status); Feature Requests und Bewertungen (Status-Badge nach `state`, Filter „Offen + Vorschlag“ als Standard und „Alle“, Sheet je Item mit Thread bzw. Bewertung, „Vorschlag ansehen“ → `/approvals?item=`, „Eigene Antwort“ → `POST /app/inbox/reply`, „Keine Antwort nötig“ → `POST /app/inbox/no-reply`, Deep-Link `?item=<itemId>`); Content zeigt bei Ideen mit offener Freigabe „wartet auf Max“ mit Link und „geplant am“ (`plannedDate`); Entscheidungen nur projektbezogen, mit Projekt gruppiert nach projektweit und Account, bei „Alle“ nach Projekt; Kalender aus `GET /calendar` (Shortform-Plan bearbeitbar, Web-Content mit Link, Bereich-Tabs); Store (Installs, Bewertung, Kampagnen); Funnel. Seiten, die genau ein Projekt brauchen, zeigen bei „Alle“ eine Zeile pro Projekt mit Scope-Link.
- Shorts-Seiten bleiben inhaltlich wie in VibeShorts; der Kalender liegt unter `/calendar` im Bereich Allgemein.

## 9. Arbeitsregeln

- Ein Checkout auf `main`, keine Branches oder Worktrees. Parallel arbeitende Agents bleiben in ihren Pfaden, committen gezielt (`git add <pfade>`, nie `git commit -a`) und pushen nicht; Byte pusht nach Prüfung.
- Abhängigkeiten nur im Root installieren (ein Lockfile). Parallel arbeitende Agents installieren nichts, sondern melden fehlende Pakete.
- Keine Testdateien im Repo. Prüfskripte in den Scratch-Ordner (`~/.hermes/profiles/byte/cache/scratch/vibegrowth-<thema>/`), geprüft wird mit echten Aufrufen.
- Datenbank: nur auf einer Kopie arbeiten (`sqlite3 <prod-db> ".backup '<kopie>'"`, dann `VIBEGROWTH_DB=<kopie>`). `render`-Proben nur auf einer APFS-Kopie des Datenordners (`cp -c -R`).
- Ports 4310 und 4311 gehören der Produktion (§10). Entwicklung und Proben auf eigenen Ports.
- Vor „fertig“: `npm run typecheck`, `npm run lint`, `npm run build` grün. Fremde, halbfertige Dateien nicht reparieren, sondern melden.
- Secrets nie ausgeben, nie in Dateien, Logs oder Commits.
- Dateien des Website-Growth-Systems (`~/.hermes/artifacts/projects/website-growth/`) nur lesen.

## 10. Start und Betrieb

- `vibegrowth serve [--port 4310] [--api-port 4311] [--dev]` startet `apps/api/dist/main.js` und `next start` (mit `--dev`: `next dev`) aus dem Repo, beide auf `127.0.0.1`, im Vordergrund. Ohne Build bricht `serve` mit einem Hinweis auf `npm run build` ab.
- Auf Max' Rechner startet ein Launcher außerhalb des Repos (`.hermes/scripts/script-vibegrowth-launcher.sh`, verlinkt als `~/.local/bin/vibegrowth` und `~/.local/bin/vibeshorts`) API und Web aus diesem Checkout im Hintergrund: `vibegrowth start|stop|restart|status|open|logs|cli-help`. Jeder andere Befehl startet bei Bedarf die API und geht an die CLI. Logs und PIDs in `.hermes/run/`. Ein neuer Build ist erst nach `vibegrowth restart` live.

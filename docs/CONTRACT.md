# VibeGrowth — Kontrakt v1

Verbindlich für `apps/api`, `apps/web`, `apps/cli`. Abweichungen nur nach Absprache mit Byte (dann dieses Dokument im selben Commit anpassen).

VibeGrowth vereint VibeShorts (Shortform-Studio, Stand Commit `702c6c5`) und das Website-Growth-System (`~/.hermes/artifacts/projects/website-growth/`, Python) in einem lokalen Tool auf dem VibeLabs-Stack: Next.js (Web), NestJS + Drizzle + better-sqlite3 (API), TypeScript-CLI für Agents. Kein Hosting, kein Login, alles auf `127.0.0.1`. Aufbau orientiert an `~/Coding/vibe-crm` (Monorepo `apps/api|web|cli`), ohne Better Auth.

## 0. Harte Randbedingung: Produktion bricht nicht

Echos Crons rufen täglich ab 05:50 `vibeshorts … --json --actor …` auf. Deshalb gilt für jeden Befehl, den die CLI am Commit `702c6c5` kannte (`git show 702c6c5:cli/index.ts`):

- gleicher Befehl, gleiche Optionen (Namen, Kurzformen, Defaults, `choices`, Pflichtoptionen), gleiche Aliase (`post`/`posts`, `learning`/`learnings`, `decision`/`decisions`, `hook`/`hooks`);
- **byte-gleiche JSON-Ausgabe** mit `--json` (Feldnamen, Feldreihenfolge, Typen, `JSON.stringify(value, null, 2)` + `\n`), abgesehen von `generatedAt`;
- gleiche Exit-Codes: `0` ok, `1` Fehler, `2` Teilfehler (`metrics pull` mit `errors.length > 0`), `3` `LOCKED`;
- Fehler mit `--json` auf **stdout** als `{"error":{"code","message"}}`, ohne `--json` auf stderr als `Fehler (<code>): <message>`; gleiche Fehlertexte.

Prüfung: Byte hat vorher Ausgaben gespeichert (`~/.hermes/profiles/byte/cache/scratch/vibegrowth-baseline/before/`, Skript `snap.sh <bin> <outdir>`, Vergleich `cmp.py before <outdir>`). Ziel: `diffs: 0`.

Die Produktionsdatenbank (`/Users/maxmannstein/VibeLabs/shortform-content/.vibeshorts/vibeshorts.db`) fasst **keine Lane** an. Jede Lane arbeitet auf einer eigenen Kopie (siehe §9). Die Umstellung der Produktion macht Byte.

## 1. Begriffe

- **Projekt**: Marke/Produkt (Chrono, Amelie, UBulk, Featurama, OpenFibu …). Physisch die Tabelle `projects` (vorher `brands`). Im Shorts-Modul heißt der Fremdschlüssel weiter `brand_id`/`brandId` und der Geltungsbereich weiter `brand` (Regeln, Learnings, Entscheidungen) — das ist dieselbe Projekt-ID. Grund: JSON-Kompatibilität (§0). Neue CLI-Optionen heißen `--project`; bei Shorts-Befehlen ist `--project` ein Alias für `--brand`.
- **Kanal**: Website, iOS-App, Android-App, YouTube, Instagram … eines Projekts (Tabelle `channels`). TikTok-Kanäle sind die bestehenden `accounts`; sie erscheinen in Kanal-Listen als virtuelle Kanäle `{id: <account-id>, kind: "tiktok", virtual: true}` und werden nicht in `channels` gespeichert.
- **Collector**: Abruf-Modul für eine Quelle (Search Console, GA4 …), pro Projekt einschaltbar, mit eigener Konfiguration (Tabelle `collectors`).
- **KPI**: Tageswert einer Quelle (`kpi_daily`). Basis für Funnel, Übersicht, Experimente.
- **Freigabe** („Wartet auf Max“): Vorschlag eines Agents, den nur der Akteur `max` entscheidet (Tabelle `approvals`).
- **Akteur**: wer schreibt. CLI `--actor` (Default `VIBEGROWTH_ACTOR`/`VIBESHORTS_ACTOR` oder `agent`), Browser immer `max`.

## 2. Repo-Aufbau

```text
apps/api/      NestJS (aktuelle Stable) + drizzle + better-sqlite3. Port 4311 (Prod), bindet nur 127.0.0.1
  drizzle/     SQL-Migrationen + meta/_journal.json (inkl. der drei bestehenden 0000–0002)
  renderer/    Python-Renderer, TikTok-Zahlen-Abruf, OFL-Fonts (vorher renderer/)
  src/
    database/  DatabaseModule, schema.ts (einzige Schemaquelle), Migrator
    common/    Fehlerklasse VGError, Actor-Decorator, Exception-Filter, util (vorher core/util.ts)
    config/    Config-Auflösung (vorher core/config.ts, unverändert übernehmen)
    shorts/    ShortsModule: accounts, characters, formats, rules, image-errors, plan, posts, metrics, knowledge, hooks, inspo, history, context, render, import, media
    growth/    GrowthModule: projects, channels, collectors, kpi, funnel, overview, approvals, content, backlog, experiments, changes, geo, mentions, store, search, audit, context
    collectors/ CollectorsModule: ein Provider pro Collector (TS-Port von growth.py)
apps/web/      Next.js (bestehende Version, App, ohne direkten DB-Zugriff). Port 4310, nur 127.0.0.1
apps/cli/      TypeScript + commander, mit esbuild zu dist/cli.mjs gebündelt (keine Laufzeit-Abhängigkeiten außer Node). bin: vibegrowth, vibeshorts
docs/CONTRACT.md
skills/vibegrowth/SKILL.md
```

Root `package.json`: npm-Workspaces `apps/*`, Skripte `build`, `typecheck`, `lint` über alle Workspaces. Ein Lockfile im Root.

Python bleibt nur für zwei Dinge, die an fremder Infrastruktur hängen: Slide-Renderer (Pillow, Pixel-Gleichheit mit bestehenden Posts) und TikTok-Zahlen (`tiktok_pull.py` aus Echos Profil, `curl_cffi`-Session). Beide ruft die API per `spawnSync(python, …)` mit JSON auf stdin auf. Alle Growth-Collectors sind TypeScript.

## 3. Konfiguration

Unverändert aus `core/config.ts` (Commit `702c6c5`): `~/.config/vibegrowth/config.json` vor `~/.config/vibeshorts/config.json`, Env `VIBEGROWTH_*` vor `VIBESHORTS_*`, DB-Default `<dataDir>/.vibegrowth/vibegrowth.db`, existierende `<dataDir>/.vibeshorts/vibeshorts.db` wird weiter genutzt. Felder: `dataDir`, `dbPath`, `python`, `tiktokPullScript`, `secretsDir`.

Zusätzlich:

| Env | Default | Zweck |
| --- | --- | --- |
| `VIBEGROWTH_API_PORT` | `4311` | API-Port |
| `VIBEGROWTH_API_URL` | `http://127.0.0.1:4311` | CLI und Web → API |
| `VIBEGROWTH_SECRETS_DIR` / `secretsDir` | — | Ordner mit Collector-Zugängen (bei Max: `~/.hermes/profiles/byte/secrets`). Dateien werden nur gelesen, nie kopiert, nie ausgegeben, nie geloggt |
| `VIBEGROWTH_CDP_URL` | `http://127.0.0.1:9224` | Automations-Chrome für den ChatGPT-GEO-Check |

## 4. Transport (API)

- Basis `http://127.0.0.1:4311/api`. JSON rein, JSON raus. `GET /api/health` → `{ok:true, dbPath, dataDir, version}`.
- Akteur per Header `X-Actor` (Pflicht für Schreibzugriffe, sonst `agent`).
- Jeder Schreibvorgang: eine Service-Methode, `BEGIN IMMEDIATE` (`tx`), `history`-Eintrag mit Akteur, Entität, ID, Aktion, Vorher/Nachher der geänderten Felder. Keine Schreibzugriffe an Services vorbei. Gilt auch für Collector-Ergebnisse (Akteur = aufrufender Akteur, z. B. `cron:growth`; Massendaten wie `kpi_daily` schreiben einen `history`-Eintrag pro Lauf, nicht pro Zeile).
- Einträge mit `locked` oder `origin = max` ändert nur `max`. Freigaben entscheidet nur `max`.
- Fehler: Body `{"error":{"code","message"}}`. Status: `INVALID` 400, `NOT_FOUND` 404, `CONFLICT` 409, `LOCKED` 423, `EXTERNAL` 502, `CONFIG` 500, sonst `ERROR` 500. Validierungsfehler von Nest (`ValidationPipe`) werden ebenfalls auf `{"error":{"code":"INVALID","message"}}` gemappt.
- Response-Bodies im Shorts-Teil sind **exakt** die Rückgabewerte der Funktionen aus `core/*.ts` am Commit `702c6c5` bzw. das, was `cli/index.ts` dort zusammensetzt (z. B. `accounts show`, `formats show`, `post show`). Logik portieren, nicht neu erfinden.
- `GET /api/media?path=<rel>` liefert Dateien aus dem Datenordner (Pfad-Guard, Endungs-Allowlist, Range für MP4), wie `app/media/route.ts` heute.
- Browser-seitig leitet Next per `rewrites` `/api/*` und `/media` an die API weiter.

## 5. Shorts-Endpunkte (1:1 zu den bisherigen CLI-Befehlen)

Query-Parameter für Filter, JSON-Body für Schreibvorgänge mit den camelCase-Feldern der jeweiligen `core`-Input-Typen. Die CLI übersetzt ihre Optionen so wie bisher `cli/index.ts` (`nullable`, `list`, `int`, `accountPatch`, `entryPatch`, `formatFields` …) und schickt das Ergebnis.

| CLI | Methode + Pfad | core-Referenz |
| --- | --- | --- |
| `context --account <id> [--date]` | `GET /context?account=&date=` | `buildContext` |
| `import [--accounts-json]` | `POST /import {accountsJson?}` | Logik aus `cli/index.ts` (settings-Key `import.accounts_json`) + `importContent` |
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
| `render --post …` | `POST /render {post, video, finalize?}` | `renderPost` |
| `open <kind> <id>` | `POST /open {kind, id}` | `openPath`/`folderFor` |

Neu bei Shorts-Befehlen: `--project <id>` als Alias für `--brand` (wo `--brand` existiert), sonst keine Änderung.

CLI-lokal bleiben: `init` (schreibt Config, ruft danach `GET /health`), `serve` (startet API und Web, siehe §10).

## 6. Schema

`apps/api/src/database/schema.ts` ist die einzige Schemaquelle. Bestehende Tabellen und Spalten (Commit `702c6c5`, `core/schema.ts`) bleiben unverändert, außer:

- `brands` → **`projects`** (`ALTER TABLE brands RENAME TO projects`; SQLite zieht die FKs in `accounts`, `characters`, `formats`, `inspirations` mit). Neue Spalten: `url` TEXT, `kind` TEXT NOT NULL DEFAULT `'app'` (`app|website|tool|other`), `status` TEXT NOT NULL DEFAULT `'active'` (`active|paused|archived`), `language` TEXT, `repo` TEXT, `workspace` TEXT, `config` TEXT NOT NULL DEFAULT `'{}'` (JSON: optional `funnel`, siehe §7.3).

Migrationen: Ledger bleibt die bestehende Tabelle `_migrations(tag, applied_at)`; der Migrator aus `core/db.ts` wird unverändert übernommen (Journal lesen, fehlende Tags in einer `IMMEDIATE`-Transaktion anwenden). Neue Migrationen anhängen (`0003_…`), nie bestehende ändern.

Alle neuen Tabellen: `created_at`/`updated_at` TEXT ISO wie im Bestand, JSON-Spalten als TEXT mit Default `'[]'`/`'{}'`, `source_key` TEXT UNIQUE wo importiert wird.

| Tabelle | Spalten (Kurzform) |
| --- | --- |
| `channels` | `id` TEXT PK (z. B. `chrono-web`), `project_id` → projects, `kind` (`website\|ios\|android\|youtube\|instagram\|other`), `name`, `url`, `handle`, `external_id`, `status` (`active\|paused\|planned`, Default `active`), `notes` |
| `collectors` | PK (`project_id`, `collector`), `enabled` INT bool Default 0, `config` JSON `'{}'`, `updated_at` |
| `collector_runs` | `id` PK, `project_id`, `collector`, `started_at`, `finished_at`, `ok` INT bool, `summary`, `error`, `stats` JSON, `actor` |
| `kpi_daily` | PK (`project_id`, `source`, `date`, `metric`, `dims`), `dims` TEXT NOT NULL DEFAULT `''` (sonst stabiles JSON mit sortierten Schlüsseln), `value` REAL, `channel_id` NULL, `updated_at` |
| `search_daily` | PK (`project_id`, `source` (`gsc\|bing`), `date`, `query`, `page`), `clicks`, `impressions`, `ctr`, `position` (REAL). `page` = `''` wenn die Quelle keine Seite liefert |
| `audit_runs` | `id` PK, `project_id`, `at`, `pages` INT, `ok` INT bool |
| `audit_issues` | `id` PK, `run_id` → audit_runs, `project_id`, `url`, `code`, `severity` (`error\|warning\|info`), `detail` |
| `audit_pages` | `id` PK, `run_id`, `project_id`, `url`, `data` JSON |
| `experiments` | `id` PK, `project_id`, `channel_id` NULL, `title`, `hypothesis`, `target_type` (`page\|post\|store\|other`), `target`, `metric` (`clicks\|impressions\|ctr\|position\|<source>:<metric>`), `start_date`, `baseline_days` Default 28, `eval_days` Default 28, `status` (`running\|evaluated\|stopped`), `result` JSON NULL, `verdict` NULL (`win\|loss\|neutral\|inconclusive`), `actor`, `source_key` |
| `changes` | `id` PK, `project_id`, `channel_id` NULL, `date`, `kind` (`deploy\|content\|seo\|store\|config\|shorts\|other`), `summary`, `ref`, `experiment_id` NULL, `actor`, `source_key` |
| `approvals` | `id` PK, `project_id`, `account_id` NULL, `kind` (`hook\|format\|blog_topic\|draft\|store_text\|strategy\|other`), `title`, `body` (Markdown), `payload` JSON, `ref_type` NULL (`plan_entry\|content\|format\|hook\|experiment\|backlog`), `ref_id` NULL, `status` (`pending\|approved\|rejected\|changes_requested\|withdrawn`), `requested_by`, `decided_by`, `decided_at`, `decision_note` |
| `content_items` | `id` PK, `project_id`, `channel_id` NULL, `kind` (`blog\|landing\|store_text\|other`), `title`, `keyword`, `intent`, `brief`, `status` (`idea\|approved\|draft\|review\|live\|discarded`), `draft_path` (absolut, außerhalb des Datenordners erlaubt, nur Verweis), `url_path` (z. B. `/blog/ueberstunden`), `live_date`, `approval_id` NULL, `notes`, `position`, `actor`, `source_key` |
| `backlog_items` | `id` PK, `project_id`, `title`, `detail`, `kind` (`seo\|tech\|content\|store\|growth\|other`), `impact` INT 1–3, `effort` INT 1–3, `status` (`open\|doing\|done\|dropped`), `source`, `done_ref`, `position`, `actor`, `source_key` |
| `geo_questions` | `id` PK, `project_id`, `text`, `active` INT bool Default 1, `source_key`; UNIQUE(`project_id`, `text`) |
| `geo_checks` | `id` PK, `project_id`, `question_id` → geo_questions, `date`, `engine`, `status` (`ok\|error`), `mentioned` INT bool, `position` INT NULL, `cited` INT bool, `in_sources` INT bool, `brands` JSON, `competitors` JSON, `links` JSON, `cited_urls` JSON, `sources` JSON, `answer`, `model`, `evidence` (Pfad), `meta` JSON, `error`, `source_key`; UNIQUE(`project_id`, `question_id`, `date`, `engine`) |
| `mention_targets` | `id` PK, `project_id`, `domain`, `url`, `kind` (`app_store\|comparison\|guide\|forum\|press\|vendor\|other`), `seen_count`, `cited_count`, `first_seen`, `last_seen`, `status` (`new\|contacted\|listed\|rejected\|ignored`), `contact`, `notes`; UNIQUE(`project_id`, `domain`) |
| `store_reviews` | `id` PK, `project_id`, `store` (`app_store\|google_play`), `review_id`, `date`, `rating` INT, `title`, `body`, `language`, `version`, `reply`; UNIQUE(`project_id`, `store`, `review_id`) |

Enums sind Whitelists im Service (`INVALID` sonst), keine CHECK-Constraints, keine Trigger.

## 7. Growth-Modul

### 7.1 KPI-Konventionen (Collector → `kpi_daily`)

Jeder Collector schreibt Tagessummen mit `dims = ''` und darf zusätzlich Aufschlüsselungen mit `dims`-JSON schreiben. Pflicht-Metriken (Quelle → Metrik):

| Quelle | Metriken mit `dims=''` | Aufschlüsselungen |
| --- | --- | --- |
| `gsc` | `clicks`, `impressions`, `ctr`, `position` | Query×Seite in `search_daily` |
| `bing` | `clicks`, `impressions` | Queries in `search_daily` |
| `ga4` | `sessions`, `users`, `engaged`, `key_events`, `event:<name>` (z. B. `event:download_click`) | `{"channel","landing"}` für `sessions`; `{"param","value"}` für Event-Parameter (`event:download_click`) |
| `psi` | — | `{"strategy","url"}` → `performance`, `seo`, `accessibility`, `best_practices`, `lcp_ms`, `cls`, `tbt_ms` |
| `app` | `active_users`, `new_users`, `event:<name>` (z. B. `event:first_entry_created`), `retention_d1`, `retention_d7`, `retention_d28` (Anteil 0–1, auf das Kohortenstart-Datum) , `active_d7`, `active_d28` | `{"platform"}` |
| `play` | `installs`, `store_visits`, `uninstalls`, `rating` | `{"source","utm_campaign","country"}` |
| `asc` | `installs`, `impressions`, `product_page_views`, `rating` | `{"campaign","source"}` |
| `health` | `up` (0/1), `tls_days`, `latency_ms` | — |

### 7.2 Collectors

IDs: `health`, `audit`, `gsc`, `ga4`, `bing`, `psi`, `app`, `play`, `asc`, `geo-chatgpt`. Jeder Collector ist ein Nest-Provider mit `id`, `label`, `channelKinds` (für welche Kanäle er sinnvoll ist), `configSchema` (Felder mit Beschreibung) und `run(project, config, {days, actor}) → {ok, summary, stats, errors}`. Er schreibt nur über Growth-Services (`kpi`, `search`, `audit`, `geo`, `store`). Konfiguration pro Projekt in `collectors.config`, z. B. `gsc: {property: "sc-domain:chrono-app.net"}`, `ga4: {property: "properties/558994740", eventParams: {download_click: ["placement"]}}`, `psi: {urls: [...]}`, `audit: {url, keyPaths, ignore}`, `health: {url, path: "/api/health"}`, `play: {package, gcsBucket}`, `asc: {appId, providerId, profile}`, `app: {ga4Property, firebaseProject, funnelEvents, keyEvents}`, `geo-chatgpt: {brandPatterns, brandPatternsAmbiguous, brandContext}` (Fragen in `geo_questions`).

Zugänge liegen in `secretsDir` (Dateinamen wie im Growth-System: `google-growth-oauth-client.json`, `google-growth-oauth-token.json`, `google-growth-api-key`, `bing-webmaster-api-key`; Play-Service-Account über `~/.playconsole-cli/config.json` → `credentials_path` oder `GROWTH_PLAY_SA_JSON`). Fehlt ein Zugang, endet der Lauf mit `ok:false` und einer klaren Meldung, ohne Secret-Inhalte. OAuth-Refresh schreibt den Token zurück in dieselbe Datei (wie `google_auth.py`), sonst nichts.

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

`GET /funnel?project=&days=7&end=YYYY-MM-DD` (Default `end` = gestern) → `{project, window:{from,to}, prevWindow:{from,to}, stages:[{key,label,value,prev,delta (relativ, null bei prev=0), conversion (value/vorherige Stufe, null bei erster Stufe oder 0), prevConversion, hasData}], weakest: <key der Stufe mit der niedrigsten conversion unter Stufen mit Daten>}`. Stufen ohne jede Quelle mit Daten: `value:null, hasData:false`.

### 7.4 Übersicht

`GET /overview?days=7` → eine Zeile pro Projekt mit `status != archived`: `{project:{id,name,url,kind}, funnel:{stages (wie oben, nur key/value/prev/delta)}, weakest, light ("green"|"yellow"|"red"), reasons:[…], pendingApprovals, runningExperiments, lastCollect, collectorErrors:[{collector, error, at}], shorts:{accounts, postsLast7d, playsLast7d}}`. Ampel: `red` wenn der letzte `health`-Lauf `up=0` meldet oder eine Funnel-Stufe mit Daten > 40 % unter Vorwoche liegt; `yellow` bei > 20 % Rückgang, fehlgeschlagenem Collector-Lauf in den letzten 48 h oder offenen Freigaben älter als 3 Tage; sonst `green`. `reasons` nennt jeden Auslöser in einem deutschen Satz.

### 7.5 Endpunkte und CLI

| CLI | API |
| --- | --- |
| `projects list\|show <id>\|add <id> --name …\|update <id> …` | `GET /projects`, `GET /projects/:id` (mit `channels`, `collectors`, `accounts`), `POST /projects`, `PATCH /projects/:id` |
| `channels list [--project]\|add <id> --project --kind …\|update <id>` | `GET /channels?project=`, `POST /channels`, `PATCH /channels/:id` |
| `collectors list [--project]` | `GET /collectors?project=` (alle Collector-Typen mit `enabled`, `config`, letztem Lauf, `configSchema`) |
| `collectors set <collector> --project <id> [--enable\|--disable] [--config <json>]` | `PUT /collectors/:project/:collector {enabled?, config?}` (Config wird gemergt, `null` löscht Schlüssel) |
| `collect [--project] [--collector] [--days 10]` | `POST /collect {project?, collector?, days?}` → `{runs:[{project,collector,ok,summary,stats,error}], errors:[…]}`; nur eingeschaltete Collectors; CLI Exit 2 bei Fehlern |
| `collectors runs [--project] [--collector] [--limit]` | `GET /collector-runs?…` |
| `kpi list --project [--source] [--metric] [--from] [--to] [--dims]` | `GET /kpi?…` |
| `kpi ingest --file <json\|->` | `POST /kpi/ingest {rows:[{project,source,date,metric,dims?,value,channel?}]}` (Upsert) |
| `funnel --project [--days] [--end]` | `GET /funnel?…` |
| `overview [--days]` | `GET /overview?…` |
| `search --project [--source] [--days 28] [--page] [--opportunities]` | `GET /search?…` → Query/Seite aggregiert; `opportunities` = Position 4–20 mit Impressionen, absteigend nach Impressionen |
| `audit run --project` / `audit show --project [--diff]` | `POST /audit/run {project}`, `GET /audit?project=&diff=` (`diff`: neue/entfallene Befunde gegen den vorherigen Lauf) |
| `health [--project\|--all]` | `POST /health-check {project?}` (Collector `health` direkt) |
| `approvals list [--status pending] [--project]\|show <id>\|add …\|decide <id> --approve\|--reject\|--changes [--note]\|withdraw <id>` | `GET /approvals?…`, `GET /approvals/:id`, `POST /approvals`, `POST /approvals/:id/decide {decision, note?}` (nur `max`, sonst `LOCKED`), `POST /approvals/:id/withdraw` (nur der anfragende Akteur oder `max`) |
| `content list [--project] [--status]\|show <id>\|add …\|update <id> …` | `GET /content?…`, `GET /content/:id` (bei `live`: Zahlen seit `live_date` aus `search_daily` und `kpi_daily` `ga4:sessions` dims landing), `POST /content`, `PATCH /content/:id` |
| `backlog list\|add\|update` | `GET /backlog?project=&status=`, `POST /backlog`, `PATCH /backlog/:id` |
| `exp list\|show <id>\|add …\|update <id>\|eval [--project]` | `GET /experiments?…`, `GET /experiments/:id` (mit Tagesreihe der Metrik und `changes` im Zeitraum), `POST /experiments`, `PATCH /experiments/:id`, `POST /experiments/evaluate {project?}` |
| `changes list [--project] [--from] [--to]\|add --project --kind --summary [--ref] [--exp]` | `GET /changes?…`, `POST /changes` |
| `geo questions [--project]\|geo question add --project --text\|geo question update <id> [--active/--inactive]` | `GET /geo/questions`, `POST /geo/questions`, `PATCH /geo/questions/:id` |
| `geo record --file <json\|->` | `POST /geo/checks {checks:[…]}` (Upsert, aktualisiert `mention_targets`) |
| `geo list --project [--date] [--engine]\|geo summary --project` | `GET /geo/checks?…`, `GET /geo/summary?project=` (pro Lauf: Nennungsquote, Ø-Position, zitiert-Quote; Top-Konkurrenten; Quellen-Domains gruppiert) |
| `geo run --project [--engine chatgpt-web]` | `POST /geo/run {project, engine}` (Collector `geo-chatgpt`) |
| `mentions list [--project] [--status]\|update <id> --status … [--contact] [--notes]` | `GET /mentions?…`, `PATCH /mentions/:id` |
| `store summary --project\|store reviews --project [--limit]` | `GET /store/summary?project=` (Installs, Bewertung, Kampagnen aus `kpi_daily`), `GET /store/reviews?…` |
| `context --project <id> [--date]` | `GET /context?project=&date=` |

`learning add`, `decision add`, `rules add|list`: zusätzlich `--project <id>` (= Geltungsbereich `brand`).

Freigabe-Wirkung: `decide` mit `approved` auf `ref_type=content` setzt das Content-Item von `idea` auf `approved` bzw. von `review` auf `live`-bereit (Status `approved` bleibt Sache des Agents, der live schaltet; nur `idea → approved` automatisch). Auf `ref_type=plan_entry` setzt sie `locked=true` mit Akteur `max`. Sonst nur Status. Jede Entscheidung schreibt `history`.

Experiment-Auswertung (`evaluate`): fällig, wenn `start_date + eval_days <= gestern`. Baseline-Fenster `[start - baseline_days, start - 1]`, Nachher-Fenster `[start, start + eval_days - 1]`. Metrik `clicks|impressions|ctr|position` aus `search_daily` (gsc) gefiltert auf `page` = `target` (Pfad-Suffix-Vergleich), sonst `kpi_daily`. `result = {baseline, after, change}`; Urteil `inconclusive` bei < 50 Impressionen in einem Fenster (nur Suchmetriken), sonst `win` bei ≥ +10 % (bei `position`: ≤ −10 %), `loss` umgekehrt, sonst `neutral`. Status → `evaluated`.

### 7.6 `context --project`

Ein Aufruf mit allem für einen Agentenlauf, read-only:

```text
{generatedAt, date, project, channels, collectors:[{collector,enabled,lastRun}], funnel, kpiSummary (7 Tage vs. Vorwoche je Quelle/Metrik mit dims=''),
 search:{opportunities (Top 20)}, audit:{lastRun, openErrors}, approvals:{pending, recentDecisions (14 Tage)},
 content:{byStatus, items (nicht discarded)}, backlog:{open (sortiert impact desc, effort asc)}, experiments:{running, recent},
 changes (28 Tage), geo:{summary, questions}, mentions (status new|contacted), store:{summary, recentReviews},
 rules (brand-Scope), learnings (brand + global, aktiv), decisions (brand + global, 20),
 shorts:{accounts:[{id,name,status,activeFormat,horizon:{filledDays,days,firstGap}}]}, warnings:[…]}
```

`context --account` bleibt exakt wie bisher.

## 8. Web (`apps/web`)

- Keine DB, kein `core`-Import. Server Components lesen per `apiFetch` (Server-seitig `VIBEGROWTH_API_URL`), Schreibvorgänge über Server Actions, die die API mit `X-Actor: max` aufrufen und `revalidatePath("/", "layout")`. Rückgabe der Actions wie heute `{ok,data}|{ok:false,error}`.
- `proxy.ts` lehnt fremde Hosts ab (wie heute). `rewrites`: `/media` und `/api/:path*` → API.
- Stil: bestehende App (shadcn base-nova, Base UI, Geist, Drawer von rechts, Toasts über `toast.add`). Charts: shadcn `chart` (Recharts), Animationen aus.
- Navigation (Sidebar-Gruppen): **Growth** — Übersicht `/`, Wartet auf Max `/approvals` (Badge mit Anzahl), Content `/content`, Experimente & Log `/experiments`, Backlog `/backlog`, GEO `/geo`, Store `/store`; **Projekte** — je Projekt `/projects/[id]`; **Shortform** — Kalender `/calendar`, Posts, Accounts, Formate, Hooks, Inspiration; **Wissen** — Learnings, Entscheidungen, Verlauf.
- Seiten Growth: Übersicht (eine Zeile pro Projekt: Ampel, Funnel-Stufen mit Wert und Δ zur Vorwoche, schwächste Stufe markiert, offene Freigaben, laufende Experimente, letzter Collect); Projekt-Cockpit (Funnel als Stufenleiste mit Conversion und Markierung, Kanäle, Collector-Schalter mit Konfiguration im Drawer und Button „Jetzt abrufen“, offene Freigaben, Experimente, Backlog-Top, Learnings/Entscheidungen des Projekts, Shorts-Accounts); Wartet auf Max (Karten mit Markdown-Body, Ein-Klick „Freigeben“/„Ablehnen“/„Änderung“ + optionale Notiz, gruppiert nach Projekt, Filter); Content-Pipeline (gruppierte Liste nach Status wie VibeCRM, Detail-Drawer, Zahlen bei live); Experimente & Log (Liste; Detail mit Liniendiagramm der Metrik, vertikale Markierungen für `changes`, Baseline-/Nachher-Fenster schattiert; Log-Tabelle aller Änderungen mit Projektfilter und Diagramm Klicks/Besuche mit Markierungen); Backlog (gruppiert nach Status, Impact/Effort); GEO (pro Projekt: Nennungsquote und Ø-Position je Lauf, Fragen × Lauf-Matrix genannt ja/nein/Position, Konkurrenten, Quellen-Domains, Erwähnungs-Ziele mit Status); Store (Installs/Bewertung, Kampagnen, Bewertungen).
- Bestehende Shorts-Seiten bleiben inhaltlich gleich; der Kalender zieht von `/` nach `/calendar`.

## 9. Lanes, Arbeitsweise

- Gemeinsamer Checkout auf `main`, keine Branches/Worktrees. Nur im eigenen Bereich arbeiten (Lane-Beschreibung). Commits scopen (`git add <eigene Pfade>`), nie `git commit -a`, **nicht pushen** (Byte pusht nach Prüfung).
- Kein `npm install` in Lanes; fehlende Abhängigkeit an Byte melden. Ausnahme: die Skeleton-Lane.
- Keine Testdateien im Repo (Max' Vorgabe). Prüfungen als Skripte im Scratch (`~/.hermes/profiles/byte/cache/scratch/vibegrowth-<lane>/`) und mit echten Aufrufen.
- Datenbank: eigene Kopie pro Lane, z. B. `sqlite3 ~/.hermes/profiles/byte/cache/scratch/vibegrowth-dev/vibegrowth.db ".backup '<scratch>/<lane>.db'"`, und `VIBEGROWTH_DB=<scratch>/<lane>.db`. Nie die Produktions-DB. `render`-Proben nur auf einer APFS-Kopie des Datenordners (`cp -c -R`).
- Eigene Ports pro Lane (in der Lane-Beschreibung). Port 4310 (Produktion, eingefrorene Kopie) nicht anfassen.
- Vor „fertig“: `npm run typecheck`, `npm run lint`, `npm run build` im eigenen Workspace grün. Fremde, halbfertige Dateien anderer Lanes nicht reparieren, sondern melden.
- Secrets: nie ausgeben, nie in Dateien, Logs oder Commits.
- Website-Growth-Dateien (`~/.hermes/artifacts/projects/website-growth/`) nur lesen. Dort laufen parallele Sessions.

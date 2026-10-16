# VibeGrowth

VibeGrowth (formerly VibeShorts) is a local growth studio for several products at once. It has two modules on one SQLite database:

- **Shortform**: content studio for short-form video and photo-mode slideshows. Accounts, AI characters, formats with versions, rules, known image errors, a multi-week calendar, posts with their folders and TikTok numbers, learnings, decisions, hooks and saved inspiration.
- **Growth**: websites and apps per project. Data collectors, a funnel from search impression to retained user, approvals, a content pipeline, experiments with a change log, a backlog, AI-answer visibility (GEO) and app store numbers.

A Next.js web app on `127.0.0.1` shows everything. A CLI with `--json` on every command lets AI agents plan, produce and report through the same data. There is no login and no hosting: API and web bind to loopback only.

## What it does

**Growth module**

- **Projects with channels.** A project is a product or brand (website, app, tool). Channels are its website, iOS and Android apps, YouTube, Instagram. TikTok accounts from the shortform module show up as virtual channels.
- **Collectors.** One switch and one JSON config per project and source: `health`, `audit`, `gsc` (Search Console), `ga4`, `bing`, `psi` (PageSpeed), `app` (Firebase/GA4 app events and retention), `play` (Google Play reports), `asc` (App Store Connect analytics), `geo-chatgpt`. `collect` runs every enabled one and stores daily values.
- **Funnel.** Impressions, clicks, visits, download clicks, installs, first entry, active D7 and D28, each against the previous window, with conversion per step and the weakest step marked. Stages can be overridden per project.
- **Waiting for Max.** Agents file proposals (blog topic, draft, store text, strategy, hook, format) as approvals. Only the actor `max` can approve, reject or ask for changes. Approving a content idea moves it to `approved`; approving a plan entry locks it.
- **Content pipeline.** Blog posts, landing pages and store texts from idea to live, with search and visit numbers since the live date.
- **Experiments and change log.** Every deploy, content, SEO or store change goes into the log. An experiment compares a baseline window with the window after the change and gets a verdict (`win`, `loss`, `neutral`, `inconclusive`).
- **Aufgaben (backlog).** Growth tasks with impact, effort and area (Web, Shortform, App, Allgemein).
- **GEO.** Questions per project are asked in ChatGPT through an automation Chrome. VibeGrowth records whether the product is named, at which position, whether it is cited, and which competitors and sources appear.
- **Mention targets.** Domains that AI answers cite (comparisons, guides, forums, press), with an outreach status.
- **Store.** Installs, ratings, campaigns and reviews from Google Play and the App Store.
- **Overview.** One row per project with a traffic light, funnel deltas, open approvals, running experiments and the last collect.

**Shortform module**

- **Calendar first.** Week, three-week and month views across all accounts. Entries created or locked by the human are never overwritten by an agent.
- **Agents plan ahead.** `plan fill` writes only free days. `context --account <id> --json` returns everything a morning run needs in one call.
- **Formats are data.** Format versions carry a Markdown guide, tool skills, example posts, renderer parameters and rules. A pivot is a new version with a reason.
- **Posts stay where they are.** Media files are never moved or renamed; the database stores paths relative to the content folder.
- **Numbers.** `metrics pull` fetches public TikTok stats per account and matches each TikTok post to a local post folder via a perceptual hash of slide 1.
- **Rendering.** `render` turns a post's `render-manifest.json` into JPG slides, a preview MP4 and a contact sheet.

Every change in both modules lands in the history with actor, before and after.

Not included on purpose: uploading or posting, scheduling, login, cloud hosting, a slide editor, image generation.

## Layout

| Path | Purpose |
|---|---|
| `apps/api` | NestJS API on `127.0.0.1:4311`, prefix `/api`. The only process that opens SQLite. Domain logic in `src/core`, modules in `src/shorts`, `src/growth/{data,work,import}`, `src/collectors` |
| `apps/api/drizzle` | SQL migrations, applied when the API starts |
| `apps/api/renderer` | Python slide renderer and TikTok number pull, bundled OFL fonts |
| `apps/web` | Next.js web app on `127.0.0.1:4310`. Reads and writes only through the API |
| `apps/cli` | Commander CLI bundled to `dist/cli.mjs`. HTTP client of the API. Binaries `vibegrowth` and `vibeshorts` |
| `docs/CONTRACT.md` | Binding contract: endpoints, schema, CLI compatibility |
| `docs/api-shorts.md` | Shortform endpoints in detail |
| `skills/vibegrowth` | Agent skill for the CLI |

Python is used only for the slide renderer (Pillow) and the TikTok number pull. All growth collectors are TypeScript.

## Requirements

- Node.js 22 or newer
- Python 3 with Pillow for `render` (and `ffmpeg` for preview videos)
- For `metrics pull`: a `tiktok_pull.py` module that provides a `curl_cffi` session and a cookie jar (`load_jar`, `cr`, `TARGET`, `UA_LANG`). Cookies never live in this repo.
- For growth collectors: the credentials listed under [Collector credentials](#collector-credentials)

## Setup

```bash
git clone https://github.com/vibelabsdotto/vibegrowth.git
cd vibegrowth
npm install
npm run build
npm link -w apps/cli   # optional: puts `vibegrowth` and `vibeshorts` on your PATH

vibegrowth init --data-dir ~/path/to/content
vibegrowth serve       # web http://127.0.0.1:4310, API http://127.0.0.1:4311
```

`init` writes `~/.config/vibegrowth/config.json` (`dataDir`, and optionally `dbPath`, `python`, `tiktokPullScript` via `--db`, `--python`, `--tiktok-pull`). The API creates and migrates the database when it starts. If an API was already running, restart it after `init`.

`serve` runs API and web in the foreground and stops both on Ctrl+C. Options: `--port`, `--api-port`, `--dev`.

### Configuration

| Setting | Config key | Env | Default |
|---|---|---|---|
| Content folder | `dataDir` | `VIBEGROWTH_DATA_DIR` | none, required |
| Database | `dbPath` | `VIBEGROWTH_DB` | `<dataDir>/.vibegrowth/vibegrowth.db`; an existing `<dataDir>/.vibeshorts/vibeshorts.db` keeps being used |
| Python | `python` | `VIBEGROWTH_PYTHON` | `/opt/homebrew/bin/python3`, else `python3` |
| TikTok pull module | `tiktokPullScript` | `VIBEGROWTH_TIKTOK_PULL` | none |
| Collector credentials folder | `secretsDir` | `VIBEGROWTH_SECRETS_DIR` | none; set it by hand, `init` does not write it |
| API port | | `VIBEGROWTH_API_PORT` | `4311` |
| API URL for CLI and web | | `VIBEGROWTH_API_URL` | `http://127.0.0.1:4311` |
| Default actor of the CLI | | `VIBEGROWTH_ACTOR` | `agent` |

The old names still work as a fallback: `~/.config/vibeshorts/config.json` and every `VIBESHORTS_*` variable for the settings above. The new file wins key by key, the new variable wins over the old one.

Collector-specific variables: `VIBEGROWTH_CDP_URL` (automation Chrome, default `http://127.0.0.1:9224`), `VIBEGROWTH_PLAY_SA_JSON`, `VIBEGROWTH_ASC_BIN`, `GOOGLE_PSI_API_KEY`.

### Content folder layout

```text
<data-dir>/
├── <brand>/
│   ├── accounts.md
│   └── <account>/
│       ├── persona/          # persona.md + reference images
│       ├── posts/YYYY-MM-DD-<slug>/
│       │   ├── render-manifest.json
│       │   ├── caption.txt
│       │   └── render/       # slides, MP4, contact sheet
│       ├── analysis/<handle>_<id>/briefing.md
│       └── pulls/
└── .vibegrowth/vibegrowth.db
```

`vibegrowth import` reads an existing folder in this layout (plus optional `journal.md`, `angles.md`, `performance.jsonl` and `.autopilot/matches.json`). It is idempotent: running it again creates nothing new and never overwrites edits made in the tool. `vibegrowth import-growth --db <growth.db> --sites <sites.json> [--workspace-root <dir>]` does the same for the earlier Python website-growth system.

## CLI

Every command accepts `--json` and `--actor <name>` (default `agent`). Writes from the actor `max` count as the human: only `max` changes locked entries or entries the human created, and only `max` decides approvals. The web app writes as `max`. Run `vibegrowth <command> --help` for all options.

### Shortform

| Command | Purpose |
|---|---|
| `context --account <id> [--date]` | Everything for one morning run: account, character, active format with guide and skills, rules, image errors, CTA rule, learnings, decisions, today's entry, upcoming plan, recent posts with numbers, warnings |
| `accounts list\|show\|add\|update` | Accounts; `add` creates the folder structure, `update --format <id> --reason <text>` records a pivot |
| `characters list\|show\|add\|update\|add-image` | AI characters and reference images |
| `formats list\|show\|add\|version\|update` | Formats; `version` starts a new version with a reason, `update` corrects the current one |
| `rules list\|add\|replace\|retire` | Rules for a format, account or brand, each with a source |
| `image-errors list\|add\|update` | Known image errors with detection and countermeasure |
| `plan list\|show\|next\|add\|update\|move\|lock\|skip\|delete\|fill\|horizon` | Content plan; `next` = entry of the day, `fill` = free days only |
| `post list\|show\|register\|posted` | Register a post folder (links the plan entry), mark as posted |
| `metrics pull\|show` | Public numbers per account; pulls younger than 60 minutes are skipped |
| `learning list\|add\|outdate` | Learnings with evidence |
| `decision list\|add` | Decisions and pivots with rationale |
| `hook list\|add\|winner\|variant` | Hook library, up to three variants per winner |
| `inspo list\|show\|add\|update` | Saved links and trends |
| `history` | Change history of both modules |
| `render --post <id>` | Slides, MP4 and contact sheet; `--finalize <stem> --zip <name>` adds QA and an upload ZIP |
| `open post\|account\|inspo <id>` | Open the folder in Finder |
| `import` | Idempotent import of an existing content folder |
| `init`, `serve` | Write the config, start API and web |

Shortform commands with `--brand` also accept `--project` with the same meaning.

### Growth

| Command | Purpose |
|---|---|
| `context --project <id> [--date]` | Everything for one growth run: funnel with weakest step, KPI deltas, search opportunities, audit errors, approvals, content, backlog, experiments, changes, GEO, mention targets, store, rules, learnings, shortform accounts, warnings |
| `overview [--days]` | All projects: traffic light, funnel, approvals, experiments, last collect |
| `projects list\|show\|add\|update` | Projects; `--config <json>` sets project config such as `funnel` or `seedKeywords` |
| `channels list\|add\|update` | Channels of a project |
| `collectors list\|set\|runs\|setup\|check-stores` | Switch and configure collectors, last runs, GA4 app setup (`setup app`), store access check |
| `collect [--project] [--collector] [--days]` | Run enabled collectors |
| `kpi list\|ingest` | Daily values; `ingest` upserts rows from a file or stdin |
| `funnel --project <id> [--days] [--end]` | Funnel with previous window and conversion |
| `search --project <id> [--opportunities]` | Search queries and pages from GSC and Bing |
| `search sitemap-submit\|bing-submit\|keywords` | Submit the sitemap to Search Console, URLs to Bing, Google autocomplete ideas (read only) |
| `audit run\|show` | Technical SEO audit, `--diff` against the previous run |
| `health [--project\|--all]` | Uptime, TLS and latency |
| `approvals list\|show\|add\|decide\|withdraw` | Waiting for Max; `decide` only as `max` |
| `content list\|show\|add\|update` | Content pipeline |
| `backlog list\|add\|update` | Growth backlog |
| `exp list\|show\|add\|update\|eval` | Experiments; `eval` evaluates the ones that are due |
| `changes list\|add` | Change log |
| `geo questions\|question add\|question update\|record\|list\|summary\|run` | GEO questions, checks and evaluation; `run` asks the questions in ChatGPT |
| `mentions list\|update` | Mention targets |
| `store summary\|reviews` | Installs, ratings, campaigns, reviews |
| `import-growth` | Idempotent import of the earlier website-growth system |

### Exit codes and errors

| Code | Meaning |
|---|---|
| `0` | ok |
| `1` | error, including API not reachable (code `API`) |
| `2` | partial failure: `metrics pull`, `collect`, `health`, `geo run` with errors, `collectors check-stores` with missing access |
| `3` | refused (`LOCKED`): locked or human-owned entry, approval decided by someone other than `max` |

With `--json`, errors go to stdout as `{"error": {"code", "message"}}`. Without, they go to stderr as `Fehler (<code>): <message>`. Error codes: `INVALID`, `NOT_FOUND`, `CONFLICT`, `LOCKED`, `EXTERNAL`, `CONFIG`, `ERROR`, `API`.

### Compatibility with `vibeshorts`

`vibeshorts` is the same CLI under the old name. Every command, option, exit code and `--json` output that VibeShorts had stays the same, so existing cron jobs keep working. Only the program name in help texts differs.

## Adding a project

A new website or app needs no code, only configuration:

```bash
vibegrowth projects add acme --name Acme --url https://acme.example --kind app --language en
vibegrowth channels add acme-web --project acme --kind website --url https://acme.example
vibegrowth channels add acme-ios --project acme --kind ios --external-id 1234567890

vibegrowth collectors set health --project acme --enable --config '{"path":"/api/health"}'
vibegrowth collectors set audit --project acme --enable
vibegrowth collectors set gsc --project acme --enable --config '{"property":"sc-domain:acme.example"}'
vibegrowth collectors set ga4 --project acme --enable --config '{"property":"properties/123456789"}'
vibegrowth collectors set asc --project acme --enable --config '{"appId":"1234567890"}'
vibegrowth collectors list --project acme --json   # configSchema shows required fields per collector

vibegrowth geo question add --project acme --text "Which app tracks working hours best?"
vibegrowth collect --project acme
vibegrowth funnel --project acme
```

`health`, `audit`, `bing` and `psi` take `url` from the project if their config has none. `--config` merges into the stored config; `null` removes a key. The project's funnel can be overridden with `projects update acme --config '{"funnel":[…]}'`.

## Collector credentials

Credentials are never stored in the database or the repo. VibeGrowth reads them from `secretsDir` and never prints or copies them. Only the Google OAuth refresh writes the new token back to its file.

| File in `secretsDir` | Used by |
|---|---|
| `google-growth-oauth-client.json` | `gsc`, `ga4`, `app`, `search sitemap-submit`, `collectors setup app` |
| `google-growth-oauth-token.json` | same as above |
| `google-growth-api-key` | `psi` (or `GOOGLE_PSI_API_KEY`) |
| `bing-webmaster-api-key` | `bing`, `search bing-submit` |

Outside `secretsDir`: `play` uses a Google Play service account from `VIBEGROWTH_PLAY_SA_JSON` or `credentials_path` in `~/.playconsole-cli/config.json`; `asc` uses a profile of the `asc` CLI; `geo-chatgpt` uses a logged-in automation Chrome at `VIBEGROWTH_CDP_URL`. `audit`, `health` and `search keywords` need no credentials. A collector without access ends with `ok: false` and says which access is missing.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm run dev:api                  # API with watch, port from VIBEGROWTH_API_PORT (default 4311)
npm run dev:web                  # web with hot reload on 127.0.0.1:4310
npm run cli -w apps/cli -- …     # CLI from source via tsx
npm run db:generate              # after changing apps/api/src/core/schema.ts
```

Point the API at a copy of the database with `VIBEGROWTH_DB` while developing. Migrations are appended, never edited. SQLite runs in WAL mode with a busy timeout, and every write is one `BEGIN IMMEDIATE` transaction, so several agents and the browser can write at the same time.

## License

MIT. The bundled fonts in `apps/api/renderer/assets/fonts` are under the SIL Open Font License (see the files next to them).

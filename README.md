# VibeGrowth

VibeGrowth (formerly VibeShorts) is a local growth studio. The shortform module is a content studio for short-form video and photo-mode slideshows. One SQLite database holds accounts, AI characters, formats with versions, rules, known image errors, a multi-week content calendar, posts with their folders and TikTok numbers, learnings, decisions, hooks and saved inspiration. A Next.js web app on `127.0.0.1` shows it all; a CLI with `--json` on every command lets AI agents plan, produce and report through the same data.

Built for a setup where agents produce one post per account every morning and a human wants to see the next weeks, step in anywhere and understand why something changed.

## What it does

- **Calendar first.** Week, three-week and month views across all accounts, filter by brand and account. Drag entries to another day, edit, lock, skip or add them. Entries created or locked by the human are never overwritten by an agent.
- **Agents plan ahead.** `plan fill` writes only free days, from entries the agent passes in or from its own idea pool. `context --account <id> --json` returns everything a run needs in one call.
- **Formats are data.** Format versions carry a Markdown guide, the tool skills an agent needs, confirmed example posts, renderer parameters and rules. A plan entry can override the account's active format for one day. A pivot is a new version with a reason, not a rewrite of agent instructions. Known image errors (with countermeasures) live next to them.
- **Posts stay where they are.** Media files are never moved or renamed. The database stores paths relative to the content folder; "Open in Finder" opens the right folder.
- **Numbers.** `metrics pull` fetches public TikTok stats per account, matches each TikTok post to a local post folder via a perceptual hash of slide 1, stores snapshots and derives 24 h / 48 h / 7 day plays, median and winners.
- **Traceability.** Every rule, learning and decision has a source, a date and an actor. Every change lands in the history with before and after.
- **Rendering.** `render` turns a post's `render-manifest.json` into JPG slides, a preview MP4 and a contact sheet with the bundled Python renderer.

Not included on purpose: uploading or posting, scheduling, login, cloud hosting, a slide editor, image generation.

## Requirements

- Node.js 22 or newer
- Python 3 with Pillow for `render` (and `ffmpeg` for preview videos)
- For `metrics pull`: a `tiktok_pull.py` module that provides a `curl_cffi` session and a cookie jar (`load_jar`, `cr`, `TARGET`, `UA_LANG`). Cookies never live in this repo.

## Setup

```bash
git clone https://github.com/vibelabsdotto/vibegrowth.git
cd vibegrowth
npm install
npm run build
npm link            # optional: puts `vibegrowth` (and the old name `vibeshorts`) on your PATH

vibegrowth init --data-dir ~/path/to/content
vibegrowth serve    # http://127.0.0.1:4310
```

`init` writes `~/.config/vibegrowth/config.json`. The database defaults to `<data-dir>/.vibegrowth/vibegrowth.db` so it lives next to the content, not the code; an existing `<data-dir>/.vibeshorts/vibeshorts.db` keeps being used. Override per process with `VIBEGROWTH_DATA_DIR`, `VIBEGROWTH_DB`, `VIBEGROWTH_PYTHON` and `VIBEGROWTH_TIKTOK_PULL`. The old names (`~/.config/vibeshorts/config.json`, `VIBESHORTS_*`) are still read as a fallback; the new ones win.

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

`vibegrowth import` reads an existing folder in this layout (plus optional `journal.md`, `angles.md`, `performance.jsonl` and `.autopilot/matches.json` files from an earlier Markdown-based workflow). It is idempotent: running it again creates nothing new and never overwrites edits made in the tool.

## CLI

Every command accepts `--json` and `--actor <name>` (default `agent`, or `VIBEGROWTH_ACTOR`). Writes from the actor `max` count as the human: only that actor may change locked entries or entries the human created. The web app writes as `max`.

| Command | Purpose |
|---|---|
| `context --account <id> [--date]` | Account, character, active format (current version with guide, skills and examples; `format.source` is `plan` or `account`) with rules, image errors, CTA rule, active learnings and decisions, today's entry, upcoming plan, recent posts with numbers, warnings |
| `accounts list\|show\|add\|update` | Accounts; `add` also creates the folder structure. Changing the active format (`update --format <id> --reason <text>`) records a pivot decision |
| `characters list\|show\|add\|update\|add-image` | AI characters and reference images |
| `formats list\|show\|add\|version\|update` | Formats; `version` starts a new version with a reason and carries fields and active rules over, `update` corrects the current version in place. Versions carry a Markdown guide (`--guide`, `--guide-file`), tool skills (`--skills`), example posts (`--examples`) and renderer parameters |
| `rules list\|add\|replace\|retire` | Rules for a format, account or brand, each with a source |
| `image-errors list\|add\|update` | Known image errors with detection and countermeasure |
| `plan list\|show\|next\|add\|update\|move\|lock\|skip\|delete\|fill\|horizon` | Content plan. `next` = entry of the day, `fill` = fill free days only |
| `post list\|show\|register\|posted` | Register a post folder (links the plan entry), mark as posted |
| `metrics pull\|show` | Public numbers per account; one pull per account at a time, fresh pulls (< 60 min) are skipped |
| `learning list\|add\|outdate` | Learnings, evidence required |
| `decision list\|add` | Decisions and pivots, rationale required |
| `hook list\|add\|winner\|variant` | Hook library, up to three variants per winner |
| `inspo list\|show\|add\|update` | Saved links and trends |
| `history` | Change history |
| `render --post <id>` | Render slides, MP4 and contact sheet; `--finalize <stem> --zip <name>` adds technical QA and an upload ZIP for canvas posts |
| `open post\|account\|inspo <id>` | Open the folder in Finder |
| `import` | Idempotent import of an existing content folder |
| `serve [--port]` | Start the web app on 127.0.0.1 |

`vibeshorts` is kept as an alias of `vibegrowth` with the same commands, JSON output and exit codes.

Exit codes: `0` ok, `1` error, `2` partial failure (`metrics pull`), `3` refused because an entry is locked or owned by the human. Errors with `--json` come back as `{"error": {"code", "message"}}`.

A typical morning run:

```bash
vibegrowth metrics pull --actor cron:jule
vibegrowth context --account jule --json --actor cron:jule
# … produce the post into <account>/posts/<date>-<slug>/ …
vibegrowth render --post <date>-<slug> --actor cron:jule
vibegrowth post register --account jule --dir <date>-<slug> --delivered --actor cron:jule
vibegrowth learning add --account jule --statement "…" --evidence "…" --actor cron:jule
vibegrowth plan fill --account jule --weeks 3 --file next-entries.json --actor cron:jule
```

## How it works

- `core/` holds all logic and is shared by the CLI and the web app (server actions). There is no separate API.
- SQLite runs in WAL mode with a busy timeout; every CLI write is one `BEGIN IMMEDIATE` transaction, so several agents and the browser can write at the same time.
- Migrations are plain SQL generated by drizzle-kit (`drizzle/`) and applied on open.
- The web app only answers requests whose `Host` is loopback and only serves media files from inside the content folder.
- UI: Next.js App Router, Tailwind and shadcn/ui on Base UI (`base-nova`), Geist.

## Development

```bash
npm run dev          # web app with hot reload on 127.0.0.1:4310
npm run cli -- …     # CLI from source via tsx
npm run typecheck
npm run lint
npm run db:generate  # after changing core/schema.ts
```

## License

MIT. The bundled fonts in `renderer/assets/fonts` are under the SIL Open Font License (see the files next to them).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VibeShorts

Lokales Content-Studio für Shortform. Web-App (Next.js, nur Loopback) und CLI teilen dieselbe Logik in `core/` und dieselbe SQLite-Datenbank. Agents arbeiten nur über die CLI mit `--json`.

## Aufbau

| Ort | Zweck |
|---|---|
| `core/` | Schema (Drizzle), DB-Öffnen mit WAL und Migration, gesamte Fachlogik |
| `cli/` | Commander-CLI, gebündelt nach `dist/cli.mjs` (`npm run build:cli`), Einstieg `bin/vibeshorts.mjs` |
| `app/` | Seiten (Server Components lesen direkt aus `core/`), `actions.ts` für alle Schreibvorgänge aus dem Browser, `media/` liefert Bilder und Videos aus dem Datenordner |
| `components/` | Eigene Komponenten; `components/ui/` sind shadcn-Komponenten (base-nova, Base UI) |
| `renderer/` | Python-Renderer, Zahlen-Abruf, gebündelte OFL-Fonts |
| `drizzle/` | SQL-Migrationen, nach Schemaänderung `npm run db:generate` |

## Regeln

- Jeder Schreibvorgang läuft über eine Funktion in `core/`, schreibt einen `history`-Eintrag mit Akteur und läuft in einer `BEGIN IMMEDIATE`-Transaktion (`tx`). Keine Schreibzugriffe an `core/` vorbei.
- Einträge mit `locked` oder `origin = max` ändert nur der Akteur `max`. Der Browser schreibt immer als `max`.
- `plan fill` schreibt nur freie Tage. Mediendateien nie verschieben, umbenennen oder löschen; Pfade relativ zum Datenordner speichern.
- `import` bleibt idempotent: jede importierte Zeile hat einen `source_key`, bestehende Zeilen werden nie überschrieben.
- Web-App bindet nur an `127.0.0.1`, `proxy.ts` lehnt fremde Hosts ab. Kein Login, keine Secrets im Repo, TikTok-Cookies kommen aus einem externen `tiktok_pull.py`.
- UI: shadcn-Komponenten zuerst, Overlays als Drawer von rechts, Toasts über `toast.add`.
- Vor Abschluss: `npm run typecheck`, `npm run lint`, `npm run build`.

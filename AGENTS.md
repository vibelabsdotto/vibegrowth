# VibeGrowth

Lokales Growth-Studio für alle VibeLabs-Projekte (früher VibeShorts): Shortform-Modul und Growth-Modul für Websites und Apps. npm-Monorepo mit API (NestJS), Web (Next.js) und CLI. Alles läuft nur auf `127.0.0.1`, ohne Login. Agents arbeiten nur über die CLI mit `--json`.

Verbindlich: `docs/CONTRACT.md` (Endpunkte, Body-Feldnamen, Schema, CLI-Kompatibilität). Abweichungen nur mit Byte, dann den Kontrakt im selben Commit anpassen.

## Aufbau

| Ort | Zweck |
|---|---|
| `apps/api/` | NestJS-API, Port 4311 (`VIBEGROWTH_API_PORT`), Präfix `/api`, einziger Prozess mit SQLite-Zugriff |
| `apps/api/src/core/` | Domänenschicht aus VibeShorts: `schema.ts` (einzige Schemaquelle), `db.ts` (WAL, Migrator mit Ledger `_migrations`), `config.ts`, Shorts-Fachlogik |
| `apps/api/src/database/` | `DatabaseService`: `ctx` aus `core/db.ts`, `tx()` für Schreibvorgänge |
| `apps/api/src/common/` | `@Actor()` (Header `X-Actor`, Default `agent`), JSON-Exception-Filter |
| `apps/api/src/shorts/` | Shorts-Controller, rufen `core/` direkt; Antworten byte-gleich zur alten CLI |
| `apps/api/src/growth/data/` | Projekte, Kanäle, Collector-Schalter, `collect`, KPI, Suche, Audit, Funnel, Collector-Aktionen (Sitemap, Bing, Keywords, GA4-Setup, Store-Check, `geo run`) |
| `apps/api/src/growth/work/` | Freigaben (inkl. `reply`/`task`), Content, Backlog, Experimente, Changes, GEO, Erwähnungs-Ziele, Store, Strategien, Wissen (`/knowledge`), App-Inbox und `app publish`, Übersicht, `context --project` |
| `apps/api/src/core/category.ts` | Kategorien `web\|shortform\|app\|general` und ihre Ableitung (Kontrakt §7.9) |
| `apps/api/src/growth/import/` | `import-growth` aus dem Website-Growth-System |
| `apps/api/src/collectors/` | `definitions/` (ein Collector pro Datei), `sources/` (Abruf), `registry.ts` |
| `apps/api/drizzle/` | SQL-Migrationen `0000`–`0006` + `meta/` |
| `apps/api/renderer/` | Python-Renderer, TikTok-Zahlen-Abruf, OFL-Fonts |
| `apps/web/` | Next.js-App, Port 4310, nur über die API. Eigene Regeln in `apps/web/AGENTS.md` |
| `apps/cli/` | Commander-CLI, HTTP-Client der API, gebündelt nach `dist/cli.mjs`; bins `vibegrowth` und Alias `vibeshorts` |
| `docs/api-shorts.md` | Shorts-Endpunkte mit Body-Feldern |
| `skills/vibegrowth/` | Skill für Agents (Echo, Byte), die die CLI nutzen |

## Befehle

- Alle Workspaces: `npm run typecheck`, `npm run lint`, `npm run build`. Einzeln: `npm run <skript> --workspace apps/api`.
- Entwicklung auf eigenen Ports und einer DB-Kopie: `VIBEGROWTH_API_PORT=4321 VIBEGROWTH_DB=<kopie> npm run dev:api`; Web: in `apps/web` `VIBEGROWTH_API_URL=http://127.0.0.1:4321 npx next dev --hostname 127.0.0.1 --port 4320`. `npm run dev:web` belegt 4310.
- CLI aus dem Quelltext: `npm run cli -w apps/cli -- <befehl>`; gebaut: `node apps/cli/dist/cli.mjs <befehl>`. Gegen eine Dev-API: `VIBEGROWTH_API_URL=http://127.0.0.1:4321`.
- Migration nach Schemaänderung: `npm run db:generate`, danach ein zweites Mal ausführen, es darf keine neue Migration entstehen.
- `npm install` nur im Root (ein Lockfile).

## Produktion

- Ein Launcher außerhalb des Repos (`.hermes/scripts/script-vibegrowth-launcher.sh`, verlinkt als `~/.local/bin/vibegrowth` und `vibeshorts`) startet API (4311) und Web (4310) aus diesem Checkout: `vibegrowth start|stop|restart|status|open|logs|cli-help`. Jeder andere Befehl startet bei Bedarf die API und geht an die CLI.
- `npm run build` in diesem Checkout ersetzt den Produktionscode; live wird er mit `vibegrowth restart`. Nur nach grünen Gates bauen und neu starten.
- Ports 4310 und 4311 nicht für Entwicklung belegen. Produktions-DB: `~/VibeLabs/shortform-content/.vibeshorts/vibeshorts.db`.

## Regeln

- Jeder Schreibvorgang läuft über eine Service-Methode in `tx()` (`BEGIN IMMEDIATE`) und schreibt einen `history`-Eintrag mit Akteur. Keine Schreibzugriffe an den Services vorbei, auch nicht aus Controllern.
- Akteur kommt aus `@Actor()`. Einträge mit `locked` oder `origin = max` ändert nur `max`, Freigaben entscheidet nur `max`, sonst `LOCKED` (CLI Exit 3). Der Browser schreibt immer als `max`.
- Shorts-JSON bleibt byte-gleich zur CLI am Commit `702c6c5` (Kontrakt §0): gleiche Befehle, Optionen, Aliase, Exit-Codes, Fehlertexte. Logik aus `core/` übernehmen, nicht neu schreiben. Prüfen nach jeder Änderung an Shorts-Routen, Shorts-Tabellen oder Shorts-CLI: Build von `HEAD` (`git archive HEAD` in den Scratch-Ordner, `node_modules` per `cp -cR`, dort bauen) und neuer Build laufen je als Dev-API auf eigener Kopie derselben DB-Sicherung; `snap.sh <bin> <outdir>` für beide CLIs, dann `python3 cmp.py <a> <b>` (`diffs: 0`) und ein Byte-Vergleich ohne `generatedAt`. Der eingefrorene Stand `.hermes/frozen/` existiert nicht mehr. Skripte in `~/.hermes/profiles/byte/cache/scratch/vibegrowth-baseline/`.
- Body-Feldnamen nicht vereinheitlichen: Growth-Daten nehmen `project`, Growth-Arbeit `projectId`/`channelId`/`accountId`/`approvalId`/`experimentId` (Kontrakt §4.1). Neue Routen folgen dem Muster ihres Moduls.
- Migrationen nur anhängen, bestehende nie ändern. Keine Rebuilds bestehender Tabellen: drizzle-kit erzeugt bei FK- oder Spaltenänderungen `__new_*`-Kopien, die von Hand durch `ALTER TABLE` ersetzt werden.
- Collectors schreiben nie selbst in die DB. Sie liefern Zeilen, `CollectService` schreibt sie über die Growth-Services. Neuer Collector = eine Datei in `collectors/definitions/` + Eintrag in `registry.ts`.
- Externe Aktionen (Sitemap, Bing, GA4-Setup, `app publish`) laufen außerhalb der Transaktion und protokollieren danach einen `changes`-Eintrag.
- `app publish` postet öffentlich (Featurama, Google Play, App Store). Beim Entwickeln nur `--dry-run` gegen echte Ziele; echtes Posten nur gegen das Featurama-Testprojekt `cde10dec-7605-43dd-89cd-2d44324da605` auf einer DB-Kopie mit eigenem Projekt. Featurama-Zugang nur über die Featurama-CLI, ihr Token wird nie gelesen oder ausgegeben.
- Neue Spalten an Shorts-Tabellen (`learnings`, `decisions`, `formats`) nie in Shorts-Antworten ausgeben (`shortsRow` in `core/knowledge.ts`).
- `plan fill` schreibt nur freie Tage. Mediendateien nie verschieben, umbenennen oder löschen; Pfade relativ zum Datenordner speichern.
- `import` und `import-growth` bleiben idempotent: jede importierte Zeile hat einen `source_key`, bestehende Zeilen werden nie überschrieben.
- Nie auf der Produktions-DB entwickeln. Kopie: `sqlite3 <db> ".backup '<kopie>'"`, dann `VIBEGROWTH_DB=<kopie>`. `render`-Proben nur auf einer APFS-Kopie des Datenordners (`cp -c -R`).
- Keine Secrets im Repo, in Logs oder Ausgaben. Collector-Zugänge liegen in `secretsDir` und werden nur gelesen.
- `apps/web` hat keinen DB-Zugriff und importiert nichts aus `apps/api`.
- Python nur für den Renderer und die TikTok-Zahlen. Alles andere in TypeScript.
- Keine Testdateien im Repo. Prüfskripte gehören in den Scratch-Ordner.
- Vor Abschluss: `npm run typecheck`, `npm run lint`, `npm run build` grün.

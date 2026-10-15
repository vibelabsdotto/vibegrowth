# VibeGrowth

Lokales Growth-Studio für alle VibeLabs-Projekte (früher VibeShorts): Shortform-Modul und Growth-Modul für Websites und Apps. npm-Monorepo mit API (NestJS), Web (Next.js) und CLI. Alles läuft nur auf `127.0.0.1`, ohne Login. Agents arbeiten nur über die CLI mit `--json`.

Verbindlich: `docs/CONTRACT.md` (Endpunkte, Schema, CLI-Kompatibilität). Abweichungen nur mit Byte, dann den Kontrakt im selben Commit anpassen.

## Aufbau

| Ort | Zweck |
|---|---|
| `apps/api/` | NestJS-API, Port 4311 (`VIBEGROWTH_API_PORT`), Präfix `/api`, einziger Zugriff auf SQLite |
| `apps/api/src/core/` | Domänenschicht aus VibeShorts: `schema.ts` (einzige Schemaquelle), `db.ts` (Öffnen mit WAL, Migrator mit Ledger `_migrations`), `config.ts`, Fachlogik. Nest-Services kapseln diese Funktionen |
| `apps/api/src/database/` | `DatabaseService`: hält den `Ctx` aus `core/db.ts`, `tx()` für Schreibvorgänge |
| `apps/api/src/common/` | `@Actor()` (Header `X-Actor`, Default `agent`), JSON-Exception-Filter, Fehlerklassen |
| `apps/api/src/shorts/`, `growth/`, `collectors/` | Module der Lanes, je ein Aggregator-Modul in `app.module.ts` registriert |
| `apps/api/drizzle/` | SQL-Migrationen + `meta/` (Snapshots, Journal) |
| `apps/api/renderer/` | Python-Renderer, TikTok-Zahlen-Abruf, OFL-Fonts |
| `apps/web/` | Next.js-App, Port 4310, `components/ui/` sind shadcn-Komponenten (base-nova, Base UI). Eigene Regeln in `apps/web/AGENTS.md` |
| `apps/cli/` | Commander-CLI, mit esbuild nach `dist/cli.mjs` gebündelt; bins `vibegrowth` und Alias `vibeshorts` in `bin/` |
| `skills/vibegrowth/` | Skill für Agents, die die CLI nutzen |

## Befehle

- Alle Workspaces: `npm run typecheck`, `npm run lint`, `npm run build`. Einzeln: `npm run <skript> --workspace apps/api`.
- Entwicklung: `npm run dev:api`, `npm run dev:web`. Für die API `VIBEGROWTH_DB=<kopie>` setzen.
- Migration nach Schemaänderung: `npm run db:generate`. Danach ein zweites Mal ausführen, es darf keine neue Migration entstehen.
- `npm install` nur im Root (ein Lockfile).

## Regeln

- Jeder Schreibvorgang läuft über eine Service-Methode in `tx()` (`BEGIN IMMEDIATE`) und schreibt einen `history`-Eintrag mit Akteur. Keine Schreibzugriffe an den Services vorbei.
- Einträge mit `locked` oder `origin = max` ändert nur der Akteur `max`. Freigaben entscheidet nur `max`. Der Browser schreibt immer als `max`.
- Shorts-JSON bleibt byte-gleich zur CLI am Commit `702c6c5` (Kontrakt §0). Logik aus `core/` übernehmen, nicht neu schreiben.
- Migrationen nur anhängen, bestehende nie ändern. Keine Tabellen-Rebuilds bestehender Tabellen: drizzle-kit erzeugt bei FK- oder Spaltenänderungen `__new_*`-Kopien, die von Hand durch `ALTER TABLE` ersetzt werden.
- `plan fill` schreibt nur freie Tage. Mediendateien nie verschieben, umbenennen oder löschen; Pfade relativ zum Datenordner speichern.
- `import` bleibt idempotent: jede importierte Zeile hat einen `source_key`, bestehende Zeilen werden nie überschrieben.
- Nie die Produktions-DB öffnen. Arbeiten auf einer Kopie (`sqlite3 <db> ".backup '<kopie>'"`, dann `VIBEGROWTH_DB=<kopie>`).
- `.hermes/frozen` (Produktion auf Port 4310) nicht ändern, nicht linten, Port 4310 nicht belegen.
- Keine Secrets im Repo. Collector-Zugänge liegen in `secretsDir` und werden nur gelesen.
- Keine Testdateien im Repo. Prüfskripte gehören in den Scratch-Ordner.

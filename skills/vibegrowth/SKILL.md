---
name: vibegrowth
description: Use when running shortform or growth work in VibeGrowth.
version: 0.3.0
author: VibeLabs
license: MIT
---

# VibeGrowth

VibeGrowth ist die einzige Quelle für Accounts, Formate, Regeln, Bildfehler, Plan, Learnings, Entscheidungen, Hooks und Inspiration und für die Growth-Daten der Projekte (Kanäle, Collectors, KPIs, Funnel, Freigaben, Content, Backlog, Experimente, Änderungen, GEO, Erwähnungs-Ziele, Stores). Lies und schreibe nur über die CLI, immer mit `--json` und `--actor <dein-name>` (z. B. `cron:jule`, `echo`, `cron:growth`). Keine Regeln, Pläne, Freigaben oder Backlogs mehr in Markdown-Dateien pflegen.

Die CLI spricht per HTTP mit der lokalen VibeGrowth-API (`VIBEGROWTH_API_URL`, Standard `http://127.0.0.1:4311`). Der Befehl `vibegrowth` startet die API bei Bedarf selbst. Ist sie trotzdem nicht erreichbar, endet der Aufruf mit Exit `1` und Code `API`; dann `vibegrowth status` und `vibegrowth logs` prüfen. `vibeshorts` ist derselbe Befehl unter altem Namen. Alle Optionen: `vibegrowth <befehl> --help`.

## Morgenlauf pro Account

1. `vibegrowth metrics pull --account <id> --actor cron:<id> --json`. Läuft schon ein Abruf, wartet der Aufruf und nutzt ihn mit. Fehler im Abruf stoppen den Lauf nicht.
2. `vibegrowth context --account <id> --actor cron:<id> --json`. Enthält das aktive Format in seiner aktuellen Version, aktive Regeln (Format, Account, Brand), Bildfehler, CTA-Regel, Learnings, Entscheidungen, `today`, `upcoming`, `ideas`, `recentPosts` mit Zahlen und `warnings`.
   - `format` ist verbindlich. `format.source` sagt, woher es kommt: `plan` (Planeintrag des Tages setzt ein Format) oder `account` (aktives Format des Accounts). Kein anderes Format nehmen.
   - `format.guide` ist der Leitfaden als Markdown (Slide-Aufbau, Produktion, Abnahme), `format.skills` die Werkzeug-Skills, die vor der Produktion zu laden sind, `format.examples` bestätigte Beispielposts relativ zum Datenordner.
3. Thema: `today` nehmen. Ist `today` leer, selbst wählen und vor der Produktion mit `plan add --account <id> --date <heute> --topic … --rationale …` eintragen. Status während der Arbeit: `plan update <id> --status in_production`.
4. Skills aus `format.skills` laden, Post nach `format.guide`, Regeln und CTA-Regel bauen. Jedes generierte Bild gegen `imageErrors` prüfen.
5. `vibegrowth render --post <ordner>` (oder `--finalize <stem> --zip <name>.zip` für Canvas-Posts).
6. `vibegrowth post register --account <id> --dir <ordner> --delivered`. Verknüpft den Eintrag des Tages und setzt ihn auf „geliefert“.
7. Learnings nur mit Beleg: `learning add --account <id> --statement … --evidence "<Posts und Zahlen>"`.
8. Horizont halten: `plan horizon --account <id>`; freie Tage mit `plan fill --account <id> --weeks 3 --file <json>` füllen (Liste von `{topic, angle, hookDirection, hook, rationale}`). Ohne `--file` plant `fill` aus dem eigenen Ideen-Pool.
9. Lieferung in den Chat wie bisher.

Ist die CLI oder die API nicht erreichbar (Code `API`), mit dem letzten bekannten Stand weiterarbeiten und den Fehler in einem Satz melden. Der Morgenlauf fällt nie aus.

## Shortform-Regeln

- Gewinner (ab 48 h mindestens 2× Median, `metrics.winners`): `hook add --account <id> --text … --mechanism … --winner --post <id>`, danach bis zu drei Varianten mit `hook variant <id> --text …` und als Planeinträge mit `--hook-id`.
- Aktives Format eines Accounts wechseln: `accounts update <id> --format <format> --reason "<Begründung>"`. Legt die Pivot-Entscheidung automatisch an.
- Format ändern als Pivot: `formats version <id> --note "<Begründung>" [--guide-file <md>] [--skills a,b] [--examples <pfad>,<pfad>]`. Nicht angegebene Felder übernimmt die neue Version.
- Format korrigieren ohne neue Version: `formats update <id> --guide-file <md>` (ebenso `--description`, `--skills`, `--examples`, `--params`, `--name`). Für Tippfehler und Nachträge, nicht für inhaltliche Wechsel.
- Planeinträge ohne `--format` folgen dem aktiven Format des Accounts. `--format` nur setzen, wenn genau dieser Tag ein anderes Format bekommen soll.
- Neue Regel aus Max' Feedback: `rules add --account <id> --kind hook --text … --source "Max, <Datum>, Chat"`. Überholte Regel: `rules replace <id> --text … --source …`.
- Links, die Max im Chat schickt: `inspo add <url> --account <id> --note …`. Planeinträge daraus mit `--inspiration <id>`.
- Neuer Account: `accounts add <id> --brand <brand> --name … --handle … --format … --cta engagement`; Charakter mit `characters add <id> --account <id> --name …`, Referenzbilder mit `characters add-image <id> <pfad>`.
- Mediendateien nie verschieben. Post-Ordner liegen unter `<brand>/<account>/posts/YYYY-MM-DD-<slug>/`.

## Growth-Lauf pro Projekt

Projekt-IDs: `vibegrowth projects --json`. Ein Lauf arbeitet ein Projekt ab, z. B. täglich nach dem Datenabruf. Akteur für Crons: `cron:growth`.

1. Daten holen: `vibegrowth collect --project <id> --actor cron:growth --json`. Läuft nur eingeschaltete Collectors (`collectors list --project <id>`). Exit `2`: mindestens ein Collector ist fehlgeschlagen, Details in `errors`. Weiterarbeiten und den Fehler im Bericht nennen.
2. Kontext lesen: `vibegrowth context --project <id> --actor cron:growth --json`. Enthält Ampel (`light`), Funnel mit schwächster Stufe (`funnel.weakest`), KPI-Vergleich zur Vorwoche, Such-Chancen (Position 4 bis 20), offene Audit-Fehler, offene und kürzlich entschiedene Freigaben, Content nach Status, offenen Backlog, laufende Experimente, Änderungen der letzten 28 Tage, GEO, Erwähnungs-Ziele, Store-Zahlen, Regeln, Learnings, Entscheidungen, Shorts-Accounts und `warnings`. `warnings` zuerst lesen.
3. Entscheidungen von Max zuerst umsetzen: `approvals.recentDecisions` aus dem Kontext bzw. `approvals list --project <id> --status approved,changes_requested --json`. Bei `changes_requested` die Notiz (`decisionNote`) umsetzen und neu anfragen.
4. Funnel prüfen (`funnel --project <id> [--days 7]`) und entscheiden, was die schwächste Stufe hebt. Nur eine Hypothese pro Seite gleichzeitig.
5. Was Max entscheiden muss (Blogthema, Entwurf, Store-Text, Strategie, neuer Hook oder Format), als Freigabe anlegen, nicht als Markdown-Datei und nicht als Frage im Chat:
   `approvals add --project <id> --kind blog_topic --title "…" --body-file <md> [--ref-type content --ref-id <id>]`.
   Arten: `hook`, `format`, `blog_topic`, `draft`, `store_text`, `strategy`, `other`. Max entscheidet in der Web-App unter „Wartet auf Max“. Eigene, überholte Anfrage: `approvals withdraw <id>`.
6. Content-Pipeline: `content add --project <id> --title … --keyword … --brief-file <md>` (Status `idea`). Eine Freigabe mit `--ref-type content` setzt das Item bei „Freigeben“ auf `approved`. Danach `content update <id> --status draft --draft-path <absoluter pfad>`, zur Abnahme `--status review`, nach Veröffentlichung `--status live --url-path /blog/… --live-date <datum>`. `content show <id>` zeigt bei `live` Klicks, Impressionen und Besuche seit dem Live-Datum.
7. Backlog: `backlog add --project <id> --title … --kind seo --impact 2 --effort 1 --source "Audit <datum>"` (Impact und Aufwand 1–3), Fortschritt mit `backlog update <id> --status doing` bzw. `--status done --done-ref <commit oder url>`.
8. Jede Änderung an Website, App oder Store loggen: `changes add --project <id> --kind deploy --summary "…" --ref <commit/pr/url> [--exp <id>]` (Arten `deploy`, `content`, `seo`, `store`, `config`, `shorts`, `other`). Ohne Log-Eintrag lässt sich kein Effekt zuordnen.
9. Experimente: `exp add --project <id> --title … --target /pfad --metric clicks --start <tag der änderung> [--hypothesis …]`. Fällige Experimente mit `exp eval --project <id>` auswerten (der Kontext warnt, wenn welche fällig sind). Ergebnis in `exp show <id>`, daraus ein Learning mit Beleg: `learning add --project <id> --statement … --evidence "<exp-id, zahlen>"`.
10. GEO: `geo run --project <id>` stellt die aktiven Fragen in ChatGPT (dauert bis zu einer Stunde, mit `--limit 2` als Probe). Auswertung mit `geo summary --project <id>`. Neue Quellen-Domains stehen in `mentions list --project <id> --status new`; Fortschritt mit `mentions update <id> --status contacted --contact … --notes …`.
11. Weitere Werkzeuge: `overview`, `search --project <id> --opportunities`, `search sitemap-submit --project <id>`, `search bing-submit --project <id>`, `search keywords --project <id> [--seed …]`, `audit run --project <id>`, `audit show --project <id> --diff`, `health --project <id>`, `kpi list --project <id>`, `store summary --project <id>`, `store reviews --project <id>`. `sitemap-submit` und `bing-submit` legen selbst einen `changes`-Eintrag an.

Bei Shorts-Befehlen ist `--project` gleichbedeutend mit `--brand` (z. B. `rules add --project amelie`, `learning add --project amelie`, `accounts list --project amelie`).

## Neues Projekt aufnehmen

Ohne Code, nur Konfiguration. IDs klein mit Bindestrich.

1. `projects add <id> --name … --url https://… --kind app --language de [--repo <pfad>] [--workspace <ordner>]`.
2. Kanäle: `channels add <id>-web --project <id> --kind website --url …`, Apps mit `--kind ios|android --external-id <app-id oder paket>`.
3. Collectors einschalten, Pflichtfelder stehen in `collectors list --project <id> --json` unter `configSchema`:
   - `collectors set health --project <id> --enable [--config '{"path":"/api/health"}']`, `collectors set audit --project <id> --enable`
   - `collectors set gsc --project <id> --enable --config '{"property":"sc-domain:…"}'`, `ga4` mit `{"property":"properties/…"}`, `bing` und `psi` ohne Config (URL aus dem Projekt)
   - Apps: `app` mit `{"ga4Property":"properties/…"}`, `play` mit `{"package":"…","gcsBucket":"pubsite_prod_…"}`, `asc` mit `{"appId":"…"}`. Zugänge prüfen: `collectors check-stores --project <id>` (Exit 2, wenn einer fehlt). GA4-Events anlegen: `collectors setup app --project <id> --dry-run`, danach ohne `--dry-run`.
   - GEO: `collectors set geo-chatgpt --project <id> --enable --config '{"brandPatterns":["…"]}'`
4. GEO-Fragen: `geo question add --project <id> --text "…"` (je Frage ein Aufruf).
5. Erster Abruf: `collect --project <id> --days 28`, danach `funnel --project <id>` und `context --project <id>`.

Ein Collector ohne Zugang endet mit `ok:false` und nennt den fehlenden Zugang. Zugänge legt nur Max an; nie Secrets ausgeben, kopieren oder in Freigaben, Notizen oder Logs schreiben.

## Regeln

- Exit `3` (`LOCKED`) heißt: Max hat den Eintrag angelegt oder gesperrt, oder die Aktion ist Max vorbehalten. Nicht umgehen, nicht neu anlegen, um ihn zu ersetzen.
- Freigaben entscheidet nur Max (`approvals decide` mit anderem Akteur endet mit Exit `3`). Nie mit `--actor max` schreiben.
- Exit `2` heißt Teilfehler (`metrics pull`, `collect`, `health`, `geo run`, `collectors check-stores`): weiterarbeiten und den Fehler melden.
- Jede Schreibaktion mit dem eigenen `--actor`, damit der Verlauf (`history --by <actor>`) stimmt.

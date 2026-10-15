---
name: vibegrowth
description: Use when planning, producing or reporting shortform posts or running website/app growth through VibeGrowth. CLI-only access to plan, rules, formats, numbers, funnel, approvals, content, backlog and experiments.
version: 0.2.0
author: VibeLabs
license: MIT
---

# VibeGrowth

VibeGrowth ist die einzige Quelle für Accounts, Formate, Regeln, Bildfehler, Plan, Learnings, Entscheidungen, Hooks und Inspiration und für Growth-Daten der Projekte (Kanäle, Collectors, KPIs, Funnel, Freigaben, Content, Backlog, Experimente, GEO, Stores). Lies und schreibe nur über die CLI, immer mit `--json` und `--actor <dein-name>` (z. B. `cron:jule`, `echo`, `cron:growth`). Keine Regeln, Pläne, Freigaben oder Backlogs mehr in Markdown-Dateien pflegen.

Die CLI spricht per HTTP mit der lokalen VibeGrowth-API (`VIBEGROWTH_API_URL`, Standard `http://127.0.0.1:4311`). Läuft sie nicht, endet jeder Aufruf mit Exit `1` und Code `API`. `vibeshorts` ist derselbe Befehl unter altem Namen.

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

## Regeln für Agents

- Exit-Code `3` (`LOCKED`) heißt: Max hat den Eintrag angelegt oder gesperrt. Nicht umgehen, nicht neu anlegen, um ihn zu ersetzen.
- Gewinner (ab 48 h mindestens 2× Median, `metrics.winners`): `hook add --account <id> --text … --mechanism … --winner --post <id>`, danach bis zu drei Varianten mit `hook variant <id>` und als Planeinträge mit `--hook-id`.
- Aktives Format eines Accounts wechseln: `accounts update <id> --format <format> --reason "<Begründung>"`. Legt die Pivot-Entscheidung automatisch an.
- Format ändern als Pivot: `formats version <id> --note "<Begründung>" [--guide-file <md>] [--skills a,b] [--examples <pfad>,<pfad>]`. Nicht angegebene Felder übernimmt die neue Version.
- Format korrigieren ohne neue Version: `formats update <id> --guide-file <md>` (ebenso `--description`, `--skills`, `--examples`, `--params`, `--name`). Für Tippfehler und Nachträge, nicht für inhaltliche Wechsel.
- Planeinträge ohne `--format` folgen dem aktiven Format des Accounts. `--format` nur setzen, wenn genau dieser Tag ein anderes Format bekommen soll.
- Neue Regel aus Max' Feedback: `rules add --account <id> --kind hook --text … --source "Max, <Datum>, Chat"`. Überholte Regel: `rules replace <id>`.
- Links, die Max im Chat schickt: `inspo add <url> --account <id> --note …`. Planeinträge daraus mit `--inspiration <id>`.
- Neuer Account: `accounts add <id> --brand <brand> --name … --handle … --format … --cta engagement`; Charakter mit `characters add <id> --account <id> …`, Referenzbilder mit `characters add-image <id> <pfad>`.
- Mediendateien nie verschieben. Post-Ordner liegen unter `<brand>/<account>/posts/YYYY-MM-DD-<slug>/`.


## Growth-Lauf pro Projekt

Projekt-IDs: `vibegrowth projects --json`. Ein Lauf arbeitet ein Projekt ab, z. B. täglich nach dem Datenabruf.

1. Daten holen: `vibegrowth collect --project <id> --actor cron:growth --json`. Läuft nur eingeschaltete Collectors (`collectors list --project <id>`). Exit `2` heißt: mindestens ein Collector ist fehlgeschlagen, Details in `errors`. Weiterarbeiten und den Fehler im Bericht nennen.
2. Kontext lesen: `vibegrowth context --project <id> --json`. Enthält Funnel mit schwächster Stufe (`funnel.weakest`), KPI-Vergleich zur Vorwoche, Such-Chancen (Position 4 bis 20), offene Audit-Fehler, offene und kürzlich entschiedene Freigaben, Content nach Status, offenen Backlog, laufende Experimente, Änderungen der letzten 28 Tage, GEO, Erwähnungs-Ziele, Store-Zahlen, Regeln, Learnings, Entscheidungen, Shorts-Accounts und `warnings`.
3. Entscheiden, was die schwächste Stufe hebt. Nur eine Hypothese pro Seite gleichzeitig.
4. Was Max entscheiden muss (Blogthema, Entwurf, Store-Text, Strategie, neuer Hook oder Format), als Freigabe anlegen, nicht als Markdown-Datei:
   `approvals add --project <id> --kind blog_topic --title "…" --body-file <md> [--ref-type content --ref-id <id>]`.
   Entscheidet nur Max (`approvals decide` mit anderem Akteur endet mit Exit `3`). Vor neuer Arbeit `approvals list --project <id> --status approved,changes_requested` lesen und umsetzen. Eigene, überholte Anfrage: `approvals withdraw <id>`.
5. Content-Pipeline: `content add --project <id> --title … --keyword … --brief-file <md>` (Status `idea`). Eine Freigabe mit `--ref-type content` setzt das Item nach `approved`. Danach `content update <id> --status draft --draft-path <absoluter pfad>`, zur Abnahme `--status review`, nach Veröffentlichung `--status live --url-path /blog/… --live-date <datum>`. `content show <id>` zeigt bei `live` Klicks, Impressionen und Besuche seit dem Live-Datum.
6. Backlog: `backlog add --project <id> --title … --kind seo --impact 1-3 --effort 1-3 --source "Audit <datum>"`, Fortschritt mit `backlog update <id> --status doing|done --done-ref <commit oder url>`.
7. Jede Änderung an Website, App oder Store loggen: `changes add --project <id> --kind deploy|content|seo|store|config --summary "…" --ref <commit/pr/url> [--exp <id>]`. Ohne Log-Eintrag lässt sich kein Effekt zuordnen.
8. Experimente: `exp add --project <id> --title … --target /pfad --metric clicks --start <tag der änderung> [--hypothesis …]`. Ausgewertet wird automatisch mit `exp eval` (fällig nach `eval_days`). Ergebnis in `exp show <id>`, daraus ein Learning mit Beleg: `learning add --project <id> --statement … --evidence "<exp-id, zahlen>"`.
9. Weitere Werkzeuge: `funnel --project <id> [--days 7]`, `overview`, `search --project <id> --opportunities`, `audit run|show --project <id> [--diff]`, `health --project <id>`, `kpi list|ingest`, `geo questions|record|summary`, `mentions list|update`, `store summary|reviews --project <id>`.

Bei Shorts-Befehlen ist `--project` gleichbedeutend mit `--brand` (z. B. `rules add --project amelie`, `learning add --project amelie`, `accounts list --project amelie`).

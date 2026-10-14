---
name: vibeshorts
description: Use when planning, producing or reporting shortform posts through VibeShorts. CLI-only access to plan, rules, formats and numbers.
version: 0.1.0
author: VibeLabs
license: MIT
---

# VibeShorts

VibeShorts ist die einzige Quelle für Accounts, Formate, Regeln, Bildfehler, Plan, Learnings, Entscheidungen, Hooks und Inspiration. Lies und schreibe nur über die CLI, immer mit `--json` und `--actor <dein-name>` (z. B. `cron:jule`, `echo`). Keine Regeln oder Pläne mehr in Markdown-Dateien pflegen.

## Morgenlauf pro Account

1. `vibeshorts metrics pull --account <id> --actor cron:<id> --json`. Läuft schon ein Abruf, wartet der Aufruf und nutzt ihn mit. Fehler im Abruf stoppen den Lauf nicht.
2. `vibeshorts context --account <id> --actor cron:<id> --json`. Enthält Format mit Version und Renderer-Parametern, aktive Regeln (Format, Account, Brand), Bildfehler, CTA-Regel, Learnings, Entscheidungen, `today`, `upcoming`, `ideas`, `recentPosts` mit Zahlen und `warnings`.
3. Thema: `today` nehmen. Ist `today` leer, selbst wählen und vor der Produktion mit `plan add --account <id> --date <heute> --topic … --rationale …` eintragen. Status während der Arbeit: `plan update <id> --status in_production`.
4. Post bauen nach Format, Regeln und CTA-Regel. Jedes generierte Bild gegen `imageErrors` prüfen.
5. `vibeshorts render --post <ordner>` (oder `--finalize <stem> --zip <name>.zip` für Canvas-Posts).
6. `vibeshorts post register --account <id> --dir <ordner> --delivered`. Verknüpft den Eintrag des Tages und setzt ihn auf „geliefert“.
7. Learnings nur mit Beleg: `learning add --account <id> --statement … --evidence "<Posts und Zahlen>"`.
8. Horizont halten: `plan horizon --account <id>`; freie Tage mit `plan fill --account <id> --weeks 3 --file <json>` füllen (Liste von `{topic, angle, hookDirection, hook, rationale}`). Ohne `--file` plant `fill` aus dem eigenen Ideen-Pool.
9. Lieferung in den Chat wie bisher.

Ist die CLI nicht erreichbar, mit dem letzten bekannten Stand weiterarbeiten und den Fehler in einem Satz melden. Der Morgenlauf fällt nie aus.

## Regeln für Agents

- Exit-Code `3` (`LOCKED`) heißt: Max hat den Eintrag angelegt oder gesperrt. Nicht umgehen, nicht neu anlegen, um ihn zu ersetzen.
- Gewinner (ab 48 h mindestens 2× Median, `metrics.winners`): `hook add --account <id> --text … --mechanism … --winner --post <id>`, danach bis zu drei Varianten mit `hook variant <id>` und als Planeinträge mit `--hook-id`.
- Pivots: `formats version <id> --note "<Begründung>"` und `decision add --pivot --title … --rationale …`.
- Neue Regel aus Max' Feedback: `rules add --account <id> --kind hook --text … --source "Max, <Datum>, Chat"`. Überholte Regel: `rules replace <id>`.
- Links, die Max im Chat schickt: `inspo add <url> --account <id> --note …`. Planeinträge daraus mit `--inspiration <id>`.
- Neuer Account: `accounts add <id> --brand <brand> --name … --handle … --format … --cta engagement`; Charakter mit `characters add <id> --account <id> …`, Referenzbilder mit `characters add-image <id> <pfad>`.
- Mediendateien nie verschieben. Post-Ordner liegen unter `<brand>/<account>/posts/YYYY-MM-DD-<slug>/`.

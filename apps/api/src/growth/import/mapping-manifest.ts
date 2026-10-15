/**
 * Mapping manifest of the website-growth import: every source table/field with its treatment.
 * Returned with each report so the classification is visible next to the counts.
 */
export type Treatment = "übernommen" | "umgewandelt" | "verworfen"

export interface MappingEntry {
  source: string
  target: string
  treatment: Treatment
  note: string
}

const e = (
  source: string,
  target: string,
  treatment: Treatment,
  note = ""
): MappingEntry => ({ source, target, treatment, note })

export const MAPPING: MappingEntry[] = [
  // sites.json
  e("sites.json <key>", "projects.id", "übernommen", "Site-Key = Projekt-ID"),
  e(
    "sites.json name, url, language, repo, workspace",
    "projects.*",
    "übernommen",
    "bestehende Projekte: nur leere Felder ergänzt"
  ),
  e(
    "sites.json app/stores",
    "projects.kind",
    "umgewandelt",
    "app, wenn app oder stores gesetzt, sonst website; bestehende Projekte behalten ihr kind"
  ),
  e("sites.json seed_keywords", "projects.config.seedKeywords", "umgewandelt"),
  e(
    "sites.json coolify_app",
    "projects.config.coolifyApp",
    "umgewandelt",
    "Deploy-Referenz"
  ),
  e("sites.json app.repo", "projects.config.appRepo", "umgewandelt"),
  e("sites.json url", "channels <id>-web (website)", "umgewandelt"),
  e(
    "sites.json stores.app_store.app_id",
    "channels <id>-ios external_id",
    "umgewandelt"
  ),
  e(
    "sites.json stores.google_play.package",
    "channels <id>-android external_id",
    "umgewandelt"
  ),
  e(
    "sites.json url + health_path",
    "collectors health {url, path}",
    "umgewandelt",
    "eingeschaltet (lief stündlich)"
  ),
  e(
    "sites.json url + key_paths + audit_ignore",
    "collectors audit {url, keyPaths, ignore}",
    "umgewandelt",
    "eingeschaltet"
  ),
  e(
    "sites.json gsc_property",
    "collectors gsc {property}",
    "umgewandelt",
    "eingeschaltet, wenn gesetzt"
  ),
  e(
    "sites.json ga4_property + ga_event_params",
    "collectors ga4 {property, eventParams}",
    "umgewandelt",
    "eingeschaltet, wenn gesetzt"
  ),
  e(
    "sites.json url",
    "collectors bing {url mit /}, psi {url}",
    "umgewandelt",
    "eingeschaltet"
  ),
  e(
    "sites.json app.* (ga4_property, firebase_project, funnel_events, key_events, event_dimensions, user_dimensions)",
    "collectors app",
    "umgewandelt",
    "eingeschaltet nur mit app.ga4_property"
  ),
  e(
    "sites.json stores.google_play {package, gcs_bucket}",
    "collectors play {package, gcsBucket}",
    "umgewandelt",
    "eingeschaltet, wenn gcs_bucket gesetzt"
  ),
  e(
    "sites.json stores.app_store {app_id, provider_id, asc_profile}",
    "collectors asc {appId, providerId, profile}",
    "umgewandelt",
    "eingeschaltet nur mit asc_profile"
  ),
  e(
    "Collector-Felder ohne configSchema-Eintrag",
    "projects.config.collectorExtras.<collector>",
    "umgewandelt",
    "z. B. app.event_dimensions, solange der Collector sie nicht kennt"
  ),
  e(
    "sites.json brand_patterns, brand_patterns_ambiguous, brand_context",
    "collectors geo-chatgpt",
    "umgewandelt",
    "eingeschaltet, wenn ai_prompts vorhanden"
  ),
  e(
    "sites.json ai_prompts",
    "geo_questions (aktiv)",
    "umgewandelt",
    "Identität (Projekt, Text)"
  ),
  // growth.db
  e(
    "runs (health, audit)",
    "collector_runs health/audit",
    "umgewandelt",
    "source_key wg:runs:<id>; ts lokale Zeit → ISO UTC; summary-JSON → stats"
  ),
  e(
    "runs (collect)",
    "collector_runs je Quelle (gsc, ga4, bing, psi, play, app)",
    "umgewandelt",
    "ein Lauf je Quelle aus summary.out, Fehler per Präfix zugeordnet; source_key wg:runs:<id>:<collector>"
  ),
  e(
    "runs (ai-check mit chatgpt-web)",
    "collector_runs geo-chatgpt",
    "umgewandelt"
  ),
  e(
    "runs (ai-check nur exa/OpenRouter)",
    "—",
    "verworfen",
    "Engines ohne Gegenstück, erzeugten keine Daten"
  ),
  e(
    "runs (ai-reparse)",
    "—",
    "verworfen",
    "Neuauswertung, keine Erhebung; Ergebnis steckt in ai_checks"
  ),
  e("runs (collect ohne Quelle)", "—", "verworfen", "leerer Lauf"),
  e(
    "runs (audit) + summary.pages",
    "audit_runs",
    "umgewandelt",
    "source_key wg:runs:<id>"
  ),
  e(
    "runs (health) summary.home/health/tls_days",
    "kpi_daily health up, latency_ms, tls_days",
    "umgewandelt",
    "letzter Lauf je Tag, nur wenn der Tag fehlt (abgeleitet)"
  ),
  e(
    "audit_issues",
    "audit_issues",
    "umgewandelt",
    "severity warn → warning; nur mit neu angelegtem Lauf"
  ),
  e("audit_pages", "audit_pages", "übernommen", "nur mit neu angelegtem Lauf"),
  e(
    "gsc_totals",
    "kpi_daily gsc clicks, impressions, ctr, position",
    "umgewandelt",
    "Upsert (Messwert)"
  ),
  e("gsc_daily", "search_daily source gsc", "übernommen", "Upsert (Messwert)"),
  e(
    "bing_daily",
    "kpi_daily bing clicks, impressions",
    "umgewandelt",
    "Upsert"
  ),
  e(
    "bing_queries",
    "search_daily source bing, page ''",
    "umgewandelt",
    "ctr = clicks/impressions; Upsert"
  ),
  e(
    "ga_daily sessions",
    "kpi_daily ga4 sessions dims {channel, landing}",
    "umgewandelt",
    "Upsert"
  ),
  e(
    "ga_daily (Tagessumme)",
    "kpi_daily ga4 sessions, engaged, key_events dims ''",
    "umgewandelt",
    "Summe je Tag, nur wenn der Tag fehlt (Collector schreibt exakte Tageswerte)"
  ),
  e(
    "ga_daily users",
    "kpi_daily ga4 users dims ''",
    "umgewandelt",
    "nur an Tagen mit genau einer Zeile; sonst verworfen (Nutzer nicht addierbar)"
  ),
  e(
    "ga_daily engaged/key_events/users je Kanal×Einstieg",
    "—",
    "verworfen",
    "§7.1 kennt nur sessions als Aufschlüsselung"
  ),
  e("ga_events", "kpi_daily ga4 event:<name>", "umgewandelt", "Upsert"),
  e(
    "ga_event_params",
    "kpi_daily ga4 event:<event> dims {param, value}",
    "umgewandelt",
    "Upsert"
  ),
  e(
    "psi",
    "kpi_daily psi performance, seo, accessibility, best_practices, lcp_ms, cls, tbt_ms dims {strategy, url}",
    "umgewandelt",
    "url wie der TS-Collector: ohne / am Ende + /; Upsert"
  ),
  e("psi.field", "—", "verworfen", "CrUX-Kategorien (Text), keine Kennzahl"),
  e(
    "store_daily google_play installs_overview",
    "kpi_daily play installs (Daily User Installs), uninstalls (Daily User Uninstalls), active_installs (Active Device Installs)",
    "umgewandelt",
    "Upsert"
  ),
  e(
    "store_daily installs_overview Geräte-/Ereigniszahlen",
    "—",
    "verworfen",
    "Daily Device Installs/Uninstalls/Upgrades, Install/Uninstall/Update events, Total User Installs: vom Play-Collector nicht erhoben"
  ),
  e(
    "store_daily store_performance_traffic_source",
    "kpi_daily play installs/store_visits dims {source, utm_source, utm_campaign}",
    "umgewandelt",
    "Store listing acquisitions → installs, visitors → store_visits; Search term summiert (wie Play-Collector)"
  ),
  e(
    "store_daily store_performance_country",
    "kpi_daily play installs/store_visits dims {country} + store_acquisitions/store_visits dims ''",
    "umgewandelt",
    "Tagessumme über Länder (wie Play-Collector)"
  ),
  e(
    "store_daily app_store / andere Berichte",
    "—",
    "verworfen",
    "keine Abbildung definiert, gemeldet"
  ),
  e(
    "store_daily.app",
    "channels <id>-android/-ios",
    "umgewandelt",
    "Kanal statt Paketname"
  ),
  e(
    "app_daily",
    "kpi_daily app active_users, new_users dims {platform} + Tagessumme",
    "umgewandelt",
    "Tagessumme nur, wenn der Tag fehlt"
  ),
  e(
    "app_events",
    "kpi_daily app event:<name> dims {platform} + Tagessumme",
    "umgewandelt",
    "users je Event verworfen (keine §7.1-Metrik)"
  ),
  e(
    "app_retention",
    "kpi_daily app retention_d1/d7/d28 + cohort_users am Kohortenstart",
    "umgewandelt",
    "cohort/cohort_end/updated verworfen (aus Datum ableitbar)"
  ),
  e(
    "ai_checks",
    "geo_checks über GeoService.recordChecks (+ mention_targets)",
    "umgewandelt",
    "Frage per Text; nur neue (Projekt, Frage, Datum, Engine); source_key wg:ai_checks:…"
  ),
  e("ai_checks.meta.in_sources", "geo_checks.in_sources", "umgewandelt"),
  e(
    "ai_checks.evidence (Liste)",
    "geo_checks.evidence (erster Pfad) + meta.evidenceFiles",
    "umgewandelt"
  ),
  e("ai_checks.ts", "geo_checks.meta.checkedAt", "umgewandelt"),
  e(
    "ai_checks.excerpt",
    "geo_checks.answer nur ohne answer",
    "umgewandelt",
    "sonst verworfen (Anfang der Antwort)"
  ),
  e(
    "ai_checks.citations",
    "—",
    "verworfen",
    "Domains aus cited_urls, ableitbar"
  ),
  e(
    "ai_checks.prompt ohne ai_prompts-Eintrag",
    "geo_questions inaktiv",
    "umgewandelt"
  ),
  e(
    "actions",
    "changes",
    "umgewandelt",
    "kind: deploy→deploy, indexing→seo, analytics/tracking/config/cron→config, content→content, store→store, tooling/system/measure→other; date = lokales Datum aus ts; exp_id → experiment_id"
  ),
  e(
    "experiments",
    "experiments",
    "umgewandelt",
    "pages[0] → target; status done → evaluated; result {before, after} → {baseline, after, change}; baseline_days = eval_days"
  ),
  // workspace + README
  e(
    "<workspace>/backlog.md Tabellenzeilen/Checkboxen",
    "backlog_items",
    "umgewandelt",
    "Status aus Status-Spalte, Checkbox oder Abschnitt Erledigt (wartet auf Max → open); effort/impact aus klein/mittel/groß, sonst 2; kind per Stichwortregel; Text, Warum, Status-Text, Datum in detail; Beleg → done_ref"
  ),
  e(
    "<workspace>/backlog.md Ausgangslage, Strategievorschlag, Wochenlauf-Notizen",
    "—",
    "verworfen",
    "keine Aufgaben, bleiben in der Datei"
  ),
  e(
    "<workspace>/posts/ideas.md",
    "content_items",
    "umgewandelt",
    "idee/freigegeben/entwurf/abnahme/veröffentlicht → idea/approved/draft/review/live; (Tool) → landing; draft_path nur bei vorhandener posts/<slug>.md"
  ),
  e(
    "<workspace>/AGENTS.md (Strategie)",
    "projects.workspace (Verweis)",
    "verworfen",
    "freigegebene Strategie bleibt Datei"
  ),
  e(
    "<workspace>/reports, research",
    "projects.workspace (Verweis)",
    "verworfen",
    "Berichte und Rohdaten bleiben Dateien"
  ),
  e(
    "README.md ## Learnings",
    "learnings",
    "umgewandelt",
    "Scope brand=<Site> wenn als Projekt bekannt, alle → global; evidence = Sätze mit Belegsignal, sonst Verweis auf den README-Eintrag; source Website-Growth README"
  ),
]

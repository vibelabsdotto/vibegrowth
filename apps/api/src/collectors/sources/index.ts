/**
 * Collector sources (TS port of website-growth/scripts/growth.py). Pure functions without Nest or
 * DB access; the CollectorsModule wraps each entry as a provider and writes the returned rows
 * through the growth services (CONTRACT §7.2).
 */
import { auditCollector } from './audit.js';
import { bingCollector } from './bing.js';
import { ga4Collector } from './ga4.js';
import { gscCollector } from './gsc.js';
import { healthCollector } from './health.js';
import { psiCollector } from './psi.js';
import { appCollector } from './app.js';
import { ascCollector } from './asc.js';
import { playCollector } from './play.js';
import type { SourceCollector } from './types.js';

export * from './types.js';
export { collectAudit, type AuditConfig } from './audit.js';
export { collectBing, bingApi, bingDate, type BingConfig } from './bing.js';
export { collectGa4, type Ga4Config } from './ga4.js';
export { collectGsc, type GscConfig } from './gsc.js';
export { collectHealth, tlsDaysLeft, type HealthConfig } from './health.js';
export { collectPsi, psiRun, type PsiConfig } from './psi.js';
export { collectApp, appSetup, normaliseProperty, retentionCohorts, type AppConfig, type AppSetupResult } from './app.js';
export { collectAsc, checkAsc, ASC_NO_PROFILE, type AscConfig, type AscCheck } from './asc.js';
export { collectPlay, checkPlay, decodeExport, parseCsv, type PlayConfig, type PlayCheck } from './play.js';
export { collectGeoChatgpt, analyseAnswer, brandMatcher, ownUrlKind, GEO_ENGINE, type GeoConfig, type GeoRunInput } from './geo.js';
export { parseChatgptConversation, cleanUrl, EngineBlocked, PromptFailed } from './chatgpt.js';
export { keywordSuggestions, sitemapSubmit, bingSubmit, type KeywordsResult, type SitemapStatus, type BingSubmitResult } from './search-actions.js';
export { serviceAccountToken, playCredentialsPath, GCS_SCOPE } from './service-account.js';
export { googleAccessToken, googleApi, GOOGLE_CLIENT_FILE, GOOGLE_TOKEN_FILE } from './google-auth.js';
export { httpFetch, UA, BROWSER_UA, type HttpResponse, type HttpOptions } from './http.js';

/** All stable sources, keyed by collector id (CONTRACT §7.2). */
export const SOURCE_COLLECTORS = {
  health: healthCollector,
  audit: auditCollector,
  gsc: gscCollector,
  ga4: ga4Collector,
  bing: bingCollector,
  psi: psiCollector,
  app: appCollector,
  play: playCollector,
  asc: ascCollector,
} as const satisfies Record<string, SourceCollector<never>>;

export type SourceCollectorId = keyof typeof SOURCE_COLLECTORS;

/**
 * Collector `health`: port of growth.py `cmd_health` (uptime, health endpoint, sitemap/robots,
 * TLS days left, http:// and www. redirects). KPI (CONTRACT §7.1): `up`, `tls_days`, `latency_ms`.
 */
import tls from 'node:tls';
import {
  dimsKey,
  errorMessage,
  finish,
  requireString,
  resolveToday,
  rstripSlash,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type KpiRow,
  type SourceCollector,
} from './types.js';
import { BROWSER_UA, hostnameOf, httpFetch } from './http.js';

export interface HealthConfig {
  url: string;
  path?: string | null;
  tlsMinDays?: number;
  slowSeconds?: number;
}

export const id = 'health';
export const label = 'Erreichbarkeit (Health)';
export const channelKinds: ChannelKind[] = ['website'];
export const configSchema: ConfigSchema = {
  url: { description: 'Basis-URL der Website (kanonischer Origin, z. B. https://chrono-app.net)', required: true, type: 'string' },
  path: { description: 'Pfad des Health-Endpunkts, muss HTTP 200 liefern (z. B. /api/health)', required: false, type: 'string' },
  tlsMinDays: { description: 'Alarm, wenn das TLS-Zertifikat weniger Tage gültig ist', required: false, type: 'number', default: 14 },
  slowSeconds: { description: 'Alarm, wenn die Startseite länger lädt (Sekunden)', required: false, type: 'number', default: 3 },
};

/** Days until the certificate expires (floor, like Python timedelta.days), null on any TLS/network error. */
export function tlsDaysLeft(host: string, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const end = (v: number | null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    const socket = tls.connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const exp = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
      end(Number.isFinite(exp) ? Math.floor((exp - Date.now()) / 86_400_000) : null);
    });
    socket.on('error', () => end(null));
    socket.on('timeout', () => end(null));
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function collectHealth(config: HealthConfig, ctx: CollectorContext): Promise<CollectorResult> {
  const today = resolveToday(ctx);
  const f = ctx.fetch ?? fetch;
  let base: string;
  let host: string | null;
  try {
    base = rstripSlash(requireString(config as unknown as Record<string, unknown>, 'url', 'health'));
    host = hostnameOf(base);
    if (!host) throw new Error(`health: ungültige url ${base}`);
  } catch (e) {
    return finish({ kpi: [], summary: errorMessage(e), stats: {}, errors: [errorMessage(e)] });
  }
  const tlsMin = config.tlsMinDays ?? 14;
  const slow = config.slowSeconds ?? 3;
  const alerts: string[] = [];
  const info: Record<string, unknown> = {};

  const home = await httpFetch(`${base}/`, { ua: BROWSER_UA }, f);
  info.home = [home.status, r2(home.elapsed)];
  if (home.status !== 200) alerts.push(`homepage HTTP ${home.status}`);
  else if (home.elapsed > slow) alerts.push(`homepage slow: ${home.elapsed.toFixed(1)}s`);

  let healthOk = true;
  if (config.path) {
    const p = config.path.startsWith('/') ? config.path : `/${config.path}`;
    const h = await httpFetch(base + p, {}, f);
    info.health = h.status;
    healthOk = h.status === 200;
    if (!healthOk) alerts.push(`health endpoint HTTP ${h.status}`);
  }
  for (const p of ['/sitemap.xml', '/robots.txt']) {
    const r = await httpFetch(base + p, {}, f);
    info[p] = r.status;
    if (r.status !== 200) alerts.push(`${p} HTTP ${r.status}`);
  }
  const days = await tlsDaysLeft(host);
  info.tls_days = days;
  if (days === null || days < tlsMin) alerts.push(`TLS certificate: ${days === null ? 'None' : days} days left`);
  for (const variant of [`http://${host}/`, `https://www.${host}/`]) {
    const r = await httpFetch(variant, { follow: false }, f);
    const loc = r.headers['location'] ?? '';
    info[variant] = [r.status, loc];
    if (![301, 302, 307, 308].includes(r.status) || !rstripSlash(loc).startsWith(base)) {
      alerts.push(`${variant} -> ${r.status} ${loc || '(no redirect)'} (expected redirect to ${base})`);
    }
  }

  const up = home.status === 200 && healthOk ? 1 : 0;
  const kpi: KpiRow[] = [
    { source: 'health', date: today, metric: 'up', dims: dimsKey(), value: up },
    { source: 'health', date: today, metric: 'latency_ms', dims: dimsKey(), value: Math.round(home.elapsed * 1000) },
  ];
  if (days !== null) kpi.push({ source: 'health', date: today, metric: 'tls_days', dims: dimsKey(), value: days });

  const summary = alerts.length
    ? `ALERT ${alerts.join('; ')}`
    : `OK: home ${home.status} in ${r2(home.elapsed)}s, TLS ${days}d`;
  // growth.py: run ok = no alerts. `up` only reflects homepage + health endpoint (Ampel rot bei up=0).
  return finish({ kpi, summary, stats: { up, alerts, ...info }, errors: alerts });
}

export const healthCollector: SourceCollector<HealthConfig> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectHealth,
};

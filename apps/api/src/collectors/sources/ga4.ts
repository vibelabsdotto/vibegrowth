/**
 * Collector `ga4`: port of the GA4 part of growth.py `cmd_collect` plus GA4 event parameters
 * from store_attribution.py `collect_ga_params`.
 * KPI (dims ''): sessions, users, engaged, key_events, event:<name> per day.
 * Breakdowns: sessions by {"channel","landing"}; event:<name> by {"param","value"} for configured params.
 * Window like growth.py: start = yesterday - (days - 1), end = today (today is partial, re-collected later).
 */
import {
  CollectorError,
  dateWindow,
  dimsKey,
  errorMessage,
  finish,
  requireString,
  type ChannelKind,
  type CollectorContext,
  type CollectorResult,
  type ConfigSchema,
  type KpiRow,
  type SourceCollector,
  resolveToday,
} from './types.js';
import { googleApi } from './google-auth.js';

export interface Ga4Config {
  /** e.g. "properties/558994740" */
  property: string;
  /** Event → parameters (custom dimensions), e.g. {download_click: ["placement"]} */
  eventParams?: Record<string, string[]>;
}

export const id = 'ga4';
export const label = 'Google Analytics 4 (Website)';
export const channelKinds: ChannelKind[] = ['website'];
export const configSchema: ConfigSchema = {
  property: { description: 'GA4-Property, z. B. properties/558994740', required: true, type: 'string', example: 'properties/558994740' },
  eventParams: {
    description: 'Event → Parameter (als Custom Dimension angelegt) für Aufschlüsselungen, z. B. {"download_click":["placement"]}',
    required: false,
    type: 'object',
    default: {},
  },
};

interface GaRow {
  dimensionValues: Array<{ value: string }>;
  metricValues: Array<{ value: string }>;
}

const gaDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export async function collectGa4(config: Ga4Config, ctx: CollectorContext): Promise<CollectorResult> {
  const { start, today } = dateWindow(ctx.days, resolveToday(ctx));
  const kpi: KpiRow[] = [];
  const errors: string[] = [];
  const stats: Record<string, unknown> = { range: [start, today] };
  const n = { days: 0, sessions: 0, rows: 0, events: 0 };
  let property: string;
  try {
    property = requireString(config as unknown as Record<string, unknown>, 'property', 'ga4');
    if (!/^properties\/\d+$/.test(property)) property = `properties/${property.replace(/^properties\//, '')}`;
  } catch (e) {
    return finish({ kpi, summary: errorMessage(e), stats, errors: [errorMessage(e)] });
  }
  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const dateRanges = [{ startDate: start, endDate: today }];
  const report = async (body: Record<string, unknown>) =>
    (await googleApi<{ rows?: GaRow[] }>('POST', url, { dateRanges, limit: 100000, ...body }, ctx)).rows ?? [];

  // Daily totals (date only: users are de-duplicated correctly, unlike summing the breakdown).
  try {
    const rows = await report({
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
    });
    const names = ['sessions', 'users', 'engaged', 'key_events'];
    for (const r of rows) {
      const date = gaDate(r.dimensionValues[0].value);
      r.metricValues.forEach((m, i) => kpi.push({ source: 'ga4', date, metric: names[i], dims: dimsKey(), value: Number(m.value) }));
    }
    n.days = stats.days = rows.length;
    n.sessions = stats.sessions = rows.reduce((a, r) => a + Number(r.metricValues[0].value), 0);
  } catch (e) {
    errors.push(`ga4 totals: ${errorMessage(e)}`);
    // Missing/invalid access: every further report would fail the same way.
    if (e instanceof CollectorError && e.code === 'CONFIG') {
      return finish({ kpi, window: { from: start, to: today }, summary: errors[0], stats, errors });
    }
  }

  // Sessions by channel × landing page (growth.py ga_daily).
  try {
    const rows = await report({
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }, { name: 'landingPage' }],
      metrics: [{ name: 'sessions' }],
    });
    for (const r of rows) {
      const [d, channel, landing] = r.dimensionValues.map((x) => x.value);
      kpi.push({ source: 'ga4', date: gaDate(d), metric: 'sessions', dims: dimsKey({ channel, landing }), value: Number(r.metricValues[0].value) });
    }
    n.rows = stats.rows = rows.length;
  } catch (e) {
    errors.push(`ga4 channel/landing: ${errorMessage(e)}`);
  }

  // Event counts per day (growth.py ga_events).
  try {
    const rows = await report({ dimensions: [{ name: 'date' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }] });
    for (const r of rows) {
      const [d, ev] = r.dimensionValues.map((x) => x.value);
      kpi.push({ source: 'ga4', date: gaDate(d), metric: `event:${ev}`, dims: dimsKey(), value: Number(r.metricValues[0].value) });
    }
    n.events = stats.events = rows.length;
  } catch (e) {
    errors.push(`ga4 events: ${errorMessage(e)}`);
  }

  // Event parameters (store_attribution.py ga_event_params).
  const params: Record<string, number> = {};
  for (const [event, names] of Object.entries(config.eventParams ?? {})) {
    for (const param of names ?? []) {
      try {
        const rows = await report({
          dimensions: [{ name: 'date' }, { name: `customEvent:${param}` }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: event } } },
        });
        for (const r of rows) {
          const [d, value] = r.dimensionValues.map((x) => x.value);
          kpi.push({ source: 'ga4', date: gaDate(d), metric: `event:${event}`, dims: dimsKey({ param, value }), value: Number(r.metricValues[0].value) });
        }
        params[`${event}.${param}`] = rows.length;
      } catch (e) {
        errors.push(`ga4 ${event}.${param}: ${errorMessage(e)}`);
      }
    }
  }
  stats.event_params = params;

  const summary = errors.length
    ? `GA4 ${start}–${today}: ${errors.length} Fehler (${errors.join('; ').slice(0, 200)})`
    : `GA4 ${start}–${today}: ${n.sessions} Sitzungen an ${n.days} Tagen, ${n.rows} Kanal×Einstieg-Zeilen, ${n.events} Event-Zeilen`;
  return finish({ kpi, window: { from: start, to: today }, summary, stats, errors });
}

export const ga4Collector: SourceCollector<Ga4Config> = {
  id,
  label,
  channelKinds,
  configSchema,
  collect: collectGa4,
};

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { MacroCalendarEvent } from '@/lib/macro-news';

export interface HistoricalNewsRelease {
  currency: string;
  eventKey: string;
  eventTitle: string;
  eventTimestamp: string;
  actual: string;
  forecast: string;
  previous: string | null;
  actualCategory: 'ABOVE_EXPECTATIONS' | 'IN_LINE' | 'BELOW_EXPECTATIONS';
  source: string;
}

let client: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url.startsWith('https://') || !key || url === 'MY_SUPABASE_URL' || key.startsWith('MY_SUPABASE_')) {
    client = null;
    return null;
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function normalizeHistoricalEventKey(title: string): string {
  return title.toLowerCase()
    .replace(/\bmonth\s*[- ]?over\s*[- ]?month\b/g, 'mom')
    .replace(/\bm\s*\/\s*m\b/g, 'mom')
    .replace(/\byear\s*[- ]?over\s*[- ]?year\b/g, 'yoy')
    .replace(/\by\s*\/\s*y\b/g, 'yoy')
    .replace(/\bquarter\s*[- ]?over\s*[- ]?quarter\b/g, 'qoq')
    .replace(/\bq\s*\/\s*q\b/g, 'qoq')
    .replace(/\b(preliminary|prelim|flash|final|revised)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function category(actual: string, forecast: string): HistoricalNewsRelease['actualCategory'] | null {
  const parse = (raw: string) => {
    const match = raw.trim().match(/^[$€£¥]?([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([%KMBTkmbt]*)$/);
    if (!match) return null;
    return { value: Number(match[1].replace(/,/g, '')), unit: (match[2] || '').toUpperCase() };
  };
  const a = parse(actual);
  const f = parse(forecast);
  if (!a || !f || a.unit !== f.unit) return null;
  const delta = a.value - f.value;
  return Math.abs(delta) < 1e-8 ? 'IN_LINE' : delta > 0 ? 'ABOVE_EXPECTATIONS' : 'BELOW_EXPECTATIONS';
}

export async function recordHistoricalNewsRelease(event: MacroCalendarEvent): Promise<boolean> {
  const actual = event.actual?.trim() || '';
  const forecast = event.forecast?.trim() || '';
  const actualCategory = category(actual, forecast);
  if (!actual || !forecast || !actualCategory || !event.timestampUtcMs) return false;
  const db = getClient();
  if (!db) return false;

  const row = {
    currency: event.currency.toUpperCase(),
    event_key: normalizeHistoricalEventKey(event.title),
    event_title: event.title,
    event_timestamp: new Date(event.timestampUtcMs).toISOString(),
    actual_value: actual,
    forecast_value: forecast,
    previous_value: event.previous?.trim() || null,
    actual_category: actualCategory,
    source: event.dataOrigin || 'calendar',
  };
  const { error } = await db.from('historical_news_releases')
    .upsert(row, { onConflict: 'currency,event_key,event_timestamp' });
  if (error) {
    // Historical storage is additive: an unapplied migration or unavailable DB
    // must never prevent normal prediction evaluation.
    console.warn('Historical news release archive write skipped:', error.message);
    return false;
  }
  return true;
}

export async function getHistoricalNewsReleaseContext(
  currency: string,
  title: string,
  beforeTimestampMs: number,
  limit = 12
): Promise<{ count: number; promptBlock: string } | null> {
  const db = getClient();
  if (!db) return null;
  const key = normalizeHistoricalEventKey(title);
  if (!key) return null;

  const { data, error } = await db.from('historical_news_releases')
    .select('event_title,event_timestamp,actual_value,forecast_value,actual_category,source')
    .eq('currency', currency.toUpperCase())
    .eq('event_key', key)
    .lt('event_timestamp', new Date(beforeTimestampMs).toISOString())
    .order('event_timestamp', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)));

  if (error) {
    console.warn('Historical news release lookup skipped:', error.message);
    return null;
  }
  const rows = data || [];
  if (!rows.length) return { count: 0, promptBlock: '' };

  const lines = rows.map((row: any) =>
    `- ${String(row.event_timestamp).slice(0, 10)}: actual ${row.actual_value}, forecast ${row.forecast_value}, result ${row.actual_category} (source: ${row.source || 'calendar'})`
  );
  const counts = rows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.actual_category] = (acc[row.actual_category] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join('; ');
  return {
    count: rows.length,
    promptBlock: [
      `HISTORICAL RELEASES FOR THE SAME INDICATOR (${rows.length} archived observations; actual-vs-consensus only, not market-reaction statistics):`,
      ...lines,
      `Observed outcome mix in this small archive: ${summary}.`,
      'Treat this as descriptive context only. The sample may be small and does not establish causation or predict the next release.',
    ].join('\n'),
  };
}

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { NewsPredictionRecord, NewsPredictionV1 } from '@/lib/news-prediction';

let client: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url.startsWith('https://') || !key || url === 'MY_SUPABASE_URL' || key.startsWith('MY_SUPABASE_')) {
    client = null;
    return null;
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function mapRow(row: any): NewsPredictionRecord {
  return {
    id: String(row.id),
    eventFingerprint: String(row.event_fingerprint),
    eventId: String(row.event_id),
    eventTitle: String(row.event_title),
    eventTimestamp: String(row.event_timestamp),
    version: Number(row.version),
    prediction: row.prediction_json as NewsPredictionV1,
    evidenceSnapshot: (row.evidence_snapshot || {}) as Record<string, unknown>,
    generatedAt: String(row.generated_at),
    lockedAt: row.locked_at ? String(row.locked_at) : null,
    status: row.status,
  };
}

export async function listNewsPredictions(limit = 60): Promise<NewsPredictionRecord[]> {
  const db = getClient();
  if (!db) throw new Error('News prediction storage is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY), then run supabase/news-predictions.sql.');
  const { data, error } = await db.from('news_predictions').select('*')
    .order('generated_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`Unable to load news predictions: ${error.message}`);
  return (data || []).map(mapRow);
}

export async function createNewsPredictionVersion(input: {
  eventFingerprint: string;
  eventId: string;
  eventTitle: string;
  eventTimestamp: string;
  prediction: NewsPredictionV1;
  evidenceSnapshot: Record<string, unknown>;
}): Promise<NewsPredictionRecord> {
  const db = getClient();
  if (!db) throw new Error('News prediction storage is not configured. Run supabase/news-predictions.sql and configure Supabase environment variables.');
  const { data: latest, error: latestError } = await db.from('news_predictions')
    .select('version').eq('event_fingerprint', input.eventFingerprint)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw new Error(`Unable to check prediction version: ${latestError.message}`);
  const version = Number(latest?.version || 0) + 1;
  const id = randomUUID();
  const generatedAt = new Date().toISOString();
  const prediction = { ...input.prediction, id, version, generatedAt };
  const row = {
    id,
    event_fingerprint: input.eventFingerprint,
    event_id: input.eventId,
    event_title: input.eventTitle,
    event_timestamp: input.eventTimestamp,
    version,
    prediction_json: prediction,
    evidence_snapshot: input.evidenceSnapshot,
    generated_at: generatedAt,
    locked_at: generatedAt,
    status: 'PREDICTED',
  };
  const { data, error } = await db.from('news_predictions').insert(row).select('*').single();
  if (error) throw new Error(`Unable to save prediction: ${error.message}`);
  return mapRow(data);
}

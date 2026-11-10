import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { NewsPredictionEvaluation } from '@/lib/news-prediction-evaluation';

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

export async function listNewsPredictionEvaluations(predictionIds?: string[]) {
  const db = getClient();
  if (!db) throw new Error('News prediction storage is not configured.');
  let query = db.from('news_prediction_evaluations').select('*').order('evaluated_at', { ascending: false });
  if (predictionIds?.length) query = query.in('prediction_id', predictionIds);
  const { data, error } = await query.limit(100);
  if (error) throw new Error(`Unable to load prediction evaluations: ${error.message}`);
  return (data || []).map((row: any) => ({
    id: String(row.id),
    predictionId: String(row.prediction_id),
    eventFingerprint: String(row.event_fingerprint),
    eventTitle: String(row.event_title),
    actual: String(row.actual_value),
    forecast: String(row.forecast_value),
    actualCategory: row.actual_category,
    predictedCategory: row.predicted_category,
    probabilities: row.probabilities_json,
    brierScore: Number(row.brier_score),
    evaluatedAt: String(row.evaluated_at),
    evaluationMethod: row.evaluation_method,
  }));
}

export async function saveNewsPredictionEvaluation(
  evaluation: Omit<NewsPredictionEvaluation, 'id' | 'evaluatedAt'>
) {
  const db = getClient();
  if (!db) throw new Error('News prediction storage is not configured.');
  const row = {
    id: randomUUID(),
    prediction_id: evaluation.predictionId,
    event_fingerprint: evaluation.eventFingerprint,
    event_title: evaluation.eventTitle,
    actual_value: evaluation.actual,
    forecast_value: evaluation.forecast,
    actual_category: evaluation.actualCategory,
    predicted_category: evaluation.predictedCategory,
    probabilities_json: evaluation.probabilities,
    brier_score: evaluation.brierScore,
    evaluation_method: evaluation.evaluationMethod,
  };
  const { data, error } = await db.from('news_prediction_evaluations')
    .upsert(row, { onConflict: 'prediction_id', ignoreDuplicates: true })
    .select('*').maybeSingle();
  if (error) throw new Error(`Unable to save prediction evaluation: ${error.message}`);
  if (data) return data;
  const { data: existing, error: readError } = await db.from('news_prediction_evaluations')
    .select('*').eq('prediction_id', evaluation.predictionId).single();
  if (readError) throw new Error(`Unable to read saved prediction evaluation: ${readError.message}`);
  return existing;
}

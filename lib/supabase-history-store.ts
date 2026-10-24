import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ChartMarkupData,
  ExecutionCategory,
  KeyPriceLevel,
  SignalHistoryRecord,
  SignalType,
  TradeOutcome,
} from '@/lib/trading-data';

const SUPABASE_TABLE = 'signal_history';
const FALLBACK_FILE_PATH = path.join(os.tmpdir(), 'tracefx-lens-history-v1.json');

interface SupabaseHistoryRow {
  id: string;
  fingerprint: string;
  pair: string;
  timeframe: string;
  signal_type: string;
  execution_category: string;
  current_market_price: string;
  entry_price: string;
  stop_loss: string;
  take_profit_1: string;
  take_profit_2: string;
  take_profit_3: string;
  risk_reward_ratio: string;
  market_structure: string;
  confidence_summary: string;
  entry_trigger_note: string;
  invalidation_condition: string;
  technical_rationale: unknown;
  key_levels: unknown;
  chart_markup: unknown;
  chart_image_url: string | null;
  outcome: string | null;
  outcome_locked_at: string | null;
  created_at: string;
}

let cachedSupabaseClient: SupabaseClient | null | undefined;

function getSupabaseServerClient(): SupabaseClient | null {
  if (cachedSupabaseClient !== undefined) {
    return cachedSupabaseClient;
  }

  const rawUrl = (process.env.SUPABASE_URL || '').trim();
  const rawKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();

  const isValidUrl =
    rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
  const isPlaceholderKey =
    !rawKey ||
    rawKey === 'MY_SUPABASE_SERVICE_ROLE_KEY' ||
    rawKey === 'MY_SUPABASE_ANON_KEY';

  if (!isValidUrl || rawUrl === 'MY_SUPABASE_URL' || isPlaceholderKey) {
    cachedSupabaseClient = null;
    return null;
  }

  cachedSupabaseClient = createClient(rawUrl, rawKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedSupabaseClient;
}

function normalizeSignalType(raw: unknown): SignalType {
  const upper = String(raw || 'HOLD').toUpperCase();
  if (upper === 'BUY') return 'BUY';
  if (upper === 'SELL') return 'SELL';
  return 'HOLD';
}

function normalizeOutcome(raw: unknown): TradeOutcome | null {
  const upper = String(raw || '').toUpperCase();
  if (upper === 'WON') return 'WON';
  if (upper === 'LOST') return 'LOST';
  return null;
}

function rowToRecord(row: SupabaseHistoryRow): SignalHistoryRecord {
  const signalType = normalizeSignalType(row.signal_type);
  const executionCategory: ExecutionCategory =
    signalType === 'HOLD' ? 'Stand Aside' : 'Market Execution';

  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint || ''),
    pair: String(row.pair || 'XAU/USD'),
    timeframe: String(row.timeframe || 'H1'),
    signalType,
    executionCategory,
    currentMarketPrice: String(row.current_market_price || '—'),
    entryPrice: String(row.entry_price || '—'),
    stopLoss: String(row.stop_loss || '—'),
    takeProfit1: String(row.take_profit_1 || '—'),
    takeProfit2: String(row.take_profit_2 || '—'),
    takeProfit3: String(row.take_profit_3 || '—'),
    riskRewardRatio: String(row.risk_reward_ratio || '1 : 2.0'),
    marketStructure: String(row.market_structure || ''),
    confidenceSummary: String(row.confidence_summary || ''),
    entryTriggerNote: String(row.entry_trigger_note || ''),
    invalidationCondition: String(row.invalidation_condition || ''),
    technicalRationale: Array.isArray(row.technical_rationale)
      ? row.technical_rationale.map(String)
      : [],
    keyLevels: Array.isArray(row.key_levels)
      ? (row.key_levels as KeyPriceLevel[])
      : [],
    chartMarkup:
      row.chart_markup && typeof row.chart_markup === 'object'
        ? (row.chart_markup as ChartMarkupData)
        : undefined,
    chartImageUrl: row.chart_image_url ? String(row.chart_image_url) : null,
    outcome: normalizeOutcome(row.outcome),
    outcomeLockedAt: row.outcome_locked_at ? String(row.outcome_locked_at) : null,
    createdAt: row.created_at
      ? String(row.created_at)
      : new Date().toISOString(),
  };
}

function recordToRow(rec: SignalHistoryRecord): SupabaseHistoryRow {
  return {
    id: rec.id,
    fingerprint: rec.fingerprint,
    pair: rec.pair,
    timeframe: rec.timeframe,
    signal_type: rec.signalType,
    execution_category: rec.executionCategory,
    current_market_price: rec.currentMarketPrice,
    entry_price: rec.entryPrice,
    stop_loss: rec.stopLoss,
    take_profit_1: rec.takeProfit1,
    take_profit_2: rec.takeProfit2,
    take_profit_3: rec.takeProfit3,
    risk_reward_ratio: rec.riskRewardRatio,
    market_structure: rec.marketStructure,
    confidence_summary: rec.confidenceSummary,
    entry_trigger_note: rec.entryTriggerNote,
    invalidation_condition: rec.invalidationCondition,
    technical_rationale: rec.technicalRationale,
    key_levels: rec.keyLevels,
    chart_markup: rec.chartMarkup ?? null,
    chart_image_url: rec.chartImageUrl,
    outcome: rec.outcome,
    outcome_locked_at: rec.outcomeLockedAt,
    created_at: rec.createdAt,
  };
}

async function readFallbackFile(): Promise<SignalHistoryRecord[]> {
  try {
    const raw = await fs.readFile(FALLBACK_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SignalHistoryRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeFallbackFile(records: SignalHistoryRecord[]): Promise<void> {
  try {
    const sorted = [...records]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 150);
    await fs.writeFile(FALLBACK_FILE_PATH, JSON.stringify(sorted), 'utf8');
  } catch {
    // Ignore transient tmp write failures
  }
}

/**
 * Merges two snapshots of the same history record while strictly enforcing
 * irreversible outcome permanence: once outcome is 'WON' or 'LOST', it can
 * never revert to null or flip to the opposite value.
 */
export function mergeImmutableRecord(
  existing: SignalHistoryRecord,
  incoming: SignalHistoryRecord
): SignalHistoryRecord {
  const lockedOutcome = existing.outcome ?? incoming.outcome;
  const lockedAt = existing.outcome
    ? existing.outcomeLockedAt
    : incoming.outcome
    ? incoming.outcomeLockedAt || new Date().toISOString()
    : null;

  return {
    ...existing,
    chartImageUrl: existing.chartImageUrl || incoming.chartImageUrl,
    chartMarkup: existing.chartMarkup || incoming.chartMarkup,
    outcome: lockedOutcome,
    outcomeLockedAt: lockedAt,
  };
}

export async function listServerHistory(): Promise<SignalHistoryRecord[]> {
  const localMirror = await readFallbackFile();
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return localMirror.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  try {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(120);

    if (error || !data) {
      return localMirror;
    }

    const remoteRecords = (data as SupabaseHistoryRow[]).map(rowToRecord);
    const byId = new Map<string, SignalHistoryRecord>();
    for (const r of remoteRecords) {
      byId.set(r.id, r);
    }
    for (const loc of localMirror) {
      const prev = byId.get(loc.id);
      byId.set(loc.id, prev ? mergeImmutableRecord(prev, loc) : loc);
    }

    const merged = Array.from(byId.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    await writeFallbackFile(merged);
    return merged;
  } catch {
    return localMirror;
  }
}

export async function upsertServerHistoryRecords(
  incomingList: SignalHistoryRecord[]
): Promise<SignalHistoryRecord[]> {
  if (incomingList.length === 0) {
    return listServerHistory();
  }

  const currentMirror = await readFallbackFile();
  const byId = new Map<string, SignalHistoryRecord>();
  const byFingerprint = new Map<string, SignalHistoryRecord>();

  for (const rec of currentMirror) {
    byId.set(rec.id, rec);
    if (rec.fingerprint) byFingerprint.set(rec.fingerprint, rec);
  }

  const toUpsertSupabase: SignalHistoryRecord[] = [];

  for (const incoming of incomingList) {
    const existingById = byId.get(incoming.id);
    const existingByFp = incoming.fingerprint
      ? byFingerprint.get(incoming.fingerprint)
      : undefined;
    const match = existingById || existingByFp;

    if (match) {
      const merged = mergeImmutableRecord(match, incoming);
      byId.set(merged.id, merged);
      if (merged.fingerprint) byFingerprint.set(merged.fingerprint, merged);
      toUpsertSupabase.push(merged);
    } else {
      byId.set(incoming.id, incoming);
      if (incoming.fingerprint) byFingerprint.set(incoming.fingerprint, incoming);
      toUpsertSupabase.push(incoming);
    }
  }

  const updatedList = Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  await writeFallbackFile(updatedList);

  const supabase = getSupabaseServerClient();
  if (supabase && toUpsertSupabase.length > 0) {
    try {
      // Insert new rows first with ignoreDuplicates so locked Supabase rows are never overwritten
      await supabase
        .from(SUPABASE_TABLE)
        .upsert(toUpsertSupabase.map(recordToRow), {
          onConflict: 'id',
          ignoreDuplicates: true,
        });

      // If any incoming synced item already had a locked outcome from client, apply conditional lock where outcome IS NULL
      for (const item of toUpsertSupabase) {
        if (item.outcome === 'WON' || item.outcome === 'LOST') {
          await supabase
            .from(SUPABASE_TABLE)
            .update({
              outcome: item.outcome,
              outcome_locked_at:
                item.outcomeLockedAt || new Date().toISOString(),
            })
            .eq('id', item.id)
            .is('outcome', null);
        }
      }
    } catch {
      // Fallback mirror already persisted
    }
  }

  return updatedList;
}

export async function lockServerHistoryOutcome(
  id: string,
  outcome: TradeOutcome
): Promise<{
  alreadyLocked: boolean;
  record: SignalHistoryRecord | null;
}> {
  const lockedAt = new Date().toISOString();
  const currentMirror = await readFallbackFile();
  const existingIdx = currentMirror.findIndex((r) => r.id === id);
  let targetRecord: SignalHistoryRecord | null =
    existingIdx >= 0 ? currentMirror[existingIdx] : null;

  // Enforce strict one-way lock in mirror
  if (targetRecord && (targetRecord.outcome === 'WON' || targetRecord.outcome === 'LOST')) {
    return {
      alreadyLocked: true,
      record: targetRecord,
    };
  }

  const supabase = getSupabaseServerClient();
  if (supabase) {
    try {
      const { data: existingRow } = await supabase
        .from(SUPABASE_TABLE)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (existingRow) {
        const mapped = rowToRecord(existingRow as SupabaseHistoryRow);
        if (mapped.outcome === 'WON' || mapped.outcome === 'LOST') {
          if (existingIdx >= 0) {
            currentMirror[existingIdx] = mapped;
          } else {
            currentMirror.unshift(mapped);
          }
          await writeFallbackFile(currentMirror);
          return {
            alreadyLocked: true,
            record: mapped,
          };
        }

        const { data: updatedRow } = await supabase
          .from(SUPABASE_TABLE)
          .update({
            outcome,
            outcome_locked_at: lockedAt,
          })
          .eq('id', id)
          .is('outcome', null)
          .select('*')
          .maybeSingle();

        if (updatedRow) {
          targetRecord = rowToRecord(updatedRow as SupabaseHistoryRow);
        }
      }
    } catch {
      // Proceed to local mirror lock
    }
  }

  if (existingIdx >= 0) {
    const updated: SignalHistoryRecord = {
      ...currentMirror[existingIdx],
      outcome,
      outcomeLockedAt: lockedAt,
    };
    currentMirror[existingIdx] = updated;
    await writeFallbackFile(currentMirror);
    return {
      alreadyLocked: false,
      record: targetRecord ?? updated,
    };
  }

  return {
    alreadyLocked: false,
    record: targetRecord,
  };
}

/**
 * Deletes a single history record by ID from Supabase and the server mirror.
 * Bulk deletion is intentionally disallowed.
 */
export async function deleteServerHistoryRecord(id: string): Promise<boolean> {
  const cleanId = id.trim();
  if (!cleanId) return false;

  const currentMirror = await readFallbackFile();
  const nextMirror = currentMirror.filter((r) => r.id !== cleanId);
  const removedFromMirror = nextMirror.length !== currentMirror.length;
  if (removedFromMirror) {
    await writeFallbackFile(nextMirror);
  }

  let removedFromSupabase = false;
  const supabase = getSupabaseServerClient();
  if (supabase) {
    try {
      const { error } = await supabase
        .from(SUPABASE_TABLE)
        .delete()
        .eq('id', cleanId);
      if (!error) {
        removedFromSupabase = true;
      }
    } catch {
      // Server mirror already updated
    }
  }

  return removedFromMirror || removedFromSupabase;
}


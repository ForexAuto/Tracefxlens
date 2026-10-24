import { NextRequest, NextResponse } from 'next/server';
import type {
  ExecutionCategory,
  SignalHistoryRecord,
  SignalType,
  TradeOutcome,
} from '@/lib/trading-data';
import {
  listServerHistory,
  upsertServerHistoryRecords,
} from '@/lib/supabase-history-store';

function sanitizeIncomingRecord(raw: unknown): SignalHistoryRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id || '').trim();
  if (!id || id.length > 128) return null;

  const sigUpper = String(r.signalType || 'HOLD').toUpperCase();
  const signalType: SignalType =
    sigUpper === 'BUY' ? 'BUY' : sigUpper === 'SELL' ? 'SELL' : 'HOLD';
  const executionCategory: ExecutionCategory =
    signalType === 'HOLD' ? 'Stand Aside' : 'Market Execution';

  const rawOutcome = String(r.outcome || '').toUpperCase();
  const outcome: TradeOutcome | null =
    rawOutcome === 'WON' ? 'WON' : rawOutcome === 'LOST' ? 'LOST' : null;

  return {
    id,
    fingerprint: String(r.fingerprint || '').slice(0, 240),
    pair: String(r.pair || 'XAU/USD').slice(0, 32),
    timeframe: String(r.timeframe || 'H1').slice(0, 16),
    signalType,
    executionCategory,
    currentMarketPrice: String(r.currentMarketPrice || '—').slice(0, 40),
    entryPrice: String(r.entryPrice || '—').slice(0, 40),
    stopLoss: String(r.stopLoss || '—').slice(0, 40),
    takeProfit1: String(r.takeProfit1 || '—').slice(0, 40),
    takeProfit2: String(r.takeProfit2 || '—').slice(0, 40),
    takeProfit3: String(r.takeProfit3 || '—').slice(0, 40),
    riskRewardRatio: String(r.riskRewardRatio || '1 : 2.0').slice(0, 32),
    marketStructure: String(r.marketStructure || '').slice(0, 140),
    confidenceSummary: String(r.confidenceSummary || '').slice(0, 140),
    entryTriggerNote: String(r.entryTriggerNote || '').slice(0, 500),
    invalidationCondition: String(r.invalidationCondition || '').slice(0, 500),
    technicalRationale: Array.isArray(r.technicalRationale)
      ? r.technicalRationale.slice(0, 8).map((s) => String(s).slice(0, 400))
      : [],
    keyLevels: Array.isArray(r.keyLevels)
      ? (r.keyLevels as SignalHistoryRecord['keyLevels']).slice(0, 16)
      : [],
    chartMarkup:
      r.chartMarkup && typeof r.chartMarkup === 'object'
        ? (r.chartMarkup as SignalHistoryRecord['chartMarkup'])
        : undefined,
    chartImageUrl:
      typeof r.chartImageUrl === 'string' && r.chartImageUrl.startsWith('data:image/')
        ? r.chartImageUrl
        : null,
    outcome,
    outcomeLockedAt:
      outcome && typeof r.outcomeLockedAt === 'string'
        ? r.outcomeLockedAt
        : outcome
        ? new Date().toISOString()
        : null,
    createdAt:
      typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt))
        ? r.createdAt
        : new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const records = await listServerHistory();
    return NextResponse.json({ records });
  } catch {
    return NextResponse.json({ records: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawItems: unknown[] = Array.isArray(body?.records)
      ? body.records
      : body?.record
      ? [body.record]
      : [body];

    const sanitized = rawItems
      .slice(0, 50)
      .map(sanitizeIncomingRecord)
      .filter((item: SignalHistoryRecord | null): item is SignalHistoryRecord => item !== null);

    if (sanitized.length === 0) {
      return NextResponse.json(
        { error: 'No valid signal history records provided.' },
        { status: 400 }
      );
    }

    const records = await upsertServerHistoryRecords(sanitized);
    return NextResponse.json({ records });
  } catch {
    return NextResponse.json(
      { error: 'Unable to save signal history record.' },
      { status: 500 }
    );
  }
}

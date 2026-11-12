import type { MacroCalendarEvent } from '@/lib/macro-news';

export type NewsOutcomeDirection =
  | 'ABOVE_EXPECTATIONS'
  | 'IN_LINE'
  | 'BELOW_EXPECTATIONS'
  | 'HAWKISH'
  | 'DOVISH'
  | 'HOLD'
  | 'HIKE'
  | 'CUT'
  | 'STRONGER'
  | 'WEAKER'
  | 'INSUFFICIENT_DATA';

export type NewsMarketBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNCONFIRMED';
export type NewsEvidenceQuality = 'HIGH' | 'MEDIUM' | 'LOW';

export interface NewsPredictionV1 {
  id: string;
  eventId: string;
  eventFingerprint: string;
  eventTitle: string;
  eventTimestampUtcMs: number;
  currency: string;
  version: number;
  outcome: {
    primary: NewsOutcomeDirection;
    probabilities: { positive: number; inline: number; negative: number };
    explanation: string;
  };
  marketReaction: {
    currencyBias?: NewsMarketBias;
    pairBiases?: Array<{ symbol: string; bias: NewsMarketBias }>;
    /** Legacy USD-only fields retained for previously saved v1 forecasts. */
    usd?: NewsMarketBias;
    xauUsd?: NewsMarketBias;
    eurUsd?: NewsMarketBias;
    gbpUsd?: NewsMarketBias;
    usdJpy?: NewsMarketBias;
    explanation: string;
    invalidationConditions: string[];
  };
  tradingPlan: {
    preferredInstruments: string[];
    confirmationConditions: string[];
    entryApproach: string;
    risks: string[];
  };
  evidence: {
    forecast: string | null;
    previous: string | null;
    actualAtGeneration: string | null;
    relevantData: string[];
    missingData: string[];
    quality: NewsEvidenceQuality;
  };
  generatedAt: string;
  modelVersion: string;
  schemaVersion: 1 | 2 | 3;
  selectedInstrument?: string;
  signal?: 'BUY' | 'SELL' | 'NO_TRADE';
  confidencePercent?: number;
  signalReason?: string;
  confirmation?: string;
  invalidation?: string;
  status: 'PREDICTED' | 'RELEASED' | 'EVALUATED';
}

export interface NewsPredictionRecord {
  id: string;
  eventFingerprint: string;
  eventId: string;
  eventTitle: string;
  eventTimestamp: string;
  version: number;
  prediction: NewsPredictionV1;
  evidenceSnapshot: Record<string, unknown>;
  generatedAt: string;
  lockedAt: string | null;
  status: NewsPredictionV1['status'];
}

const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY']);

export function isSupportedNewsHighImpactEvent(event: MacroCalendarEvent): boolean {
  const currency = event.currency.trim().toUpperCase();
  return (
    SUPPORTED_CURRENCIES.has(currency) &&
    event.impact === 'High' &&
    !event.isAllDayOrTentative &&
    !event.actual?.trim() &&
    event.timestampUtcMs > Date.now()
  );
}

/** Backward-compatible alias for callers from the original USD-only release. */
export const isSupportedUsdHighImpactEvent = isSupportedNewsHighImpactEvent;

export function getNewsEventFingerprint(event: MacroCalendarEvent): string {
  const normalizedTitle = event.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const releaseMinute = Math.floor(event.timestampUtcMs / 60_000);
  const currency = event.currency.trim().toUpperCase();
  return `${currency === 'USD' ? 'usd' : currency}:${normalizedTitle}:${releaseMinute}`;
}

function isString(value: unknown, max = 1200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isBias(value: unknown): value is NewsMarketBias {
  return ['BULLISH', 'BEARISH', 'NEUTRAL', 'UNCONFIRMED'].includes(String(value));
}

function isStringArray(value: unknown, maxItems = 8): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((v) => isString(v, 400));
}

export function validateNewsPredictionPayload(
  raw: unknown,
  event: MacroCalendarEvent
): Omit<NewsPredictionV1, 'id' | 'eventId' | 'eventFingerprint' | 'eventTitle' | 'eventTimestampUtcMs' | 'currency' | 'version' | 'generatedAt' | 'modelVersion' | 'schemaVersion' | 'status' | 'evidence'> & {
  evidence?: Partial<NewsPredictionV1['evidence']>;
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, any>;
  const reaction = value.marketReaction || {};
  const currencyBias = reaction.currencyBias || value.currencySignal;
  const supplied = Array.isArray(reaction.pairBiases) ? reaction.pairBiases : Array.isArray(value.pairSignals) ? value.pairSignals : [];
  const expectedPairs = event.affectedPairs.slice(0, 5);
  const expectedSymbols = expectedPairs.map((pair) => pair.symbol);
  const validSupplied = supplied.every((item: any) =>
    item && expectedSymbols.includes(item.symbol) && isBias(item.bias || item.signal)
  );
  if (!isBias(currencyBias) || !validSupplied) return null;
  const pairBiases = expectedPairs.map((pair) => {
    const item = supplied.find((candidate: any) => candidate.symbol === pair.symbol);
    let bias: NewsMarketBias = item ? (item.bias || item.signal) : 'UNCONFIRMED';
    if (!item && currencyBias !== 'UNCONFIRMED' && currencyBias !== 'NEUTRAL') {
      bias = pair.bullishCurrencyEffect === 'UP'
        ? currencyBias
        : currencyBias === 'BULLISH' ? 'BEARISH' : 'BULLISH';
    }
    return { symbol: pair.symbol, bias };
  });
  const direction = currencyBias === 'BULLISH' ? 'ABOVE_EXPECTATIONS'
    : currencyBias === 'BEARISH' ? 'BELOW_EXPECTATIONS' : 'INSUFFICIENT_DATA';
  const probability = { positive: 34, inline: 33, negative: 33 };
  return {
    outcome: {
      primary: direction,
      probabilities: probability,
      explanation: 'Compact AI signal. Review the pair directions and confirm with price action before trading.',
    },
    marketReaction: {
      currencyBias,
      pairBiases,
      explanation: 'Directional pair signals based on the supplied calendar event.',
      invalidationConditions: [],
    },
    tradingPlan: {
      preferredInstruments: pairBiases.filter((item) => item.bias === 'BULLISH' || item.bias === 'BEARISH').map((item) => item.symbol),
      confirmationConditions: [],
      entryApproach: 'Wait for post-release price confirmation; do not enter on the forecast alone.',
      risks: ['News volatility and spread expansion can cause slippage.'],
    },
  };
}

export function buildNewsEvidenceSnapshot(event: MacroCalendarEvent) {
  const relevantData = [
    event.officialOverview,
    event.usualEffect,
    event.whyTradersCare,
    event.surpriseLabel,
  ].filter(Boolean);
  const missingData: string[] = [];
  if (!event.forecast?.trim()) missingData.push('Consensus forecast is unavailable.');
  if (!event.previous?.trim()) missingData.push('Previous release value is unavailable.');
  missingData.push('Live DXY, Treasury yields and market positioning are not supplied by the current calendar feed.');
  const hasConsensus = Boolean(event.forecast?.trim());
  const hasPrevious = Boolean(event.previous?.trim());
  const quality: NewsEvidenceQuality =
    hasConsensus && hasPrevious && relevantData.length >= 3 ? 'MEDIUM' : 'LOW';

  return {
    eventId: event.eventId,
    title: event.title,
    currency: event.currency,
    impact: event.impact,
    timestampUtcMs: event.timestampUtcMs,
    forecast: event.forecast || null,
    previous: event.previous || null,
    actual: event.actual || null,
    unit: event.unit,
    period: event.period,
    officialOverview: event.officialOverview,
    usualEffect: event.usualEffect,
    whyTradersCare: event.whyTradersCare,
    affectedPairs: event.affectedPairs,
    dataOrigin: event.dataOrigin,
    relevantData,
    missingData,
    quality,
    collectedAt: new Date().toISOString(),
  };
}

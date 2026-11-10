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
  currency: 'USD';
  version: number;
  outcome: {
    primary: NewsOutcomeDirection;
    probabilities: { positive: number; inline: number; negative: number };
    explanation: string;
  };
  marketReaction: {
    usd: NewsMarketBias;
    xauUsd: NewsMarketBias;
    eurUsd: NewsMarketBias;
    gbpUsd: NewsMarketBias;
    usdJpy: NewsMarketBias;
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
  schemaVersion: 1;
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

const SUPPORTED_EVENT_PATTERNS = [
  /\bcpi\b|consumer price|core inflation|inflation rate/i,
  /\bpce\b|personal consumption expenditures/i,\n  /\bppi\b|producer price|producer price index/i,
  /non.?farm|nonfarm|payroll|employment change/i,
  /unemployment|jobless claims|initial claims|continuing claims/i,
  /average hourly earnings|wage growth|employment cost/i,
  /fomc|federal funds rate|fed interest rate|federal reserve rate/i,
  /fed chair|federal reserve chair|fomc press conference|fed monetary policy/i,
  /\bgdp\b|gross domestic product/i,
  /retail sales/i,
  /ism manufacturing|ism services|ism non.?manufacturing/i,
];

export function isSupportedUsdHighImpactEvent(event: MacroCalendarEvent): boolean {
  return (
    event.currency.toUpperCase() === 'USD' &&
    event.impact === 'High' &&
    !event.isAllDayOrTentative &&
    !event.actual?.trim() &&
    event.timestampUtcMs > Date.now() &&
    SUPPORTED_EVENT_PATTERNS.some((pattern) => pattern.test(event.title))
  );
}

export function getNewsEventFingerprint(event: MacroCalendarEvent): string {
  const normalizedTitle = event.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const releaseMinute = Math.floor(event.timestampUtcMs / 60_000);
  return `usd:${normalizedTitle}:${releaseMinute}`;
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
  const outcome = value.outcome;
  const reaction = value.marketReaction;
  const plan = value.tradingPlan;
  const probabilities = outcome?.probabilities;
  const isPolicyEvent = /fomc|federal funds rate|fed interest rate|federal reserve rate|fed monetary policy/i.test(event.title);
  const allowedOutcomes = isPolicyEvent
    ? ['HAWKISH', 'DOVISH', 'HOLD', 'HIKE', 'CUT', 'INSUFFICIENT_DATA']
    : ['ABOVE_EXPECTATIONS', 'IN_LINE', 'BELOW_EXPECTATIONS', 'STRONGER', 'WEAKER', 'INSUFFICIENT_DATA'];
  if (
    !outcome ||
    !allowedOutcomes.includes(outcome.primary) ||
    !probabilities ||
    !['positive', 'inline', 'negative'].every((key) => Number.isFinite(probabilities[key]) && probabilities[key] >= 0 && probabilities[key] <= 100) ||
    Math.abs(probabilities.positive + probabilities.inline + probabilities.negative - 100) > 0.01 ||
    !isString(outcome.explanation) ||
    !reaction ||
    !['usd', 'xauUsd', 'eurUsd', 'gbpUsd', 'usdJpy'].every((key) => isBias(reaction[key])) ||
    !isString(reaction.explanation) ||
    !isStringArray(reaction.invalidationConditions) ||
    !plan ||
    !isStringArray(plan.preferredInstruments) ||
    !isStringArray(plan.confirmationConditions) ||
    !isString(plan.entryApproach) ||
    !isStringArray(plan.risks)
  ) return null;

  return {
    outcome: {
      primary: outcome.primary,
      probabilities: {
        positive: probabilities.positive,
        inline: probabilities.inline,
        negative: probabilities.negative,
      },
      explanation: outcome.explanation.trim(),
    },
    marketReaction: {
      usd: reaction.usd,
      xauUsd: reaction.xauUsd,
      eurUsd: reaction.eurUsd,
      gbpUsd: reaction.gbpUsd,
      usdJpy: reaction.usdJpy,
      explanation: reaction.explanation.trim(),
      invalidationConditions: reaction.invalidationConditions,
    },
    tradingPlan: {
      preferredInstruments: plan.preferredInstruments,
      confirmationConditions: plan.confirmationConditions,
      entryApproach: plan.entryApproach.trim(),
      risks: plan.risks,
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

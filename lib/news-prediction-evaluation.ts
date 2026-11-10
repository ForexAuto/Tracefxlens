import type { MacroCalendarEvent } from '@/lib/macro-news';
import type { NewsPredictionRecord } from '@/lib/news-prediction';
import { isInversePolarityIndicator } from '@/lib/macro-news';

export type NewsActualCategory = 'ABOVE_EXPECTATIONS' | 'IN_LINE' | 'BELOW_EXPECTATIONS';

export interface NewsPredictionEvaluation {
  id: string;
  predictionId: string;
  eventFingerprint: string;
  eventTitle: string;
  actual: string;
  forecast: string;
  actualCategory: NewsActualCategory;
  predictedCategory: string;
  probabilities: { positive: number; inline: number; negative: number };
  brierScore: number;
  evaluatedAt: string;
  evaluationMethod: 'ACTUAL_VS_CONSENSUS_V1';
}

function parseComparableValue(raw: string): { value: number; suffix: string } | null {
  const match = raw.trim().match(/^[$€£¥]?([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([%KMBTkmbt]*)$/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return { value, suffix: (match[2] || '').toUpperCase() };
}

export function evaluateNewsPrediction(
  record: NewsPredictionRecord,
  event: MacroCalendarEvent
): Omit<NewsPredictionEvaluation, 'id' | 'evaluatedAt'> | null {
  if (!event.actual?.trim() || !event.forecast?.trim()) return null;
  const actual = parseComparableValue(event.actual);
  const forecast = parseComparableValue(event.forecast);
  if (!actual || !forecast || actual.suffix !== forecast.suffix) return null;

  const delta = actual.value - forecast.value;
  const category: NewsActualCategory = Math.abs(delta) < 1e-8
    ? 'IN_LINE'
    : delta > 0 ? 'ABOVE_EXPECTATIONS' : 'BELOW_EXPECTATIONS';

  const inverse = isInversePolarityIndicator(event.title);
  const outcomeClass = category === 'IN_LINE'
    ? 'inline'
    : ((category === 'ABOVE_EXPECTATIONS') !== inverse ? 'positive' : 'negative');

  const probabilities = record.prediction.outcome.probabilities;
  const target = {
    positive: outcomeClass === 'positive' ? 1 : 0,
    inline: outcomeClass === 'inline' ? 1 : 0,
    negative: outcomeClass === 'negative' ? 1 : 0,
  };
  const brierScore =
    (probabilities.positive / 100 - target.positive) ** 2 +
    (probabilities.inline / 100 - target.inline) ** 2 +
    (probabilities.negative / 100 - target.negative) ** 2;

  return {
    predictionId: record.id,
    eventFingerprint: record.eventFingerprint,
    eventTitle: record.eventTitle,
    actual: event.actual,
    forecast: event.forecast,
    actualCategory: category,
    predictedCategory: record.prediction.outcome.primary,
    probabilities,
    brierScore: Number(brierScore.toFixed(6)),
    evaluationMethod: 'ACTUAL_VS_CONSENSUS_V1',
  };
}

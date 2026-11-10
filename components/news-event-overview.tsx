'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  RotateCcw,
  X,
  ScanLine,
} from 'lucide-react';
import {
  EventAiMacroBrief,
  MacroCalendarEvent,
  formatFullDateTimeInZone,
  formatRelativeCountdown,
} from '@/lib/macro-news';
import { isSupportedUsdHighImpactEvent, getNewsEventFingerprint, type NewsPredictionRecord } from '@/lib/news-prediction';
import type { NewsPredictionEvaluation } from '@/lib/news-prediction-evaluation';

interface NewsEventOverviewProps {
  event: MacroCalendarEvent | null;
  timezone: string;
  nowMs: number;
  aiBrief: EventAiMacroBrief | null;
  isBriefLoading: boolean;
  onRefreshBrief: (event: MacroCalendarEvent) => void;
  onCloseMobile?: () => void;
}

function getImpactTextClass(impact: MacroCalendarEvent['impact']): string {
  switch (impact) {
    case 'High':
      return 'text-rose-400 font-semibold';
    case 'Medium':
      return 'text-amber-400 font-semibold';
    case 'Holiday':
      return 'text-slate-300 font-medium';
    default:
      return 'text-slate-400';
  }
}

function getSurpriseTextClass(
  dir: MacroCalendarEvent['surpriseDirection']
): string {
  switch (dir) {
    case 'bullish':
      return 'text-emerald-400';
    case 'bearish':
      return 'text-rose-400';
    case 'inline':
      return 'text-sky-300';
    default:
      return 'text-slate-400';
  }
}

export function NewsEventOverview({
  event,
  timezone,
  nowMs,
  aiBrief,
  isBriefLoading,
  onRefreshBrief,
  onCloseMobile,
}: NewsEventOverviewProps) {
  const [newsPrediction, setNewsPrediction] = useState<NewsPredictionRecord | null>(null);
  const [newsEvaluation, setNewsEvaluation] = useState<NewsPredictionEvaluation | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setNewsPrediction(null);
    setNewsEvaluation(null);
    setEvaluationLoading(false);
    setPredictionError(null);
    if (!event || event.currency !== 'USD') return () => { active = false; };
    const fingerprint = getNewsEventFingerprint(event);
    fetch(`/api/news/predictions?eventFingerprint=${encodeURIComponent(fingerprint)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load saved prediction.');
        return payload;
      })
      .then((payload) => {
        if (active && Array.isArray(payload.predictions) && payload.predictions.length) {
          const latest = payload.predictions.sort((a: NewsPredictionRecord, b: NewsPredictionRecord) => b.version - a.version)[0];
          setNewsPrediction(latest);
          const evaluation = Array.isArray(payload.evaluations) ? payload.evaluations.find((item: NewsPredictionEvaluation) => item.predictionId === latest.id) : null;
          setNewsEvaluation(evaluation || null);
        }
      })
      .catch((error) => {
        if (active) setPredictionError(error instanceof Error ? error.message : 'Unable to load saved prediction.');
      });
    return () => { active = false; };
  }, [event?.eventId]);

  useEffect(() => {
    if (!event || !newsPrediction || newsPrediction.eventFingerprint !== getNewsEventFingerprint(event) || newsEvaluation || !event.actual?.trim() || !event.forecast?.trim()) return;
    let active = true;
    setEvaluationLoading(true);
    fetch('/api/news/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'evaluate', eventId: event.eventId }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to evaluate released event.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        const current = (payload.evaluations || []).find((item: NewsPredictionEvaluation) => item.predictionId === newsPrediction.id);
        if (current) setNewsEvaluation(current);
      })
      .catch((error) => {
        if (active) setPredictionError(error instanceof Error ? error.message : 'Unable to evaluate released event.');
      })
      .finally(() => {
        if (active) setEvaluationLoading(false);
      });
    return () => { active = false; };
  }, [event?.eventId, event?.actual, event?.forecast, newsPrediction?.id, newsEvaluation?.id]);

  const generateNewsPrediction = async () => {
    if (!event) return;
    setPredictionLoading(true);
    setPredictionError(null);
    try {
      const response = await fetch('/api/news/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.eventId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to generate prediction.');
      setNewsPrediction(payload.prediction as NewsPredictionRecord);
    } catch (error) {
      setPredictionError(error instanceof Error ? error.message : 'Unable to generate prediction.');
    } finally {
      setPredictionLoading(false);
    }
  };

  const evaluateNewsPredictionNow = async () => {
    if (!event || !newsPrediction) return;
    setPredictionLoading(true);
    setPredictionError(null);
    try {
      const response = await fetch('/api/news/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'evaluate', eventId: event.eventId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to evaluate prediction.');
      const current = (payload.evaluations || []).find((item: NewsPredictionEvaluation) => item.predictionId === newsPrediction.id);
      if (current) setNewsEvaluation(current);
      else throw new Error('Evaluation saved, but no result was returned for the selected forecast version.');
    } catch (error) {
      setPredictionError(error instanceof Error ? error.message : 'Unable to evaluate prediction.');
    } finally {
      setPredictionLoading(false);
    }
  };

  if (!event) {
    return (
      <div className="rounded-2xl border border-slate-800/90 bg-[#111726] p-6 text-center">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-slate-200">
          Select a Macroeconomic Release
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Click any calendar row on the left to inspect its official indicator definition, Actual vs. Forecast surprise score, affected pairs, and AI execution playbook.
        </p>
      </div>
    );
  }

  const countdown = formatRelativeCountdown(
    event.timestampUtcMs,
    nowMs,
    event.isAllDayOrTentative
  );
  const fullScheduledStr = formatFullDateTimeInZone(
    event.timestampUtcMs,
    event.isAllDayOrTentative,
    event.rawTimeLabel,
    timezone
  );

  return (
    <div className="rounded-2xl border border-slate-800/90 bg-[#111726] divide-y divide-slate-800/80">
      {/* 1. Header: Unboxed Metadata Kicker + Event Title + Countdown */}
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 tabular-nums">
              <span className="font-[family-name:var(--font-mono)] font-semibold text-white">
                {event.currency}
              </span>
              <span aria-hidden="true">·</span>
              <span>{event.countryName}</span>
              <span aria-hidden="true">·</span>
              <span className={getImpactTextClass(event.impact)}>
                {event.impact === 'Holiday'
                  ? 'Bank Holiday'
                  : `${event.impact} Impact`}
              </span>
              {event.period && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-[family-name:var(--font-mono)] text-slate-300">
                    {event.period}
                  </span>
                </>
              )}
            </div>

            <h2 className="mt-2 font-[family-name:var(--font-display)] text-xl sm:text-2xl font-bold tracking-tight text-white [text-wrap:balance]">
              {event.title}
            </h2>

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 tabular-nums">
              <span className="font-[family-name:var(--font-mono)] text-slate-300">
                {fullScheduledStr}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-[family-name:var(--font-mono)] font-medium ${
                  countdown.isImminent
                    ? 'text-amber-400'
                    : countdown.isPast
                    ? 'text-slate-400'
                    : 'text-sky-400'
                }`}
              >
                {countdown.text}
              </span>
            </div>
          </div>

          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close event overview"
              className="flex min-h-[42px] min-w-[42px] shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#0D1320] text-slate-300 transition-colors hover:border-slate-700 hover:text-white lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Release Figures & Surprise Verdict (Actual · Forecast · Previous) */}
      {event.impact !== 'Holiday' && (
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-200">
              Release Numbers &amp; Surprise Meter
            </span>
            <span
              className={`font-[family-name:var(--font-mono)] font-semibold tabular-nums ${getSurpriseTextClass(
                event.surpriseDirection
              )}`}
            >
              {event.surpriseLabel}
              {event.surpriseDeltaText ? ` · ${event.surpriseDeltaText}` : ''}
            </span>
          </div>

          <div className="mt-3.5 grid grid-cols-3 divide-x divide-slate-800/80 border-y border-slate-800/70 py-3">
            <div className="pr-3">
              <div className="text-[11px] text-slate-500">Actual</div>
              <div
                className={`mt-0.5 font-[family-name:var(--font-mono)] text-base sm:text-lg font-semibold tabular-nums ${
                  !event.actual
                    ? 'text-slate-500'
                    : event.surpriseDirection === 'bullish'
                    ? 'text-emerald-400'
                    : event.surpriseDirection === 'bearish'
                    ? 'text-rose-400'
                    : 'text-white'
                }`}
              >
                {event.actual || 'Pending'}
              </div>
            </div>

            <div className="px-3">
              <div className="text-[11px] text-slate-500">Forecast</div>
              <div className="mt-0.5 font-[family-name:var(--font-mono)] text-base sm:text-lg font-semibold text-slate-200 tabular-nums">
                {event.forecast || '—'}
              </div>
            </div>

            <div className="pl-3">
              <div className="text-[11px] text-slate-500">Previous</div>
              <div className="mt-0.5 font-[family-name:var(--font-mono)] text-base sm:text-lg font-semibold text-slate-300 tabular-nums">
                {event.previous || '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Assisted AI News Prediction */}
      {event.currency === 'USD' && (
        <section className="p-5 sm:p-6 space-y-3" aria-label="AI news prediction">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-100">AI News Prediction</h3>
              <p className="mt-1 text-[11px] text-slate-500">Pre-release economic forecast and market scenarios</p>
            </div>
            <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-300">USD V1</span>
          </div>

          {newsPrediction ? (
            <div className="rounded-xl border border-slate-800 bg-[#0D1320] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{newsPrediction.prediction.outcome.primary.replace(/_/g, ' ')}</span>
                <span className="text-[10px] text-slate-400">Version {newsPrediction.version} · {new Date(newsPrediction.generatedAt).toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Stronger', newsPrediction.prediction.outcome.probabilities.positive],
                  ['In line', newsPrediction.prediction.outcome.probabilities.inline],
                  ['Weaker', newsPrediction.prediction.outcome.probabilities.negative],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-slate-800/60 p-2">
                    <div className="text-[10px] text-slate-400">{label}</div>
                    <div className="mt-0.5 font-mono text-lg font-semibold text-white">{value}%</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Evidence quality</span>
                <span className={newsPrediction.prediction.evidence.quality === 'HIGH' ? 'text-emerald-400' : newsPrediction.prediction.evidence.quality === 'MEDIUM' ? 'text-amber-300' : 'text-rose-300'}>
                  {newsPrediction.prediction.evidence.quality}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-300">{newsPrediction.prediction.outcome.explanation}</p>
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="text-[11px] font-semibold text-slate-200">Expected market reaction</div>
                {([
                  ['USD', newsPrediction.prediction.marketReaction.usd],
                  ['XAU/USD', newsPrediction.prediction.marketReaction.xauUsd],
                  ['EUR/USD', newsPrediction.prediction.marketReaction.eurUsd],
                  ['GBP/USD', newsPrediction.prediction.marketReaction.gbpUsd],
                  ['USD/JPY', newsPrediction.prediction.marketReaction.usdJpy],
                ] as const).map(([symbol, bias]) => (
                  <div key={symbol} className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">{symbol}</span>
                    <span className={bias === 'BULLISH' ? 'text-emerald-400' : bias === 'BEARISH' ? 'text-rose-400' : 'text-slate-300'}>{bias}</span>
                  </div>
                ))}
                <p className="text-xs leading-relaxed text-slate-400">{newsPrediction.prediction.marketReaction.explanation}</p>
              </div>
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="text-[11px] font-semibold text-slate-200">Trading plan</div>
                <p className="text-xs leading-relaxed text-slate-300">{newsPrediction.prediction.tradingPlan.entryApproach}</p>
                <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">
                  {newsPrediction.prediction.tradingPlan.confirmationConditions.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
                <div className="text-[11px] font-semibold text-slate-200">Invalidation</div>
                <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">
                  {newsPrediction.prediction.marketReaction.invalidationConditions.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </div>
              {newsPrediction.prediction.evidence.missingData.length > 0 && (
                <p className="text-[11px] leading-relaxed text-amber-300/90">Data limitations: {newsPrediction.prediction.evidence.missingData.join(' ')}</p>
              )}
              {newsEvaluation && (
                <div className="border-t border-slate-800 pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-200">Post-release evaluation</span>
                    <span className="text-[10px] text-emerald-300">Evaluated</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-slate-800/60 p-2">
                      <div className="text-[10px] text-slate-400">Actual vs consensus</div>
                      <div className="mt-1 text-xs font-semibold text-white">{newsEvaluation.actualCategory.replace(/_/g, ' ')}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{newsEvaluation.actual} actual · {newsEvaluation.forecast} forecast</div>
                    </div>
                    <div className="rounded-lg bg-slate-800/60 p-2">
                      <div className="text-[10px] text-slate-400">Brier score</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-white">{newsEvaluation.brierScore.toFixed(3)}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">Lower is better · 0 is perfect</div>
                    </div>
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-400">Model call: <span className="font-semibold text-slate-200">{newsEvaluation.predictedCategory.replace(/_/g, ' ')}</span></p>
                  <p className="text-[10px] leading-relaxed text-slate-500">This scores the economic release versus consensus, not the resulting price move. Market-reaction accuracy is not yet scored.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-700 bg-[#0D1320] p-4">
              <p className="text-xs leading-relaxed text-slate-400">Generate a forecast from the current calendar evidence. The AI will not invent unavailable market data.</p>
            </div>
          )}

          {predictionError && <p role="alert" className="text-xs leading-relaxed text-rose-300">{predictionError}</p>}
          <button
            type="button"
            disabled={predictionLoading || !isSupportedUsdHighImpactEvent(event)}
            onClick={() => void generateNewsPrediction()}
            className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${predictionLoading ? 'animate-spin' : ''}`} />
            {predictionLoading ? 'Generating forecast...' : newsPrediction ? 'Refresh prediction · save new version' : 'Generate AI prediction'}
          </button>
          {!isSupportedUsdHighImpactEvent(event) && !newsPrediction && (
            <p className="text-[10px] text-slate-500">Available for supported upcoming USD high-impact releases only.</p>
          )}
          {newsPrediction && event.actual?.trim() && event.forecast?.trim() && !newsEvaluation && (
            <button
              type="button"
              disabled={predictionLoading || evaluationLoading}
              onClick={() => void evaluateNewsPredictionNow()}
              className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:opacity-40"
            >
              {predictionLoading || evaluationLoading ? 'Evaluating release...' : 'Evaluate prediction against actual'}
            </button>
          )}
          <p className="text-[10px] leading-relaxed text-slate-500">AI-generated scenario analysis, not a verified win probability or guaranteed trading signal. Forecast versions are stored separately.</p>
        </section>
      )}


      {/* 3. Official Macroeconomic Overview & Specifications */}
      <div className="p-5 sm:p-6 space-y-3.5 text-xs leading-relaxed">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-200">
            Official Indicator Specifications
          </h3>
          <span className="text-[11px] text-slate-500">{event.frequency}</span>
        </div>

        <div>
          <span className="font-semibold text-slate-200">
            What It Measures:{' '}
          </span>
          <span className="text-slate-300">{event.officialOverview}</span>
        </div>

        <div>
          <span className="font-semibold text-slate-200">Usual Effect: </span>
          <span className="text-slate-300">{event.usualEffect}</span>
        </div>

        <div>
          <span className="font-semibold text-slate-200">
            Why Traders Care:{' '}
          </span>
          <span className="text-slate-300">{event.whyTradersCare}</span>
        </div>

        <div>
          <span className="font-semibold text-slate-200">
            Killzone Protocol:{' '}
          </span>
          <span className="text-amber-300/95">{event.killzoneGuidance}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
          <span>
            Source: <span className="text-slate-300">{event.sourceAgency}</span>
          </span>
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-sky-400 transition-colors hover:text-sky-300 whitespace-nowrap"
            >
              <span>Official Agency</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* 4. AI Macro Trading Playbook */}
      <div className="p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-200">
            Macro &amp; CRT Execution Playbook
          </h3>
          <button
            type="button"
            disabled={isBriefLoading}
            onClick={() => onRefreshBrief(event)}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0D1320] px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw
              className={`h-3 w-3 text-sky-400 ${
                isBriefLoading ? 'animate-spin' : ''
              }`}
            />
            <span>{isBriefLoading ? 'Updating...' : 'Refresh Brief'}</span>
          </button>
        </div>

        {isBriefLoading && !aiBrief ? (
          <div className="space-y-2.5 py-1" aria-busy="true">
            <div className="h-3.5 w-11/12 rounded bg-slate-800/80 animate-pulse" />
            <div className="h-3.5 w-full rounded bg-slate-800/70 animate-pulse" />
            <div className="h-3.5 w-5/6 rounded bg-slate-800/70 animate-pulse" />
            <div className="h-3.5 w-4/5 rounded bg-slate-800/60 animate-pulse" />
          </div>
        ) : aiBrief ? (
          <div className="space-y-2.5 text-xs leading-relaxed">
            <p className="font-medium text-slate-100">
              {aiBrief.headlineVerdict}
            </p>
            <div>
              <span className="font-semibold text-emerald-400">
                Hawkish / Beat Scenario:{' '}
              </span>
              <span className="text-slate-300">
                {aiBrief.bullishPrintPlaybook}
              </span>
            </div>
            <div>
              <span className="font-semibold text-rose-400">
                Dovish / Miss Scenario:{' '}
              </span>
              <span className="text-slate-300">
                {aiBrief.bearishPrintPlaybook}
              </span>
            </div>
            <div>
              <span className="font-semibold text-sky-400">
                CRT Post-News Trigger:{' '}
              </span>
              <span className="text-slate-300">{aiBrief.crtExecutionTip}</span>
            </div>
          </div>
        ) : null}
      </div>


      {/* 6. Directly Affected TraceFX Pairs -> 1-Click Analyze Handoff */}
      <div className="p-5 sm:p-6">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-200">
            Directly Affected Pairs
          </h3>
          <span className="text-[11px] text-slate-500">
            Stronger {event.currency} reaction
          </span>
        </div>

        <div className="divide-y divide-slate-800/70">
          {event.affectedPairs.map((pair) => {
            const isUp = pair.bullishCurrencyEffect === 'UP';
            return (
              <div
                key={pair.symbol}
                className="flex min-h-[46px] items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-[family-name:var(--font-mono)] text-xs font-semibold text-white tabular-nums">
                      {pair.symbol}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
                        isUp ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isUp ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" />
                      )}
                      <span>{isUp ? 'Upside' : 'Downside'}</span>
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-slate-500">
                    {pair.relationship}
                  </p>
                </div>

                <Link
                  href={`/?pair=${encodeURIComponent(pair.symbol)}`}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0D1320] px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-200 whitespace-nowrap shrink-0"
                >
                  <ScanLine className="h-3.5 w-3.5 text-sky-400" />
                  <span>Analyze</span>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

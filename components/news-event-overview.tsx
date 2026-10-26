'use client';

import React from 'react';
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

      {/* 5. Directly Affected TraceFX Pairs -> 1-Click Analyze Handoff */}
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

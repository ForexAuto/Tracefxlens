'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  computeGlobalSessionSnapshot,
  SessionClockZone,
} from '@/lib/trading-sessions';

const CLOCK_ZONE_STORAGE_KEY = 'tracefx_lens_clock_zone_v1';

interface TradingSessionHeaderProps {
  selectedPair: string;
}

export function TradingSessionHeader({
  selectedPair,
}: TradingSessionHeaderProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [clockZone, setClockZone] = useState<SessionClockZone>('LOCAL');

  useEffect(() => {
    const bootTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(CLOCK_ZONE_STORAGE_KEY);
        if (saved === 'UTC' || saved === 'LOCAL') {
          setClockZone(saved);
        }
      } catch {
        // Ignore storage read error
      }
      setNowMs(Date.now());
    }, 0);

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearTimeout(bootTimer);
      window.clearInterval(interval);
    };
  }, []);

  const toggleClockZone = () => {
    const nextZone: SessionClockZone = clockZone === 'LOCAL' ? 'UTC' : 'LOCAL';
    setClockZone(nextZone);
    try {
      window.localStorage.setItem(CLOCK_ZONE_STORAGE_KEY, nextZone);
    } catch {
      // Ignore storage write error
    }
  };

  const snapshot = useMemo(() => {
    if (nowMs === null) return null;
    return computeGlobalSessionSnapshot(nowMs, clockZone, selectedPair);
  }, [nowMs, clockZone, selectedPair]);

  const headlineColor =
    snapshot?.stateKind === 'overlap'
      ? 'text-emerald-400'
      : snapshot?.stateKind === 'active'
      ? 'text-sky-400'
      : snapshot?.stateKind === 'weekend'
      ? 'text-amber-300'
      : 'text-slate-200';

  return (
    <div className="mb-4 sm:mb-7 flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-medium text-slate-400">
          Forex · Commodities · Crypto
        </p>
        <h1 className="mt-0.5 font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
          AI Chart Signal &amp; Structure Analysis
        </h1>
      </div>

      {/* Compact At-a-Glance Active Session Readout (Zero Extra Card Footprint) */}
      <div className="flex flex-col gap-0.5 lg:items-end">
        {snapshot ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 lg:justify-end">
              <span className="text-xs font-medium text-slate-400">
                Session
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span
                className={`font-[family-name:var(--font-display)] text-sm sm:text-base font-bold tracking-tight ${headlineColor}`}
              >
                {snapshot.headline}
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="font-[family-name:var(--font-mono)] text-xs font-medium text-slate-300 tabular-nums">
                {snapshot.primaryCountdownLabel}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 lg:justify-end">
              <span>{snapshot.subheadline.split(' · ')[0]}</span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <button
                type="button"
                onClick={toggleClockZone}
                title="Switch between Local time and UTC"
                className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-1.5 -mx-1.5 font-[family-name:var(--font-mono)] text-xs text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-white tabular-nums"
              >
                <Clock className="h-3 w-3 text-sky-400/90" />
                <span>
                  {snapshot.clockLabel} {snapshot.zoneLabel}
                </span>
              </button>
            </div>
          </>
        ) : (
          <div className="h-9 w-56 animate-pulse rounded-lg bg-[#111726]" />
        )}
      </div>
    </div>
  );
}

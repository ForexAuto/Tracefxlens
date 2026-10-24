'use client';

import React, { useEffect, useState } from 'react';
import { Check, Loader2, X, Lock, ImagePlus, Square, ScanLine } from 'lucide-react';
import { motion } from 'motion/react';
import { AnalysisStageItem } from '@/lib/trading-data';

interface AnalysisProgressProps {
  stages: AnalysisStageItem[];
  progressPct: number;
  selectedPair: string;
  selectedTimeframe: string;
  isRejected: boolean;
  isStopped: boolean;
  isCompleting?: boolean;
  onStopAnalysis: () => void;
  onResumeAnalysis: () => void;
  onReplaceChart: () => void;
}

export function AnalysisProgress({
  stages,
  progressPct,
  selectedPair,
  selectedTimeframe,
  isRejected,
  isStopped,
  isCompleting = false,
  onStopAnalysis,
  onResumeAnalysis,
  onReplaceChart,
}: AnalysisProgressProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  // Wall-clock stopwatch — pauses immediately if rejected, stopped, or completed
  useEffect(() => {
    if (isRejected || isStopped || isCompleting) return;
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(timer);
  }, [isRejected, isStopped, isCompleting]);

  const formattedSeconds = (elapsedMs / 1000).toFixed(1);
  const stepOneApproved = stages[0]?.status === 'approved';
  const isActivelyRunning = !isRejected && !isStopped && !isCompleting;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      aria-busy={isActivelyRunning}
      aria-live="polite"
      className={`rounded-2xl border bg-[#111726] ${
        isRejected
          ? 'border-rose-500/35'
          : isStopped
          ? 'border-amber-500/30'
          : 'border-slate-800/90'
      }`}
    >
      {/* Top Progress Header */}
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <span className="font-[family-name:var(--font-mono)] font-semibold text-slate-200 tabular-nums">
                {selectedPair}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-[family-name:var(--font-mono)] tabular-nums">
                {selectedTimeframe}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  isRejected
                    ? 'text-rose-400'
                    : isStopped
                    ? 'text-amber-400'
                    : stepOneApproved
                    ? 'text-emerald-400'
                    : 'text-sky-400'
                }
              >
                {isRejected
                  ? 'Approval Declined'
                  : isStopped
                  ? 'Stopped by User'
                  : isCompleting
                  ? 'All Stages Verified'
                  : stepOneApproved
                  ? 'Chart Approved · Streaming'
                  : 'Awaiting AI Gatekeeper'}
              </span>
            </div>

            <h2 className="mt-1 font-[family-name:var(--font-display)] text-lg sm:text-xl font-semibold tracking-tight text-slate-100">
              {isRejected
                ? 'Chart Verification Declined'
                : isStopped
                ? 'Chart Analysis Stopped'
                : isCompleting
                ? 'Signal Coordinates Confirmed'
                : stepOneApproved
                ? 'Live Model Structure Stream'
                : 'Verifying Uploaded Chart...'}
            </h2>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div
                className={`font-[family-name:var(--font-mono)] text-base sm:text-lg font-semibold tabular-nums ${
                  isRejected
                    ? 'text-rose-400'
                    : isStopped
                    ? 'text-amber-400'
                    : 'text-sky-400'
                }`}
              >
                {progressPct}%
              </div>
              <div className="font-[family-name:var(--font-mono)] text-[11px] text-slate-500 tabular-nums">
                {formattedSeconds}s
              </div>
            </div>

            {isActivelyRunning && (
              <button
                type="button"
                onClick={onStopAnalysis}
                className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/12 px-3 py-1.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 whitespace-nowrap shrink-0"
              >
                <Square className="h-3 w-3 fill-current text-rose-400" />
                <span>Stop</span>
              </button>
            )}
          </div>
        </div>

        {/* Purely Model-Driven GPU Progress Bar */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[#090D16] border border-slate-800/80">
          <div
            style={{ transform: `scaleX(${Math.max(0.03, progressPct / 100)})` }}
            className={`h-full w-full origin-left transition-transform duration-200 ease-out ${
              isRejected
                ? 'bg-rose-500'
                : isStopped
                ? 'bg-amber-400'
                : progressPct === 100
                ? 'bg-emerald-400'
                : 'bg-sky-400'
            }`}
          />
        </div>
      </div>

      {/* Live Model-Emitted Step-by-Step Pipeline */}
      <div className="divide-y divide-slate-800/70 border-t border-slate-800/80 px-5 py-2 sm:px-6">
        {stages.map((stage) => {
          const isApprovedOrDone =
            stage.status === 'approved' || stage.status === 'completed';
          const isActive = stage.status === 'active';
          const isDeclined = stage.status === 'rejected';
          const isStageStopped = stage.status === 'stopped';

          return (
            <div
              key={stage.step}
              className="flex items-start justify-between gap-3.5 py-3.5"
            >
              <div className="flex items-start gap-3 min-w-0">
                {/* Stage Status Badge */}
                <div className="mt-0.5 shrink-0">
                  {isApprovedOrDone ? (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15 }}
                      className="flex h-6 w-6 items-center justify-center rounded-lg border border-emerald-500/35 bg-emerald-500/15 text-emerald-400"
                    >
                      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                    </motion.div>
                  ) : isDeclined ? (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15 }}
                      className="flex h-6 w-6 items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/15 text-rose-400"
                    >
                      <X className="h-3.5 w-3.5 stroke-[2.5]" />
                    </motion.div>
                  ) : isStageStopped ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/15 text-amber-400">
                      <Square className="h-2.5 w-2.5 fill-current" />
                    </div>
                  ) : isActive ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/15 text-sky-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-800 bg-[#0D1320] text-slate-600">
                      <Lock className="h-3 w-3" />
                    </div>
                  )}
                </div>

                {/* Stage Title + Real AI Finding */}
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium leading-snug transition-colors duration-150 ${
                      isApprovedOrDone
                        ? 'text-slate-100'
                        : isDeclined
                        ? 'text-rose-300'
                        : isStageStopped
                        ? 'text-amber-200'
                        : isActive
                        ? 'text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    {stage.title}
                  </p>
                  <p
                    className={`mt-0.5 text-xs leading-relaxed transition-colors duration-150 ${
                      stage.finding
                        ? isDeclined
                          ? 'text-rose-200/90'
                          : isStageStopped
                          ? 'text-amber-200/80'
                          : 'text-slate-300'
                        : isActive
                        ? 'text-slate-400'
                        : 'text-slate-600'
                    }`}
                  >
                    {stage.finding
                      ? stage.finding
                      : isRejected
                      ? 'Halted — chart verification was not approved'
                      : isStopped
                      ? 'Cancelled before reaching this stage'
                      : stage.waitingText}
                  </p>
                </div>
              </div>

              {/* Clean Unboxed Status Text */}
              <span
                className={`mt-1 shrink-0 font-[family-name:var(--font-mono)] text-[11px] tabular-nums ${
                  stage.status === 'approved'
                    ? 'text-emerald-400'
                    : stage.status === 'completed'
                    ? 'text-emerald-400'
                    : isDeclined
                    ? 'text-rose-400'
                    : isStageStopped
                    ? 'text-amber-400'
                    : isActive
                    ? 'text-sky-400'
                    : 'text-slate-600'
                }`}
              >
                {stage.status === 'approved'
                  ? 'Approved'
                  : stage.status === 'completed'
                  ? 'Verified'
                  : isDeclined
                  ? 'Declined'
                  : isStageStopped
                  ? 'Stopped'
                  : isActive
                  ? stage.step === 1
                    ? 'Verifying'
                    : 'Streaming'
                  : isRejected || isStopped
                  ? 'Halted'
                  : 'Locked'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Action Footer when AI Gatekeeper Rejects Non-Chart Screenshot */}
      {isRejected && (
        <div className="border-t border-slate-800/80 p-4 sm:px-6 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            Upload a candlestick, bar, or line chart with a visible price axis.
          </span>
          <button
            type="button"
            onClick={onReplaceChart}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap"
          >
            <ImagePlus className="h-3.5 w-3.5 text-sky-400" />
            <span>Replace Image</span>
          </button>
        </div>
      )}

      {/* Action Footer when User Stops Analysis */}
      {isStopped && (
        <div className="border-t border-slate-800/80 p-4 sm:px-6 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            Scan stopped. Adjust pair or timeframe anytime, or resume analysis.
          </span>
          <button
            type="button"
            onClick={onResumeAnalysis}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap"
          >
            <ScanLine className="h-3.5 w-3.5" />
            <span>Resume Scan</span>
          </button>
        </div>
      )}
    </motion.div>
  );
}

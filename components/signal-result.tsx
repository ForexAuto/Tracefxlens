'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowDownRight,
  PauseCircle,
  Copy,
  Check,
  AlertTriangle,
  ScanLine,
  ClipboardCheck,
  ChevronDown,
  History,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  AnalysisStageItem,
  SignalType,
  TradingSignalResponse,
} from '@/lib/trading-data';
import { getStructureLayerCounts } from '@/lib/chart-markup';
import { AnalysisProgress } from '@/components/analysis-progress';

interface SignalResultProps {
  signal: TradingSignalResponse | null;
  stages: AnalysisStageItem[];
  progressPct: number;
  isRejected: boolean;
  isStopped: boolean;
  isLoading: boolean;
  isCompleting?: boolean;
  error: string | null;
  selectedPair: string;
  selectedTimeframe: string;
  hasChart: boolean;
  onStopAnalysis: () => void;
  onTriggerUpload: () => void;
  onRetry: () => void;
}

function getSignalMeta(signalType: SignalType) {
  switch (signalType) {
    case 'BUY':
      return {
        tone: 'bullish' as const,
        textClass: 'text-emerald-400',
        iconBgClass: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25',
        Icon: ArrowUpRight,
        executionHint: 'Market Long Execution',
      };
    case 'SELL':
      return {
        tone: 'bearish' as const,
        textClass: 'text-rose-400',
        iconBgClass: 'bg-rose-500/12 text-rose-400 border-rose-500/25',
        Icon: ArrowDownRight,
        executionHint: 'Market Short Execution',
      };
    default:
      return {
        tone: 'neutral' as const,
        textClass: 'text-amber-400',
        iconBgClass: 'bg-amber-500/12 text-amber-400 border-amber-500/25',
        Icon: PauseCircle,
        executionHint: 'Stand Aside · Await Structure Break',
      };
  }
}

function parseNumericPrice(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function formatPctDelta(from: number | null, to: number | null): string | null {
  if (from === null || to === null || from === 0) return null;
  const pct = ((to - from) / from) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function SignalResult({
  signal,
  stages,
  progressPct,
  isRejected,
  isStopped,
  isLoading,
  isCompleting = false,
  error,
  selectedPair,
  selectedTimeframe,
  hasChart,
  onStopAnalysis,
  onTriggerUpload,
  onRetry,
}: SignalResultProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState<boolean>(false);
  const [showAllLevels, setShowAllLevels] = useState<boolean>(false);

  const structureCounts = useMemo(
    () => getStructureLayerCounts(signal),
    [signal]
  );

  const handleCopyValue = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      // Clipboard API unavailable
    }
  };

  const ladderPoints = useMemo(() => {
    if (!signal || !signal.isValidChart) return [];
    const items = [
      { id: 'tp3', label: 'TP3', priceStr: signal.takeProfit3, kind: 'tp' as const },
      { id: 'tp2', label: 'TP2', priceStr: signal.takeProfit2, kind: 'tp' as const },
      { id: 'tp1', label: 'TP1', priceStr: signal.takeProfit1, kind: 'tp' as const },
      { id: 'entry', label: 'Entry', priceStr: signal.entryPrice, kind: 'entry' as const },
      { id: 'now', label: 'Current', priceStr: signal.currentMarketPrice, kind: 'now' as const },
      { id: 'sl', label: 'Stop Loss', priceStr: signal.stopLoss, kind: 'sl' as const },
    ]
      .map((item) => ({ ...item, num: parseNumericPrice(item.priceStr) }))
      .filter((item): item is typeof item & { num: number } => item.num !== null);

    if (items.length < 3) return [];
    return [...items].sort((a, b) => b.num - a.num);
  }, [signal]);

  // 1. Live Model-Driven Progress Pipeline (including Step 1 Rejection or User Stop)
  if (isLoading || isCompleting || isRejected || isStopped) {
    return (
      <AnalysisProgress
        stages={stages}
        progressPct={progressPct}
        selectedPair={selectedPair}
        selectedTimeframe={selectedTimeframe}
        isRejected={isRejected}
        isStopped={isStopped}
        isCompleting={isCompleting}
        onStopAnalysis={onStopAnalysis}
        onResumeAnalysis={onRetry}
        onReplaceChart={onTriggerUpload}
      />
    );
  }

  // 2. Network / Server Error State
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-rose-500/30 bg-[#111726] p-6"
      >
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-100">
              Analysis Interrupted
            </h2>
            <p className="mt-1 break-words text-sm leading-relaxed text-slate-400">
              {error}
            </p>
            {hasChart && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap"
              >
                Retry Chart Scan
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. Empty / Ready State (Desktop companion column only; hidden on mobile)
  if (!signal) {
    return (
      <div className="hidden lg:flex h-full flex-col justify-between rounded-2xl border border-slate-800/90 bg-[#111726]">
        <div className="p-6 sm:p-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-[#0D1320] text-sky-400">
            <ScanLine className="h-5 w-5" />
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-slate-100">
            Signal Execution Ticket
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
            Upload a chart screenshot to start. The AI gatekeeper verifies your chart first, streams each structural checkpoint live, and delivers a BUY, SELL, or HOLD signal with visual chart markup.
          </p>

          {!hasChart && (
            <button
              type="button"
              onClick={onTriggerUpload}
              className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700/90 bg-[#0D1320] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white whitespace-nowrap"
            >
              Upload Chart Screenshot
            </button>
          )}
        </div>

        <div className="border-t border-slate-800/80 p-5 sm:p-6">
          <p className="text-xs font-medium text-slate-400">
            Supported Signal Coverage
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div>
              <span className="font-semibold text-slate-200">Directional Execution</span>
              <p className="mt-0.5 text-slate-500">
                BUY · SELL with Entry, SL &amp; TP1–TP3
              </p>
            </div>
            <div>
              <span className="font-semibold text-slate-200">Stand Aside Discipline</span>
              <p className="mt-0.5 text-slate-500">
                HOLD with key breakout watch level
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 4. Legacy non-chart guard fallback
  if (!signal.isValidChart) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-[#111726] p-6">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Unrecognized Chart Image
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              {signal.validationMessage ||
                'The uploaded image does not appear to be a financial price chart. Upload a clear candlestick or bar chart with a visible price scale.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 5. Populated Signal Execution Ticket
  const meta = getSignalMeta(signal.signalType);
  const DirectionIcon = meta.Icon;
  const entryNum = parseNumericPrice(signal.entryPrice);
  const slNum = parseNumericPrice(signal.stopLoss);

  const fullTicketText = [
    `TRACEFX LENS SIGNAL — ${signal.detectedPair} (${signal.detectedTimeframe})`,
    `Order Type: ${signal.signalType} (${signal.executionCategory})`,
    `Current Market: ${signal.currentMarketPrice}`,
    `Entry Price: ${signal.entryPrice}`,
    `Stop Loss: ${signal.stopLoss}`,
    `Take Profit 1: ${signal.takeProfit1}`,
    `Take Profit 2: ${signal.takeProfit2}`,
    `Take Profit 3: ${signal.takeProfit3}`,
    `Risk / Reward: ${signal.riskRewardRatio}`,
    `Trigger: ${signal.entryTriggerNote}`,
  ].join('\n');

  const pairMismatch =
    signal.detectedPair &&
    signal.detectedPair.replace(/[^A-Z0-9]/gi, '').toUpperCase() !==
      selectedPair.replace(/[^A-Z0-9]/gi, '').toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-slate-800/90 bg-[#111726]"
    >
      {/* Top Signal Header */}
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* Clean Unboxed Metadata */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <span className="font-[family-name:var(--font-mono)] font-semibold text-slate-200 tabular-nums">
                {signal.detectedPair}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-[family-name:var(--font-mono)] tabular-nums">
                {signal.detectedTimeframe}
              </span>
              <span aria-hidden="true">·</span>
              <span>{signal.executionCategory}</span>
              <span aria-hidden="true">·</span>
              <span className="font-[family-name:var(--font-mono)] text-slate-300 tabular-nums">
                R:R {signal.riskRewardRatio}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${meta.iconBgClass}`}
              >
                <DirectionIcon className="h-5 w-5" />
              </div>
              <div>
                <h2
                  className={`font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold tracking-tight ${meta.textClass}`}
                >
                  {signal.signalType}
                </h2>
                <p className="text-xs text-slate-400">{meta.executionHint}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/history"
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-800 bg-[#0D1320] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap"
            >
              <History className="h-3.5 w-3.5 text-sky-400" />
              <span className="hidden sm:inline">History</span>
            </Link>

            <button
              type="button"
              onClick={() => handleCopyValue('full-ticket', fullTicketText)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-800 bg-[#0D1320] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap"
            >
              {copiedKey === 'full-ticket' ? (
                <>
                  <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                  <span>Copy Ticket</span>
                </>
              )}
            </button>
          </div>
        </div>

        {signal.entryTriggerNote && (
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            {signal.entryTriggerNote}
          </p>
        )}

        {(() => {
          const vv = signal.visionVerification;
          if (!vv) return null;
          const items: Array<{ key: string; label: string; className?: string }> = [];
          if (vv.rulerCalibrated) {
            items.push({
              key: 'ruler',
              label: vv.rightEdgeZoomed
                ? 'Ruler + 2× Axis Calibrated'
                : '0..1000 Ruler Calibrated',
            });
          }
          if ((vv.subPanesDetected ?? 0) > 0) {
            items.push({
              key: 'subpane',
              label: `${vv.subPanesDetected} Sub-Pane Split`,
            });
          }
          if (vv.ohlcSynced) {
            items.push({
              key: 'ohlc',
              label: `Live OHLC${vv.ohlcAtr ? ` (ATR ${vv.ohlcAtr})` : ''}`,
              className: 'text-sky-400/90',
            });
          }
          if (vv.selfChecked) {
            items.push({
              key: 'selfcheck',
              label: '2-Pass Verified',
              className: 'text-emerald-400/90',
            });
          }
          if (items.length === 0) return null;
          return (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
              {items.map((item, idx) => (
                <React.Fragment key={item.key}>
                  {idx > 0 && <span aria-hidden="true">·</span>}
                  <span className={item.className}>{item.label}</span>
                </React.Fragment>
              ))}
            </div>
          );
        })()}

        {pairMismatch && (
          <p className="mt-2.5 text-xs text-amber-400">
            Note: Chart visual displays {signal.detectedPair} while dropdown was set to {selectedPair}. Levels match the visible chart axis.
          </p>
        )}
      </div>

      {/* Primary Execution Coordinates: Current Price · Entry · Stop Loss */}
      <div className="grid grid-cols-1 divide-y divide-slate-800/80 border-t border-slate-800/80 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {/* Current Price */}
        <div className="flex items-center justify-between p-4 sm:block sm:p-5">
          <div className="text-xs text-slate-400">Current Market</div>
          <div className="mt-0.5 font-[family-name:var(--font-mono)] text-base sm:text-lg font-semibold text-slate-200 tabular-nums">
            {signal.currentMarketPrice}
          </div>
        </div>

        {/* Entry Point */}
        <div className="flex items-center justify-between p-4 sm:p-5">
          <div>
            <div className="text-xs font-medium text-sky-400">
              {signal.signalType === 'HOLD' ? 'Watch Trigger' : 'Entry Price'}
            </div>
            <div className="mt-0.5 font-[family-name:var(--font-mono)] text-lg sm:text-xl font-semibold text-white tabular-nums">
              {signal.entryPrice}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleCopyValue('entry', signal.entryPrice)}
            aria-label="Copy entry price"
            className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            {copiedKey === 'entry' ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Stop Loss Exit */}
        <div className="flex items-center justify-between p-4 sm:p-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-rose-400">
              <span>Stop Loss</span>
              {formatPctDelta(entryNum, slNum) && (
                <span className="font-[family-name:var(--font-mono)] text-[11px] text-slate-500 tabular-nums">
                  {formatPctDelta(entryNum, slNum)}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-[family-name:var(--font-mono)] text-lg sm:text-xl font-semibold text-rose-300 tabular-nums">
              {signal.stopLoss}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleCopyValue('sl', signal.stopLoss)}
            aria-label="Copy stop loss price"
            className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            {copiedKey === 'sl' ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Take-Profit Exit Targets */}
      <div className="border-t border-slate-800/80 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300">
            Take-Profit Exit Targets
          </h3>
          <span className="text-xs text-slate-500">Tap level to copy</span>
        </div>

        <div className="divide-y divide-slate-800/70">
          {[
            {
              key: 'tp1',
              code: 'TP 1',
              role: 'Conservative Partial Exit',
              price: signal.takeProfit1,
            },
            {
              key: 'tp2',
              code: 'TP 2',
              role: 'Primary Structural Target',
              price: signal.takeProfit2,
            },
            {
              key: 'tp3',
              code: 'TP 3',
              role: 'Extended Runner Objective',
              price: signal.takeProfit3,
            },
          ].map((tp) => {
            const tpNum = parseNumericPrice(tp.price);
            const delta = formatPctDelta(entryNum, tpNum);
            return (
              <div
                key={tp.key}
                className="flex min-h-[52px] items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-[family-name:var(--font-mono)] text-xs font-semibold text-emerald-400 tabular-nums">
                      {tp.code}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="truncate text-xs text-slate-400">
                      {tp.role}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {delta && (
                    <span className="hidden sm:inline font-[family-name:var(--font-mono)] text-xs text-slate-500 tabular-nums">
                      {delta}
                    </span>
                  )}
                  <span className="font-[family-name:var(--font-mono)] text-base font-semibold text-emerald-300 tabular-nums">
                    {tp.price}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyValue(tp.key, tp.price)}
                    aria-label={`Copy ${tp.code} price`}
                    className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
                  >
                    {copiedKey === tp.key ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Visual Order Price Axis Ladder */}
      {ladderPoints.length >= 4 && (
        <div className="border-t border-slate-800/80 p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300">
              Price Axis Geometry
            </h3>
            <span className="text-xs text-slate-500">High to Low Scale</span>
          </div>

          <div className="space-y-1.5">
            {ladderPoints.map((pt) => {
              const textStyle =
                pt.kind === 'tp'
                  ? 'text-emerald-300'
                  : pt.kind === 'sl'
                  ? 'text-rose-300'
                  : pt.kind === 'entry'
                  ? 'text-sky-300 font-semibold'
                  : 'text-slate-400';

              const lineStyle =
                pt.kind === 'tp'
                  ? 'border-emerald-500/30'
                  : pt.kind === 'sl'
                  ? 'border-rose-500/35'
                  : pt.kind === 'entry'
                  ? 'border-sky-400/50'
                  : 'border-slate-700 border-dashed';

              return (
                <div
                  key={pt.id}
                  className="flex items-center gap-3 text-xs py-0.5"
                >
                  <span className={`w-20 shrink-0 ${textStyle}`}>
                    {pt.label}
                  </span>
                  <div className={`flex-1 border-b ${lineStyle}`} />
                  <span
                    className={`font-[family-name:var(--font-mono)] tabular-nums shrink-0 ${textStyle}`}
                  >
                    {pt.priceStr}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Structural Rationale & Key Levels */}
      <div className="border-t border-slate-800/80 p-5 sm:p-6 space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">
              Technical Confluence
            </span>
            <span aria-hidden="true">·</span>
            <span>{signal.marketStructure}</span>
            <span aria-hidden="true">·</span>
            <span>{signal.confidenceSummary}</span>
          </div>

          <ul className="mt-3 space-y-2">
            {signal.technicalRationale.map((point, index) => (
              <li
                key={index}
                className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-300"
              >
                <span className="mt-0.5 font-[family-name:var(--font-mono)] text-xs text-slate-500 tabular-nums shrink-0">
                  0{index + 1}.
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {(signal.keyLevels.length > 0 || structureCounts.total > 0) && (
          <div className="border-t border-slate-800/70 pt-4">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-300">
                Mapped Market Structure &amp; SMC Zones
              </h3>
              {structureCounts.total > 0 && (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400 tabular-nums">
                  {structureCounts.zones > 0 && (
                    <span>{structureCounts.zones} Zones/OB</span>
                  )}
                  {structureCounts.fvg > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{structureCounts.fvg} FVG</span>
                    </>
                  )}
                  {structureCounts.bosSwings > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{structureCounts.bosSwings} BOS/Swings</span>
                    </>
                  )}
                  {structureCounts.liquidity > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{structureCounts.liquidity} Liquidity</span>
                    </>
                  )}
                  {structureCounts.trendlines > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{structureCounts.trendlines} Trend</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {signal.keyLevels.length > 0 && (
              <>
                <div className="divide-y divide-slate-800/60">
                  {(showAllLevels
                    ? signal.keyLevels
                    : signal.keyLevels.slice(0, 6)
                  ).map((lvl, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-2 text-xs"
                    >
                      <div className="min-w-0 pr-3">
                        <span className="text-slate-200">{lvl.label}</span>
                        <span className="mx-1.5 text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-500">{lvl.role}</span>
                      </div>
                      <span className="font-[family-name:var(--font-mono)] font-medium text-slate-200 tabular-nums shrink-0">
                        {lvl.price}
                      </span>
                    </div>
                  ))}
                </div>

                {signal.keyLevels.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllLevels((prev) => !prev)}
                    className="mt-2 inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-sky-400 transition-colors hover:text-sky-300 whitespace-nowrap"
                  >
                    <span>
                      {showAllLevels
                        ? 'Show fewer levels'
                        : `Show all ${signal.keyLevels.length} mapped levels`}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-150 ${
                        showAllLevels ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {signal.invalidationCondition && (
          <div className="border-t border-slate-800/70 pt-4 text-xs leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-200">
              Setup Invalidation:{' '}
            </span>
            {signal.invalidationCondition}
          </div>
        )}

        {/* Collapsible Live AI Verification Log */}
        {signal.auditTrail && signal.auditTrail.length > 0 && (
          <div className="border-t border-slate-800/70 pt-2">
            <button
              type="button"
              onClick={() => setAuditOpen((prev) => !prev)}
              className="flex min-h-[44px] w-full items-center justify-between text-left text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
            >
              <span>
                AI Verification Trail ({signal.auditTrail.length}/5 Stages Approved)
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
                  auditOpen ? 'rotate-180 text-sky-400' : ''
                }`}
              />
            </button>

            {auditOpen && (
              <div className="mt-2 space-y-2.5 pb-1">
                {signal.auditTrail.map((item) => (
                  <div key={item.step} className="flex items-start gap-2.5 text-xs">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <div>
                      <span className="font-medium text-slate-200">
                        {item.title}:{' '}
                      </span>
                      <span className="text-slate-400">{item.finding}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

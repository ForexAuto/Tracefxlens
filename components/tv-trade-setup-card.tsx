'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowDownRight,
  PauseCircle,
  Copy,
  Check,
  ScanLine,
  PenTool,
  Ticket,
  History,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  Loader2,
  ChevronDown,
  X,
  Target,
  ShieldAlert,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type {
  SignalType,
  TradingSignalResponse,
} from '@/lib/trading-data';
import { recordSignalToHistory } from '@/lib/history-storage';
import { TvConfirmDialog } from '@/components/tv-confirm-dialog';

interface TvTradeSetupCardProps {
  signal: TradingSignalResponse | null;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  onAnalyze: (customPrompt?: string) => void;
  onMarkOnChart: (signal: TradingSignalResponse) => void;
  onOpenOrderTicket: (signal: TradingSignalResponse) => void;
  onDismiss?: () => void;
  chartFrameUrl?: string | null;
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

function getSignalMeta(signalType: SignalType) {
  switch (signalType) {
    case 'BUY':
      return {
        tone: 'bullish' as const,
        textClass: 'text-emerald-400',
        badgeBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        glowClass: 'shadow-[0_0_24px_rgba(16,185,129,0.12)]',
        Icon: ArrowUpRight,
        executionHint: 'Market Long Execution',
      };
    case 'SELL':
      return {
        tone: 'bearish' as const,
        textClass: 'text-rose-400',
        badgeBg: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        glowClass: 'shadow-[0_0_24px_rgba(244,63,94,0.12)]',
        Icon: ArrowDownRight,
        executionHint: 'Market Short Execution',
      };
    default:
      return {
        tone: 'neutral' as const,
        textClass: 'text-amber-400',
        badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        glowClass: 'shadow-[0_0_24px_rgba(245,158,11,0.10)]',
        Icon: PauseCircle,
        executionHint: 'Stand Aside · Await Structure Breakout',
      };
  }
}

export function TvTradeSetupCard({
  signal,
  isLoading,
  error,
  isConnected,
  onAnalyze,
  onMarkOnChart,
  onOpenOrderTicket,
  onDismiss,
  chartFrameUrl,
}: TvTradeSetupCardProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedHistory, setSavedHistory] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [showAllLevels, setShowAllLevels] = useState(false);
  const [showReanalyzeConfirm, setShowReanalyzeConfirm] = useState(false);
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);

  const handleCopyValue = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleSaveToHistory = async () => {
    if (!signal) return;
    try {
      await recordSignalToHistory(signal, chartFrameUrl || null);
      setSavedHistory(true);
      setTimeout(() => setSavedHistory(false), 2500);
    } catch {
      // ignore
    }
  };

  const ladderPoints = useMemo(() => {
    if (!signal || !signal.isValidChart) return [];
    const items = [
      { id: 'tp3', label: 'TP 3', priceStr: signal.takeProfit3, kind: 'tp' as const },
      { id: 'tp2', label: 'TP 2', priceStr: signal.takeProfit2, kind: 'tp' as const },
      { id: 'tp1', label: 'TP 1', priceStr: signal.takeProfit1, kind: 'tp' as const },
      { id: 'entry', label: 'Entry', priceStr: signal.entryPrice, kind: 'entry' as const },
      { id: 'now', label: 'Current', priceStr: signal.currentMarketPrice, kind: 'now' as const },
      { id: 'sl', label: 'Stop Loss', priceStr: signal.stopLoss, kind: 'sl' as const },
    ]
      .map((item) => ({ ...item, num: parseNumericPrice(item.priceStr) }))
      .filter((item): item is typeof item & { num: number } => item.num !== null);

    if (items.length < 3) return [];
    return [...items].sort((a, b) => b.num - a.num);
  }, [signal]);

  const entryNum = signal ? parseNumericPrice(signal.entryPrice) : null;
  const slNum = signal ? parseNumericPrice(signal.stopLoss) : null;

  const fullTicketText = useMemo(() => {
    if (!signal) return '';
    return [
      `TRACEFX LENS TV SETUP — ${signal.detectedPair} (${signal.detectedTimeframe})`,
      `Order Type: ${signal.signalType} (${signal.executionCategory})`,
      `Current Market: ${signal.currentMarketPrice}`,
      `Entry Price: ${signal.entryPrice}`,
      `Stop Loss: ${signal.stopLoss}`,
      `Take Profit 1: ${signal.takeProfit1}`,
      `Take Profit 2: ${signal.takeProfit2}`,
      `Take Profit 3: ${signal.takeProfit3}`,
      `Risk / Reward: ${signal.riskRewardRatio}`,
      `Trigger: ${signal.entryTriggerNote}`,
      `Invalidation: ${signal.invalidationCondition}`,
    ].join('\n');
  }, [signal]);

  // 1. Loading State with Animated Radar Stages
  if (isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-sky-500/30 bg-[#0C1220] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-500/40 bg-sky-500/10 text-sky-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500" />
              </span>
            </div>
            <div>
              <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">
                TraceFX AI Vision Scanning Live Chart...
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Auditing candlestick wicks, right-hand price scale, order flow &amp; SMC liquidity pools
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-[family-name:var(--font-mono)] text-sky-400 bg-sky-500/10 px-3 py-1.5 rounded-lg border border-sky-500/20 w-fit">
            <ScanLine className="h-3.5 w-3.5 animate-pulse" />
            <span>Generating Ready-to-Trade Ticket...</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-slate-800/80 text-[11px]">
          <div className="text-slate-400">
            <span className="text-sky-400 font-medium">1.</span> Viewport Calibration
          </div>
          <div className="text-slate-400">
            <span className="text-sky-400 font-medium">2.</span> Structure &amp; BOS
          </div>
          <div className="text-slate-400">
            <span className="text-sky-400 font-medium">3.</span> FVG &amp; Liquidity Sweep
          </div>
          <div className="text-slate-400">
            <span className="text-sky-400 font-medium">4.</span> Entry, SL &amp; TP Ladder
          </div>
        </div>
      </div>
    );
  }

  // 2. Error State
  if (error && !signal) {
    return (
      <div className="mt-4 rounded-xl border border-rose-500/35 bg-[#111726] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">
                Chart Analysis Interrupted
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{error}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onAnalyze()}
            className="flex min-h-[34px] items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // 3. Ready Dock State (when no analysis has been performed yet)
  if (!signal) {
    return (
      <div className="mt-4 rounded-xl border border-slate-800/80 bg-[#0D1322] p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-sky-400">
              <Target className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">
                  Ready-to-Trade Setup Card
                </h3>
                <span className="font-[family-name:var(--font-mono)] text-[10px] text-slate-500 uppercase tracking-wider">
                  Terminal Companion
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400 leading-relaxed max-w-xl">
                {isConnected
                  ? 'Run AI analysis on the current TradingView chart above to generate an institutional setup card with exact Entry, Stop Loss, TP1–TP3, and 1-click execution.'
                  : 'Connect your TradingView cookies or launch a Guest Chart above, then click Analyze Live Chart to generate a ready-to-trade setup card.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
            <button
              type="button"
              disabled={!isConnected}
              onClick={() => onAnalyze()}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <ScanLine className="h-3.5 w-3.5" />
              <span>Analyze Live Chart</span>
            </button>
          </div>
        </div>

        {isConnected && (
          <div className="mt-3.5 pt-3 border-t border-slate-800/70 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">
              Quick AI Scans:
            </span>
            <button
              type="button"
              onClick={() => onAnalyze('Scan current chart for institutional BUY or SELL setup with SMC confirmations')}
              className="rounded-md border border-slate-800/80 bg-[#101728] px-2.5 py-1 text-[11px] text-slate-300 hover:border-sky-500/40 hover:text-sky-300 transition-colors whitespace-nowrap"
            >
              Scan for Setup
            </button>
            <button
              type="button"
              onClick={() => onAnalyze('Audit liquidity sweeps, BOS, and Fair Value Gaps on this timeframe')}
              className="rounded-md border border-slate-800/80 bg-[#101728] px-2.5 py-1 text-[11px] text-slate-300 hover:border-sky-500/40 hover:text-sky-300 transition-colors whitespace-nowrap"
            >
              Check SMC Liquidity
            </button>
            <button
              type="button"
              onClick={() => onAnalyze('Calculate conservative and aggressive take profit targets')}
              className="rounded-md border border-slate-800/80 bg-[#101728] px-2.5 py-1 text-[11px] text-slate-300 hover:border-sky-500/40 hover:text-sky-300 transition-colors whitespace-nowrap"
            >
              Evaluate R:R Targets
            </button>
          </div>
        )}
      </div>
    );
  }

  // 4. Populated Ready-to-Trade Setup Card
  const meta = getSignalMeta(signal.signalType);
  const DirectionIcon = meta.Icon;

  return (
    <motion.section
      aria-label="Ready-to-Trade Setup Card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={`mt-4 overflow-hidden rounded-2xl border border-slate-700/70 bg-[#0B1120] shadow-[0_18px_55px_rgba(0,0,0,0.28)] ${meta.glowClass}`}
    >
      {/* Signal Hero Header */}
      <div className="relative overflow-hidden border-b border-slate-800/80 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.10),transparent_52%),linear-gradient(135deg,#111a2a_0%,#0b1020_58%,#101827_100%)] p-4 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-emerald-400/[0.06] blur-3xl" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-mono)] text-xs font-semibold tracking-[0.28em] text-slate-300 sm:text-sm">
                {signal.detectedPair}
              </p>
              <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                {signal.detectedTimeframe} <span className="px-1 text-slate-700">/</span> {signal.executionCategory}
              </p>
            </div>
            <div className="shrink-0 pt-0.5 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 sm:text-xs">
                Confidence
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2">
                  <DirectionIcon className={`h-7 w-7 sm:h-9 sm:w-9 ${meta.textClass}`} strokeWidth={2.4} />
                  <h2 className={`font-[family-name:var(--font-display)] text-4xl font-extrabold leading-none tracking-tight sm:text-5xl ${meta.textClass}`}>
                    {signal.signalType}
                  </h2>
                </div>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] sm:text-xs ${meta.badgeBg}`}>
                  {signal.signalType === 'BUY' ? 'Bullish' : signal.signalType === 'SELL' ? 'Bearish' : 'Neutral'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {meta.executionHint}
                {signal.entryTriggerNote ? <span className="text-slate-500"> · {signal.entryTriggerNote}</span> : null}
              </p>
            </div>
            <div className="shrink-0 self-center text-right">
              <p
                title="AI-estimated setup quality based on technical confluence; not a win-probability forecast"
                className={`font-[family-name:var(--font-mono)] text-3xl font-bold leading-none tracking-tight tabular-nums sm:text-4xl ${
                  typeof signal.signalConfidence !== 'number'
                    ? 'text-slate-500'
                    : signal.signalConfidence >= 80
                    ? 'text-emerald-400'
                    : signal.signalConfidence >= 65
                    ? 'text-sky-400'
                    : 'text-amber-400'
                }`}
              >
                {typeof signal.signalConfidence === 'number' ? `${signal.signalConfidence}%` : '—'}
              </p>
              <p className="mt-2 text-[9px] uppercase tracking-[0.16em] text-slate-600">
                R:R {signal.riskRewardRatio}
              </p>
            </div>
          </div>

          <div
            className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800/90 ring-1 ring-inset ring-white/[0.04]"
            role="meter"
            aria-label="AI setup confidence"
            aria-valuemin={0}
            aria-valuemax={99}
            aria-valuenow={typeof signal.signalConfidence === 'number' ? signal.signalConfidence : 0}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${typeof signal.signalConfidence === 'number' ? Math.min(99, Math.max(1, signal.signalConfidence)) : 0}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className={`h-full rounded-full ${
                signal.signalType === 'SELL'
                  ? 'bg-gradient-to-r from-rose-500 via-rose-400 to-rose-300'
                  : signal.signalType === 'HOLD'
                  ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300'
                  : 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300'
              }`}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.14em] text-slate-600">
            <span>Lower confluence</span>
            <span>Stronger confluence</span>
          </div>

          {/* TradingView actions */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={() => onMarkOnChart(signal)}
              title="Draw Entry, Stop Loss, and Take Profit levels on the TradingView chart"
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-3 py-1.5 text-xs font-semibold text-sky-200 transition-all hover:border-sky-300/50 hover:bg-sky-400/[0.15]"
            >
              <PenTool className="h-3.5 w-3.5 text-sky-400" />
              <span>Mark on Chart</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenOrderTicket(signal)}
              title="Open a pre-configured TradingView order ticket"
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-all hover:border-emerald-300/50 hover:bg-emerald-400/[0.15]"
            >
              <Ticket className="h-3.5 w-3.5 text-emerald-400" />
              <span>Order Ticket</span>
            </button>
            <button
              type="button"
              onClick={() => handleCopyValue('full-ticket', fullTicketText)}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:border-slate-600 hover:text-white"
            >
              {copiedKey === 'full-ticket' ? <><Check className="h-3.5 w-3.5 text-emerald-400" /><span>Copied</span></> : <><Copy className="h-3.5 w-3.5 text-slate-400" /><span>Copy</span></>}
            </button>
            <button
              type="button"
              onClick={handleSaveToHistory}
              title="Archive signal to TraceFX History"
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:border-slate-600 hover:text-white"
            >
              {savedHistory ? <><Check className="h-3.5 w-3.5 text-emerald-400" /><span>Saved</span></> : <><History className="h-3.5 w-3.5 text-slate-400" /><span>History</span></>}
            </button>
            <button
              type="button"
              onClick={() => setShowReanalyzeConfirm(true)}
              title="Re-run analysis on the latest TradingView chart"
              className="ml-auto flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/60 text-slate-400 transition-all hover:border-slate-600 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={() => setShowDismissConfirm(true)}
                aria-label="Dismiss setup card"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/60 text-slate-500 transition-all hover:border-rose-500/40 hover:text-rose-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Primary Execution Coordinates (Current Price · Entry · Stop Loss) */}
      <div className="grid grid-cols-1 gap-px border-t border-slate-800/80 bg-slate-800/70 sm:grid-cols-3">
        {/* Current Price */}
        <div className="flex items-center justify-between bg-[#0D1525] p-4 sm:block sm:p-4">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Current Market
          </div>
          <div className="mt-0.5 font-[family-name:var(--font-mono)] text-base sm:text-lg font-semibold text-slate-200 tabular-nums">
            {signal.currentMarketPrice}
          </div>
        </div>

        {/* Entry Price */}
        <div className="flex items-center justify-between bg-[#0D1525] p-4">
          <div>
            <div className="text-[11px] font-semibold text-sky-400 uppercase tracking-wider">
              {signal.signalType === 'HOLD' ? 'Watch Trigger' : 'Entry Price'}
            </div>
            <div className="mt-0.5 font-[family-name:var(--font-mono)] text-lg sm:text-xl font-bold text-white tabular-nums">
              {signal.entryPrice}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleCopyValue('entry', signal.entryPrice)}
            aria-label="Copy entry price"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            {copiedKey === 'entry' ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Stop Loss Price */}
        <div className="flex items-center justify-between p-3.5 sm:p-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
              <span>Stop Loss</span>
              {formatPctDelta(entryNum, slNum) && (
                <span className="font-[family-name:var(--font-mono)] text-[10px] text-slate-500 tabular-nums">
                  ({formatPctDelta(entryNum, slNum)})
                </span>
              )}
            </div>
            <div className="mt-0.5 font-[family-name:var(--font-mono)] text-lg sm:text-xl font-bold text-rose-300 tabular-nums">
              {signal.stopLoss}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleCopyValue('sl', signal.stopLoss)}
            aria-label="Copy stop loss price"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            {copiedKey === 'sl' ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Take-Profit Targets Grid */}
      <div className="border-t border-slate-800/80 bg-[#0D1423]/80 p-4 sm:p-5">
        <div className="mb-2.5 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-200">Take-Profit Targets</span>
          <span className="text-[11px] text-slate-500">Tap a target to copy</span>
        </div>
        {signal.preferredTakeProfit && (
        <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">AI Recommended Main Target</span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">TP {signal.preferredTakeProfit}</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-200">{signal.preferredTakeProfitReason || 'Selected by the model as the preferred target for this setup.'}</p>
        </div>
      )}
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-800/80 bg-slate-800/80 sm:grid-cols-3">
          {[
            { key: 'tp1', label: 'TP 1', role: 'Conservative · Partial exit', price: signal.takeProfit1, number: 1 },
            { key: 'tp2', label: 'TP 2', role: 'Structural target', price: signal.takeProfit2, number: 2 },
            { key: 'tp3', label: 'TP 3', role: 'Extended runner', price: signal.takeProfit3, number: 3 },
          ].map((tp) => {
            const tpNum = parseNumericPrice(tp.price);
            const delta = formatPctDelta(entryNum, tpNum);
            const isPreferred = signal.preferredTakeProfit === tp.number;
            return (
              <button key={tp.key} type="button" onClick={() => handleCopyValue(tp.key, tp.price)} aria-label={`Copy ${tp.label} price${isPreferred ? ', AI recommended main target' : ''}`} className={`flex min-h-[76px] items-center justify-between text-left bg-[#0B1220] p-3.5 transition-colors hover:bg-[#111D30] ${isPreferred ? 'ring-1 ring-inset ring-emerald-400/60 bg-emerald-500/[0.07]' : ''}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-[family-name:var(--font-mono)] font-bold text-emerald-400">{tp.label}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[11px] text-slate-400">{tp.role}</span>
                    {isPreferred && <span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">Use this</span>}
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-mono)] text-base font-semibold text-emerald-300 tabular-nums">{tp.price}</div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  {delta && <span className="font-[family-name:var(--font-mono)] text-[11px] text-slate-500 tabular-nums">{delta}</span>}
                  {copiedKey === tp.key ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Visual Price Axis Geometry Ladder (High to Low) */}
      {ladderPoints.length >= 4 && (
        <div className="border-t border-slate-800/80 px-4 py-3 sm:px-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">
              Price Axis Geometry
            </span>
            <span className="text-[11px] text-slate-500">High to Low Scale</span>
          </div>

          <div className="space-y-1">
            {ladderPoints.map((pt) => {
              const textStyle =
                pt.kind === 'tp'
                  ? 'text-emerald-300 font-medium'
                  : pt.kind === 'sl'
                  ? 'text-rose-300 font-medium'
                  : pt.kind === 'entry'
                  ? 'text-sky-300 font-semibold'
                  : 'text-slate-400';

              const lineStyle =
                pt.kind === 'tp'
                  ? 'border-emerald-500/25'
                  : pt.kind === 'sl'
                  ? 'border-rose-500/30'
                  : pt.kind === 'entry'
                  ? 'border-sky-400/40'
                  : 'border-slate-800 border-dashed';

              return (
                <div key={pt.id} className="flex items-center gap-3 text-xs py-0.5">
                  <span className={`w-20 shrink-0 ${textStyle}`}>{pt.label}</span>
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

      {/* Technical Confluence & SMC Structure */}
      <div className="border-t border-slate-800/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.48),rgba(8,13,24,0.72))] p-4 sm:p-5 space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">
              Technical Confluence
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-300">{signal.marketStructure}</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-400">{signal.confidenceSummary}</span>
          </div>

          <ul className="mt-2.5 space-y-1.5">
            {signal.technicalRationale.map((point, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-xs leading-relaxed text-slate-300"
              >
                <span className="font-[family-name:var(--font-mono)] text-[11px] text-sky-400 shrink-0 mt-0.5">
                  0{idx + 1}.
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Key Mapped Levels if available */}
        {signal.keyLevels && signal.keyLevels.length > 0 && (
          <div className="pt-2 border-t border-slate-800/70">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Mapped Key Levels &amp; Zones
              </span>
              {signal.keyLevels.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllLevels((v) => !v)}
                  className="text-[11px] text-sky-400 hover:text-sky-300 whitespace-nowrap"
                >
                  {showAllLevels
                    ? 'Show fewer'
                    : `Show all ${signal.keyLevels.length}`}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {(showAllLevels
                ? signal.keyLevels
                : signal.keyLevels.slice(0, 4)
              ).map((lvl, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-md border border-slate-800/80 bg-[#090D18] px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-2">
                    <span className="text-slate-200 truncate">{lvl.label}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[11px] text-slate-500 truncate">
                      {lvl.role}
                    </span>
                  </div>
                  <span className="font-[family-name:var(--font-mono)] font-medium text-slate-200 tabular-nums shrink-0">
                    {lvl.price}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Setup Invalidation */}
        {signal.invalidationCondition && (
          <div className="flex items-start gap-2 rounded-lg border border-slate-800/80 bg-[#0A0F1E] p-3 text-xs leading-relaxed text-slate-400">
            <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-200">
                Setup Invalidation:{' '}
              </span>
              <span>{signal.invalidationCondition}</span>
            </div>
          </div>
        )}

        {/* Audit Trail Collapsible */}
        {signal.auditTrail && signal.auditTrail.length > 0 && (
          <div className="pt-2 border-t border-slate-800/70">
            <button
              type="button"
              onClick={() => setAuditOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span>
                AI Verification Stages ({signal.auditTrail.length} Checkpoints)
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-150 ${
                  auditOpen ? 'rotate-180 text-sky-400' : ''
                }`}
              />
            </button>

            {auditOpen && (
              <div className="mt-2 space-y-1.5 pb-1">
                {signal.auditTrail.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-[11px] text-slate-400"
                  >
                    <span className="font-[family-name:var(--font-mono)] text-sky-400 shrink-0">
                      [{item.step}]
                    </span>
                    <span className="font-medium text-slate-300 shrink-0">
                      {item.title}:
                    </span>
                    <span className="text-slate-400 break-words">
                      {item.finding}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Dialog: Re-Analyze Live Chart */}
      <TvConfirmDialog
        open={showReanalyzeConfirm}
        title="Re-Analyze Live Chart?"
        description={`This will capture a new screenshot of your TradingView screen and recalculate institutional setups, key levels, and risk-reward targets, replacing the current ${signal.signalType} setup for ${signal.detectedPair}.`}
        confirmLabel="Re-Analyze"
        cancelLabel="Keep Current Setup"
        variant="primary"
        icon={<RotateCcw className="h-4 w-4 text-sky-400" />}
        onConfirm={() => {
          setShowReanalyzeConfirm(false);
          onAnalyze();
        }}
        onCancel={() => setShowReanalyzeConfirm(false)}
      />

      {/* Confirmation Dialog: Dismiss Setup Card */}
      <TvConfirmDialog
        open={showDismissConfirm}
        title="Dismiss Trade Setup Card?"
        description={`Are you sure you want to dismiss the ${signal.signalType} setup card for ${signal.detectedPair}? You can generate a new trade setup at any time by clicking Analyze Chart.`}
        confirmLabel="Dismiss Card"
        cancelLabel="Keep Card"
        variant="danger"
        icon={<X className="h-4 w-4 text-rose-400" />}
        onConfirm={() => {
          setShowDismissConfirm(false);
          onDismiss?.();
        }}
        onCancel={() => setShowDismissConfirm(false)}
      />
    </motion.section>
  );
}

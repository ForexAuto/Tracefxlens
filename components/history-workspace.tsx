'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ScanLine,
  ArrowUpRight,
  ArrowDownRight,
  PauseCircle,
  Check,
  X,
  Lock,
  Search,
  ChevronDown,
  Copy,
  ClipboardCheck,
  Maximize2,
  Download,
  Eye,
  EyeOff,
  History,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AppHeaderWithSidebar } from '@/components/navigation-sidebar';
import { OutcomeLockDialog } from '@/components/outcome-lock-dialog';
import { DeleteHistoryDialog } from '@/components/delete-history-dialog';
import { AnnotatedChartOverlay } from '@/components/annotated-chart-overlay';
import {
  exportMarkedChartPng,
  getStructureLayerCounts,
  MarkupLayerFilter,
  StructureSubLayer,
} from '@/lib/chart-markup';
import {
  deleteSingleHistoryRecord,
  loadLocalHistory,
  lockSignalOutcomePermanent,
  recordSignalToHistory,
  syncHistoryWithServer,
} from '@/lib/history-storage';
import { loadWorkspaceState } from '@/lib/workspace-storage';
import type {
  SignalHistoryRecord,
  SignalType,
  TradeOutcome,
  TradingSignalResponse,
} from '@/lib/trading-data';

type OutcomeFilter = 'ALL' | 'PENDING' | 'WON' | 'LOST';
type DirectionFilter = 'ALL' | 'BUY' | 'SELL' | 'HOLD';

function formatShortTimestamp(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getDirectionVisual(signalType: SignalType) {
  if (signalType === 'BUY') {
    return {
      Icon: ArrowUpRight,
      textClass: 'text-emerald-400',
      boxClass: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-400',
    };
  }
  if (signalType === 'SELL') {
    return {
      Icon: ArrowDownRight,
      textClass: 'text-rose-400',
      boxClass: 'border-rose-500/25 bg-rose-500/12 text-rose-400',
    };
  }
  return {
    Icon: PauseCircle,
    textClass: 'text-amber-400',
    boxClass: 'border-amber-500/25 bg-amber-500/12 text-amber-400',
  };
}

function toSignalResponse(rec: SignalHistoryRecord): TradingSignalResponse {
  return {
    isValidChart: true,
    analysisMode: rec.analysisMode,
    crtContext: rec.crtContext,
    signalType: rec.signalType,
    executionCategory: rec.executionCategory,
    detectedPair: rec.pair,
    detectedTimeframe: rec.timeframe,
    currentMarketPrice: rec.currentMarketPrice,
    entryPrice: rec.entryPrice,
    entryTriggerNote: rec.entryTriggerNote,
    stopLoss: rec.stopLoss,
    takeProfit1: rec.takeProfit1,
    takeProfit2: rec.takeProfit2,
    takeProfit3: rec.takeProfit3,
    riskRewardRatio: rec.riskRewardRatio,
    marketStructure: rec.marketStructure,
    confidenceSummary: rec.confidenceSummary,
    technicalRationale: rec.technicalRationale,
    keyLevels: rec.keyLevels,
    invalidationCondition: rec.invalidationCondition,
    chartMarkup: rec.chartMarkup,
  };
}

export function HistoryWorkspace() {
  const [records, setRecords] = useState<SignalHistoryRecord[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Permanent outcome lock modal state
  const [lockTarget, setLockTarget] = useState<{
    record: SignalHistoryRecord;
    outcome: TradeOutcome;
  } | null>(null);
  const [isLocking, setIsLocking] = useState(false);

  // Single-record delete confirmation modal state (no bulk/multiple deletion)
  const [deleteTarget, setDeleteTarget] =
    useState<SignalHistoryRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fullscreen marked chart lightbox state
  const [inspectedRecord, setInspectedRecord] =
    useState<SignalHistoryRecord | null>(null);
  const [showMarkup, setShowMarkup] = useState(true);
  const [layerFilter, setLayerFilter] = useState<MarkupLayerFilter>('primary');
  const [subLayer, setSubLayer] = useState<StructureSubLayer>('all');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootHistory() {
      // Backfill active workspace signal if present and not yet archived
      try {
        const activeWorkspace = await loadWorkspaceState();
        if (activeWorkspace?.signal?.isValidChart) {
          await recordSignalToHistory(
            activeWorkspace.signal,
            activeWorkspace.imageDataUrl,
            {
              deduplicateByFingerprint: true,
              createdAtIso: new Date(
                activeWorkspace.updatedAt || Date.now()
              ).toISOString(),
            }
          );
        }
      } catch {
        // Ignore workspace backfill failure
      }

      const cached = await loadLocalHistory();
      if (!cancelled) {
        setRecords(cached);
        setIsLoaded(true);
      }

      const synced = await syncHistoryWithServer();
      if (!cancelled) {
        setRecords(synced);
        setIsLoaded(true);
      }
    }

    void bootHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    let won = 0;
    let lost = 0;
    let pending = 0;
    for (const r of records) {
      if (r.outcome === 'WON') won++;
      else if (r.outcome === 'LOST') lost++;
      else pending++;
    }
    const settled = won + lost;
    const winRate =
      settled > 0 ? `${((won / settled) * 100).toFixed(1)}%` : '—';
    return {
      total: records.length,
      won,
      lost,
      pending,
      settled,
      winRate,
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return records.filter((rec) => {
      if (outcomeFilter === 'PENDING' && rec.outcome !== null) return false;
      if (outcomeFilter === 'WON' && rec.outcome !== 'WON') return false;
      if (outcomeFilter === 'LOST' && rec.outcome !== 'LOST') return false;
      if (directionFilter !== 'ALL' && rec.signalType !== directionFilter) {
        return false;
      }
      if (q) {
        const hay = `${rec.pair} ${rec.timeframe} ${rec.signalType} ${rec.marketStructure}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, outcomeFilter, directionFilter, searchQuery]);

  const requestOutcomeLock = useCallback(
    (record: SignalHistoryRecord, outcome: TradeOutcome) => {
      // Absolute guard: once locked, no further toggling is ever permitted
      if (record.outcome !== null) return;
      setLockTarget({ record, outcome });
    },
    []
  );

  const confirmOutcomeLock = useCallback(async () => {
    if (!lockTarget || isLocking) return;
    setIsLocking(true);
    try {
      const updated = await lockSignalOutcomePermanent(
        lockTarget.record.id,
        lockTarget.outcome
      );
      setRecords(updated);
      setLockTarget(null);
    } finally {
      setIsLocking(false);
    }
  }, [lockTarget, isLocking]);

  const requestSingleDelete = useCallback(
    (record: SignalHistoryRecord) => {
      if (isDeleting) return;
      setDeleteTarget(record);
    },
    [isDeleting]
  );

  const confirmSingleDelete = useCallback(async () => {
    if (!deleteTarget || isDeleting) return;
    const targetId = deleteTarget.id;
    setIsDeleting(true);
    try {
      const updated = await deleteSingleHistoryRecord(targetId);
      setRecords(updated);
      setExpandedIds((prev) => {
        if (!prev[targetId]) return prev;
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      setInspectedRecord((prev) => (prev?.id === targetId ? null : prev));
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, isDeleting]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyTicket = async (rec: SignalHistoryRecord) => {
    const outcomeLine = rec.outcome
      ? `Outcome: ${rec.outcome} (Locked)`
      : 'Outcome: Awaiting Settlement';
    const text = [
      `TRACEFX LENS — ${rec.pair} (${rec.timeframe})`,
      `Signal: ${rec.signalType} (${rec.executionCategory})`,
      outcomeLine,
      `Entry: ${rec.entryPrice}`,
      `Stop Loss: ${rec.stopLoss}`,
      `TP1: ${rec.takeProfit1} | TP2: ${rec.takeProfit2} | TP3: ${rec.takeProfit3}`,
      `Risk / Reward: ${rec.riskRewardRatio}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(rec.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === rec.id ? null : prev));
      }, 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleExportInspectedPng = async () => {
    if (!inspectedRecord?.chartImageUrl || isExporting) return;
    setIsExporting(true);
    try {
      await exportMarkedChartPng(
        inspectedRecord.chartImageUrl,
        toSignalResponse(inspectedRecord),
        layerFilter,
        subLayer
      );
    } finally {
      setIsExporting(false);
    }
  };

  const inspectedSignal = useMemo(
    () => (inspectedRecord ? toSignalResponse(inspectedRecord) : null),
    [inspectedRecord]
  );

  const inspectedCounts = useMemo(
    () => getStructureLayerCounts(inspectedSignal),
    [inspectedSignal]
  );

  const inspectedSubLayers = useMemo(() => {
    const items: Array<{ id: StructureSubLayer; label: string; count: number }> = [
      { id: 'all', label: 'All Layers', count: inspectedCounts.total },
      { id: 'zones', label: 'Zones & OB', count: inspectedCounts.zones },
      { id: 'fvg', label: 'FVG', count: inspectedCounts.fvg },
      { id: 'bos_swings', label: 'BOS & Swings', count: inspectedCounts.bosSwings },
      { id: 'liquidity', label: 'Liquidity', count: inspectedCounts.liquidity },
      { id: 'trendlines', label: 'Trendlines', count: inspectedCounts.trendlines },
    ];
    return items.filter((item) => item.id === 'all' || item.count > 0);
  }, [inspectedCounts]);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeaderWithSidebar
        activeRoute="history"
        rightAction={
          <Link
            href="/"
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap"
          >
            <ScanLine className="h-3.5 w-3.5" />
            <span>Analyze Chart</span>
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-14 sm:px-6 sm:pt-8 lg:px-8">
        {/* Editorial Page Header */}
        <div className="mb-5 sm:mb-7 flex flex-col gap-1">
          <p className="text-xs font-medium text-slate-400">
            Archived Signals · Permanent Outcome Ledger
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
            Signal Execution History
          </h1>
        </div>

        {/* 4-Column Performance Ledger Summary Strip */}
        <section
          aria-label="Performance summary"
          className="mb-6 grid grid-cols-2 divide-y divide-slate-800/80 rounded-2xl border border-slate-800/90 bg-[#111726] sm:grid-cols-4 sm:divide-x sm:divide-y-0"
        >
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-400">Verified Win Rate</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-xl sm:text-2xl font-semibold text-white tabular-nums">
              {summary.winRate}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {summary.settled} settled of {summary.total} signals
            </div>
          </div>

          <div className="border-l border-slate-800/80 p-4 sm:border-l-0 sm:p-5">
            <div className="text-xs text-slate-400">Trades Won</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-xl sm:text-2xl font-semibold text-emerald-400 tabular-nums">
              {summary.won}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Permanently locked
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-400">Trades Lost</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-xl sm:text-2xl font-semibold text-rose-400 tabular-nums">
              {summary.lost}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Permanently locked
            </div>
          </div>

          <div className="border-l border-slate-800/80 p-4 sm:border-l-0 sm:p-5">
            <div className="text-xs text-slate-400">Awaiting Outcome</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-xl sm:text-2xl font-semibold text-sky-400 tabular-nums">
              {summary.pending}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Toggle Won or Lost once closed
            </div>
          </div>
        </section>

        {/* Interactive Filter & Search Controls */}
        {records.length > 0 && (
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {/* Outcome Segmented Control */}
              <div
                role="group"
                aria-label="Filter by outcome"
                className="flex items-center gap-0.5 rounded-xl border border-slate-800 bg-[#0D1320] p-1"
              >
                {(
                  [
                    { id: 'ALL', label: `All (${summary.total})` },
                    { id: 'PENDING', label: `Open (${summary.pending})` },
                    { id: 'WON', label: `Won (${summary.won})` },
                    { id: 'LOST', label: `Lost (${summary.lost})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setOutcomeFilter(tab.id)}
                    className={`min-h-[36px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                      outcomeFilter === tab.id
                        ? 'bg-[#172033] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Signal Direction Segmented Control */}
              <div
                role="group"
                aria-label="Filter by direction"
                className="flex items-center gap-0.5 rounded-xl border border-slate-800 bg-[#0D1320] p-1"
              >
                {(['ALL', 'BUY', 'SELL', 'HOLD'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setDirectionFilter(dir)}
                    className={`min-h-[36px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      directionFilter === dir
                        ? 'bg-[#172033] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {dir === 'ALL' ? 'All Signals' : dir}
                  </button>
                ))}
              </div>
            </div>

            {/* Pair Search Input */}
            <div className="relative w-full lg:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search pair or timeframe..."
                aria-label="Search signal history"
                className="min-h-[42px] w-full rounded-xl border border-slate-800 bg-[#0D1320] py-2 pr-3 pl-9 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* History List / Loading / Empty State */}
        {!isLoaded ? (
          <div className="space-y-4">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                className="h-44 animate-pulse rounded-2xl border border-slate-800/80 bg-[#111726]"
              />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/90 bg-[#111726] p-8 sm:p-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-[#0D1320] text-sky-400">
              <History className="h-5 w-5" />
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">
              No Archived Signals Yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
              Every chart scan you run is automatically saved here with its exact entry, stop-loss, take-profit targets, marked chart, and a one-time permanent WON / LOST outcome toggle.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap"
            >
              <ScanLine className="h-4 w-4" />
              <span>Analyze First Chart</span>
            </Link>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/90 bg-[#111726] p-8 text-center">
            <p className="text-sm font-medium text-slate-200">
              No signal records match your current filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setOutcomeFilter('ALL');
                setDirectionFilter('ALL');
                setSearchQuery('');
              }}
              className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-700 bg-[#0D1320] px-4 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRecords.map((rec) => {
              const dirMeta = getDirectionVisual(rec.signalType);
              const DirIcon = dirMeta.Icon;
              const isLocked = rec.outcome === 'WON' || rec.outcome === 'LOST';
              const isExpanded = Boolean(expandedIds[rec.id]);

              return (
                <article
                  key={rec.id}
                  className="rounded-2xl border border-slate-800/90 bg-[#111726] transition-colors"
                >
                  {/* Top Row: Signal Identity + Permanent One-Time WON / LOST Toggle */}
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                    {/* Left: Direction + Unboxed Metadata */}
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${dirMeta.boxClass}`}
                      >
                        <DirIcon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                          <span className="font-[family-name:var(--font-mono)] font-semibold text-white tabular-nums">
                            {rec.pair}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-[family-name:var(--font-mono)] tabular-nums">
                            {rec.timeframe}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-[family-name:var(--font-mono)] text-slate-300 tabular-nums">
                            R:R {rec.riskRewardRatio}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatShortTimestamp(rec.createdAt)}</span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
                          <h2
                            className={`font-[family-name:var(--font-display)] text-xl sm:text-2xl font-bold tracking-tight ${dirMeta.textClass}`}
                          >
                            {rec.signalType}
                          </h2>
                          <span className="text-xs text-slate-400">
                            {rec.marketStructure || rec.executionCategory}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Permanent One-Way WON / LOST Toggle Control */}
                    <div className="flex flex-col items-stretch sm:items-end shrink-0">
                      <div
                        role="group"
                        aria-label={
                          isLocked
                            ? `Outcome permanently locked as ${rec.outcome}`
                            : 'Select permanent trade outcome'
                        }
                        className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-[#0B101B] p-1 sm:inline-flex"
                      >
                        {/* WON Segment */}
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => requestOutcomeLock(rec, 'WON')}
                          className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-all whitespace-nowrap ${
                            rec.outcome === 'WON'
                              ? 'border border-emerald-500/45 bg-emerald-500/18 text-emerald-300 cursor-default'
                              : rec.outcome === 'LOST'
                              ? 'text-slate-600 opacity-30 cursor-not-allowed'
                              : 'text-slate-300 hover:bg-emerald-500/15 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400'
                          }`}
                        >
                          {rec.outcome === 'WON' ? (
                            <Lock className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          )}
                          <span>WON</span>
                        </button>

                        {/* LOST Segment */}
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => requestOutcomeLock(rec, 'LOST')}
                          className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-all whitespace-nowrap ${
                            rec.outcome === 'LOST'
                              ? 'border border-rose-500/45 bg-rose-500/18 text-rose-300 cursor-default'
                              : rec.outcome === 'WON'
                              ? 'text-slate-600 opacity-30 cursor-not-allowed'
                              : 'text-slate-300 hover:bg-rose-500/15 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400'
                          }`}
                        >
                          {rec.outcome === 'LOST' ? (
                            <Lock className="h-3.5 w-3.5 text-rose-400" />
                          ) : (
                            <X className="h-3.5 w-3.5 text-rose-400" />
                          )}
                          <span>LOST</span>
                        </button>
                      </div>

                      <div className="mt-1.5 flex items-center justify-end gap-1 text-[11px] text-slate-500">
                        {isLocked ? (
                          <>
                            <Lock className="h-3 w-3 shrink-0 text-slate-500" />
                            <span>
                              Locked permanently
                              {rec.outcomeLockedAt
                                ? ` · ${formatShortTimestamp(rec.outcomeLockedAt)}`
                                : ''}
                            </span>
                          </>
                        ) : (
                          <span>Locks permanently once selected</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle Row: Hairline Execution Coordinates Strip */}
                  <div className="grid grid-cols-2 divide-y divide-slate-800/75 border-t border-slate-800/80 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
                    <div className="p-3.5 sm:px-4">
                      <div className="text-[11px] font-medium text-sky-400">
                        {rec.signalType === 'HOLD' ? 'Watch Level' : 'Entry Price'}
                      </div>
                      <div className="mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold text-white tabular-nums">
                        {rec.entryPrice}
                      </div>
                    </div>

                    <div className="border-l border-slate-800/75 p-3.5 sm:border-l-0 sm:px-4">
                      <div className="text-[11px] font-medium text-rose-400">
                        Stop Loss
                      </div>
                      <div className="mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold text-rose-300 tabular-nums">
                        {rec.stopLoss}
                      </div>
                    </div>

                    <div className="p-3.5 sm:px-4">
                      <div className="text-[11px] text-slate-400">TP 1</div>
                      <div className="mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold text-emerald-300 tabular-nums">
                        {rec.takeProfit1}
                      </div>
                    </div>

                    <div className="border-l border-slate-800/75 p-3.5 sm:border-l-0 sm:px-4">
                      <div className="text-[11px] text-slate-400">TP 2</div>
                      <div className="mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold text-emerald-300 tabular-nums">
                        {rec.takeProfit2}
                      </div>
                    </div>

                    <div className="col-span-2 p-3.5 sm:col-span-1 sm:px-4">
                      <div className="text-[11px] text-slate-400">TP 3</div>
                      <div className="mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold text-emerald-300 tabular-nums">
                        {rec.takeProfit3}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action & Inspection Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 px-4 py-2.5 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      {rec.chartImageUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowMarkup(true);
                            setLayerFilter('primary');
                            setSubLayer('all');
                            setInspectedRecord(rec);
                          }}
                          className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0D1320] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap"
                        >
                          <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
                          <span>Inspect Marked Chart</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => toggleExpanded(rec.id)}
                        className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0D1320] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap"
                      >
                        <span>Analysis Rationale</span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform duration-150 ${
                            isExpanded ? 'rotate-180 text-sky-400' : ''
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyTicket(rec)}
                        className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0D1320] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap"
                      >
                        {copiedId === rec.id ? (
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

                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => requestSingleDelete(rec)}
                        aria-label={`Delete ${rec.pair} ${rec.timeframe} signal record`}
                        className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0D1320] px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-400/90" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>

                  {/* Expandable Rationale Drawer */}
                  {isExpanded && (
                    <div className="border-t border-slate-800/80 bg-[#0D1320]/60 p-4 sm:p-5 space-y-3 text-xs">
                      {rec.entryTriggerNote && (
                        <p className="text-sm leading-relaxed text-slate-200">
                          {rec.entryTriggerNote}
                        </p>
                      )}

                      {rec.technicalRationale.length > 0 && (
                        <ul className="space-y-1.5">
                          {rec.technicalRationale.map((pt, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 leading-relaxed text-slate-300"
                            >
                              <span className="font-[family-name:var(--font-mono)] text-slate-500 tabular-nums shrink-0">
                                0{idx + 1}.
                              </span>
                              <span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {rec.macroContext && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-400 tabular-nums">
                          <span className="font-semibold text-slate-200">
                            Macro Filter:
                          </span>
                          <span
                            className={
                              rec.macroContext.signalAlignment === 'tailwind'
                                ? 'text-emerald-400'
                                : rec.macroContext.signalAlignment === 'headwind'
                                ? 'text-rose-400'
                                : rec.macroContext.signalAlignment === 'mixed'
                                ? 'text-amber-400'
                                : 'text-slate-300'
                            }
                          >
                            {rec.macroContext.alignmentLabel}
                          </span>
                          {rec.macroContext.dxy && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-[family-name:var(--font-mono)]">
                                DXY {rec.macroContext.dxy.value} ({rec.macroContext.dxy.changeLabel})
                              </span>
                            </>
                          )}
                          {rec.macroContext.us10y && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-[family-name:var(--font-mono)]">
                                US10Y {rec.macroContext.us10y.value} ({rec.macroContext.us10y.changeLabel})
                              </span>
                            </>
                          )}
                        </div>
                      )}

                      {rec.invalidationCondition && (
                        <p className="pt-1 text-slate-400">
                          <span className="font-semibold text-slate-200">
                            Invalidation:{' '}
                          </span>
                          {rec.invalidationCondition}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Permanent Outcome Lock Confirmation Dialog */}
      <OutcomeLockDialog
        open={Boolean(lockTarget)}
        record={lockTarget?.record || null}
        pendingOutcome={lockTarget?.outcome || null}
        isSaving={isLocking}
        onConfirm={confirmOutcomeLock}
        onCancel={() => !isLocking && setLockTarget(null)}
      />

      {/* Single-Record Delete Confirmation Dialog */}
      <DeleteHistoryDialog
        open={Boolean(deleteTarget)}
        record={deleteTarget}
        isDeleting={isDeleting}
        onConfirm={confirmSingleDelete}
        onCancel={() => !isDeleting && setDeleteTarget(null)}
      />

      {/* Fullscreen Marked Chart Lightbox from History */}
      <AnimatePresence>
        {inspectedRecord && inspectedRecord.chartImageUrl && inspectedSignal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setInspectedRecord(null)}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/92 p-3 sm:p-6 backdrop-blur-md"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="mb-3 flex w-full max-w-6xl flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="font-[family-name:var(--font-mono)] font-semibold text-white tabular-nums">
                  {inspectedRecord.pair}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-[family-name:var(--font-mono)] tabular-nums">
                  {inspectedRecord.timeframe}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-sky-400">
                  {inspectedRecord.signalType}
                </span>
                {inspectedRecord.outcome && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold ${
                        inspectedRecord.outcome === 'WON'
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {inspectedRecord.outcome} (Locked)
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowMarkup((prev) => !prev)}
                  className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    showMarkup
                      ? 'border-sky-500/45 bg-sky-500/15 text-sky-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {showMarkup ? (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      <span>Markup On</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      <span>Original</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={handleExportInspectedPng}
                  className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Save PNG</span>
                </button>

                <button
                  type="button"
                  onClick={() => setInspectedRecord(null)}
                  aria-label="Close chart inspection"
                  className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div
              onClick={(e) => e.stopPropagation()}
              className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-slate-800 bg-[#070A12]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={inspectedRecord.chartImageUrl}
                alt={`Archived ${inspectedRecord.pair} chart`}
                referrerPolicy="no-referrer"
                className="block max-h-[75vh] w-auto max-w-[95vw] sm:max-w-6xl object-contain"
              />

              <AnnotatedChartOverlay
                imageDataUrl={inspectedRecord.chartImageUrl}
                signal={inspectedSignal}
                layerFilter={layerFilter}
                subLayer={subLayer}
                visible={showMarkup}
              />
            </div>

            {showMarkup && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mt-3 flex max-w-full flex-col items-center gap-2"
              >
                <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-[#111726] p-1 overflow-x-auto max-w-[95vw]">
                  {(
                    [
                      { id: 'primary', label: 'Primary Setup' },
                      {
                        id: 'all',
                        label:
                          inspectedCounts.total > 0
                            ? `Full Structure (${inspectedCounts.total})`
                            : 'Full Structure',
                      },
                      { id: 'structure', label: 'Structure Only' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setLayerFilter(opt.id);
                        if (opt.id === 'all') setSubLayer('all');
                      }}
                      className={`min-h-[38px] rounded-lg px-3.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                        layerFilter === opt.id
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {(layerFilter === 'all' || layerFilter === 'structure') &&
                  inspectedSubLayers.length > 2 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto max-w-[95vw] px-1">
                      {inspectedSubLayers.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSubLayer(opt.id)}
                          className={`min-h-[34px] rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                            subLayer === opt.id
                              ? 'border-sky-500/50 bg-sky-500/20 text-sky-200'
                              : 'border-slate-800 bg-slate-900/90 text-slate-400 hover:text-white'
                          }`}
                        >
                          {opt.label} ({opt.count})
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quiet Risk Disclaimer Footer */}
      <footer className="border-t border-slate-800/60 py-5">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <span>TraceFX Lens · Signal Execution History</span>
          <span>
            Outcomes marked Won or Lost are permanently sealed in your trading ledger.
          </span>
        </div>
      </footer>
    </div>
  );
}

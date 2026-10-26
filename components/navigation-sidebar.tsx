'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  PanelLeft,
  X,
  ScanLine,
  CalendarClock,
  History,
  MonitorPlay,
  Download,
  ChevronRight,
} from 'lucide-react';
import {
  HISTORY_UPDATED_EVENT,
  loadLocalHistory,
} from '@/lib/history-storage';
import type { SignalHistoryRecord } from '@/lib/trading-data';
import { usePWA } from '@/components/pwa-provider';

interface AppHeaderWithSidebarProps {
  activeRoute: 'analyze' | 'news' | 'history' | 'tv-engine';
  rightAction?: React.ReactNode;
}

interface SidebarStats {
  total: number;
  won: number;
  lost: number;
  pending: number;
}

function computeStats(records: SignalHistoryRecord[]): SidebarStats {
  let won = 0;
  let lost = 0;
  let pending = 0;
  for (const r of records) {
    if (r.outcome === 'WON') won++;
    else if (r.outcome === 'LOST') lost++;
    else pending++;
  }
  return {
    total: records.length,
    won,
    lost,
    pending,
  };
}

export function AppHeaderWithSidebar({
  activeRoute,
  rightAction,
}: AppHeaderWithSidebarProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState<SidebarStats>({
    total: 0,
    won: 0,
    lost: 0,
    pending: 0,
  });

  const {
    isInstalled,
    isInstallable,
    bannerDismissed,
    triggerInstallOrGuide,
    dismissMobileBanner,
  } = usePWA();

  const refreshStats = useCallback(() => {
    loadLocalHistory()
      .then((records) => {
        setStats(computeStats(records));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
    window.addEventListener(HISTORY_UPDATED_EVENT, refreshStats);
    return () => {
      window.removeEventListener(HISTORY_UPDATED_EVENT, refreshStats);
    };
  }, [refreshStats]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarOpen]);

  const settledCount = stats.won + stats.lost;
  const winRateStr =
    settledCount > 0
      ? `${((stats.won / settledCount) * 100).toFixed(0)}%`
      : '—';

  return (
    <>
      {/* Sticky Top Header (< 15% Mobile Viewport Cap) */}
      <header className="sticky top-0 z-30 h-14 border-b border-slate-800/80 bg-[#090D16]/85 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
          {/* Left Zone: Sidebar Trigger + Brand Wordmark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                refreshStats();
                setSidebarOpen(true);
              }}
              aria-label="Open navigation sidebar"
              aria-expanded={sidebarOpen}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-200 hover:border-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <PanelLeft className="h-4 w-4 text-sky-400" />
            </button>

            <Link
              href="/"
              className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
            >
              TraceFX Lens
            </Link>
          </div>

          {/* Center Zone: Clean Unboxed Desktop Route Links (4 single-line items max) */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-xs font-medium"
          >
            <Link
              href="/"
              className={`py-1 transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                activeRoute === 'analyze'
                  ? 'border-sky-400 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Analyze Chart
            </Link>
            <Link
              href="/news"
              className={`py-1 transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                activeRoute === 'news'
                  ? 'border-sky-400 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Impact News
            </Link>
            <Link
              href="/history"
              className={`flex items-center gap-1.5 py-1 transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                activeRoute === 'history'
                  ? 'border-sky-400 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Signal History</span>
              {stats.total > 0 && (
                <span className="font-[family-name:var(--font-mono)] text-[11px] text-slate-500 tabular-nums">
                  ({stats.total})
                </span>
              )}
            </Link>
            <Link
              href="/tv-engine"
              className={`py-1 transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                activeRoute === 'tv-engine'
                  ? 'border-sky-400 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              TradingView Engine
            </Link>
            {!isInstalled && (
              <button
                type="button"
                onClick={() => void triggerInstallOrGuide()}
                className="py-1 text-sky-400 hover:text-sky-300 transition-colors border-b-2 border-transparent hover:border-sky-400/50 whitespace-nowrap shrink-0"
              >
                Install App
              </button>
            )}
          </nav>

          {/* Right Zone: Contextual Page Action */}
          <div className="flex items-center shrink-0">{rightAction}</div>
        </div>
      </header>

      {/* Non-Sticky Mobile Install Strip (0% sticky height impact; auto-hidden when installed or dismissed) */}
      {!isInstalled && !bannerDismissed && (
        <div className="md:hidden border-b border-slate-800/80 bg-[#0E1422] px-4 py-2">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <span className="truncate text-xs text-slate-300">
              Install TraceFX on your phone home screen
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void triggerInstallOrGuide()}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-sky-500/15 border border-sky-500/35 px-3 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Install</span>
              </button>
              <button
                type="button"
                onClick={dismissMobileBanner}
                aria-label="Dismiss install prompt"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:text-slate-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instant Navigation Sidebar Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            aria-hidden="true"
          />

          {/* Sidebar Panel */}
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Application navigation sidebar"
            className="relative z-10 flex h-full w-[84vw] max-w-[320px] flex-col justify-between border-r border-slate-800/90 bg-[#0B101B] shadow-2xl"
          >
            {/* Top Section: Brand + Navigation Links */}
            <div>
              <div className="flex h-14 items-center justify-between border-b border-slate-800/80 px-4">
                <div>
                  <span className="font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-white">
                    TraceFX Lens
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close navigation sidebar"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-3 space-y-1.5">
                <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-slate-500">
                  Workspace Navigation
                </p>

                <Link
                  href="/"
                  onClick={() => setSidebarOpen(false)}
                  className={`group flex min-h-[52px] items-center justify-between rounded-xl border px-3.5 py-2.5 ${
                    activeRoute === 'analyze'
                      ? 'border-sky-500/35 bg-sky-500/10 text-white'
                      : 'border-transparent bg-transparent text-slate-300 hover:border-slate-800/90 hover:bg-[#111726] hover:text-white'
                  }`}
                >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                          activeRoute === 'analyze'
                            ? 'border-sky-500/40 bg-sky-500/15 text-sky-400'
                            : 'border-slate-800 bg-[#111726] text-slate-400 group-hover:text-sky-400'
                        }`}
                      >
                        <ScanLine className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">Analyze Chart</div>
                        <div className="truncate text-xs text-slate-400">
                          AI structure scan &amp; markup
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 ${
                        activeRoute === 'analyze'
                          ? 'text-sky-400'
                          : 'text-slate-600 group-hover:text-slate-400'
                      }`}
                    />
                  </Link>

                <Link
                  href="/news"
                  onClick={() => setSidebarOpen(false)}
                  className={`group flex min-h-[52px] items-center justify-between rounded-xl border px-3.5 py-2.5 ${
                    activeRoute === 'news'
                      ? 'border-sky-500/35 bg-sky-500/10 text-white'
                      : 'border-transparent bg-transparent text-slate-300 hover:border-slate-800/90 hover:bg-[#111726] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                        activeRoute === 'news'
                          ? 'border-sky-500/40 bg-sky-500/15 text-sky-400'
                          : 'border-slate-800 bg-[#111726] text-slate-400 group-hover:text-sky-400'
                      }`}
                    >
                      <CalendarClock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        High Impact News
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        Red-folder calendar &amp; full event specs
                      </div>
                    </div>
                  </div>
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 ${
                      activeRoute === 'news'
                        ? 'text-sky-400'
                        : 'text-slate-600 group-hover:text-slate-400'
                    }`}
                  />
                </Link>

                <Link
                  href="/history"
                  onClick={() => setSidebarOpen(false)}
                  className={`group flex min-h-[52px] items-center justify-between rounded-xl border px-3.5 py-2.5 ${
                    activeRoute === 'history'
                      ? 'border-sky-500/35 bg-sky-500/10 text-white'
                      : 'border-transparent bg-transparent text-slate-300 hover:border-slate-800/90 hover:bg-[#111726] hover:text-white'
                  }`}
                >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                          activeRoute === 'history'
                            ? 'border-sky-500/40 bg-sky-500/15 text-sky-400'
                            : 'border-slate-800 bg-[#111726] text-slate-400 group-hover:text-sky-400'
                        }`}
                      >
                        <History className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">
                            Signal History
                          </span>
                          {stats.total > 0 && (
                            <span className="font-[family-name:var(--font-mono)] text-xs text-slate-400 tabular-nums">
                              {stats.total}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-slate-400">
                          Permanent Won / Lost ledger
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 ${
                        activeRoute === 'history'
                          ? 'text-sky-400'
                          : 'text-slate-600 group-hover:text-slate-400'
                      }`}
                    />
                  </Link>

                <Link
                  href="/tv-engine"
                  onClick={() => setSidebarOpen(false)}
                  className={`group flex min-h-[52px] items-center justify-between rounded-xl border px-3.5 py-2.5 ${
                    activeRoute === 'tv-engine'
                      ? 'border-sky-500/35 bg-sky-500/10 text-white'
                      : 'border-transparent bg-transparent text-slate-300 hover:border-slate-800/90 hover:bg-[#111726] hover:text-white'
                  }`}
                >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                          activeRoute === 'tv-engine'
                            ? 'border-sky-500/40 bg-sky-500/15 text-sky-400'
                            : 'border-slate-800 bg-[#111726] text-slate-400 group-hover:text-sky-400'
                        }`}
                      >
                        <MonitorPlay className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          TradingView Engine
                        </div>
                        <div className="truncate text-xs text-slate-400">
                          Live Playwright AI browser control
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 ${
                        activeRoute === 'tv-engine'
                          ? 'text-sky-400'
                          : 'text-slate-600 group-hover:text-slate-400'
                      }`}
                    />
                  </Link>

                {!isInstalled && (
                  <button
                    type="button"
                    onClick={() => {
                      setSidebarOpen(false);
                      void triggerInstallOrGuide();
                    }}
                    className="group flex w-full min-h-[52px] items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5 text-left text-white hover:bg-sky-500/15 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/20 text-sky-300">
                        <Download className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">Install App</div>
                        <div className="truncate text-xs text-sky-200/80">
                          {isInstallable
                            ? 'Ready for one-tap install'
                            : 'OPPO, Android & iOS setup'}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-sky-400" />
                  </button>
                )}
                </div>
              </div>

              {/* Bottom Section: Live Performance Ledger Summary */}
              <div className="border-t border-slate-800/80 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Recorded Performance</span>
                  <span className="font-[family-name:var(--font-mono)] font-semibold text-slate-200 tabular-nums">
                    Win Rate {winRateStr}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 divide-x divide-slate-800/80 rounded-xl border border-slate-800/90 bg-[#111726] py-2.5 text-center">
                  <div className="px-2">
                    <div className="font-[family-name:var(--font-mono)] text-sm font-semibold text-emerald-400 tabular-nums">
                      {stats.won}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">Won</div>
                  </div>
                  <div className="px-2">
                    <div className="font-[family-name:var(--font-mono)] text-sm font-semibold text-rose-400 tabular-nums">
                      {stats.lost}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">Lost</div>
                  </div>
                  <div className="px-2">
                    <div className="font-[family-name:var(--font-mono)] text-sm font-semibold text-sky-400 tabular-nums">
                      {stats.pending}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">Open</div>
                  </div>
                </div>
              </div>
          </aside>
        </div>
      )}
    </>
  );
}

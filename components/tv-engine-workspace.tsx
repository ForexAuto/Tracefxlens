'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw,
  Square,
  Maximize2,
  X,
  Download,
  MousePointerClick,
  Plug,
  Power,
  Loader2,
  Keyboard,
  ScanLine,
  Save,
  Check,
} from 'lucide-react';
import { AppHeaderWithSidebar } from '@/components/navigation-sidebar';
import { TvSessionModal } from '@/components/tv-session-modal';
import { TvTradeSetupCard } from '@/components/tv-trade-setup-card';
import { TvConfirmDialog } from '@/components/tv-confirm-dialog';
import type { TradingSignalResponse } from '@/lib/trading-data';
import {
  loadTvWorkspaceState,
  saveTvWorkspaceState,
  getTvCredentials,
} from '@/lib/tv-storage';
import type {
  TvAgentStep,
  TvAgentStreamEvent,
  TvConnectPayload,
  TvManualInputPayload,
  TvPendingOrderApproval,
  TvPointerMarker,
  TvSessionInfo,
} from '@/lib/tv-engine-types';

interface CommandTurn {
  id: string;
  prompt: string;
  steps: TvAgentStep[];
  summary: string | null;
  error: string | null;
  pendingOrder: TvPendingOrderApproval | null;
  statusMessage: string | null;
  isRunning: boolean;
  createdAt: number;
}

export function TvEngineWorkspace() {
  const [session, setSession] = useState<TvSessionInfo>({
    status: 'disconnected',
    url: 'https://www.tradingview.com/chart/',
    pageTitle: 'Not Connected',
    accountLabel: null,
    viewportWidth: 1440,
    viewportHeight: 900,
    frameDataUrl: null,
    lastActionPointer: null,
    updatedAt: 0,
  });
  const [initialChecking, setInitialChecking] = useState(true);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showSwitchSessionConfirm, setShowSwitchSessionConfirm] = useState(false);

  const [manualMode, setManualMode] = useState<boolean>(false);
  const [manualTypeText, setManualTypeText] = useState('');
  const [isManualSending, setIsManualSending] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [isRefreshingFrame, setIsRefreshingFrame] = useState(false);

  const orderLock = true;
  const [turns, setTurns] = useState<CommandTurn[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  const [activeSignal, setActiveSignal] = useState<TradingSignalResponse | null>(null);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [isAnalyzingChart, setIsAnalyzingChart] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [layoutSaveSuccess, setLayoutSaveSuccess] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const isConnected =
    session.status === 'connected_auth' || session.status === 'connected_guest';

  // Hydrate workspace state safely on client mount to eliminate SSR hydration mismatch
  useEffect(() => {
    const persisted = loadTvWorkspaceState();
    if (persisted) {
      if (persisted.activeSignal) setActiveSignal(persisted.activeSignal);
      if (typeof persisted.manualMode === 'boolean') {
        setManualMode(persisted.manualMode);
      }
    }
    setIsHydrated(true);
  }, []);

  // Save workspace state whenever active state changes, ONLY AFTER initial hydration
  useEffect(() => {
    if (!isHydrated) return;
    saveTvWorkspaceState({
      activeSignal,
      orderLock,
      manualMode,
    });
  }, [isHydrated, activeSignal, manualMode]);

  // Ensure state is flushed when switching tabs or navigating away
  useEffect(() => {
    if (!isHydrated) return;
    const handleFlush = () => {
      saveTvWorkspaceState({
        activeSignal,
        orderLock,
        manualMode,
      });
    };
    window.addEventListener('pagehide', handleFlush);
    window.addEventListener('beforeunload', handleFlush);
    return () => {
      window.removeEventListener('pagehide', handleFlush);
      window.removeEventListener('beforeunload', handleFlush);
    };
  }, [isHydrated, activeSignal, manualMode]);

  const fetchSessionStatus = useCallback(
    async (refresh = false, auto = false) => {
      try {
        const params = new URLSearchParams();
        if (refresh) params.set('refresh', '1');
        if (auto) params.set('auto', '1');
        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await fetch(`/api/tv-engine/session${qs}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as TvSessionInfo;
        setSession(data);
      } catch {
        // ignore transient network check
      } finally {
        setInitialChecking(false);
      }
    },
    []
  );

  useEffect(() => {
    const hasCreds = Boolean(getTvCredentials());
    void fetchSessionStatus(false, hasCreds);
  }, [fetchSessionStatus]);

  // Gentle live frame refresh when connected and idle so live candles stay current
  useEffect(() => {
    if (!isConnected || isAgentRunning) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchSessionStatus(true, false);
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [isConnected, isAgentRunning, fetchSessionStatus]);

  const handleConnect = async (payload: TvConnectPayload) => {
    setIsConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/tv-engine/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as TvSessionInfo & { error?: string };
      if (!res.ok || data.status === 'error') {
        setConnectError(data.error || data.errorMessage || 'Could not launch browser.');
        return;
      }
      setSession(data);
      setConnectModalOpen(false);
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : 'Network error connecting session.'
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleQuickGuestLaunch = async () => {
    setConnectError(null);
    setIsConnecting(true);
    setSession((prev) => ({ ...prev, status: 'launching' }));
    try {
      const res = await fetch('/api/tv-engine/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'guest' }),
      });
      const data = (await res.json()) as TvSessionInfo & { error?: string };
      if (!res.ok || data.status === 'error') {
        setSession((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: data.error || 'Failed to launch guest session.',
        }));
        return;
      }
      setSession(data);
    } catch {
      setSession((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: 'Failed to launch guest session.',
      }));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (isAgentRunning) {
      abortControllerRef.current?.abort();
    }
    try {
      const res = await fetch('/api/tv-engine/session', { method: 'DELETE' });
      if (res.ok) {
        const data = (await res.json()) as TvSessionInfo;
        setSession(data);
      } else {
        setSession((prev) => ({
          ...prev,
          status: 'disconnected',
          frameDataUrl: null,
          accountLabel: null,
        }));
      }
      setManualMode(false);
    } catch {
      // ignore
    }
  };

  const handleRefreshFrame = async () => {
    if (!isConnected || isRefreshingFrame) return;
    setIsRefreshingFrame(true);
    try {
      await fetchSessionStatus(true);
    } finally {
      setIsRefreshingFrame(false);
    }
  };

  const handleDownloadSnapshot = () => {
    if (!session.frameDataUrl) return;
    const link = document.createElement('a');
    link.href = session.frameDataUrl;
    const slug = (session.pageTitle || 'tradingview')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 36);
    link.download = `TraceFX-TV-${slug}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sendManualInput = useCallback(async (payload: TvManualInputPayload) => {
    setIsManualSending(true);
    try {
      const res = await fetch('/api/tv-engine/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as TvSessionInfo;
      setSession(updated);
    } catch {
      // ignore
    } finally {
      setIsManualSending(false);
    }
  }, []);

  const handleManualSaveLayout = async () => {
    if (!isConnected || isSavingLayout) return;
    setIsSavingLayout(true);
    setLayoutSaveSuccess(false);
    try {
      await sendManualInput({ type: 'save_layout' });
      setLayoutSaveSuccess(true);
      setTimeout(() => setLayoutSaveSuccess(false), 2600);
    } finally {
      setIsSavingLayout(false);
    }
  };

  const computeNormCoords = (
    e: React.PointerEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1000, Math.round(((e.clientX - rect.left) / rect.width) * 1000))
    );
    const y = Math.max(
      0,
      Math.min(1000, Math.round(((e.clientY - rect.top) / rect.height) * 1000))
    );
    return { x, y };
  };

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!manualMode || !isConnected || isAgentRunning) return;
    e.currentTarget.focus();
    dragStartRef.current = computeNormCoords(e);
  };

  const handleViewportPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!manualMode || !isConnected || isAgentRunning || !dragStartRef.current) {
      return;
    }
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const end = computeNormCoords(e);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);

    if (dist > 18) {
      void sendManualInput({
        type: 'drag',
        fromX: start.x,
        fromY: start.y,
        toX: end.x,
        toY: end.y,
      });
    } else {
      void sendManualInput({
        type: 'click',
        x: end.x,
        y: end.y,
        button: e.button === 2 ? 'right' : 'left',
      });
    }
  };

  const handleViewportKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!manualMode || !isConnected || isAgentRunning) return;
    // Ignore pure modifier presses
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    let chord = e.key;
    if (e.altKey && e.code.startsWith('Key')) {
      chord = `Alt+${e.code}`;
    } else if ((e.ctrlKey || e.metaKey) && e.code.startsWith('Key')) {
      chord = `Control+${e.code}`;
    }
    void sendManualInput({ type: 'key', key: chord });
  };

  const runAgentCommand = async (
    instruction: string,
    allowOrderExecution = false
  ) => {
    const trimmed = instruction.trim();
    if (!trimmed || isAgentRunning) return;

    const turnId = `turn-${Date.now()}`;

    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        prompt: allowOrderExecution ? 'Approved order placement' : trimmed,
        steps: [],
        summary: null,
        error: null,
        pendingOrder: null,
        statusMessage: 'Starting AI control loop...',
        isRunning: true,
        createdAt: Date.now(),
      },
    ]);

    setIsAgentRunning(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/tv-engine/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          orderLock,
          allowOrderExecution,
          history: [],
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || 'Failed to start AI TradingView agent.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const chunk of parts) {
          const line = chunk
            .split('\n')
            .find((l) => l.startsWith('data: '));
          if (!line) continue;

          let event: TvAgentStreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as TvAgentStreamEvent;
          } catch {
            continue;
          }

          if (event.type === 'status') {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId ? { ...t, statusMessage: event.message } : t
              )
            );
          } else if (event.type === 'frame') {
            setSession((prev) => ({
              ...prev,
              frameDataUrl: event.frameDataUrl,
              pageTitle: event.pageTitle || prev.pageTitle,
              url: event.url || prev.url,
              lastActionPointer:
                event.pointer !== undefined
                  ? event.pointer
                  : prev.lastActionPointer,
              updatedAt: Date.now(),
            }));
          } else if (event.type === 'step') {
            setTurns((prev) =>
              prev.map((t) => {
                if (t.id !== turnId) return t;
                const existingIdx = t.steps.findIndex(
                  (s) => s.id === event.step.id
                );
                const nextSteps =
                  existingIdx >= 0
                    ? t.steps.map((s, idx) =>
                        idx === existingIdx ? event.step : s
                      )
                    : [...t.steps, event.step];
                return { ...t, steps: nextSteps };
              })
            );
          } else if (event.type === 'signal') {
            setActiveSignal(event.signal);
          } else if (event.type === 'order_approval_needed') {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      pendingOrder: event.order,
                      summary: event.message,
                      statusMessage: null,
                      isRunning: false,
                    }
                  : t
              )
            );
          } else if (event.type === 'complete') {
            if (event.signal) {
              setActiveSignal(event.signal);
            }
            if (event.frameDataUrl) {
              setSession((prev) => ({
                ...prev,
                frameDataUrl: event.frameDataUrl,
                updatedAt: Date.now(),
              }));
            }
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      summary: event.summary,
                      statusMessage: null,
                      isRunning: false,
                    }
                  : t
              )
            );
          } else if (event.type === 'error') {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      error: event.message,
                      statusMessage: null,
                      isRunning: false,
                    }
                  : t
              )
            );
          }
        }
      }
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('Stopped'));
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                error: aborted
                  ? 'Stopped by user.'
                  : err instanceof Error
                  ? err.message
                  : 'Agent loop interrupted.',
                statusMessage: null,
                isRunning: false,
              }
            : t
        )
      );
    } finally {
      setIsAgentRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopAgent = () => {
    abortControllerRef.current?.abort();
  };

  const handleAnalyzeLiveChart = async (customPrompt?: string) => {
    if (isAnalyzingChart) return;
    setIsAnalyzingChart(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/tv-engine/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frameDataUrl: session.frameDataUrl,
          customPrompt,
        }),
      });
      const data = (await res.json()) as {
        signal?: TradingSignalResponse;
        error?: string;
      };
      if (!res.ok || !data.signal) {
        throw new Error(data.error || 'Failed to analyze live TradingView chart.');
      }
      setActiveSignal(data.signal);

    } catch (err) {
      setAnalyzeError(
        err instanceof Error ? err.message : 'Analysis could not be completed.'
      );
    } finally {
      setIsAnalyzingChart(false);
    }
  };

  const handleMarkSetupOnChart = (targetSignal: TradingSignalResponse) => {
    const prompt = `Mark this ${targetSignal.signalType} setup on the chart: draw horizontal line at entry ${targetSignal.entryPrice}, horizontal line at stop loss ${targetSignal.stopLoss}, and horizontal line at take profit ${targetSignal.takeProfit1}.`;
    void runAgentCommand(prompt);
  };

  const handleOpenOrderTicket = (targetSignal: TradingSignalResponse) => {
    const prompt = `Open the TradingView Order Ticket for a ${targetSignal.signalType} order at entry ${targetSignal.entryPrice} with Stop Loss ${targetSignal.stopLoss} and Take Profit ${targetSignal.takeProfit1}.`;
    void runAgentCommand(prompt);
  };

  const renderPointerOverlay = (pointer: TvPointerMarker | null) => {
    if (!pointer) return null;
    const hasEnd =
      typeof pointer.endX === 'number' && typeof pointer.endY === 'number';
    return (
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {hasEnd && (
          <line
            x1={pointer.x}
            y1={pointer.y}
            x2={pointer.endX}
            y2={pointer.endY}
            stroke="#38BDF8"
            strokeWidth="2.5"
            strokeDasharray="6 4"
          />
        )}
        <circle
          cx={hasEnd ? pointer.endX : pointer.x}
          cy={hasEnd ? pointer.endY : pointer.y}
          r="10"
          fill="rgba(56, 189, 248, 0.22)"
          stroke="#38BDF8"
          strokeWidth="2"
        />
        <circle
          cx={hasEnd ? pointer.endX : pointer.x}
          cy={hasEnd ? pointer.endY : pointer.y}
          r="3"
          fill="#38BDF8"
        />
      </svg>
    );
  };

  const pendingOrderTurn = turns.find((turn) => turn.pendingOrder);
  const latestAgentTurn = turns[turns.length - 1];

  const headerRightAction = isConnected ? (
    <button
      type="button"
      onClick={() => setShowDisconnectConfirm(true)}
      className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111726] px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:border-rose-500/40 hover:text-rose-300 transition-colors whitespace-nowrap shrink-0"
    >
      <Power className="h-3.5 w-3.5 text-rose-400" />
      <span>Disconnect</span>
    </button>
  ) : (
    <button
      type="button"
      onClick={() => {
        setConnectError(null);
        setConnectModalOpen(true);
      }}
      className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
    >
      <Plug className="h-3.5 w-3.5" />
      <span>Connect Session</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col">
      <AppHeaderWithSidebar
        activeRoute="tv-engine"
        rightAction={headerRightAction}
      />

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 lg:px-8">
        {/* Clean Page Header */}
        <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl sm:text-2xl font-bold tracking-tight text-white [text-wrap:balance]">
              TradingView Autonomous Control Engine
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-400 max-w-2xl">
              Live TradingView chart connection, AI technical analysis, trade setups, and essential chart actions in one focused workspace.
            </p>
          </div>

          {isConnected && (
            <button
              type="button"
              onClick={() => setShowSwitchSessionConfirm(true)}
              className="self-start sm:self-auto text-xs font-medium text-sky-400 hover:text-sky-300 underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Switch Session Cookies
            </button>
          )}
        </div>

        {/* Balanced 12-Column Stretched Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 items-start gap-5">
          {/* Left 8 Columns: Live TradingView Browser Stage + Setup Card Below */}
          <div className="lg:col-span-12 flex flex-col gap-4">
            <section
              aria-label="Live TradingView Browser Viewport"
              className="flex flex-col rounded-xl border border-slate-800/80 bg-[#0E1422] overflow-hidden"
            >
              {/* Stage Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 border-b border-slate-800/80 px-3 py-2 sm:px-4 sm:py-2.5">
                {/* Unboxed Metadata with Typographic Separators */}
                <div className="flex items-center gap-2 text-xs min-w-0 w-full sm:w-auto overflow-hidden">
                  <span
                    className={
                      session.status === 'connected_auth'
                        ? 'font-medium text-emerald-400 whitespace-nowrap shrink-0'
                        : session.status === 'connected_guest'
                        ? 'font-medium text-sky-400 whitespace-nowrap shrink-0'
                        : session.status === 'launching'
                        ? 'font-medium text-amber-400 whitespace-nowrap shrink-0'
                        : 'text-slate-500 whitespace-nowrap shrink-0'
                    }
                  >
                    {session.status === 'connected_auth'
                      ? 'Connected'
                      : session.status === 'connected_guest'
                      ? 'Guest Session'
                      : session.status === 'launching'
                      ? 'Launching...'
                      : 'Offline'}
                  </span>

                  {session.accountLabel && (
                    <>
                      <span className="text-slate-600 shrink-0" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-300 whitespace-nowrap truncate max-w-[120px] sm:max-w-none">
                        {session.accountLabel}
                      </span>
                    </>
                  )}

                  {isConnected && session.pageTitle && (
                    <>
                      <span className="text-slate-600 shrink-0" aria-hidden="true">
                        ·
                      </span>
                      <span className="truncate text-slate-400 max-w-[140px] xs:max-w-[180px] sm:max-w-[280px]">
                        {session.pageTitle}
                      </span>
                    </>
                  )}
                </div>

                {/* Interactive Viewport Controls (Mobile Scrollable & Touch-Friendly) */}
                {isConnected && (
                  <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
                    <button
                      type="button"
                      disabled={isAgentRunning || isAnalyzingChart}
                      onClick={() => void handleAnalyzeLiveChart()}
                      title="Run AI vision analysis on live TradingView screen"
                      className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-500/22 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                    >
                      <ScanLine className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      <span>
                        <span className="sm:hidden">Analyze</span>
                        <span className="hidden sm:inline">Analyze Chart</span>
                      </span>
                    </button>

                    {isAgentRunning && (
                      <button
                        type="button"
                        onClick={handleStopAgent}
                        className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 whitespace-nowrap shrink-0"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                        <span>Stop AI</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isAgentRunning || isSavingLayout}
                      onClick={() => void handleManualSaveLayout()}
                      title="Save current TradingView chart layout (Ctrl+S / Cloud Save)"
                      className={`flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                        layoutSaveSuccess
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      {layoutSaveSuccess ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span className="text-emerald-300">
                            <span className="sm:hidden">Saved</span>
                            <span className="hidden sm:inline">Layout Saved</span>
                          </span>
                        </>
                      ) : isSavingLayout ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span>
                            <span className="sm:hidden">Save</span>
                            <span className="hidden sm:inline">Save Layout</span>
                          </span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isAgentRunning}
                      onClick={() => setManualMode((v) => !v)}
                      title="Toggle direct clicks, drags, and keystrokes to TradingView"
                      className={`flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        manualMode
                          ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                          : 'border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white'
                      } disabled:opacity-40`}
                    >
                      <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        <span className="sm:hidden">Manual</span>
                        <span className="hidden sm:inline">Manual Control</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleRefreshFrame}
                      disabled={isRefreshingFrame}
                      aria-label="Refresh viewport frame"
                      className="flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-40"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          isRefreshingFrame || isManualSending ? 'animate-spin' : ''
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadSnapshot}
                      aria-label="Download TradingView screenshot"
                      className="flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setFullscreenOpen(true)}
                      aria-label="Expand viewport fullscreen"
                      className="flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Auth Cookie Notice Row (if expired or guest fallback) */}
              {session.authNotice && (
                <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 sm:px-4 text-xs text-amber-300">
                  <span className="truncate">{session.authNotice}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isConnected) {
                        setShowSwitchSessionConfirm(true);
                      } else {
                        setConnectError(null);
                        setConnectModalOpen(true);
                      }
                    }}
                    className="font-medium underline underline-offset-2 whitespace-nowrap shrink-0"
                  >
                    Update Cookies
                  </button>
                </div>
              )}

              {/* Mobile-Friendly Manual Keyboard Bar when Manual Control is toggled ON */}
              {isConnected && manualMode && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 border-b border-slate-800/80 bg-[#0B101B] px-3 py-2 sm:px-4">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
                    <Keyboard className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                    <span className="sm:hidden">Send keys to TV:</span>
                    <span className="hidden sm:inline">Click/drag on chart, or send keys:</span>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!manualTypeText.trim()) return;
                      void sendManualInput({
                        type: 'type',
                        text: manualTypeText,
                        pressEnter: true,
                      });
                      setManualTypeText('');
                    }}
                    className="flex flex-1 w-full sm:w-auto items-center gap-1.5 min-w-0"
                  >
                    <input
                      type="text"
                      value={manualTypeText}
                      onChange={(e) => setManualTypeText(e.target.value)}
                      placeholder="Type symbol or text + Enter..."
                      className="flex-1 min-w-0 min-h-[32px] rounded-md border border-slate-800 bg-[#090D16] px-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="min-h-[32px] rounded-md bg-slate-800 px-3 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendManualInput({ type: 'key', key: 'Escape' })}
                      className="min-h-[32px] rounded-md border border-slate-800 px-2.5 text-xs text-slate-300 hover:text-white whitespace-nowrap shrink-0"
                    >
                      Esc
                    </button>
                  </form>
                </div>
              )}

            {/* 16:10 Viewport Canvas */}
            <div className="relative aspect-[16/10] w-full bg-[#090D16] flex items-center justify-center select-none">
              {initialChecking || session.status === 'launching' ? (
                <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
                  <p className="text-sm font-medium text-slate-200">
                    {session.status === 'launching'
                      ? 'Launching headless Chromium & opening TradingView...'
                      : 'Checking active browser session...'}
                  </p>
                </div>
              ) : !isConnected || !session.frameDataUrl ? (
                <div className="mx-auto max-w-md px-6 py-10 text-center space-y-4">
                  <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-white [text-wrap:balance]">
                    No Active TradingView Browser Session
                  </h2>
                  <p className="text-xs sm:text-sm leading-relaxed text-slate-400">
                    Import your TradingView <span className="font-[family-name:var(--font-mono)] text-slate-200">sessionid</span> cookie to load your logged-in layouts, private indicators, and paper trading panel, or start an instant Guest Chart.
                  </p>
                  {session.errorMessage && (
                    <p className="text-xs text-rose-400">{session.errorMessage}</p>
                  )}
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setConnectError(null);
                        setConnectModalOpen(true);
                      }}
                      className="w-full sm:w-auto min-h-[42px] rounded-lg bg-sky-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap"
                    >
                      Connect TradingView Cookies
                    </button>
                    <button
                      type="button"
                      disabled={isConnecting}
                      onClick={handleQuickGuestLaunch}
                      className="w-full sm:w-auto min-h-[42px] rounded-lg border border-slate-800 bg-[#111726] px-4 py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      Launch Guest Chart
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  tabIndex={manualMode ? 0 : -1}
                  onPointerDown={handleViewportPointerDown}
                  onPointerUp={handleViewportPointerUp}
                  onKeyDown={handleViewportKeyDown}
                  onContextMenu={(e) => {
                    if (manualMode) e.preventDefault();
                  }}
                  onWheel={(e) => {
                    if (!manualMode || !isConnected || isAgentRunning) return;
                    const coords = computeNormCoords(e);
                    void sendManualInput({
                      type: 'wheel',
                      x: coords.x,
                      y: coords.y,
                      deltaX: e.deltaX,
                      deltaY: e.deltaY,
                    });
                  }}
                  className={`relative h-full w-full focus:outline-none ${
                    manualMode ? 'cursor-crosshair ring-1 ring-inset ring-sky-500/40' : ''
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={session.frameDataUrl}
                    alt={`Live TradingView viewport: ${session.pageTitle}`}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="h-full w-full object-contain"
                  />
                  {renderPointerOverlay(session.lastActionPointer)}
                </div>
              )}
            </div>
          </section>

          {/* Ready-to-Trade Setup Card Below the Chart Terminal */}
          <TvTradeSetupCard
            signal={activeSignal}
            isLoading={isAnalyzingChart}
            error={analyzeError}
            isConnected={isConnected}
            chartFrameUrl={session.frameDataUrl}
            onAnalyze={handleAnalyzeLiveChart}
            onMarkOnChart={handleMarkSetupOnChart}
            onOpenOrderTicket={handleOpenOrderTicket}
            onDismiss={() => setActiveSignal(null)}
          />

          {isAgentRunning && (
            <div className="flex items-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-4 py-3 text-xs text-sky-200">
              <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
              <span>{latestAgentTurn?.statusMessage || 'AI is carrying out the requested chart action...'}</span>
            </div>
          )}

          {latestAgentTurn?.error && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-300">
              {latestAgentTurn.error}
            </div>
          )}

          {pendingOrderTurn?.pendingOrder && !isAgentRunning && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
              <div className="text-sm font-semibold text-amber-200">Order approval required</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                {pendingOrderTurn.pendingOrder.summary}. Review the order ticket in TradingView before approving submission.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const resume = pendingOrderTurn.pendingOrder?.resumePrompt;
                    if (!resume) return;
                    setTurns((prev) => prev.map((item) => item.id === pendingOrderTurn.id ? { ...item, pendingOrder: null } : item));
                    void runAgentCommand(resume, true);
                  }}
                  className="min-h-[38px] rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Approve &amp; Place Order
                </button>
                <button
                  type="button"
                  onClick={() => setTurns((prev) => prev.map((item) => item.id === pendingOrderTurn.id ? { ...item, pendingOrder: null, summary: 'Order placement canceled.' } : item))}
                  className="min-h-[38px] rounded-lg border border-slate-700 bg-[#111726] px-4 py-2 text-xs text-slate-300 hover:text-white"
                >
                  Cancel Order
                </button>
              </div>
            </div>
          )}
        </div>


      </main>

      {/* Connect Session Modal */}
      <TvSessionModal
        open={connectModalOpen}
        isConnecting={isConnecting}
        errorMessage={connectError}
        onClose={() => setConnectModalOpen(false)}
        onConnect={handleConnect}
      />

      {/* Confirmation Dialog: Disconnect Session */}
      <TvConfirmDialog
        open={showDisconnectConfirm}
        title="Disconnect TradingView Session?"
        description="This will terminate the active cloud browser session and stop any ongoing AI agent tasks. Any unsaved chart changes or temporary drawings in TradingView will be closed."
        confirmLabel="Disconnect"
        cancelLabel="Keep Connected"
        variant="danger"
        icon={<Power className="h-4 w-4 text-rose-400" />}
        onConfirm={() => {
          setShowDisconnectConfirm(false);
          void handleDisconnect();
        }}
        onCancel={() => setShowDisconnectConfirm(false)}
      />

      {/* Confirmation Dialog: Switch Session Cookies */}
      <TvConfirmDialog
        open={showSwitchSessionConfirm}
        title="Switch Session Cookies?"
        description="You currently have an active TradingView browser session. Switching cookies will replace your current session credentials and reload the chart view. Do you want to proceed?"
        confirmLabel="Continue to Switch"
        cancelLabel="Cancel"
        variant="primary"
        icon={<Plug className="h-4 w-4 text-sky-400" />}
        onConfirm={() => {
          setShowSwitchSessionConfirm(false);
          setConnectError(null);
          setConnectModalOpen(true);
        }}
        onCancel={() => setShowSwitchSessionConfirm(false)}
      />

      {/* Fullscreen Viewport Inspector */}
      {fullscreenOpen && session.frameDataUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#060910]/95 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2 text-xs text-slate-300 truncate">
              <span className="font-semibold text-white">
                TradingView Live Viewport
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="truncate">{session.pageTitle}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadSnapshot}
                className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111726] px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={() => setFullscreenOpen(false)}
                aria-label="Close fullscreen view"
                className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
            <div className="relative aspect-[16/10] max-h-full max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={session.frameDataUrl}
                alt={`Fullscreen TradingView viewport: ${session.pageTitle}`}
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain rounded-lg border border-slate-800/80"
              />
              {renderPointerOverlay(session.lastActionPointer)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Square,
  RefreshCw,
  Maximize2,
  X,
  Download,
  MousePointerClick,
  ShieldCheck,
  ShieldOff,
  Plug,
  Power,
  Loader2,
  Keyboard,
} from 'lucide-react';
import { AppHeaderWithSidebar } from '@/components/navigation-sidebar';
import { TvSessionModal } from '@/components/tv-session-modal';
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

const STARTER_COMMANDS = [
  'Switch symbol to OANDA:XAUUSD on 15m and reset chart view',
  'Open Indicators and add Moving Average Exponential and RSI',
  'Mark the main visible resistance and support swing levels with horizontal lines',
  'Open the Paper Trading / Order Ticket panel so we can set up a trade',
];

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
    updatedAt: Date.now(),
  });
  const [initialChecking, setInitialChecking] = useState(true);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [manualMode, setManualMode] = useState(false);
  const [manualTypeText, setManualTypeText] = useState('');
  const [isManualSending, setIsManualSending] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [isRefreshingFrame, setIsRefreshingFrame] = useState(false);

  const [orderLock, setOrderLock] = useState(true);
  const [promptInput, setPromptInput] = useState('');
  const [turns, setTurns] = useState<CommandTurn[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const isConnected =
    session.status === 'connected_auth' || session.status === 'connected_guest';

  const fetchSessionStatus = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(
        `/api/tv-engine/session${refresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = (await res.json()) as TvSessionInfo;
      setSession(data);
    } catch {
      // ignore transient network check
    } finally {
      setInitialChecking(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessionStatus(false);
  }, [fetchSessionStatus]);

  // Gentle live frame refresh when connected and idle so live candles stay current
  useEffect(() => {
    if (!isConnected || isAgentRunning) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchSessionStatus(true);
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [isConnected, isAgentRunning, fetchSessionStatus]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, isAgentRunning]);

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
    const historyPayload = turns.slice(-4).flatMap((t) => {
      const items: Array<{ role: 'user' | 'assistant'; text: string }> = [
        { role: 'user', text: t.prompt },
      ];
      if (t.summary) {
        items.push({ role: 'assistant', text: t.summary });
      }
      return items;
    });

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

    if (!allowOrderExecution) {
      setPromptInput('');
    }
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
          history: historyPayload,
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

  const headerRightAction = isConnected ? (
    <button
      type="button"
      onClick={handleDisconnect}
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
              Direct cloud Playwright session connected to your TradingView workspace—control symbols, timeframes, private indicators, drawings, alerts, and orders with natural language.
            </p>
          </div>

          {isConnected && (
            <button
              type="button"
              onClick={() => {
                setConnectError(null);
                setConnectModalOpen(true);
              }}
              className="self-start sm:self-auto text-xs font-medium text-sky-400 hover:text-sky-300 underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Switch Session Cookies
            </button>
          )}
        </div>

        {/* Balanced 12-Column Stretched Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch gap-5">
          {/* Left 8 Columns: Live TradingView Browser Stage */}
          <section
            aria-label="Live TradingView Browser Viewport"
            className="lg:col-span-8 flex flex-col rounded-xl border border-slate-800/80 bg-[#0E1422] overflow-hidden"
          >
            {/* Stage Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-2.5">
              {/* Unboxed Metadata with Typographic Separators */}
              <div className="flex items-center gap-2 text-xs min-w-0">
                <span
                  className={
                    session.status === 'connected_auth'
                      ? 'font-medium text-emerald-400 whitespace-nowrap'
                      : session.status === 'connected_guest'
                      ? 'font-medium text-sky-400 whitespace-nowrap'
                      : session.status === 'launching'
                      ? 'font-medium text-amber-400 whitespace-nowrap'
                      : 'text-slate-500 whitespace-nowrap'
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
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-300 whitespace-nowrap">
                      {session.accountLabel}
                    </span>
                  </>
                )}

                {isConnected && session.pageTitle && (
                  <>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="truncate text-slate-400 max-w-[220px] sm:max-w-[300px]">
                      {session.pageTitle}
                    </span>
                  </>
                )}
              </div>

              {/* Interactive Viewport Controls */}
              {isConnected && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isAgentRunning}
                    onClick={() => setManualMode((v) => !v)}
                    className={`flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      manualMode
                        ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                        : 'border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white'
                    } disabled:opacity-40`}
                  >
                    <MousePointerClick className="h-3.5 w-3.5" />
                    <span>Manual Control</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRefreshFrame}
                    disabled={isRefreshingFrame}
                    aria-label="Refresh viewport frame"
                    className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-40"
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
                    className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setFullscreenOpen(true)}
                    aria-label="Expand viewport fullscreen"
                    className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-slate-300 hover:border-slate-700 hover:text-white"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Auth Cookie Notice Row (if expired or guest fallback) */}
            {session.authNotice && (
              <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">
                <span>{session.authNotice}</span>
                <button
                  type="button"
                  onClick={() => setConnectModalOpen(true)}
                  className="font-medium underline underline-offset-2 whitespace-nowrap shrink-0"
                >
                  Update Cookies
                </button>
              </div>
            )}

            {/* Mobile-Friendly Manual Keyboard Bar when Manual Control is toggled ON */}
            {isConnected && manualMode && (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-[#0B101B] px-4 py-2">
                <Keyboard className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="text-xs text-slate-400 whitespace-nowrap">
                  Click or drag directly on the chart below, or send text:
                </span>
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
                  className="flex flex-1 min-w-[180px] items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={manualTypeText}
                    onChange={(e) => setManualTypeText(e.target.value)}
                    placeholder="Type symbol or text + Enter..."
                    className="flex-1 min-h-[32px] rounded-md border border-slate-800 bg-[#090D16] px-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="min-h-[32px] rounded-md bg-slate-800 px-2.5 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap"
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendManualInput({ type: 'key', key: 'Escape' })}
                    className="min-h-[32px] rounded-md border border-slate-800 px-2.5 text-xs text-slate-300 hover:text-white whitespace-nowrap"
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
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setConnectError(null);
                        setConnectModalOpen(true);
                      }}
                      className="min-h-[42px] rounded-lg bg-sky-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap"
                    >
                      Connect TradingView Cookies
                    </button>
                    <button
                      type="button"
                      disabled={isConnecting}
                      onClick={handleQuickGuestLaunch}
                      className="min-h-[42px] rounded-lg border border-slate-800 bg-[#111726] px-4 py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap disabled:opacity-50"
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

          {/* Right 4 Columns: AI Command & Step Feed */}
          <section
            aria-label="AI TradingView Operator"
            className="lg:col-span-4 flex flex-col rounded-xl border border-slate-800/80 bg-[#0E1422] min-h-[500px] lg:max-h-[calc(100vh-170px)]"
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-white whitespace-nowrap">
                  AI Control Thread
                </h2>
                {turns.length > 0 && !isAgentRunning && (
                  <button
                    type="button"
                    onClick={() => setTurns([])}
                    className="text-xs text-slate-500 hover:text-slate-300 whitespace-nowrap"
                  >
                    · Clear
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOrderLock((v) => !v)}
                title="When enabled, the AI pauses for your confirmation before clicking any final trade order submission button."
                className={`flex min-h-[32px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  orderLock
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                }`}
              >
                {orderLock ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Order Lock: On</span>
                  </>
                ) : (
                  <>
                    <ShieldOff className="h-3.5 w-3.5" />
                    <span>Order Lock: Off</span>
                  </>
                )}
              </button>
            </div>

            {/* Action Log / Starter Prompts */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              {turns.length === 0 ? (
                <div className="space-y-4">
                  <p className="text-xs leading-relaxed text-slate-400">
                    {isConnected
                      ? 'Describe any action or multi-step workflow. The model inspects the live TradingView screen after each step until complete.'
                      : 'Connect your TradingView cookies (or launch a Guest Chart) first, then choose a starter task or type any command below.'}
                  </p>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-300">
                      Quick Starter Commands
                    </p>
                    <div className="divide-y divide-slate-800/70 border-y border-slate-800/70">
                      {STARTER_COMMANDS.map((cmd) => (
                        <button
                          key={cmd}
                          type="button"
                          disabled={!isConnected || isAgentRunning}
                          onClick={() => void runAgentCommand(cmd)}
                          className="w-full py-2.5 text-left text-xs text-slate-300 hover:text-sky-300 transition-colors disabled:opacity-45"
                        >
                          {cmd}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {turns.map((turn) => (
                    <div key={turn.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                      <div className="text-xs font-semibold text-white">
                        {turn.prompt}
                      </div>

                      {turn.steps.length > 0 && (
                        <div className="space-y-1.5">
                          {turn.steps.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-baseline justify-between gap-2 text-xs"
                            >
                              <div className="flex items-baseline gap-2 min-w-0">
                                <span className="font-[family-name:var(--font-mono)] text-[11px] text-slate-500 tabular-nums shrink-0">
                                  {String(s.stepNumber).padStart(2, '0')}.
                                </span>
                                <span className="text-slate-300 break-words">
                                  {s.description}
                                </span>
                              </div>
                              <span
                                className={`font-[family-name:var(--font-mono)] text-[11px] shrink-0 whitespace-nowrap ${
                                  s.status === 'done'
                                    ? 'text-emerald-400'
                                    : s.status === 'running'
                                    ? 'text-sky-400'
                                    : s.status === 'blocked_order'
                                    ? 'text-amber-400'
                                    : 'text-rose-400'
                                }`}
                              >
                                {s.status === 'done'
                                  ? 'Done'
                                  : s.status === 'running'
                                  ? 'Running'
                                  : s.status === 'blocked_order'
                                  ? 'Locked'
                                  : 'Check'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {turn.isRunning && turn.statusMessage && (
                        <div className="flex items-center gap-2 text-xs text-sky-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <span>{turn.statusMessage}</span>
                        </div>
                      )}

                      {turn.pendingOrder && !isAgentRunning && (
                        <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                          <div className="text-xs font-medium text-amber-300">
                            Confirm Order: {turn.pendingOrder.summary}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const resume = turn.pendingOrder?.resumePrompt;
                                if (!resume) return;
                                setTurns((prev) =>
                                  prev.map((item) =>
                                    item.id === turn.id
                                      ? { ...item, pendingOrder: null }
                                      : item
                                  )
                                );
                                void runAgentCommand(resume, true);
                              }}
                              className="min-h-[36px] rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap"
                            >
                              Approve &amp; Place Order
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setTurns((prev) =>
                                  prev.map((item) =>
                                    item.id === turn.id
                                      ? {
                                          ...item,
                                          pendingOrder: null,
                                          summary: 'Order placement canceled.',
                                        }
                                      : item
                                  )
                                )
                              }
                              className="min-h-[36px] rounded-lg border border-slate-800 bg-[#111726] px-3 py-1.5 text-xs text-slate-300 hover:text-white whitespace-nowrap"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {turn.summary && !turn.pendingOrder && (
                        <p className="text-xs leading-relaxed text-slate-300 whitespace-pre-line">
                          {turn.summary}
                        </p>
                      )}

                      {turn.error && (
                        <p className="text-xs text-rose-400">{turn.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div ref={feedEndRef} />
            </div>

            {/* Command Input Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isConnected) {
                  setConnectModalOpen(true);
                  return;
                }
                void runAgentCommand(promptInput);
              }}
              className="border-t border-slate-800/80 p-3"
            >
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!isConnected) {
                        setConnectModalOpen(true);
                        return;
                      }
                      void runAgentCommand(promptInput);
                    }
                  }}
                  placeholder={
                    isConnected
                      ? 'Command TradingView (e.g. Switch to EURUSD 1H and draw support)...'
                      : 'Connect session first, then enter any TradingView command...'
                  }
                  disabled={isAgentRunning}
                  className="flex-1 resize-none rounded-lg border border-slate-800 bg-[#090D16] px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none disabled:opacity-50"
                />

                {isAgentRunning ? (
                  <button
                    type="button"
                    onClick={handleStopAgent}
                    aria-label="Stop AI execution"
                    className="flex min-h-[42px] items-center gap-1.5 rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isConnected && !promptInput.trim()}
                    className="flex min-h-[42px] items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors disabled:opacity-45 whitespace-nowrap shrink-0"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{isConnected ? 'Run' : 'Connect'}</span>
                  </button>
                )}
              </div>
            </form>
          </section>
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

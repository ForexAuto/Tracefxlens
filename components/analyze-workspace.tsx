'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ScanLine, RotateCcw, Upload, Square } from 'lucide-react';
import { PairSelector } from '@/components/pair-selector';
import { TimeframeSelector } from '@/components/timeframe-selector';
import { ChartUploader } from '@/components/chart-uploader';
import { SignalResult } from '@/components/signal-result';
import { StopConfirmDialog } from '@/components/stop-confirm-dialog';
import { AppHeaderWithSidebar } from '@/components/navigation-sidebar';
import { TradingSessionHeader } from '@/components/trading-session-banner';
import {
  AnalysisStageItem,
  AnalyzeStreamEvent,
  createInitialAnalysisStages,
  TradingSignalResponse,
} from '@/lib/trading-data';
import {
  loadWorkspaceState,
  saveWorkspaceState,
} from '@/lib/workspace-storage';
import {
  recordSignalToHistory,
  syncHistoryWithServer,
} from '@/lib/history-storage';

export function AnalyzeWorkspace() {
  const [selectedPair, setSelectedPair] = useState<string>('XAU/USD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('H1');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [signal, setSignal] = useState<TradingSignalResponse | null>(null);
  const [stages, setStages] = useState<AnalysisStageItem[]>(() =>
    createInitialAnalysisStages('XAU/USD', 'H1')
  );
  const [progressPct, setProgressPct] = useState<number>(0);
  const [isRejected, setIsRejected] = useState<boolean>(false);
  const [isStopped, setIsStopped] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCompletingScan, setIsCompletingScan] = useState<boolean>(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestStateRef = useRef({
    selectedPair: 'XAU/USD',
    selectedTimeframe: 'H1',
    imageDataUrl: null as string | null,
    signal: null as TradingSignalResponse | null,
    rejectedFinding: null as string | null,
    wasAnalyzing: false,
  });

  useEffect(() => {
    latestStateRef.current = {
      selectedPair,
      selectedTimeframe,
      imageDataUrl,
      signal,
      rejectedFinding: isRejected ? stages[0]?.finding || null : null,
      wasAnalyzing: isAnalyzing,
    };
  }, [
    selectedPair,
    selectedTimeframe,
    imageDataUrl,
    signal,
    isRejected,
    stages,
    isAnalyzing,
  ]);

  const confirmStopAnalysis = useCallback(() => {
    setStopConfirmOpen(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsAnalyzing(false);
    setIsCompletingScan(false);
    setIsStopped(true);
    setError(null);

    setStages((prev) =>
      prev.map((item) =>
        item.status === 'active'
          ? {
              ...item,
              status: 'stopped',
              finding: 'Analysis stopped by user.',
            }
          : item
      )
    );

    const current = latestStateRef.current;
    void saveWorkspaceState({
      selectedPair: current.selectedPair,
      selectedTimeframe: current.selectedTimeframe,
      imageDataUrl: current.imageDataUrl,
      signal: current.signal,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  }, []);

  const executeAnalysis = useCallback(
    async (chartUrl: string, pair: string, timeframe: string) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsAnalyzing(true);
      setIsCompletingScan(false);
      setStopConfirmOpen(false);
      setIsRejected(false);
      setIsStopped(false);
      setError(null);
      setProgressPct(0);
      setStages(createInitialAnalysisStages(pair, timeframe));

      await saveWorkspaceState({
        selectedPair: pair,
        selectedTimeframe: timeframe,
        imageDataUrl: chartUrl,
        signal: null,
        rejectedFinding: null,
        wasAnalyzing: true,
      });

      if (controller.signal.aborted) return;

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageDataUrl: chartUrl,
            pair,
            timeframe,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errMsg = 'Failed to analyze chart screenshot.';
          try {
            const errJson = await response.json();
            if (errJson?.error) errMsg = errJson.error;
          } catch {
            // Ignore non-JSON error body
          }
          throw new Error(errMsg);
        }

        if (!response.body) {
          throw new Error('Streaming response body unavailable.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';
        let finalSignal: TradingSignalResponse | null = null;
        let chartRejected = false;
        let rejectedReason: string | null = null;
        let streamError: string | null = null;

        const applyStreamEvent = (evt: AnalyzeStreamEvent) => {
          if (controller.signal.aborted) return;

          if (evt.event === 'approval') {
            if (!evt.approved) {
              chartRejected = true;
              rejectedReason = evt.finding;
              setIsRejected(true);
              setProgressPct(0);
              setStages((prev) =>
                prev.map((item) =>
                  item.step === 1
                    ? {
                        ...item,
                        status: 'rejected',
                        finding: evt.finding,
                      }
                    : { ...item, status: 'locked' }
                )
              );
              return;
            }

            setProgressPct(20);
            setStages((prev) =>
              prev.map((item) => {
                if (item.step === 1) {
                  return {
                    ...item,
                    status: 'approved',
                    finding: evt.finding,
                  };
                }
                if (item.step === 2) {
                  return {
                    ...item,
                    status: 'active',
                    waitingText: `Streaming ${
                      evt.detectedTimeframe || timeframe
                    } swing structure from model...`,
                  };
                }
                return item;
              })
            );
            return;
          }

          if (evt.event === 'step') {
            const completedStep = evt.step;
            const nextStep = completedStep + 1;
            const nextProgress = Math.min(100, completedStep * 20);
            setProgressPct(nextProgress);

            setStages((prev) =>
              prev.map((item) => {
                if (item.step < completedStep && item.status !== 'approved' && item.status !== 'completed') {
                  return {
                    ...item,
                    status: item.step === 1 ? 'approved' : 'completed',
                    finding: item.finding || 'Verified by model.',
                  };
                }
                if (item.step === completedStep) {
                  return {
                    ...item,
                    status: 'completed',
                    finding: evt.finding,
                  };
                }
                if (item.step === nextStep && item.status === 'locked') {
                  return {
                    ...item,
                    status: 'active',
                    waitingText: 'Streaming live observation from model...',
                  };
                }
                return item;
              })
            );
            return;
          }

          if (evt.event === 'result') {
            finalSignal = evt.data;
            setProgressPct(100);
            setStages((prev) =>
              prev.map((item) =>
                item.status === 'active' || item.status === 'locked'
                  ? {
                      ...item,
                      status: item.step === 1 ? 'approved' : 'completed',
                      finding: item.finding || 'Verified by model.',
                    }
                  : item
              )
            );
            return;
          }

          if (evt.event === 'status') {
            setStages((prev) =>
              prev.map((item) =>
                item.status === 'active'
                  ? {
                      ...item,
                      waitingText: evt.message,
                    }
                  : item
              )
            );
            return;
          }

          if (evt.event === 'error') {
            streamError = evt.message;
          }
        };

        while (true) {
          if (controller.signal.aborted) {
            await reader.cancel().catch(() => {});
            return;
          }

          const { value, done } = await reader.read();
          if (done) break;

          if (controller.signal.aborted) {
            await reader.cancel().catch(() => {});
            return;
          }

          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed) as AnalyzeStreamEvent;
              applyStreamEvent(parsed);
            } catch {
              // Ignore malformed NDJSON line
            }
          }
        }

        if (controller.signal.aborted) return;

        if (lineBuffer.trim()) {
          try {
            const parsed = JSON.parse(lineBuffer.trim()) as AnalyzeStreamEvent;
            applyStreamEvent(parsed);
          } catch {
            // Ignore trailing fragment
          }
        }

        if (streamError) {
          throw new Error(streamError);
        }

        if (chartRejected) {
          abortControllerRef.current = null;
          setIsAnalyzing(false);
          setIsCompletingScan(false);
          await saveWorkspaceState({
            selectedPair: pair,
            selectedTimeframe: timeframe,
            imageDataUrl: chartUrl,
            signal: null,
            rejectedFinding: rejectedReason,
            wasAnalyzing: false,
          });
          return;
        }

        if (finalSignal) {
          await saveWorkspaceState({
            selectedPair: pair,
            selectedTimeframe: timeframe,
            imageDataUrl: chartUrl,
            signal: finalSignal,
            rejectedFinding: null,
            wasAnalyzing: false,
          });

          // Automatically archive signal & marked chart into Supabase + local History
          void recordSignalToHistory(finalSignal, chartUrl);

          if (controller.signal.aborted) return;

          setIsAnalyzing(false);
          setIsCompletingScan(true);
          await new Promise((resolve) => setTimeout(resolve, 340));

          if (controller.signal.aborted) return;

          abortControllerRef.current = null;
          setSignal(finalSignal);
          setIsCompletingScan(false);
        } else {
          throw new Error('Analysis stream ended without a final signal ticket.');
        }
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return;
        }

        abortControllerRef.current = null;
        const msg =
          err instanceof Error
            ? err.message
            : 'Network error while analyzing chart. Please try again.';
        setError(msg);
        setIsAnalyzing(false);
        setIsCompletingScan(false);

        await saveWorkspaceState({
          selectedPair: pair,
          selectedTimeframe: timeframe,
          imageDataUrl: chartUrl,
          signal: null,
          rejectedFinding: null,
          wasAnalyzing: false,
        });
      }
    },
    []
  );

  // Restore saved workspace state on boot & automatically resume if browser was killed mid-scan
  useEffect(() => {
    let cancelled = false;

    loadWorkspaceState()
      .then((persisted) => {
        if (cancelled) return;
        if (persisted) {
          setSelectedPair(persisted.selectedPair);
          setSelectedTimeframe(persisted.selectedTimeframe);
          setImageDataUrl(persisted.imageDataUrl);
          setSignal(persisted.signal);

          if (persisted.signal?.isValidChart) {
            void recordSignalToHistory(
              persisted.signal,
              persisted.imageDataUrl,
              {
                deduplicateByFingerprint: true,
                createdAtIso: new Date(
                  persisted.updatedAt || Date.now()
                ).toISOString(),
              }
            ).then(() => syncHistoryWithServer());
          } else {
            void syncHistoryWithServer();
          }

          if (persisted.rejectedFinding && persisted.imageDataUrl && !persisted.signal) {
            setIsRejected(true);
            setStages(
              createInitialAnalysisStages(
                persisted.selectedPair,
                persisted.selectedTimeframe
              ).map((item) =>
                item.step === 1
                  ? {
                      ...item,
                      status: 'rejected',
                      finding: persisted.rejectedFinding || null,
                    }
                  : { ...item, status: 'locked' }
              )
            );
          }

          if (persisted.wasAnalyzing && persisted.imageDataUrl && !persisted.signal) {
            const ageMs = Date.now() - (persisted.updatedAt || 0);
            if (ageMs >= 0 && ageMs < 45_000) {
              setIsHydrated(true);
              void executeAnalysis(
                persisted.imageDataUrl,
                persisted.selectedPair,
                persisted.selectedTimeframe
              );
              return;
            }
            // Clear stale wasAnalyzing flag so old interrupted scans don't lock UI on boot
            void saveWorkspaceState({
              selectedPair: persisted.selectedPair,
              selectedTimeframe: persisted.selectedTimeframe,
              imageDataUrl: persisted.imageDataUrl,
              signal: null,
              rejectedFinding: null,
              wasAnalyzing: false,
            });
          }
        }
        setIsHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setIsHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [executeAnalysis]);

  // Clean up any active controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Flush state immediately when mobile browser backgrounds or terminates the tab
  useEffect(() => {
    const flushState = () => {
      if (!isHydrated) return;
      void saveWorkspaceState(latestStateRef.current);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushState();
      }
    };

    window.addEventListener('pagehide', flushState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHydrated]);

  const isBusy = isAnalyzing || isCompletingScan;

  const requestStopAnalysis = useCallback(() => {
    if (isBusy) {
      setStopConfirmOpen(true);
    }
  }, [isBusy]);

  const cancelStopConfirmation = useCallback(() => {
    setStopConfirmOpen(false);
  }, []);

  const handlePairChange = (pair: string) => {
    setSelectedPair(pair);
    setIsStopped(false);
    void saveWorkspaceState({
      selectedPair: pair,
      selectedTimeframe,
      imageDataUrl,
      signal,
      rejectedFinding: null,
      wasAnalyzing: isAnalyzing,
    });
  };

  const handleTimeframeChange = (tf: string) => {
    setSelectedTimeframe(tf);
    setIsStopped(false);
    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe: tf,
      imageDataUrl,
      signal,
      rejectedFinding: null,
      wasAnalyzing: isAnalyzing,
    });
  };

  const handleReset = () => {
    if (isBusy) {
      confirmStopAnalysis();
    }
    setImageDataUrl(null);
    setSignal(null);
    setError(null);
    setIsRejected(false);
    setIsStopped(false);
    setProgressPct(0);
    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      imageDataUrl: null,
      signal: null,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  };

  const handleImageChange = (newUrl: string | null) => {
    setImageDataUrl(newUrl);
    setSignal(null);
    setError(null);
    setIsRejected(false);
    setIsStopped(false);
    setProgressPct(0);
    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      imageDataUrl: newUrl,
      signal: null,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  };

  const handleAnalyze = () => {
    if (!imageDataUrl || isBusy) return;
    void executeAnalysis(imageDataUrl, selectedPair, selectedTimeframe);
  };

  const handleTriggerUpload = () => {
    if (!isBusy) {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Compact Sticky Top Bar with Navigation Sidebar */}
      <AppHeaderWithSidebar
        activeRoute="analyze"
        rightAction={
          isBusy ? (
            <button
              type="button"
              onClick={requestStopAnalysis}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/12 px-3.5 py-1.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 whitespace-nowrap shrink-0"
            >
              <Square className="h-3 w-3 fill-current text-rose-400" />
              <span>Stop Scan</span>
            </button>
          ) : imageDataUrl || signal ? (
            <button
              type="button"
              onClick={handleReset}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111726] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>New Scan</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!isHydrated}
              onClick={handleTriggerUpload}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111726] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5 text-sky-400" />
              <span>Upload Chart</span>
            </button>
          )
        }
      />

      {/* Main Responsive Analyze Canvas */}
      <main
        id="top"
        className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-12 sm:px-6 sm:pt-8 lg:px-8"
      >
        {/* Editorial Intro Header + At-a-Glance Live Trading Session Desk */}
        <TradingSessionHeader selectedPair={selectedPair} />

        {/* Mobile Single-Column Ergonomic Stack -> Desktop 12-Column Split */}
        <div
          className={`grid grid-cols-1 items-start gap-5 lg:grid-cols-12 lg:gap-8 transition-opacity duration-150 ${
            isHydrated ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Left Column: Chart Lens Controls & Upload */}
          <section
            aria-label="Chart Input Controls"
            className="lg:col-span-5 rounded-2xl border border-slate-800/90 bg-[#111726] p-4 sm:p-6 space-y-4 sm:space-y-5"
          >
            {/* Market Pair & Timeframe Dropdowns Side-by-Side on Mobile & Desktop */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
              <PairSelector
                value={selectedPair}
                onChange={handlePairChange}
                disabled={isBusy}
              />
              <TimeframeSelector
                value={selectedTimeframe}
                onChange={handleTimeframeChange}
                disabled={isBusy}
              />
            </div>

            {/* Chart Screenshot Uploader + Live AI Chart Markup */}
            <ChartUploader
              imageDataUrl={imageDataUrl}
              signal={signal}
              onImageChange={handleImageChange}
              disabled={isBusy}
              isAnalyzing={isBusy}
              selectedPair={selectedPair}
              selectedTimeframe={selectedTimeframe}
              fileInputRef={fileInputRef}
            />

            {/* Primary Thumb-Zone CTA -> Transforms into Stop Analysis during active scan */}
            <div>
              {isBusy ? (
                <button
                  type="button"
                  onClick={requestStopAnalysis}
                  className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-5 py-3 text-sm font-semibold text-rose-100 transition-all duration-150 hover:bg-rose-500/25 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111726] whitespace-nowrap"
                >
                  <Square className="h-3.5 w-3.5 fill-current text-rose-400" />
                  <span>
                    Stop Analysis{progressPct > 0 ? ` (${progressPct}%)` : ''}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!imageDataUrl}
                  onClick={handleAnalyze}
                  className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-all duration-150 hover:bg-sky-400 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111726] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 whitespace-nowrap"
                >
                  <ScanLine className="h-4 w-4" />
                  <span>
                    {signal ? 'Re-Analyze Chart' : 'Generate Trading Signal'}
                  </span>
                </button>
              )}
              <p className="mt-2 text-center text-[11px] text-slate-500">
                Generates BUY, SELL &amp; HOLD signals with visual chart markup
              </p>
            </div>
          </section>

          {/* Right Column: Real Model-Streamed Progress & Execution Signal Ticket */}
          <section
            aria-label="Signal Execution Output"
            className="lg:col-span-7"
          >
            <SignalResult
              signal={signal}
              stages={stages}
              progressPct={progressPct}
              isRejected={isRejected}
              isStopped={isStopped}
              isLoading={isAnalyzing}
              isCompleting={isCompletingScan}
              error={error}
              selectedPair={selectedPair}
              selectedTimeframe={selectedTimeframe}
              hasChart={Boolean(imageDataUrl)}
              onStopAnalysis={requestStopAnalysis}
              onTriggerUpload={handleTriggerUpload}
              onRetry={handleAnalyze}
            />
          </section>
        </div>
      </main>

      {/* Stop Analysis Confirmation Dialog (Bottom Sheet on Mobile, Modal on Desktop) */}
      <StopConfirmDialog
        open={stopConfirmOpen && isBusy}
        selectedPair={selectedPair}
        selectedTimeframe={selectedTimeframe}
        progressPct={progressPct}
        onConfirmStop={confirmStopAnalysis}
        onCancel={cancelStopConfirmation}
      />

      {/* Quiet Risk Disclaimer Footer */}
      <footer className="border-t border-slate-800/60 py-5">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <span>TraceFX Lens · Technical Chart Analysis</span>
          <span>
            Signals are technical structure evaluations for informational decision support, not financial advice.
          </span>
        </div>
      </footer>
    </div>
  );
}

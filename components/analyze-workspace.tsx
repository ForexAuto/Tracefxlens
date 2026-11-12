'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ScanLine,
  RotateCcw,
  Upload,
  Square,
  Check,
  ArrowLeftRight,
} from 'lucide-react';
import { PairSelector } from '@/components/pair-selector';
import {
  TimeframeSelector,
  TopDownTimeframeSelector,
} from '@/components/timeframe-selector';
import { ChartUploader } from '@/components/chart-uploader';
import { SignalResult } from '@/components/signal-result';
import { StopConfirmDialog } from '@/components/stop-confirm-dialog';
import { AppHeaderWithSidebar } from '@/components/navigation-sidebar';
import { TradingSessionHeader } from '@/components/trading-session-banner';
import {
  AnalysisMode,
  AnalysisStageItem,
  AnalyzeStreamEvent,
  createInitialAnalysisStages,
  DEFAULT_TOP_DOWN_PAIR_ID,
  MARKET_PAIRS,
  resolveTopDownTimeframePair,
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

const OHLC_ASSIST_PREF_KEY = 'tracefx_ohlc_assist_v1';

export function AnalyzeWorkspace() {
  const [selectedPair, setSelectedPair] = useState<string>('XAU/USD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('H1');
  const [topDownPairId, setTopDownPairId] = useState<string>(
    DEFAULT_TOP_DOWN_PAIR_ID
  );
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('single');
  const [macroImageDataUrl, setMacroImageDataUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [activeCrtSlot, setActiveCrtSlot] = useState<'h1' | 'm5'>('h1');
  const [signal, setSignal] = useState<TradingSignalResponse | null>(null);
  const [stages, setStages] = useState<AnalysisStageItem[]>(() =>
    createInitialAnalysisStages('XAU/USD', 'H1', 'single')
  );
  const [progressPct, setProgressPct] = useState<number>(0);
  const [isRejected, setIsRejected] = useState<boolean>(false);
  const [isStopped, setIsStopped] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCompletingScan, setIsCompletingScan] = useState<boolean>(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [ohlcAssistEnabled, setOhlcAssistEnabled] = useState<boolean>(true);

  const activeTopDownPair = useMemo(
    () => resolveTopDownTimeframePair(topDownPairId),
    [topDownPairId]
  );
  const macroTf = activeTopDownPair.macroTf;
  const executionTf = activeTopDownPair.executionTf;
  const topDownLabel = activeTopDownPair.label;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const ohlcAssistEnabledRef = useRef<boolean>(true);
  const latestStateRef = useRef({
    selectedPair: 'XAU/USD',
    selectedTimeframe: 'H1',
    topDownPairId: DEFAULT_TOP_DOWN_PAIR_ID,
    analysisMode: 'single' as AnalysisMode,
    imageDataUrl: null as string | null,
    macroImageDataUrl: null as string | null,
    signal: null as TradingSignalResponse | null,
    rejectedFinding: null as string | null,
    wasAnalyzing: false,
  });

  useEffect(() => {
    latestStateRef.current = {
      selectedPair,
      selectedTimeframe,
      topDownPairId,
      analysisMode,
      imageDataUrl,
      macroImageDataUrl,
      signal,
      rejectedFinding: isRejected ? stages[0]?.finding || null : null,
      wasAnalyzing: isAnalyzing,
    };
  }, [
    selectedPair,
    selectedTimeframe,
    topDownPairId,
    analysisMode,
    imageDataUrl,
    macroImageDataUrl,
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
      topDownPairId: current.topDownPairId,
      analysisMode: current.analysisMode,
      imageDataUrl: current.imageDataUrl,
      macroImageDataUrl: current.macroImageDataUrl,
      signal: current.signal,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  }, []);

  const executeAnalysis = useCallback(
    async (
      chartUrl: string,
      pair: string,
      timeframe: string,
      mode: AnalysisMode = 'single',
      macroChartUrl: string | null = null,
      crtPairId: string = DEFAULT_TOP_DOWN_PAIR_ID
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const isCrtMode = mode === 'top_down_crt';
      const crtPair = resolveTopDownTimeframePair(crtPairId);
      const crtMacroTf = crtPair.macroTf;
      const crtExecTf = crtPair.executionTf;
      const effectiveTimeframe = isCrtMode ? crtPair.label : timeframe;

      setIsAnalyzing(true);
      setIsCompletingScan(false);
      setStopConfirmOpen(false);
      setIsRejected(false);
      setIsStopped(false);
      setError(null);
      setProgressPct(0);
      setStages(
        createInitialAnalysisStages(pair, effectiveTimeframe, mode, {
          macroTf: crtMacroTf,
          executionTf: crtExecTf,
        })
      );

      await saveWorkspaceState({
        selectedPair: pair,
        selectedTimeframe: timeframe,
        topDownPairId: crtPair.id,
        analysisMode: mode,
        imageDataUrl: chartUrl,
        macroImageDataUrl: macroChartUrl,
        signal: null,
        rejectedFinding: null,
        wasAnalyzing: true,
      });

      if (controller.signal.aborted) return;

      try {
        // Analyze focuses on market interpretation and signal quality; no drawing-coordinate calibration.
        setStages((prev) =>
          prev.map((item) =>
            item.step === 1
              ? {
                  ...item,
                  waitingText: isCrtMode
                    ? `Reading ${crtMacroTf} macro context and ${crtExecTf} execution structure...`
                    : 'Reading price action, market structure and trade context...',
                }
              : item
          )
        );

        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisMode: mode,
            topDownPairId: isCrtMode ? crtPair.id : undefined,
            macroTimeframe: isCrtMode ? crtMacroTf : undefined,
            executionTimeframe: isCrtMode ? crtExecTf : undefined,
            imageDataUrl: chartUrl,
            macroImageDataUrl: isCrtMode ? macroChartUrl : undefined,
            pair,
            timeframe: effectiveTimeframe,
            ohlcAssistEnabled: ohlcAssistEnabledRef.current,
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
                    waitingText: isCrtMode
                      ? `Auditing ${crtMacroTf} CRT range, liquidity purge & macro directional bias...`
                      : `Streaming ${
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
                if (
                  item.step < completedStep &&
                  item.status !== 'approved' &&
                  item.status !== 'completed'
                ) {
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
            topDownPairId: crtPair.id,
            analysisMode: mode,
            imageDataUrl: chartUrl,
            macroImageDataUrl: macroChartUrl,
            signal: null,
            rejectedFinding: rejectedReason,
            wasAnalyzing: false,
          });
          return;
        }

        if (finalSignal) {
          let verifiedSignal: TradingSignalResponse = finalSignal;

          setProgressPct(100);
          setStages((prev) =>
            prev.map((item) =>
              item.step === 5
                ? {
                    ...item,
                    status: 'completed',
                    finding: 'Analysis complete.',
                  }
                : item
            )
          );

          await saveWorkspaceState({
            selectedPair: pair,
            selectedTimeframe: timeframe,
            topDownPairId: crtPair.id,
            analysisMode: mode,
            imageDataUrl: chartUrl,
            macroImageDataUrl: macroChartUrl,
            signal: verifiedSignal,
            rejectedFinding: null,
            wasAnalyzing: false,
          });

          // Automatically archive signal & marked execution chart into Supabase + local History
          void recordSignalToHistory(verifiedSignal, chartUrl);

          if (controller.signal.aborted) return;

          setIsAnalyzing(false);
          setIsCompletingScan(true);
          await new Promise((resolve) => setTimeout(resolve, 340));

          if (controller.signal.aborted) return;

          abortControllerRef.current = null;
          if (isCrtMode) {
            setActiveCrtSlot('m5');
          }
          setSignal(verifiedSignal);
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
          topDownPairId: crtPair.id,
          analysisMode: mode,
          imageDataUrl: chartUrl,
          macroImageDataUrl: macroChartUrl,
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
        try {
          const savedOhlcAssist = window.localStorage.getItem(OHLC_ASSIST_PREF_KEY);
          if (savedOhlcAssist === '0' || savedOhlcAssist === '1') {
            const ohlcEnabled = savedOhlcAssist === '1';
            ohlcAssistEnabledRef.current = ohlcEnabled;
            setOhlcAssistEnabled(ohlcEnabled);
          }
        } catch {
          // Ignore storage restrictions
        }
        let queryPairOverride: string | null = null;
        try {
          const rawPairParam = new URLSearchParams(window.location.search).get(
            'pair'
          );
          if (rawPairParam) {
            const norm = rawPairParam.trim().toUpperCase();
            const found = MARKET_PAIRS.find(
              (m) => m.symbol.toUpperCase() === norm
            );
            if (found) {
              queryPairOverride = found.symbol;
              window.history.replaceState({}, '', '/');
            }
          }
        } catch {
          // Ignore URL parsing issues
        }

        if (persisted) {
          const persistedMode: AnalysisMode =
            persisted.analysisMode === 'top_down_crt' ? 'top_down_crt' : 'single';
          const persistedMacro = persisted.macroImageDataUrl ?? null;
          const persistedTopDownPair = persisted.topDownPairId
            ? resolveTopDownTimeframePair(persisted.topDownPairId)
            : persisted.signal?.crtContext
            ? resolveTopDownTimeframePair(
                persisted.signal.crtContext.macroTimeframe,
                persisted.signal.crtContext.executionTimeframe
              )
            : resolveTopDownTimeframePair(DEFAULT_TOP_DOWN_PAIR_ID);
          const nextPair =
            queryPairOverride && !persisted.wasAnalyzing
              ? queryPairOverride
              : persisted.selectedPair;
          const pairSwitchedViaUrl = nextPair !== persisted.selectedPair;

          setSelectedPair(nextPair);
          setSelectedTimeframe(persisted.selectedTimeframe);
          setTopDownPairId(persistedTopDownPair.id);
          setAnalysisMode(persistedMode);
          setMacroImageDataUrl(pairSwitchedViaUrl ? null : persistedMacro);
          setImageDataUrl(pairSwitchedViaUrl ? null : persisted.imageDataUrl);
          setSignal(pairSwitchedViaUrl ? null : persisted.signal);

          if (persistedMode === 'top_down_crt') {
            setActiveCrtSlot(
              !pairSwitchedViaUrl && persisted.signal
                ? 'm5'
                : !persistedMacro || pairSwitchedViaUrl
                ? 'h1'
                : 'm5'
            );
          }

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

          if (persisted.rejectedFinding && !persisted.signal) {
            const hasRequiredCharts =
              persistedMode === 'top_down_crt'
                ? Boolean(persistedMacro && persisted.imageDataUrl)
                : Boolean(persisted.imageDataUrl);
            if (hasRequiredCharts) {
              setIsRejected(true);
              setStages(
                createInitialAnalysisStages(
                  persisted.selectedPair,
                  persistedMode === 'top_down_crt'
                    ? persistedTopDownPair.label
                    : persisted.selectedTimeframe,
                  persistedMode,
                  {
                    macroTf: persistedTopDownPair.macroTf,
                    executionTf: persistedTopDownPair.executionTf,
                  }
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
          } else if (persistedMode === 'top_down_crt') {
            setStages(
              createInitialAnalysisStages(
                nextPair,
                persistedTopDownPair.label,
                'top_down_crt',
                {
                  macroTf: persistedTopDownPair.macroTf,
                  executionTf: persistedTopDownPair.executionTf,
                }
              )
            );
          }

          if (persisted.wasAnalyzing && persisted.imageDataUrl && !persisted.signal) {
            const canResume =
              persistedMode === 'top_down_crt'
                ? Boolean(persistedMacro && persisted.imageDataUrl)
                : Boolean(persisted.imageDataUrl);
            const ageMs = Date.now() - (persisted.updatedAt || 0);
            if (canResume && ageMs >= 0 && ageMs < 45_000) {
              setIsHydrated(true);
              void executeAnalysis(
                persisted.imageDataUrl,
                persisted.selectedPair,
                persisted.selectedTimeframe,
                persistedMode,
                persistedMacro,
                persistedTopDownPair.id
              );
              return;
            }
            // Clear stale wasAnalyzing flag so old interrupted scans don't lock UI on boot
            void saveWorkspaceState({
              selectedPair: persisted.selectedPair,
              selectedTimeframe: persisted.selectedTimeframe,
              topDownPairId: persistedTopDownPair.id,
              analysisMode: persistedMode,
              imageDataUrl: persisted.imageDataUrl,
              macroImageDataUrl: persistedMacro,
              signal: null,
              rejectedFinding: null,
              wasAnalyzing: false,
            });
          }
        } else if (queryPairOverride) {
          setSelectedPair(queryPairOverride);
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
  const isTopDownCrt = analysisMode === 'top_down_crt';

  const displayedImageDataUrl = isTopDownCrt
    ? activeCrtSlot === 'h1'
      ? macroImageDataUrl
      : imageDataUrl
    : imageDataUrl;

  const displayedTimeframe = isTopDownCrt
    ? activeCrtSlot === 'h1'
      ? macroTf
      : executionTf
    : selectedTimeframe;

  const hasAnyUploadedChart = isTopDownCrt
    ? Boolean(macroImageDataUrl || imageDataUrl)
    : Boolean(imageDataUrl);

  const isReadyToAnalyze = isTopDownCrt
    ? Boolean(macroImageDataUrl && imageDataUrl)
    : Boolean(imageDataUrl);

  const crtReadyCount =
    (macroImageDataUrl ? 1 : 0) + (imageDataUrl ? 1 : 0);

  const requestStopAnalysis = useCallback(() => {
    if (isBusy) {
      setStopConfirmOpen(true);
    }
  }, [isBusy]);

  const cancelStopConfirmation = useCallback(() => {
    setStopConfirmOpen(false);
  }, []);

  const handleModeChange = (nextMode: AnalysisMode) => {
    if (isBusy || nextMode === analysisMode) return;

    let nextMacro = macroImageDataUrl;
    let nextSingleOrM5 = imageDataUrl;

    if (nextMode === 'top_down_crt') {
      // Smart carry-over: if user already uploaded a chart matching Macro HTF in Single mode, place it in Slot 1
      if (!nextMacro && nextSingleOrM5 && selectedTimeframe === macroTf) {
        nextMacro = nextSingleOrM5;
        nextSingleOrM5 = null;
        setActiveCrtSlot('m5');
      } else if (
        !nextMacro &&
        nextSingleOrM5 &&
        selectedTimeframe === executionTf
      ) {
        // Keep matching Execution LTF chart in Slot 2 and focus Slot 1 for Macro HTF upload
        setActiveCrtSlot('h1');
      } else {
        setActiveCrtSlot(!nextMacro ? 'h1' : 'm5');
      }
    }

    const compatibleSignal =
      signal &&
      (signal.analysisMode || 'single') === nextMode &&
      (nextMode !== 'top_down_crt' ||
        (signal.crtContext?.macroTimeframe === macroTf &&
          signal.crtContext?.executionTimeframe === executionTf))
        ? signal
        : null;

    setAnalysisMode(nextMode);
    setMacroImageDataUrl(nextMacro);
    setImageDataUrl(nextSingleOrM5);
    setSignal(compatibleSignal);
    setError(null);
    setIsRejected(false);
    setIsStopped(false);
    setProgressPct(0);
    setStages(
      createInitialAnalysisStages(
        selectedPair,
        nextMode === 'top_down_crt' ? topDownLabel : selectedTimeframe,
        nextMode,
        { macroTf, executionTf }
      )
    );

    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      topDownPairId,
      analysisMode: nextMode,
      imageDataUrl: nextSingleOrM5,
      macroImageDataUrl: nextMacro,
      signal: compatibleSignal,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  };

  const handleTopDownPairChange = (nextPairId: string) => {
    if (isBusy) return;
    const nextPair = resolveTopDownTimeframePair(nextPairId);
    if (nextPair.id === topDownPairId) return;

    const compatibleSignal =
      signal &&
      signal.analysisMode === 'top_down_crt' &&
      signal.crtContext?.macroTimeframe === nextPair.macroTf &&
      signal.crtContext?.executionTimeframe === nextPair.executionTf
        ? signal
        : null;

    setTopDownPairId(nextPair.id);
    setSignal(compatibleSignal);
    setError(null);
    setIsRejected(false);
    setIsStopped(false);
    setProgressPct(0);
    setStages(
      createInitialAnalysisStages(selectedPair, nextPair.label, 'top_down_crt', {
        macroTf: nextPair.macroTf,
        executionTf: nextPair.executionTf,
      })
    );

    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      topDownPairId: nextPair.id,
      analysisMode,
      imageDataUrl,
      macroImageDataUrl,
      signal: compatibleSignal,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  };

  const handlePairChange = (pair: string) => {
    setSelectedPair(pair);
    setIsStopped(false);
    void saveWorkspaceState({
      selectedPair: pair,
      selectedTimeframe,
      topDownPairId,
      analysisMode,
      imageDataUrl,
      macroImageDataUrl,
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
      topDownPairId,
      analysisMode,
      imageDataUrl,
      macroImageDataUrl,
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
    setMacroImageDataUrl(null);
    if (isTopDownCrt) {
      setActiveCrtSlot('h1');
    }
    setSignal(null);
    setError(null);
    setIsRejected(false);
    setIsStopped(false);
    setProgressPct(0);
    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      topDownPairId,
      analysisMode,
      imageDataUrl: null,
      macroImageDataUrl: null,
      signal: null,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  };

  const handleImageChange = (newUrl: string | null) => {
    let nextMacro = macroImageDataUrl;
    let nextSingleOrM5 = imageDataUrl;

    if (isTopDownCrt) {
      if (activeCrtSlot === 'h1') {
        nextMacro = newUrl;
        setMacroImageDataUrl(newUrl);
        if (newUrl && !imageDataUrl) {
          setActiveCrtSlot('m5');
        }
      } else {
        nextSingleOrM5 = newUrl;
        setImageDataUrl(newUrl);
        if (newUrl && !macroImageDataUrl) {
          setActiveCrtSlot('h1');
        }
      }
    } else {
      nextSingleOrM5 = newUrl;
      setImageDataUrl(newUrl);
    }

    setSignal(null);
    setError(null);
    setIsRejected(false);
    setIsStopped(false);
    setProgressPct(0);
    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      topDownPairId,
      analysisMode,
      imageDataUrl: nextSingleOrM5,
      macroImageDataUrl: nextMacro,
      signal: null,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  };

  const handleSwapCrtCharts = () => {
    if (isBusy || !isTopDownCrt) return;
    const prevMacro = macroImageDataUrl;
    const prevM5 = imageDataUrl;
    setMacroImageDataUrl(prevM5);
    setImageDataUrl(prevMacro);
    setSignal(null);
    setError(null);
    setIsRejected(false);
    setIsStopped(false);
    setProgressPct(0);
    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      topDownPairId,
      analysisMode,
      imageDataUrl: prevMacro,
      macroImageDataUrl: prevM5,
      signal: null,
      rejectedFinding: null,
      wasAnalyzing: false,
    });
  };

  const handleAnalyze = () => {
    if (isBusy) return;
    if (isTopDownCrt) {
      if (!macroImageDataUrl || !imageDataUrl) return;
      void executeAnalysis(
        imageDataUrl,
        selectedPair,
        selectedTimeframe,
        'top_down_crt',
        macroImageDataUrl,
        topDownPairId
      );
      return;
    }
    if (!imageDataUrl) return;
    void executeAnalysis(
      imageDataUrl,
      selectedPair,
      selectedTimeframe,
      'single',
      null,
      topDownPairId
    );
  };

  const handleTriggerUpload = () => {
    if (isBusy) return;
    if (isTopDownCrt) {
      if (!macroImageDataUrl) {
        setActiveCrtSlot('h1');
      } else if (!imageDataUrl) {
        setActiveCrtSlot('m5');
      }
    }
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };

  const handleToggleOhlcAssist = () => {
    if (isBusy) return;
    const next = !ohlcAssistEnabled;
    ohlcAssistEnabledRef.current = next;
    setOhlcAssistEnabled(next);
    try {
      window.localStorage.setItem(OHLC_ASSIST_PREF_KEY, next ? '1' : '0');
    } catch {
      // Ignore storage restrictions
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
          ) : hasAnyUploadedChart || signal ? (
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
              <span>
                {isTopDownCrt
                  ? `Upload ${!macroImageDataUrl ? macroTf : executionTf} Chart`
                  : 'Upload Chart'}
              </span>
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
            {/* Analysis Workflow Mode Toggle: Single Chart vs Top-Down CRT */}
            <div>
              <div
                role="group"
                aria-label="Analysis workflow mode"
                className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-[#0D1320] p-1"
              >
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleModeChange('single')}
                  className={`min-h-[40px] min-w-0 truncate rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                    !isTopDownCrt
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Single Chart
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleModeChange('top_down_crt')}
                  className={`min-h-[40px] min-w-0 truncate rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                    isTopDownCrt
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Top-Down CRT
                </button>
              </div>
              {isTopDownCrt && (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  {macroTf} dominates bias &amp; targets · {executionTf} refines trigger &amp; tight risk · Invalid {macroTf} forces HOLD
                </p>
              )}
            </div>

            {/* Market Pair & Timeframe Dropdowns Side-by-Side on Mobile & Desktop */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
              <PairSelector
                value={selectedPair}
                onChange={handlePairChange}
                disabled={isBusy}
              />
              {isTopDownCrt ? (
                <TopDownTimeframeSelector
                  value={topDownPairId}
                  onChange={handleTopDownPairChange}
                  disabled={isBusy}
                />
              ) : (
                <TimeframeSelector
                  value={selectedTimeframe}
                  onChange={handleTimeframeChange}
                  disabled={isBusy}
                />
              )}
            </div>

            {/* Dual-Chart Slot Switcher in Top-Down CRT Mode */}
            {isTopDownCrt && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-400 tabular-nums">
                    Top-Down Chart Slots ({crtReadyCount}/2 Ready)
                  </span>
                  {macroImageDataUrl && imageDataUrl && !isBusy && (
                    <button
                      type="button"
                      onClick={handleSwapCrtCharts}
                      className="inline-flex min-h-[32px] items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-sky-400 whitespace-nowrap shrink-0"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      <span>
                        Swap {macroTf} / {executionTf}
                      </span>
                    </button>
                  )}
                </div>

                <div
                  role="tablist"
                  aria-label="Top-Down CRT chart slots"
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeCrtSlot === 'h1'}
                    onClick={() => setActiveCrtSlot('h1')}
                    className={`flex min-h-[54px] min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                      activeCrtSlot === 'h1'
                        ? 'border-sky-500/50 bg-sky-500/10 text-slate-100'
                        : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold tracking-tight tabular-nums">
                        1. {macroTf} Macro · CRT
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">
Bias, Range & Targets
                      </div>
                    </div>
                    {macroImageDataUrl && (
                      <span
                        aria-label={`${macroTf} chart uploaded`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/12 text-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeCrtSlot === 'm5'}
                    onClick={() => setActiveCrtSlot('m5')}
                    className={`flex min-h-[54px] min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                      activeCrtSlot === 'm5'
                        ? 'border-sky-500/50 bg-sky-500/10 text-slate-100'
                        : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold tracking-tight tabular-nums">
                        2. {executionTf} Execution
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">
Trigger & Tight Stop
                      </div>
                    </div>
                    {imageDataUrl && (
                      <span
                        aria-label={`${executionTf} chart uploaded`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/12 text-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Original chart screenshot for analysis context */}
            <ChartUploader
              imageDataUrl={displayedImageDataUrl}
              signal={displayedSignal}
              onImageChange={handleImageChange}
              disabled={isBusy}
              isAnalyzing={isBusy}
              selectedPair={selectedPair}
              selectedTimeframe={displayedTimeframe}
              fileInputRef={fileInputRef}
              customLabel={
                isTopDownCrt
                  ? activeCrtSlot === 'h1'
                    ? `${macroTf} Macro Chart · CRT Bias & Targets`
                    : `${executionTf} Execution Chart · Entry & Tight Stop`
                  : undefined
              }
              uploadTitle={
                isTopDownCrt
                  ? activeCrtSlot === 'h1'
                    ? `Upload 1. ${macroTf} Macro (CRT) screenshot`
                    : `Upload 2. ${executionTf} Execution screenshot`
                  : undefined
              }
              uploadDescription={
                isTopDownCrt
                  ? activeCrtSlot === 'h1'
                    ? `${macroTf} sets the dominant bias, CRT candle range (High, Low & 50% EQ), and macro liquidity targets. Keep the right-hand price scale visible.`
                    : `${executionTf} is your execution microscope for CHoCH/FVG entry precision and tight stop-loss placement. Keep the right-hand price scale visible.`
                  : undefined
              }
            />

            {/* Live OHLC & Macro Assist */}
            <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-[#0D1320]">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-200 whitespace-nowrap">
                    Live Spot OHLC &amp; Macro Assist
                  </div>
                  <p className="truncate text-[11px] text-slate-500">
                    {ohlcAssistEnabled
                      ? 'Swissquote Spot · DXY & US10Y Yield Filter · 14-ATR'
                      : 'Off · Pure screenshot Y-axis vision (for backtests)'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ohlcAssistEnabled}
                  aria-label="Toggle Live Spot OHLC and Macro Correlation Assist"
                  disabled={isBusy}
                  onClick={handleToggleOhlcAssist}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-50 ${
                    ohlcAssistEnabled
                      ? 'border-sky-400/50 bg-sky-500/25'
                      : 'border-slate-700 bg-slate-800/80'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 ${
                      ohlcAssistEnabled
                        ? 'translate-x-5 bg-sky-400'
                        : 'translate-x-1 bg-slate-400'
                    }`}
                  />
                </button>
              </div>
            </div>

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
              ) : isTopDownCrt && !isReadyToAnalyze ? (
                <button
                  type="button"
                  onClick={handleTriggerUpload}
                  className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/12 px-5 py-3 text-sm font-semibold text-sky-200 transition-all duration-150 hover:bg-sky-500/20 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111726] whitespace-nowrap"
                >
                  <Upload className="h-4 w-4 text-sky-400" />
                  <span>
                    {!macroImageDataUrl
                      ? `Upload 1. ${macroTf} Macro Chart`
                      : `Upload 2. ${executionTf} Execution Chart`}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!isReadyToAnalyze}
                  onClick={handleAnalyze}
                  className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-all duration-150 hover:bg-sky-400 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111726] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 whitespace-nowrap"
                >
                  <ScanLine className="h-4 w-4" />
                  <span>
                    {isTopDownCrt
                      ? signal
                        ? 'Re-Run Top-Down CRT'
                        : 'Generate Top-Down CRT Signal'
                      : signal
                      ? 'Re-Analyze Chart'
                      : 'Generate Trading Signal'}
                  </span>
                </button>
              )}
              <p className="mt-2 text-center text-[11px] text-slate-500">
                {isTopDownCrt
                  ? `${macroTf} CRT validates bias & TP1–TP3 · ${executionTf} refines entry & tight SL`
                  : 'Generates BUY, SELL & HOLD signals with visual chart markup'}
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
              analysisMode={analysisMode}
              stages={stages}
              progressPct={progressPct}
              isRejected={isRejected}
              isStopped={isStopped}
              isLoading={isAnalyzing}
              isCompleting={isCompletingScan}
              error={error}
              selectedPair={selectedPair}
              selectedTimeframe={isTopDownCrt ? topDownLabel : selectedTimeframe}
              hasChart={isReadyToAnalyze}
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
        selectedTimeframe={isTopDownCrt ? topDownLabel : selectedTimeframe}
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

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
import { TimeframeSelector } from '@/components/timeframe-selector';
import { VisionModelSelector } from '@/components/vision-model-selector';
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
  MARKET_PAIRS,
  TradingSignalResponse,
} from '@/lib/trading-data';
import {
  DEFAULT_VISION_MODEL_ID,
  INITIAL_VISION_MODEL_CATALOG,
  isRestrictedHarnessModelId,
  OPENROUTER_AUTO_VISION_ID,
  type VisionModelOption,
} from '@/lib/vision-models';
import {
  loadWorkspaceState,
  saveWorkspaceState,
} from '@/lib/workspace-storage';
import {
  recordSignalToHistory,
  syncHistoryWithServer,
} from '@/lib/history-storage';
import {
  buildVisionEnhancementPayload,
  renderDraftMarkupPreviewDataUrl,
} from '@/lib/chart-vision-enhancer';

const SELF_CHECK_PREF_KEY = 'tracefx_self_check_v1';
const OHLC_ASSIST_PREF_KEY = 'tracefx_ohlc_assist_v1';
const VISION_MODEL_PREF_KEY = 'tracefx_vision_model_v1';

export function AnalyzeWorkspace() {
  const [selectedPair, setSelectedPair] = useState<string>('XAU/USD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('H1');
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
  const [selfCheckEnabled, setSelfCheckEnabled] = useState<boolean>(true);
  const [ohlcAssistEnabled, setOhlcAssistEnabled] = useState<boolean>(true);
  const [visionModel, setVisionModel] = useState<string>(DEFAULT_VISION_MODEL_ID);
  const [visionCatalog, setVisionCatalog] = useState<VisionModelOption[]>(
    INITIAL_VISION_MODEL_CATALOG
  );
  const [openRouterConfigured, setOpenRouterConfigured] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const selfCheckEnabledRef = useRef<boolean>(true);
  const ohlcAssistEnabledRef = useRef<boolean>(true);
  const visionModelRef = useRef<string>(DEFAULT_VISION_MODEL_ID);
  const latestStateRef = useRef({
    selectedPair: 'XAU/USD',
    selectedTimeframe: 'H1',
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
      macroChartUrl: string | null = null
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const isCrtMode = mode === 'top_down_crt';
      const effectiveTimeframe = isCrtMode ? 'H1 → M5' : timeframe;

      setIsAnalyzing(true);
      setIsCompletingScan(false);
      setStopConfirmOpen(false);
      setIsRejected(false);
      setIsStopped(false);
      setError(null);
      setProgressPct(0);
      setStages(createInitialAnalysisStages(pair, effectiveTimeframe, mode));

      await saveWorkspaceState({
        selectedPair: pair,
        selectedTimeframe: timeframe,
        analysisMode: mode,
        imageDataUrl: chartUrl,
        macroImageDataUrl: macroChartUrl,
        signal: null,
        rejectedFinding: null,
        wasAnalyzing: true,
      });

      if (controller.signal.aborted) return;

      try {
        // Pre-AI Pixel Scan: Sub-Pane Splitter + Hidden 0..1000 Ruler Grid + 2x Right-Edge Axis Crop
        setStages((prev) =>
          prev.map((item) =>
            item.step === 1
              ? {
                  ...item,
                  waitingText: isCrtMode
                    ? 'Calibrating H1 Macro & M5 Execution 0..1000 ruler grids & 2× price-axis crops...'
                    : 'Calibrating 0..1000 coordinate ruler grid, sub-panes & 2× price-axis crop...',
                }
              : item
          )
        );

        const [visionEnhancement, macroVisionEnhancement] = await Promise.all([
          buildVisionEnhancementPayload(chartUrl),
          isCrtMode && macroChartUrl
            ? buildVisionEnhancementPayload(macroChartUrl)
            : Promise.resolve(undefined),
        ]);
        if (controller.signal.aborted) return;

        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisMode: mode,
            imageDataUrl: chartUrl,
            macroImageDataUrl: isCrtMode ? macroChartUrl : undefined,
            pair,
            timeframe: effectiveTimeframe,
            visionModel: visionModelRef.current,
            ohlcAssistEnabled: ohlcAssistEnabledRef.current,
            visionEnhancement,
            macroVisionEnhancement,
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
                      ? 'Auditing H1 CRT range, liquidity purge & macro directional bias...'
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
            setProgressPct(selfCheckEnabledRef.current ? 92 : 100);
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

          // Optional Pass 2 — Two-Pass "Visual Self-Check" Mode (Draw -> Inspect -> Correct)
          // Guaranteed non-breaking: if Pass 2 times out or fails, `verifiedSignal` seamlessly stays Draft 1!
          if (
            selfCheckEnabledRef.current &&
            verifiedSignal.isValidChart &&
            !controller.signal.aborted
          ) {
            try {
              setStages((prev) =>
                prev.map((item) =>
                  item.step === 5
                    ? {
                        ...item,
                        status: 'active',
                        waitingText: isCrtMode
                          ? 'Pass 2 Self-Check: auditing M5 tight risk & H1 dominance lock on canvas...'
                          : 'Pass 2 Self-Check: inspecting drawn zones, wicks & stop-loss placement on canvas...',
                      }
                    : item
                )
              );

              const markedDraftDataUrl = await renderDraftMarkupPreviewDataUrl(
                chartUrl,
                verifiedSignal
              );

              if (markedDraftDataUrl && !controller.signal.aborted) {
                const verifyRes = await fetch('/api/analyze/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    draftSignal: verifiedSignal,
                    visionModel: visionModelRef.current,
                    rulerOrCleanDataUrl:
                      visionEnhancement?.rulerGridDataUrl || chartUrl,
                    markedDraftDataUrl,
                    rightEdgeZoomDataUrl: visionEnhancement?.rightEdgeZoomDataUrl,
                    detectedPlotBox: visionEnhancement?.detectedPlotBox,
                    subPaneCount: visionEnhancement?.subPaneCount ?? 0,
                  }),
                  signal: controller.signal,
                });

                if (verifyRes.ok) {
                  const verifyJson = (await verifyRes.json()) as {
                    signal?: TradingSignalResponse;
                  };
                  if (verifyJson?.signal && verifyJson.signal.isValidChart) {
                    verifiedSignal = verifyJson.signal;
                  }
                }
              }
            } catch {
              // Non-breaking fallback: retain Pass 1 `verifiedSignal` if Pass 2 is interrupted or rate-limited
            }

            if (controller.signal.aborted) return;

            setProgressPct(100);
            const finalStepFinding =
              verifiedSignal.auditTrail?.find((a) => a.step === 5)?.finding;
            setStages((prev) =>
              prev.map((item) =>
                item.step === 5
                  ? {
                      ...item,
                      status: 'completed',
                      finding:
                        finalStepFinding ||
                        item.finding ||
                        'Verified by Pass 2 self-check.',
                    }
                  : item
              )
            );
          }

          await saveWorkspaceState({
            selectedPair: pair,
            selectedTimeframe: timeframe,
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
          const savedSelfCheck = window.localStorage.getItem(SELF_CHECK_PREF_KEY);
          if (savedSelfCheck === '0' || savedSelfCheck === '1') {
            const enabled = savedSelfCheck === '1';
            selfCheckEnabledRef.current = enabled;
            setSelfCheckEnabled(enabled);
          }
          const savedOhlcAssist = window.localStorage.getItem(OHLC_ASSIST_PREF_KEY);
          if (savedOhlcAssist === '0' || savedOhlcAssist === '1') {
            const ohlcEnabled = savedOhlcAssist === '1';
            ohlcAssistEnabledRef.current = ohlcEnabled;
            setOhlcAssistEnabled(ohlcEnabled);
          }
          const savedVisionModel = window.localStorage.getItem(VISION_MODEL_PREF_KEY);
          if (savedVisionModel && savedVisionModel.trim()) {
            const rawModel = savedVisionModel.trim();
            const safeModel = isRestrictedHarnessModelId(rawModel)
              ? OPENROUTER_AUTO_VISION_ID
              : rawModel;
            visionModelRef.current = safeModel;
            setVisionModel(safeModel);
            if (safeModel !== rawModel) {
              window.localStorage.setItem(VISION_MODEL_PREF_KEY, safeModel);
            }
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
          const nextPair =
            queryPairOverride && !persisted.wasAnalyzing
              ? queryPairOverride
              : persisted.selectedPair;
          const pairSwitchedViaUrl = nextPair !== persisted.selectedPair;

          setSelectedPair(nextPair);
          setSelectedTimeframe(persisted.selectedTimeframe);
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
                    ? 'H1 → M5'
                    : persisted.selectedTimeframe,
                  persistedMode
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
                persistedMacro
              );
              return;
            }
            // Clear stale wasAnalyzing flag so old interrupted scans don't lock UI on boot
            void saveWorkspaceState({
              selectedPair: persisted.selectedPair,
              selectedTimeframe: persisted.selectedTimeframe,
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

  // Hydrate live OpenRouter Free Vision catalog from server
  useEffect(() => {
    let active = true;
    fetch('/api/openrouter/models', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            openRouterConfigured?: boolean;
            models?: VisionModelOption[];
          } | null
        ) => {
          if (!active || !data) return;
          if (typeof data.openRouterConfigured === 'boolean') {
            setOpenRouterConfigured(data.openRouterConfigured);
          }
          if (Array.isArray(data.models) && data.models.length > 0) {
            setVisionCatalog(data.models);
          }
        }
      )
      .catch(() => {
        // Retain static initial catalog on offline error
      });
    return () => {
      active = false;
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

  // Memoize H1 macro signal projection so ChartUploader's reference check preserves layer filter toggles
  const h1MacroSignalView = useMemo<TradingSignalResponse | null>(() => {
    if (!signal || !signal.isValidChart || !signal.macroChartMarkup) {
      return null;
    }
    return {
      ...signal,
      detectedTimeframe: 'H1 Macro · CRT',
      chartMarkup: signal.macroChartMarkup,
    };
  }, [signal]);

  const displayedImageDataUrl = isTopDownCrt
    ? activeCrtSlot === 'h1'
      ? macroImageDataUrl
      : imageDataUrl
    : imageDataUrl;

  const displayedSignal = isTopDownCrt
    ? activeCrtSlot === 'h1'
      ? h1MacroSignalView
      : signal
    : signal;

  const displayedTimeframe = isTopDownCrt
    ? activeCrtSlot === 'h1'
      ? 'H1'
      : 'M5'
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
      // Smart carry-over: if user already uploaded an H1 chart in Single mode, place it in Slot 1 (H1 Macro)
      if (!nextMacro && nextSingleOrM5 && selectedTimeframe === 'H1') {
        nextMacro = nextSingleOrM5;
        nextSingleOrM5 = null;
      }
      setActiveCrtSlot(!nextMacro ? 'h1' : 'm5');
    }

    const compatibleSignal =
      signal && (signal.analysisMode || 'single') === nextMode ? signal : null;

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
        nextMode === 'top_down_crt' ? 'H1 → M5' : selectedTimeframe,
        nextMode
      )
    );

    void saveWorkspaceState({
      selectedPair,
      selectedTimeframe,
      analysisMode: nextMode,
      imageDataUrl: nextSingleOrM5,
      macroImageDataUrl: nextMacro,
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
        macroImageDataUrl
      );
      return;
    }
    if (!imageDataUrl) return;
    void executeAnalysis(imageDataUrl, selectedPair, selectedTimeframe, 'single', null);
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

  const handleToggleSelfCheck = () => {
    if (isBusy) return;
    const next = !selfCheckEnabled;
    selfCheckEnabledRef.current = next;
    setSelfCheckEnabled(next);
    try {
      window.localStorage.setItem(SELF_CHECK_PREF_KEY, next ? '1' : '0');
    } catch {
      // Ignore storage restrictions
    }
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

  const handleVisionModelChange = (nextModelId: string) => {
    if (isBusy) return;
    visionModelRef.current = nextModelId;
    setVisionModel(nextModelId);
    setError(null);
    try {
      window.localStorage.setItem(VISION_MODEL_PREF_KEY, nextModelId);
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
              <span>{isTopDownCrt ? 'Upload H1 Chart' : 'Upload Chart'}</span>
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
                  H1 dominates bias &amp; targets · M5 refines trigger &amp; tight risk · Invalid H1 forces HOLD
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
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Timeframe Pair
                  </label>
                  <div className="flex min-h-[50px] w-full flex-col justify-center rounded-xl border border-slate-800 bg-[#0D1320] px-3 py-2">
                    <div className="font-[family-name:var(--font-mono)] text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap tabular-nums">
                      H1 → M5
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      Macro CRT · Tight Risk
                    </p>
                  </div>
                </div>
              ) : (
                <TimeframeSelector
                  value={selectedTimeframe}
                  onChange={handleTimeframeChange}
                  disabled={isBusy}
                />
              )}
            </div>

            {/* Vision Engine Selector: Gemini 3.8 Flash + OpenRouter Free Vision Models */}
            <VisionModelSelector
              value={visionModel}
              onChange={handleVisionModelChange}
              models={visionCatalog}
              openRouterConfigured={openRouterConfigured}
              disabled={isBusy}
            />

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
                      <span>Swap H1 / M5</span>
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
                        1. H1 Macro · CRT
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">
                        {signal?.macroChartMarkup
                          ? 'Inspect H1 CRT Markup'
                          : 'Bias, Range & Targets'}
                      </div>
                    </div>
                    {macroImageDataUrl && (
                      <span
                        aria-label="H1 chart uploaded"
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
                        2. M5 Execution
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">
                        {signal?.chartMarkup
                          ? 'Inspect M5 Entry Markup'
                          : 'Trigger & Tight Stop'}
                      </div>
                    </div>
                    {imageDataUrl && (
                      <span
                        aria-label="M5 chart uploaded"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/12 text-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Chart Screenshot Uploader + Live AI Chart Markup */}
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
                    ? 'H1 Macro Chart · CRT Bias & Targets'
                    : 'M5 Execution Chart · Entry & Tight Stop'
                  : undefined
              }
              customMarkedPrefix={
                isTopDownCrt
                  ? activeCrtSlot === 'h1'
                    ? 'AI Marked H1 Macro'
                    : 'AI Marked M5 Execution'
                  : undefined
              }
              uploadTitle={
                isTopDownCrt
                  ? activeCrtSlot === 'h1'
                    ? 'Upload 1. H1 Macro (CRT) screenshot'
                    : 'Upload 2. M5 Execution screenshot'
                  : undefined
              }
              uploadDescription={
                isTopDownCrt
                  ? activeCrtSlot === 'h1'
                    ? 'H1 sets the dominant bias, CRT candle range (High, Low & 50% EQ), and macro liquidity targets. Keep the right-hand price scale visible.'
                    : 'M5 is your execution microscope for CHoCH/FVG entry precision and tight stop-loss placement. Keep the right-hand price scale visible.'
                  : undefined
              }
            />

            {/* Precision Calibration Switches: 2-Pass Self-Check + Live OHLC Feed Assist */}
            <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-[#0D1320]">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-200 whitespace-nowrap">
                    Two-Pass Visual Self-Check
                  </div>
                  <p className="truncate text-[11px] text-slate-500">
                    {isTopDownCrt
                      ? 'Dual H1/M5 rulers · Pass 2 wick audit · H1 veto lock'
                      : 'Ruler grid · 2× axis zoom · Pass 2 wick & SL audit'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={selfCheckEnabled}
                  aria-label="Toggle Two-Pass Visual Self-Check"
                  disabled={isBusy}
                  onClick={handleToggleSelfCheck}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-50 ${
                    selfCheckEnabled
                      ? 'border-sky-400/50 bg-sky-500/25'
                      : 'border-slate-700 bg-slate-800/80'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 ${
                      selfCheckEnabled
                        ? 'translate-x-5 bg-sky-400'
                        : 'translate-x-1 bg-slate-400'
                    }`}
                  />
                </button>
              </div>

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
                      ? 'Upload 1. H1 Macro Chart'
                      : 'Upload 2. M5 Execution Chart'}
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
                  ? 'H1 CRT validates bias & TP1–TP3 · M5 refines entry & tight SL'
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
              selectedTimeframe={isTopDownCrt ? 'H1 → M5' : selectedTimeframe}
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
        selectedTimeframe={isTopDownCrt ? 'H1 → M5' : selectedTimeframe}
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

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Upload,
  Maximize2,
  Trash2,
  X,
  ImagePlus,
  Download,
  Eye,
  EyeOff,
  Layers,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { TradingSignalResponse } from '@/lib/trading-data';
import {
  exportMarkedChartPng,
  getStructureLayerCounts,
  MarkupLayerFilter,
  StructureSubLayer,
} from '@/lib/chart-markup';
import { AnnotatedChartOverlay } from '@/components/annotated-chart-overlay';

interface ChartUploaderProps {
  imageDataUrl: string | null;
  signal?: TradingSignalResponse | null;
  onImageChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  isAnalyzing?: boolean;
  selectedPair: string;
  selectedTimeframe: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  customLabel?: string;
  customMarkedPrefix?: string;
  uploadTitle?: string;
  uploadDescription?: string;
  enableGlobalPaste?: boolean;
}

/**
 * Normalizes and downscales ultra-high-res phone screenshots to crisp max 1440px
 * and compresses heavy uncompressed PNGs so network uploads and IndexedDB writes
 * are sub-second while keeping price-axis numerals razor sharp for Gemini Vision.
 */
function normalizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const resultStr = reader.result as string;
      const img = new window.Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const maxDim = 1440;
        let { width, height } = img;
        const needsResize = width > maxDim || height > maxDim;
        const isHeavyPayload = resultStr.length > 450_000;

        if (!needsResize && !isHeavyPayload) {
          resolve(resultStr);
          return;
        }

        if (needsResize) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(resultStr);
          return;
        }
        ctx.fillStyle = '#0B101B';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.src = resultStr;
    };
    reader.readAsDataURL(file);
  });
}

export function ChartUploader({
  imageDataUrl,
  signal = null,
  onImageChange,
  disabled,
  isAnalyzing = false,
  selectedPair,
  selectedTimeframe,
  fileInputRef,
  customLabel,
  customMarkedPrefix,
  uploadTitle,
  uploadDescription,
  enableGlobalPaste = true,
}: ChartUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [markupViewState, setMarkupViewState] = useState<{
    signalRef: TradingSignalResponse | null;
    showMarkup: boolean;
    layerFilter: MarkupLayerFilter;
    subLayer: StructureSubLayer;
  }>({
    signalRef: signal,
    showMarkup: true,
    layerFilter: 'primary',
    subLayer: 'all',
  });
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const isSameSignal = markupViewState.signalRef === signal;
  const showMarkup = isSameSignal ? markupViewState.showMarkup : true;
  const layerFilter: MarkupLayerFilter = isSameSignal
    ? markupViewState.layerFilter
    : 'primary';
  const subLayer: StructureSubLayer = isSameSignal
    ? markupViewState.subLayer
    : 'all';

  const setShowMarkup = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setMarkupViewState((prev) => {
        const base =
          prev.signalRef === signal
            ? prev
            : {
                signalRef: signal,
                showMarkup: true,
                layerFilter: 'primary' as MarkupLayerFilter,
                subLayer: 'all' as StructureSubLayer,
              };
        return {
          ...base,
          showMarkup:
            typeof updater === 'function' ? updater(base.showMarkup) : updater,
        };
      });
    },
    [signal]
  );

  const setLayerFilter = useCallback(
    (nextFilter: MarkupLayerFilter) => {
      setMarkupViewState((prev) => {
        const base =
          prev.signalRef === signal
            ? prev
            : {
                signalRef: signal,
                showMarkup: true,
                layerFilter: 'primary' as MarkupLayerFilter,
                subLayer: 'all' as StructureSubLayer,
              };
        return { ...base, layerFilter: nextFilter };
      });
    },
    [signal]
  );

  const setSubLayer = useCallback(
    (nextSubLayer: StructureSubLayer) => {
      setMarkupViewState((prev) => {
        const base =
          prev.signalRef === signal
            ? prev
            : {
                signalRef: signal,
                showMarkup: true,
                layerFilter: 'primary' as MarkupLayerFilter,
                subLayer: 'all' as StructureSubLayer,
              };
        return { ...base, subLayer: nextSubLayer };
      });
    },
    [signal]
  );

  const hasValidSignal = Boolean(signal && signal.isValidChart && !isAnalyzing);
  const structureCounts = useMemo(
    () => getStructureLayerCounts(signal),
    [signal]
  );

  const subLayerOptions = useMemo(() => {
    const items: Array<{ id: StructureSubLayer; label: string; count: number }> = [
      { id: 'all', label: 'All Layers', count: structureCounts.total },
      { id: 'zones', label: 'Zones & OB', count: structureCounts.zones },
      { id: 'fvg', label: 'FVG', count: structureCounts.fvg },
      { id: 'bos_swings', label: 'BOS & Swings', count: structureCounts.bosSwings },
      { id: 'liquidity', label: 'Liquidity', count: structureCounts.liquidity },
      { id: 'trendlines', label: 'Trendlines', count: structureCounts.trendlines },
    ];
    return items.filter((item) => item.id === 'all' || item.count > 0);
  }, [structureCounts]);

  const processFile = useCallback(
    async (file: File) => {
      setFileError(null);
      if (!file.type.startsWith('image/')) {
        setFileError('Please select a PNG, JPEG, or WebP chart screenshot.');
        return;
      }
      try {
        const normalized = await normalizeImageFile(file);
        setMarkupViewState({
          signalRef: null,
          showMarkup: true,
          layerFilter: 'primary',
          subLayer: 'all',
        });
        onImageChange(normalized);
      } catch {
        setFileError('Could not process screenshot. Please try another image.');
      }
    },
    [onImageChange]
  );

  // Support global clipboard paste (Ctrl+V / Cmd+V) of chart screenshots
  useEffect(() => {
    if (!enableGlobalPaste) return;
    const handlePaste = (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [disabled, enableGlobalPaste, processFile]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDownloadMarked = async () => {
    if (!imageDataUrl || !signal || isExporting) return;
    setIsExporting(true);
    try {
      await exportMarkedChartPng(imageDataUrl, signal, layerFilter, subLayer);
    } finally {
      setIsExporting(false);
    }
  };

  const markedPrefix = customMarkedPrefix || 'AI Marked Chart';

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-slate-400">
          {hasValidSignal && showMarkup
            ? layerFilter === 'primary'
              ? `${markedPrefix} · Primary Setup`
              : layerFilter === 'structure'
              ? `${markedPrefix} · Structure Only`
              : `${markedPrefix} · Full Structure`
            : customLabel || 'Chart Screenshot'}
        </label>
        {isAnalyzing ? (
          <span className="text-xs font-medium text-sky-400">
            Scanning full chart...
          </span>
        ) : hasValidSignal ? (
          <span className="text-xs text-emerald-400">
            {structureCounts.total > 0
              ? `${structureCounts.total} structures mapped`
              : 'Tap Expand to inspect'}
          </span>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
          e.target.value = '';
        }}
        className="sr-only"
      />

      {!imageDataUrl ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`group flex min-h-[190px] sm:min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-6 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
            isDragging
              ? 'border-sky-400 bg-sky-500/10'
              : 'border-slate-700/90 bg-[#0D1320] hover:border-slate-600 hover:bg-[#0F1726]'
          }`}
        >
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-[#141C2E] text-sky-400 transition-transform duration-150 group-hover:scale-105">
            <Upload className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-slate-100">
            {uploadTitle || 'Tap to upload chart screenshot'}
          </p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
            {uploadDescription ||
              'Supports TradingView, MT4/MT5, cTrader, or exchange screenshots. Keep the price scale visible for exact levels.'}
          </p>
          <p className="mt-2.5 text-[11px] text-slate-500">
            PNG · JPG · WebP · Paste from clipboard
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0B101B]">
          {/* Exact-Fit Image + Vector Drawing Viewport (Zero Letterbox Drift) */}
          <div className="relative flex w-full items-center justify-center overflow-hidden bg-[#070A12]">
            <div className="relative mx-auto w-fit max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageDataUrl}
                alt={`Uploaded ${selectedPair} ${selectedTimeframe} chart screenshot`}
                referrerPolicy="no-referrer"
                className={`block w-auto max-w-full object-contain transition-opacity duration-200 ${
                  hasValidSignal
                    ? 'max-h-[480px] sm:max-h-[560px]'
                    : 'max-h-[340px] sm:max-h-[400px]'
                } ${isAnalyzing ? 'opacity-80' : 'opacity-100'}`}
              />

              {/* Live Pixel-Calibrated AI Technical Analysis Canvas */}
              {hasValidSignal && signal && (
                <AnnotatedChartOverlay
                  imageDataUrl={imageDataUrl}
                  signal={signal}
                  layerFilter={layerFilter}
                  subLayer={subLayer}
                  visible={showMarkup}
                />
              )}

              {/* Optical GPU Scan Beam Overlay During Active Analysis */}
              {isAnalyzing && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden bg-sky-950/15">
                  <motion.div
                    initial={{ y: '-10%' }}
                    animate={{ y: '1050%' }}
                    transition={{
                      duration: 2.1,
                      repeat: Infinity,
                      repeatType: 'reverse',
                      ease: 'easeInOut',
                    }}
                    className="h-[10%] w-full bg-gradient-to-b from-transparent via-sky-400/25 to-transparent border-b border-sky-400/60"
                  />
                </div>
              )}
            </div>

            {/* Pre-Analysis Floating Actions (when no markup bar is shown below) */}
            {!isAnalyzing && !hasValidSignal && (
              <>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

                <div className="absolute right-2.5 bottom-2.5 left-2.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900/90 px-3.5 text-xs font-medium text-slate-100 backdrop-blur-md border border-slate-700/80 transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-sky-400" />
                    <span>Replace</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLightboxOpen(true)}
                      aria-label="Inspect chart fullscreen"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-900/90 text-slate-200 backdrop-blur-md border border-slate-700/80 transition-colors hover:bg-slate-800"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onImageChange(null)}
                      aria-label="Remove chart screenshot"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-900/90 text-rose-400 backdrop-blur-md border border-slate-700/80 transition-colors hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Post-Analysis Interactive Drawing Toolbar (Primary Setup Default + Full Structure Toggle) */}
          {hasValidSignal && signal && (
            <div className="border-t border-slate-800/80 bg-[#0D1320] p-2.5 sm:px-3 space-y-2">
              {/* Row 1: Markup Visibility + Primary Setup vs Full Structure Segmented Control */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowMarkup((prev) => !prev)}
                  className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    showMarkup
                      ? 'border-sky-500/40 bg-sky-500/12 text-sky-300'
                      : 'border-slate-800 bg-[#111726] text-slate-400 hover:text-slate-200'
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

                {showMarkup && (
                  <div
                    role="group"
                    aria-label="Chart structure mode"
                    className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#090D16] p-0.5 overflow-x-auto max-w-full"
                  >
                    <button
                      type="button"
                      onClick={() => setLayerFilter('primary')}
                      className={`min-h-[34px] rounded-md px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                        layerFilter === 'primary'
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Primary Setup
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLayerFilter('all');
                        setSubLayer('all');
                      }}
                      className={`flex min-h-[34px] items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                        layerFilter === 'all'
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <Layers className="h-3 w-3" />
                      <span>
                        Full Structure
                        {structureCounts.total > 0
                          ? ` (${structureCounts.total})`
                          : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLayerFilter('structure')}
                      className={`min-h-[34px] rounded-md px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                        layerFilter === 'structure'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Structure Only
                    </button>
                  </div>
                )}
              </div>

              {/* Row 1b: SMC Category Filter Bar when Full Structure or Structure Only is active */}
              {showMarkup &&
                (layerFilter === 'all' || layerFilter === 'structure') &&
                subLayerOptions.length > 2 && (
                  <div
                    role="group"
                    aria-label="Filter market structure categories"
                    className="flex items-center gap-1 overflow-x-auto pb-0.5"
                  >
                    {subLayerOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSubLayer(opt.id)}
                        className={`min-h-[32px] rounded-md border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                          subLayer === opt.id
                            ? 'border-sky-500/45 bg-sky-500/15 text-sky-200'
                            : 'border-slate-800/90 bg-[#090D16] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {opt.label} ({opt.count})
                      </button>
                    ))}
                  </div>
                )}

              {/* Row 2: Export Marked PNG · Fullscreen Inspect · Replace · Remove */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleDownloadMarked}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#111726] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" />
                    <span>{isExporting ? 'Saving...' : 'Save PNG'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111726] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap"
                  >
                    <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
                    <span>Expand</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Replace chart screenshot"
                    className="flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-800 bg-[#111726] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white disabled:opacity-50 whitespace-nowrap"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-slate-400" />
                    <span>Replace</span>
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onImageChange(null)}
                    aria-label="Remove chart screenshot"
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-800 bg-[#111726] text-rose-400 transition-colors hover:border-slate-700 hover:bg-slate-800/60 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {fileError && (
        <p className="mt-2 text-xs text-rose-400" role="alert">
          {fileError}
        </p>
      )}

      {/* Fullscreen Marked Chart Lightbox */}
      <AnimatePresence>
        {lightboxOpen && imageDataUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setLightboxOpen(false)}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/92 p-3 sm:p-6 backdrop-blur-md"
          >
            {/* Top Fullscreen Bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="mb-3 flex w-full max-w-6xl flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="font-[family-name:var(--font-mono)] font-semibold text-white tabular-nums">
                  {signal?.detectedPair || selectedPair}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-[family-name:var(--font-mono)] tabular-nums">
                  {signal?.detectedTimeframe || selectedTimeframe}
                </span>
                {hasValidSignal && signal && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-sky-400">
                      {signal.signalType}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {hasValidSignal && signal && (
                  <>
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
                      onClick={handleDownloadMarked}
                      className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Save PNG</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setLightboxOpen(false)}
                  aria-label="Close chart inspection"
                  className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Fullscreen Aspect-Locked Annotated Chart */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-slate-800 bg-[#070A12]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageDataUrl}
                alt="Fullscreen marked trading chart"
                referrerPolicy="no-referrer"
                className="block max-h-[75vh] w-auto max-w-[95vw] sm:max-w-6xl object-contain"
              />

              {hasValidSignal && signal && (
                <AnnotatedChartOverlay
                  imageDataUrl={imageDataUrl}
                  signal={signal}
                  layerFilter={layerFilter}
                  subLayer={subLayer}
                  visible={showMarkup}
                />
              )}
            </div>

            {/* Bottom Layer Switcher + SMC Category Filter in Fullscreen */}
            {hasValidSignal && showMarkup && (
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
                          structureCounts.total > 0
                            ? `Full Structure (${structureCounts.total})`
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
                  subLayerOptions.length > 2 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto max-w-[95vw] px-1">
                      {subLayerOptions.map((opt) => (
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
    </div>
  );
}

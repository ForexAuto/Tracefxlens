'use client';

import React, { useEffect, useRef } from 'react';
import type { TradingSignalResponse } from '@/lib/trading-data';
import {
  MarkupLayerFilter,
  renderMarkedChartToCanvas,
  StructureSubLayer,
} from '@/lib/chart-markup';

interface AnnotatedChartOverlayProps {
  imageDataUrl: string;
  signal: TradingSignalResponse;
  layerFilter: MarkupLayerFilter;
  subLayer?: StructureSubLayer;
  visible: boolean;
}

/**
 * Renders the pixel-calibrated AI technical analysis markup onto a high-DPI HTML5
 * Canvas locked to the image's exact natural dimensions, guaranteeing 100% visual
 * and geometric parity between in-app preview, fullscreen lightbox, and PNG export.
 */
export function AnnotatedChartOverlay({
  imageDataUrl,
  signal,
  layerFilter,
  subLayer = 'all',
  visible,
}: AnnotatedChartOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!signal.isValidChart || !imageDataUrl) return;

    let cancelled = false;
    let drawn = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';

    const draw = () => {
      if (cancelled || drawn || !canvasRef.current) return;
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
      drawn = true;
      renderMarkedChartToCanvas(canvasRef.current, img, signal, {
        layerFilter,
        subLayer,
        includeStamp: false,
      });
    };

    img.onload = draw;
    img.src = imageDataUrl;

    if (img.complete && img.naturalWidth > 0) {
      draw();
    }

    return () => {
      cancelled = true;
    };
  }, [imageDataUrl, signal, layerFilter, subLayer]);

  if (!signal.isValidChart) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-label={`AI technical analysis drawings for ${signal.detectedPair}`}
      className={`pointer-events-none absolute inset-0 block h-full w-full select-none transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}

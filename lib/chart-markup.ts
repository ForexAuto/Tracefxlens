import type {
  ChartMarkupLiquidity,
  ChartMarkupSwing,
  ChartMarkupTrendline,
  ChartMarkupZone,
  DetectedAxisTickAnchor,
  DetectedCandleBar,
  DetectedCandleEnvelope,
  DetectedFvgCandidate,
  DetectedPivotAnchor,
  SignalType,
  TradingSignalResponse,
} from '@/lib/trading-data';
import { scanChartOpticalGeometry } from '@/lib/chart-optical-scanner';

export type MarkupLayerFilter = 'primary' | 'all' | 'setup' | 'structure';

export type StructureSubLayer =
  | 'all'
  | 'zones'
  | 'fvg'
  | 'bos_swings'
  | 'liquidity'
  | 'trendlines';

export interface StructureLayerCounts {
  total: number;
  zones: number;
  fvg: number;
  bosSwings: number;
  liquidity: number;
  trendlines: number;
}

export interface ResolvedZoneRect {
  id: string;
  label: string;
  role: ChartMarkupZone['role'];
  tone: 'bullish' | 'bearish' | 'neutral';
  isOrderBlock: boolean;
  mitigated: boolean;
  isPrimary: boolean;
  x: number;
  width: number;
  topY: number;
  height: number;
  priceText: string;
}

export interface ResolvedFvgRect {
  id: string;
  label: string;
  tone: 'bullish' | 'bearish';
  mitigated: boolean;
  isPrimary: boolean;
  x: number;
  width: number;
  topY: number;
  height: number;
  midY: number;
  priceText: string;
}

export interface ResolvedStructureBreak {
  id: string;
  kind: 'BOS' | 'CHoCH';
  label: string;
  tone: 'bullish' | 'bearish';
  x1: number;
  x2: number;
  y: number;
  priceText: string;
  isPrimary: boolean;
}

export interface ResolvedLiquidityLine {
  id: string;
  kind: ChartMarkupLiquidity['kind'];
  label: string;
  tone: 'bullish' | 'bearish' | 'neutral';
  x1: number;
  x2: number;
  y: number;
  priceText: string;
  swept: boolean;
  isPrimary: boolean;
}

export interface ResolvedLevelLine {
  id: 'tp3' | 'tp2' | 'tp1' | 'entry' | 'current' | 'sl';
  shortTag: string;
  priceText: string;
  y: number;
  labelY: number;
  tone: 'tp' | 'entry' | 'current' | 'sl';
  dashed: boolean;
}

export interface ResolvedPositionBox {
  startX: number;
  endX: number;
  entryY: number;
  slY: number;
  tp1Y: number;
  tp2Y: number;
  tp3Y: number;
  currentY: number;
  isBullish: boolean;
  isStandAside: boolean;
  riskTopY: number;
  riskHeight: number;
  rewardTopY: number;
  rewardHeight: number;
  rrCenterY: number;
  rrBadgeText: string;
}

export interface ResolvedPathSegment {
  points: Array<{ x: number; y: number }>;
  dashed: boolean;
  hasArrowhead: boolean;
}

export interface ResolvedChartMarkup {
  isLightBg: boolean;
  plotBox: {
    leftX: number;
    rightX: number;
    topY: number;
    bottomY: number;
  };
  anchorPoint: {
    x: number;
    y: number;
  };
  stampAnchor: 'bottom-left' | 'top-right';
  zones: ResolvedZoneRect[];
  fairValueGaps: ResolvedFvgRect[];
  structureBreaks: ResolvedStructureBreak[];
  liquidityLevels: ResolvedLiquidityLine[];
  trendlines: ChartMarkupTrendline[];
  swings: ChartMarkupSwing[];
  positionBox: ResolvedPositionBox | null;
  levelLines: ResolvedLevelLine[];
  pathSegments: ResolvedPathSegment[];
  tone: 'bullish' | 'bearish' | 'neutral';
}

export interface ChartPixelGeometry {
  isLightBg: boolean;
  plotBox: {
    leftX: number;
    rightX: number;
    topY: number;
    bottomY: number;
  };
  detectedCurrentLineY: number | null;
  detectedLastCandleX: number | null;
  axisLabelCentroidsY: number[];
  detectedAxisTicks: DetectedAxisTickAnchor[];
  liveBadgeY: number | null;
  verifiedBidAskLineY: number | null;
  candles: DetectedCandleBar[];
  detectedPivots: DetectedPivotAnchor[];
  detectedFvgCandidates: DetectedFvgCandidate[];
  candleEnvelope?: DetectedCandleEnvelope;
  snapToCandleWick: (
    nx: number,
    ny: number,
    mode: 'high' | 'low' | 'nearest',
    radiusNX?: number,
    radiusNY?: number
  ) => { x: number; y: number } | null;
  findOriginCandleForBand: (
    prefStartX: number,
    bandTopY: number,
    bandBotY: number,
    roleTone: 'bullish' | 'bearish' | 'neutral',
    isOrderBlock: boolean
  ) => DetectedCandleBar | null;
  findBreakoutCandleX: (
    originX: number,
    levelY: number,
    tone: 'bullish' | 'bearish'
  ) => number | null;
  stampAnchor: 'bottom-left' | 'top-right';
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function parseChartPrice(raw?: string | null): number | null {
  if (!raw) return null;
  const firstPart = String(raw).split(/[–—-]/)[0] || String(raw);
  const cleaned = firstPart.replace(/[^0-9.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getStructureLayerCounts(
  signal: TradingSignalResponse | null | undefined
): StructureLayerCounts {
  if (!signal || !signal.isValidChart) {
    return {
      total: 0,
      zones: 0,
      fvg: 0,
      bosSwings: 0,
      liquidity: 0,
      trendlines: 0,
    };
  }
  const m = signal.chartMarkup;
  const zones =
    m?.zones && m.zones.length > 0
      ? m.zones.length
      : Math.min(6, signal.keyLevels?.length ?? 0);
  const fvg = m?.fairValueGaps?.length ?? 0;
  const bosSwings =
    (m?.structureBreaks?.length ?? 0) + (m?.swings?.length ?? 0);
  const liquidity = m?.liquidityLevels?.length ?? 0;
  const trendlines = m?.trendlines?.length ?? 0;

  return {
    total: zones + fvg + bosSwings + liquidity + trendlines,
    zones,
    fvg,
    bosSwings,
    liquidity,
    trendlines,
  };
}

function isBullishSignal(signalType: SignalType): boolean {
  return signalType === 'BUY';
}

function getZoneTone(role: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = role.toLowerCase();
  if (
    lower.includes('demand') ||
    lower.includes('support') ||
    lower.includes('bullish ob') ||
    lower.includes('bull ob')
  ) {
    return 'bullish';
  }
  if (
    lower.includes('supply') ||
    lower.includes('resistance') ||
    lower.includes('bearish ob') ||
    lower.includes('bear ob')
  ) {
    return 'bearish';
  }
  return 'neutral';
}

/**
 * High-resolution portrait & landscape optical scanner shared 1:1 with the pre-AI
 * vision enhancer (`scanChartOpticalGeometry`). Extracts exact `plotBox` bounds,
 * printed Y-axis tick centroids (`T1..Tk`), verified live-price pill (`LIVE`),
 * segmented candlesticks, swing wick pivots (`H1..H8`, `L1..L8`), and 3-candle FVGs (`G1..G10`).
 */
export function analyzeChartPixels(
  img: HTMLImageElement,
  signal: TradingSignalResponse
): ChartPixelGeometry | null {
  const optical = scanChartOpticalGeometry(img, signal.chartMarkup?.plotBox);
  if (!optical) return null;

  const verifiedLiveY = optical.verifiedBidAskLineY ?? optical.liveBadgeY;

  return {
    isLightBg: optical.isLightBg,
    plotBox: { ...optical.detectedPlotBox },
    detectedCurrentLineY: verifiedLiveY,
    detectedLastCandleX: optical.candleEnvelope?.lastCandleX ?? null,
    axisLabelCentroidsY: optical.detectedAxisTicks.map((t) => t.y),
    detectedAxisTicks: optical.detectedAxisTicks,
    liveBadgeY: optical.liveBadgeY,
    verifiedBidAskLineY: optical.verifiedBidAskLineY,
    candles: optical.candles,
    detectedPivots: optical.detectedPivots,
    detectedFvgCandidates: optical.detectedFvgCandidates,
    candleEnvelope: optical.candleEnvelope,
    snapToCandleWick: (nx, ny, mode, radiusNX, radiusNY) => {
      const res = optical.snapToCandleWick(nx, ny, mode, radiusNX, radiusNY);
      return res ? { x: res.x, y: res.y } : null;
    },
    findOriginCandleForBand: optical.findOriginCandleForBand,
    findBreakoutCandleX: optical.findBreakoutCandleX,
    stampAnchor: optical.stampAnchor,
  };
}

function snapTickYToAxisCentroid(
  rawY: number,
  centroids: number[]
): { y: number; snapped: boolean } {
  if (centroids.length === 0) return { y: rawY, snapped: false };
  let closest = rawY;
  let minDiff = 16;
  let snapped = false;
  for (const c of centroids) {
    const diff = Math.abs(c - rawY);
    if (diff < minDiff) {
      minDiff = diff;
      closest = c;
      snapped = true;
    }
  }
  return { y: closest, snapped };
}

function weightedMedian(items: Array<{ value: number; weight: number }>): number {
  if (items.length === 0) return 0;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((acc, it) => acc + Math.max(1e-6, it.weight), 0);
  let acc = 0;
  for (const it of sorted) {
    acc += Math.max(1e-6, it.weight);
    if (acc >= totalWeight * 0.5) {
      return it.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

function normalizeAnchorKey(raw?: string): string {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Computes a pixel-accurate, mathematically undistorted 0..1000 technical drawing
 * layout calibrated directly against the chart's price axis and physical candlestick wicks.
 */
export function computeResolvedChartMarkup(
  signal: TradingSignalResponse,
  pixelGeo?: ChartPixelGeometry | null
): ResolvedChartMarkup {
  const rawMarkup = signal.chartMarkup;
  const isLightBg = pixelGeo?.isLightBg ?? false;

  const leftX = pixelGeo
    ? pixelGeo.plotBox.leftX
    : clamp(Number(rawMarkup?.plotBox?.leftX ?? 20), 6, 200);
  const rightX = pixelGeo
    ? pixelGeo.plotBox.rightX
    : clamp(Number(rawMarkup?.plotBox?.rightX ?? 850), 680, 965);
  const topY = pixelGeo
    ? pixelGeo.plotBox.topY
    : clamp(Number(rawMarkup?.plotBox?.topY ?? 65), 14, 280);
  const bottomY = pixelGeo
    ? pixelGeo.plotBox.bottomY
    : clamp(Number(rawMarkup?.plotBox?.bottomY ?? 865), 420, 968);

  const minPlotY = topY + 10;
  const maxPlotY = bottomY - 10;

  const rawLastX = Number(rawMarkup?.axisCalibration?.lastCandleX ?? rightX - 65);
  const lastCandleX =
    pixelGeo?.detectedLastCandleX !== null && pixelGeo?.detectedLastCandleX !== undefined
      ? pixelGeo.detectedLastCandleX
      : clamp(rawLastX, leftX + 120, rightX - 14);

  const rawLastY = Number(
    rawMarkup?.axisCalibration?.lastCandleY ??
      pixelGeo?.candleEnvelope?.lastCandleCloseY ??
      (minPlotY + maxPlotY) / 2
  );
  const verifiedLiveY =
    pixelGeo?.verifiedBidAskLineY ?? pixelGeo?.liveBadgeY ?? pixelGeo?.detectedCurrentLineY ?? null;

  const fallbackCurrentY =
    verifiedLiveY ??
    pixelGeo?.candleEnvelope?.lastCandleCloseY ??
    clamp(rawLastY, minPlotY + 16, maxPlotY - 16);

  const currentNum = parseChartPrice(signal.currentMarketPrice);
  const entryNum = parseChartPrice(signal.entryPrice);
  const slNum = parseChartPrice(signal.stopLoss);
  const tp1Num = parseChartPrice(signal.takeProfit1);
  const tp2Num = parseChartPrice(signal.takeProfit2);
  const tp3Num = parseChartPrice(signal.takeProfit3);

  // Build lookup maps for exact pixel-detected anchors (T1..Tk, LIVE, H1..H8, L1..L8, G1..G10)
  const opticalTickMap = new Map<string, number>();
  for (const t of pixelGeo?.detectedAxisTicks || []) {
    const key = normalizeAnchorKey(t.id);
    if (key) opticalTickMap.set(key, t.y);
  }
  if (pixelGeo?.liveBadgeY !== null && pixelGeo?.liveBadgeY !== undefined) {
    opticalTickMap.set('LIVE', pixelGeo.liveBadgeY);
  }

  const opticalPivotMap = new Map<string, DetectedPivotAnchor>();
  for (const p of pixelGeo?.detectedPivots || []) {
    const key = normalizeAnchorKey(p.id);
    if (key) opticalPivotMap.set(key, p);
  }

  const opticalFvgMap = new Map<string, DetectedFvgCandidate>();
  for (const g of pixelGeo?.detectedFvgCandidates || []) {
    const key = normalizeAnchorKey(g.id);
    if (key) opticalFvgMap.set(key, g);
  }

  // Collect multi-point Y-axis calibration anchors and solve scale via outlier-proof Theil-Sen / RANSAC
  const centroids = pixelGeo?.axisLabelCentroidsY ?? [];
  const rawCalibCandidates: Array<{ price: number; y: number; weight: number }> = [];

  if (Array.isArray(rawMarkup?.axisCalibration?.axisTicks)) {
    for (const tick of rawMarkup.axisCalibration.axisTicks) {
      const p = parseChartPrice(tick.price);
      if (p === null) continue;

      const tKey = normalizeAnchorKey(tick.tickId);
      const exactTickY = tKey ? opticalTickMap.get(tKey) : undefined;
      if (exactTickY !== undefined && exactTickY >= topY - 12 && exactTickY <= bottomY + 12) {
        rawCalibCandidates.push({
          price: p,
          y: clamp(exactTickY, topY, bottomY),
          weight: 2.8,
        });
        continue;
      }

      const rawY = Number(tick.y);
      if (Number.isFinite(rawY) && rawY >= topY - 18 && rawY <= bottomY + 18) {
        const snapped = snapTickYToAxisCentroid(clamp(rawY, topY, bottomY), centroids);
        rawCalibCandidates.push({
          price: p,
          y: snapped.y,
          weight: snapped.snapped ? 1.8 : 1.0,
        });
      }
    }
  }

  const highRefPrice = parseChartPrice(rawMarkup?.axisCalibration?.highRefPrice);
  const lowRefPrice = parseChartPrice(rawMarkup?.axisCalibration?.lowRefPrice);
  const highRefY = Number(rawMarkup?.axisCalibration?.highRefY);
  const lowRefY = Number(rawMarkup?.axisCalibration?.lowRefY);

  if (
    highRefPrice !== null &&
    Number.isFinite(highRefY) &&
    highRefY >= topY - 15 &&
    highRefY <= bottomY + 15
  ) {
    const snapped = snapTickYToAxisCentroid(clamp(highRefY, topY, bottomY), centroids);
    rawCalibCandidates.push({
      price: highRefPrice,
      y: snapped.y,
      weight: snapped.snapped ? 1.3 : 0.75,
    });
  }
  if (
    lowRefPrice !== null &&
    Number.isFinite(lowRefY) &&
    lowRefY >= topY - 15 &&
    lowRefY <= bottomY + 15
  ) {
    const snapped = snapTickYToAxisCentroid(clamp(lowRefY, topY, bottomY), centroids);
    rawCalibCandidates.push({
      price: lowRefPrice,
      y: snapped.y,
      weight: snapped.snapped ? 1.3 : 0.75,
    });
  }

  if (currentNum !== null && verifiedLiveY !== null) {
    rawCalibCandidates.push({
      price: currentNum,
      y: clamp(verifiedLiveY, topY, bottomY),
      weight: 2.4,
    });
  }

  // Merge duplicate price anchors (keeping highest-weight / exact optical Y)
  const dedupedCalib: Array<{ price: number; y: number; weight: number }> = [];
  for (const cand of rawCalibCandidates) {
    const existingIdx = dedupedCalib.findIndex(
      (c) => Math.abs(c.price - cand.price) / Math.max(cand.price, 1e-9) < 1e-5
    );
    if (existingIdx === -1) {
      dedupedCalib.push(cand);
    } else if (cand.weight > dedupedCalib[existingIdx].weight) {
      dedupedCalib[existingIdx] = cand;
    }
  }

  // Outlier-proof Theil-Sen median pairwise slope + RANSAC inlier refinement
  let calibratedSlope: number | null = null;
  let calibratedInterceptB = 0; // y(p) = calibratedInterceptB - calibratedSlope * p
  let inlierCount = 0;

  if (dedupedCalib.length >= 2) {
    const pairwiseSlopes: Array<{ value: number; weight: number }> = [];
    for (let i = 0; i < dedupedCalib.length; i++) {
      for (let j = i + 1; j < dedupedCalib.length; j++) {
        const dp = dedupedCalib[i].price - dedupedCalib[j].price;
        const dy = dedupedCalib[j].y - dedupedCalib[i].y; // positive when higher price has smaller Y
        if (Math.abs(dp) > 1e-10 && Math.abs(dy) >= 16) {
          const slope = dy / dp;
          if (slope > 0 && Number.isFinite(slope)) {
            pairwiseSlopes.push({
              value: slope,
              weight:
                dedupedCalib[i].weight *
                dedupedCalib[j].weight *
                Math.min(350, Math.abs(dy)),
            });
          }
        }
      }
    }

    if (pairwiseSlopes.length > 0) {
      const medianSlope = weightedMedian(pairwiseSlopes);
      const intercepts = dedupedCalib.map((pt) => ({
        value: pt.y + medianSlope * pt.price,
        weight: pt.weight,
      }));
      const medianInterceptB = weightedMedian(intercepts);

      // Filter out misread digits or echoed prompt coordinates (> 18 Y-units residual)
      const inliers = dedupedCalib.filter(
        (pt) => Math.abs(medianInterceptB - medianSlope * pt.price - pt.y) <= 18
      );
      inlierCount = inliers.length;

      if (inliers.length >= 2) {
        let wSum = 0;
        let pMean = 0;
        let yMean = 0;
        for (const pt of inliers) {
          wSum += pt.weight;
          pMean += pt.weight * pt.price;
          yMean += pt.weight * pt.y;
        }
        pMean /= Math.max(1e-9, wSum);
        yMean /= Math.max(1e-9, wSum);

        let num = 0;
        let den = 0;
        for (const pt of inliers) {
          const dp = pMean - pt.price;
          const dy = pt.y - yMean;
          num += pt.weight * dp * dy;
          den += pt.weight * dp * dp;
        }
        if (den > 1e-12 && num / den > 0) {
          calibratedSlope = num / den;
          calibratedInterceptB = yMean + calibratedSlope * pMean;
        } else {
          calibratedSlope = medianSlope;
          calibratedInterceptB = medianInterceptB;
        }
      } else {
        calibratedSlope = medianSlope;
        calibratedInterceptB = medianInterceptB;
      }
    }
  }

  const setupNums = [
    currentNum,
    entryNum,
    slNum,
    tp1Num,
    tp2Num,
    tp3Num,
    ...signal.keyLevels.map((k) => parseChartPrice(k.price)),
  ].filter((n): n is number => n !== null);

  let rawPriceToY: (price: number) => number;

  if (calibratedSlope !== null) {
    // ONLY anchor intercept to verified live Y-axis badge if it agrees with the multi-tick Y-scale
    // (or if fewer than 2 regular scale ticks existed). Never let a stray line shift true axis ticks!
    if (currentNum !== null && verifiedLiveY !== null) {
      const predictedLiveY = calibratedInterceptB - calibratedSlope * currentNum;
      if (inlierCount < 2 || Math.abs(predictedLiveY - verifiedLiveY) <= 16) {
        const blendedLiveY =
          inlierCount >= 3
            ? verifiedLiveY * 0.65 + predictedLiveY * 0.35
            : verifiedLiveY;
        rawPriceToY = (p: number) => blendedLiveY + (currentNum - p) * calibratedSlope!;
      } else {
        rawPriceToY = (p: number) => calibratedInterceptB - calibratedSlope! * p;
      }
    } else {
      rawPriceToY = (p: number) => calibratedInterceptB - calibratedSlope! * p;
    }
  } else if (setupNums.length >= 2) {
    // Cropped-axis fallback calibrated to real detected candle envelope
    const minP = Math.min(...setupNums);
    const maxP = Math.max(...setupNums);
    const span = Math.max(maxP - minP, 1e-6);
    const envSpanY = pixelGeo?.candleEnvelope
      ? Math.max(140, pixelGeo.candleEnvelope.maxLowY - pixelGeo.candleEnvelope.minHighY)
      : (maxPlotY - minPlotY) * 0.76;
    const fallbackSlope = envSpanY / span;
    if (currentNum !== null) {
      rawPriceToY = (p: number) =>
        fallbackCurrentY + (currentNum - p) * fallbackSlope;
    } else {
      const envMidY = pixelGeo?.candleEnvelope
        ? (pixelGeo.candleEnvelope.minHighY + pixelGeo.candleEnvelope.maxLowY) / 2
        : (minPlotY + maxPlotY) / 2;
      const midP = (minP + maxP) / 2;
      rawPriceToY = (p: number) => envMidY + (midP - p) * fallbackSlope;
    }
  } else {
    rawPriceToY = () => fallbackCurrentY;
  }

  const mapLevelY = (
    priceNum: number | null,
    fallbackY: number
  ): { y: number; clipped: 'top' | 'bottom' | null } => {
    const unclipped = priceNum !== null ? rawPriceToY(priceNum) : fallbackY;
    if (unclipped < minPlotY) return { y: minPlotY, clipped: 'top' };
    if (unclipped > maxPlotY) return { y: maxPlotY, clipped: 'bottom' };
    return { y: unclipped, clipped: null };
  };

  const bullish = isBullishSignal(signal.signalType);
  const standAside = signal.signalType === 'HOLD';
  const overallTone: 'bullish' | 'bearish' | 'neutral' = standAside
    ? 'neutral'
    : bullish
    ? 'bullish'
    : 'bearish';

  // Exact undistorted price-to-Y mapping (NEVER artificially shift true price lines!)
  const currentMapped = mapLevelY(currentNum, fallbackCurrentY);
  const entryMapped = mapLevelY(
    entryNum,
    standAside ? currentMapped.y : currentMapped.y
  );
  const slMapped = mapLevelY(
    slNum,
    clamp(entryMapped.y + (bullish ? 75 : -75), minPlotY, maxPlotY)
  );
  const tp1Mapped = mapLevelY(
    tp1Num,
    clamp(entryMapped.y + (bullish ? -65 : 65), minPlotY, maxPlotY)
  );
  const tp2Mapped = mapLevelY(
    tp2Num,
    clamp(entryMapped.y + (bullish ? -125 : 125), minPlotY, maxPlotY)
  );
  const tp3Mapped = mapLevelY(
    tp3Num,
    clamp(entryMapped.y + (bullish ? -185 : 185), minPlotY, maxPlotY)
  );

  const currentY = standAside ? currentMapped.y : entryMapped.y;
  const entryY = entryMapped.y;
  const slY = slMapped.y;
  const tp1Y = tp1Mapped.y;
  const tp2Y = tp2Mapped.y;
  const tp3Y = tp3Mapped.y;

  const maxAllowedZoneHeight = Math.max(54, (bottomY - topY) * 0.36);

  // Resolve Supply / Demand / S&R / Order Block Zones — automatically locked onto real origin candles
  const resolvedZones: ResolvedZoneRect[] = [];
  const rawZones = rawMarkup?.zones ?? [];
  const rawFvgs = rawMarkup?.fairValueGaps ?? [];
  const anyExplicitPrimaryZone =
    rawZones.some((z) => Boolean(z.isPrimary)) ||
    rawFvgs.some((f) => Boolean(f.isPrimary));

  if (rawZones.length > 0) {
    rawZones.slice(0, 12).forEach((z, idx) => {
      const topPriceNum = parseChartPrice(z.topPrice);
      const botPriceNum = parseChartPrice(z.bottomPrice);
      const tone = getZoneTone(z.role);
      const isOrderBlock =
        z.role === 'Bullish OB' ||
        z.role === 'Bearish OB' ||
        z.label.toLowerCase().includes('ob') ||
        z.label.toLowerCase().includes('order block');

      let zTop =
        topPriceNum !== null
          ? clamp(rawPriceToY(topPriceNum), topY + 5, bottomY - 14)
          : clamp(Number(z.topY ?? 450), topY + 6, bottomY - 20);
      let zBot =
        botPriceNum !== null
          ? clamp(rawPriceToY(botPriceNum), topY + 13, bottomY - 5)
          : topPriceNum !== null
          ? clamp(zTop + 18, topY + 15, bottomY - 5)
          : clamp(Number(z.bottomY ?? zTop + 24), topY + 15, bottomY - 5);

      if (zTop > zBot) {
        const tmp = zTop;
        zTop = zBot;
        zBot = tmp;
      }

      let startX = clamp(
        Number(z.startX ?? leftX + 60),
        leftX + 6,
        Math.max(leftX + 44, lastCandleX - 20)
      );
      let isMitigated = Boolean(z.mitigated);
      const rawEndX = Number(z.endX);
      let effectiveEndX =
        isMitigated && Number.isFinite(rawEndX) && rawEndX > startX + 32
          ? clamp(rawEndX, startX + 40, rightX)
          : rightX;

      // Lock zone startX (and Order Block wick/body bounds) onto the real origin candle on the chart!
      if (pixelGeo && pixelGeo.candles.length > 0) {
        const originCandle = pixelGeo.findOriginCandleForBand(
          startX,
          zTop,
          zBot,
          tone,
          isOrderBlock
        );

        if (originCandle) {
          startX = clamp(
            originCandle.x - originCandle.width * 0.5,
            leftX + 4,
            Math.max(leftX + 36, lastCandleX - 16)
          );

          // Tighten Order Blocks (or zones lacking explicit dual price bounds) to physical candle body+wick
          const hasDualPriceBounds = topPriceNum !== null && botPriceNum !== null;
          if (isOrderBlock || !hasDualPriceBounds) {
            const obTop =
              tone === 'bearish'
                ? originCandle.highY
                : Math.min(originCandle.lowY - 8, originCandle.bodyTopY);
            const obBot =
              tone === 'bearish'
                ? Math.max(originCandle.highY + 8, originCandle.bodyBottomY)
                : originCandle.lowY;

            const midDiff = Math.abs((obTop + obBot) / 2 - (zTop + zBot) / 2);
            if (!hasDualPriceBounds || calibratedSlope === null || midDiff <= 22) {
              zTop = clamp(obTop, topY + 5, bottomY - 14);
              zBot = clamp(Math.max(zTop + 8, obBot), topY + 13, bottomY - 5);
            }
          }

          // Verify mitigation candle X when zone is marked mitigated
          if (isMitigated) {
            const zMid = (zTop + zBot) / 2;
            for (let k = originCandle.index + 3; k < pixelGeo.candles.length; k++) {
              const c = pixelGeo.candles[k];
              const pierced =
                tone === 'bullish'
                  ? c.lowY >= zMid
                  : tone === 'bearish'
                  ? c.highY <= zMid
                  : c.highY <= zBot && c.lowY >= zTop;
              if (pierced && c.x > startX + 28) {
                effectiveEndX = clamp(c.x + c.width * 0.5, startX + 36, rightX);
                break;
              }
            }
          } else {
            effectiveEndX = rightX;
          }
        }
      }

      const height = clamp(zBot - zTop, 8, maxAllowedZoneHeight);

      resolvedZones.push({
        id: `zone-${idx}`,
        label: z.label || z.role,
        role: z.role,
        tone,
        isOrderBlock,
        mitigated: isMitigated,
        isPrimary: anyExplicitPrimaryZone ? Boolean(z.isPrimary) : idx === 0,
        x: startX,
        width: Math.max(44, effectiveEndX - startX),
        topY: clamp(zTop, topY + 5, bottomY - height - 5),
        height,
        priceText: z.topPrice || z.bottomPrice || '',
      });
    });
  } else if (signal.keyLevels.length > 0) {
    signal.keyLevels.slice(0, 8).forEach((lvl, idx) => {
      const pNum = parseChartPrice(lvl.price);
      if (pNum === null) return;
      const centerY = clamp(rawPriceToY(pNum), topY + 14, bottomY - 14);
      const height = 18;
      let zTop = clamp(centerY - height / 2, topY + 5, bottomY - height - 5);
      const zBot = zTop + height;
      const tone = getZoneTone(lvl.role);
      const role: ChartMarkupZone['role'] =
        lvl.role === 'Fair Value Gap' || lvl.role === 'Structure Break'
          ? 'Support'
          : lvl.role;
      const isOrderBlock = role === 'Bullish OB' || role === 'Bearish OB';

      let startX = clamp(
        leftX + 70 + (idx % 4) * 50,
        leftX + 10,
        Math.max(leftX + 50, lastCandleX - 32)
      );
      if (pixelGeo && pixelGeo.candles.length > 0) {
        const originCandle = pixelGeo.findOriginCandleForBand(
          startX,
          zTop,
          zBot,
          tone,
          isOrderBlock
        );
        if (originCandle) {
          startX = clamp(
            originCandle.x - originCandle.width * 0.5,
            leftX + 6,
            Math.max(leftX + 36, lastCandleX - 18)
          );
        }
      }

      resolvedZones.push({
        id: `fallback-zone-${idx}`,
        label: lvl.label,
        role,
        tone,
        isOrderBlock,
        mitigated: false,
        isPrimary: idx === 0,
        x: startX,
        width: Math.max(55, rightX - startX),
        topY: zTop,
        height,
        priceText: lvl.price,
      });
    });
  }

  // Resolve Fair Value Gaps (FVG / Imbalances) — locked onto real 3-candle wick-to-wick gaps
  const consumedGapIds = new Set<string>();
  const maxAllowedFvgHeight = Math.max(46, (bottomY - topY) * 0.28);

  const fairValueGaps: ResolvedFvgRect[] = rawFvgs
    .slice(0, 8)
    .map((f, idx): ResolvedFvgRect => {
      const fTone: 'bullish' | 'bearish' = f.tone === 'bearish' ? 'bearish' : 'bullish';
      const topP = parseChartPrice(f.topPrice);
      const botP = parseChartPrice(f.bottomPrice);

      let fTop =
        topP !== null
          ? clamp(rawPriceToY(topP), topY + 5, bottomY - 14)
          : clamp(Number(f.topY ?? 460), topY + 6, bottomY - 20);
      let fBot =
        botP !== null
          ? clamp(rawPriceToY(botP), topY + 12, bottomY - 5)
          : topP !== null
          ? clamp(fTop + 16, topY + 14, bottomY - 5)
          : clamp(Number(f.bottomY ?? fTop + 20), topY + 14, bottomY - 5);

      if (fTop > fBot) {
        const tmp = fTop;
        fTop = fBot;
        fBot = tmp;
      }

      let startX = clamp(
        Number(f.startX ?? leftX + 120),
        leftX + 6,
        Math.max(leftX + 42, lastCandleX - 16)
      );
      let isMitigated = Boolean(f.mitigated);
      const rawEndX = Number(f.endX);
      let effectiveEndX =
        isMitigated && Number.isFinite(rawEndX) && rawEndX > startX + 28
          ? clamp(rawEndX, startX + 34, rightX)
          : rightX;

      // 1. Exact ID match or spatial match against pre-detected physical 3-candle FVG gaps
      let matchedGap: DetectedFvgCandidate | undefined;
      const gKey = normalizeAnchorKey(f.gapId);
      if (gKey && opticalFvgMap.has(gKey)) {
        const cand = opticalFvgMap.get(gKey)!;
        if (!consumedGapIds.has(cand.id)) {
          matchedGap = cand;
        }
      }

      if (!matchedGap && pixelGeo && pixelGeo.detectedFvgCandidates.length > 0) {
        const fMid = (fTop + fBot) / 2;
        let bestDist = Infinity;
        for (const cand of pixelGeo.detectedFvgCandidates) {
          if (consumedGapIds.has(cand.id) || cand.tone !== fTone) continue;
          const cMid = (cand.topY + cand.bottomY) / 2;
          const dx = Math.abs(cand.startX - startX);
          const dy = Math.abs(cMid - fMid);
          const maxDy = calibratedSlope !== null && topP !== null ? 32 : 56;
          if (dx <= 85 && dy <= maxDy) {
            const d = dy * 1.35 + dx * 0.45;
            if (d < bestDist) {
              bestDist = d;
              matchedGap = cand;
            }
          }
        }
      }

      if (matchedGap) {
        consumedGapIds.add(matchedGap.id);
        startX = clamp(
          matchedGap.startX,
          leftX + 6,
          Math.max(leftX + 36, lastCandleX - 14)
        );
        fTop = clamp(matchedGap.topY, topY + 5, bottomY - 12);
        fBot = clamp(Math.max(fTop + 6, matchedGap.bottomY), topY + 11, bottomY - 5);
        if (matchedGap.mitigatedEndX !== undefined) {
          isMitigated = true;
          effectiveEndX = clamp(matchedGap.mitigatedEndX, startX + 24, rightX);
        } else if (!isMitigated) {
          effectiveEndX = rightX;
        }
      } else if (pixelGeo && pixelGeo.candles.length > 0) {
        // Fallback: anchor FVG startX directly onto the displacement candle at [fTop..fBot]
        const impulseCandle = pixelGeo.findOriginCandleForBand(
          startX,
          fTop,
          fBot,
          fTone,
          false
        );
        if (impulseCandle) {
          startX = clamp(
            impulseCandle.x - impulseCandle.width * 0.5,
            leftX + 6,
            Math.max(leftX + 36, lastCandleX - 14)
          );
          if (!isMitigated) {
            effectiveEndX = rightX;
          }
        }
      }

      const height = clamp(fBot - fTop, 6, maxAllowedFvgHeight);
      const clampedTop = clamp(fTop, topY + 5, bottomY - height - 5);
      return {
        id: `fvg-${idx}`,
        label: f.label || (fTone === 'bearish' ? 'Bearish FVG' : 'Bullish FVG'),
        tone: fTone,
        mitigated: isMitigated,
        isPrimary: Boolean(f.isPrimary),
        x: startX,
        width: Math.max(36, effectiveEndX - startX),
        topY: clampedTop,
        height,
        midY: clampedTop + height / 2,
        priceText: f.topPrice || f.bottomPrice || '',
      };
    });

  // Resolve Horizontal BOS & CHoCH Market Structure Breaks (locked to true swing wick + breakout candle)
  const rawBreaks = rawMarkup?.structureBreaks ?? [];
  const anyExplicitPrimaryBreak = rawBreaks.some((b) => Boolean(b.isPrimary));
  const structureBreaks: ResolvedStructureBreak[] = rawBreaks
    .slice(0, 10)
    .map((sb, idx): ResolvedStructureBreak => {
      const sbTone: 'bullish' | 'bearish' = sb.tone === 'bearish' ? 'bearish' : 'bullish';
      const pNum = parseChartPrice(sb.price);
      let y =
        pNum !== null
          ? clamp(rawPriceToY(pNum), topY + 10, bottomY - 10)
          : clamp(Number(sb.y ?? 450), topY + 10, bottomY - 10);

      let x1 = clamp(Number(sb.startX ?? leftX + 80), leftX + 8, lastCandleX - 20);
      let x2 = clamp(
        Number(sb.endX ?? x1 + 140),
        x1 + 30,
        Math.min(rightX - 6, lastCandleX + 16)
      );

      if (pixelGeo) {
        const pKey = normalizeAnchorKey(sb.pivotId);
        const matchedPivot = pKey ? opticalPivotMap.get(pKey) : undefined;
        const maxWickPullY = pNum !== null && calibratedSlope !== null ? 28 : 82;

        if (
          matchedPivot &&
          ((sbTone === 'bullish' && matchedPivot.kind === 'high') ||
            (sbTone === 'bearish' && matchedPivot.kind === 'low')) &&
          Math.abs(matchedPivot.y - y) <= maxWickPullY + 12
        ) {
          x1 = clamp(matchedPivot.x, leftX + 8, lastCandleX - 16);
          y = clamp(matchedPivot.y, topY + 8, bottomY - 8);
        } else {
          const wickSnap = pixelGeo.snapToCandleWick(
            x1,
            y,
            sbTone === 'bullish' ? 'high' : 'low',
            62,
            maxWickPullY
          );
          if (wickSnap) {
            x1 = clamp(wickSnap.x, leftX + 8, lastCandleX - 16);
            if (pNum === null || calibratedSlope === null || Math.abs(wickSnap.y - y) <= 28) {
              y = clamp(wickSnap.y, topY + 8, bottomY - 8);
            }
          }
        }

        const breakoutX = pixelGeo.findBreakoutCandleX(x1, y, sbTone);
        if (breakoutX !== null && breakoutX > x1 + 16) {
          x2 = clamp(breakoutX, x1 + 26, Math.min(rightX - 6, lastCandleX + 12));
        } else {
          x2 = clamp(Math.max(x2, x1 + 34), x1 + 28, Math.min(rightX - 6, lastCandleX + 14));
        }
      }

      return {
        id: `sb-${idx}`,
        kind: sb.kind === 'CHoCH' ? 'CHoCH' : 'BOS',
        label: sb.label || sb.kind,
        tone: sbTone,
        x1,
        x2,
        y,
        priceText: sb.price || '',
        isPrimary: anyExplicitPrimaryBreak
          ? Boolean(sb.isPrimary)
          : idx === rawBreaks.length - 1,
      };
    });

  // Resolve Liquidity Pools & Sweeps (EQH, EQL, BSL, SSL, Sweep) locked onto true high/low wicks
  const liquidityLevels: ResolvedLiquidityLine[] = (
    rawMarkup?.liquidityLevels ?? []
  )
    .slice(0, 8)
    .map((lq, idx): ResolvedLiquidityLine => {
      const pNum = parseChartPrice(lq.price);
      let y =
        pNum !== null
          ? clamp(rawPriceToY(pNum), topY + 8, bottomY - 8)
          : clamp(Number(lq.y ?? 350), topY + 8, bottomY - 8);

      let x1 = clamp(Number(lq.startX ?? leftX + 70), leftX + 8, lastCandleX - 18);
      const isSwept = Boolean(lq.swept || lq.kind === 'Sweep');
      let x2 = clamp(
        Number(lq.endX ?? (isSwept ? lastCandleX : rightX - 6)),
        x1 + 32,
        rightX - 6
      );

      const isUpperLiq =
        lq.kind === 'EQH' ||
        lq.kind === 'BSL' ||
        (lq.kind === 'Sweep' && lq.tone === 'bearish');

      if (pixelGeo) {
        const pKey = normalizeAnchorKey(lq.pivotId);
        const matchedPivot = pKey ? opticalPivotMap.get(pKey) : undefined;
        const maxWickPullY = pNum !== null && calibratedSlope !== null ? 26 : 76;

        if (
          matchedPivot &&
          ((isUpperLiq && matchedPivot.kind === 'high') ||
            (!isUpperLiq && matchedPivot.kind === 'low')) &&
          Math.abs(matchedPivot.y - y) <= maxWickPullY + 12
        ) {
          x1 = clamp(matchedPivot.x, leftX + 8, lastCandleX - 16);
          y = clamp(matchedPivot.y, topY + 8, bottomY - 8);
        } else {
          const snap = pixelGeo.snapToCandleWick(
            x1,
            y,
            isUpperLiq ? 'high' : 'low',
            62,
            maxWickPullY
          );
          if (snap) {
            x1 = clamp(snap.x, leftX + 8, lastCandleX - 16);
            if (pNum === null || calibratedSlope === null || Math.abs(snap.y - y) <= 26) {
              y = clamp(snap.y, topY + 8, bottomY - 8);
            }
          }
        }

        if (isSwept) {
          const sweepX = pixelGeo.findBreakoutCandleX(
            x1,
            y,
            isUpperLiq ? 'bullish' : 'bearish'
          );
          if (sweepX !== null && sweepX > x1 + 16) {
            x2 = clamp(sweepX + 8, x1 + 28, rightX - 6);
          } else {
            x2 = Math.max(x2, x1 + 32);
          }
        } else {
          x2 = Math.max(x2, rightX - 8);
        }
      }

      return {
        id: `liq-${idx}`,
        kind: lq.kind,
        label: lq.label || lq.kind,
        tone: lq.tone,
        x1,
        x2,
        y,
        priceText: lq.price || '',
        swept: isSwept,
        isPrimary: Boolean(lq.isPrimary),
      };
    });

  // Snap Trendlines & Parallel Price Channels onto real candle wick tips
  const trendlines: ChartMarkupTrendline[] = (rawMarkup?.trendlines || [])
    .slice(0, 6)
    .map((tl): ChartMarkupTrendline => {
      let x1 = clamp(Number(tl.x1 ?? leftX + 80), leftX + 8, rightX - 20);
      let y1 = clamp(Number(tl.y1 ?? 500), topY + 10, bottomY - 10);
      let x2 = clamp(Number(tl.x2 ?? lastCandleX), leftX + 35, rightX - 6);
      let y2 = clamp(Number(tl.y2 ?? 460), topY + 10, bottomY - 10);
      const tone: 'bullish' | 'bearish' | 'neutral' =
        tl.tone === 'bullish' || tl.tone === 'bearish' ? tl.tone : 'neutral';
      const isHorizontalStruct = Math.abs(y2 - y1) <= 16;

      if (pixelGeo) {
        const wickMode: 'high' | 'low' | 'nearest' =
          tl.role === 'Channel Upper' || tone === 'bearish'
            ? 'high'
            : tl.role === 'Channel Lower' || tone === 'bullish'
            ? 'low'
            : 'nearest';
        const snap1 = pixelGeo.snapToCandleWick(x1, y1, wickMode, 56, 95);
        if (snap1) {
          x1 = snap1.x;
          y1 = snap1.y;
        }
        if (isHorizontalStruct) {
          y2 = y1;
          x2 = Math.max(x2, Math.min(rightX - 10, lastCandleX));
        } else {
          const snap2 = pixelGeo.snapToCandleWick(
            Math.min(x2, lastCandleX),
            y2,
            wickMode,
            52,
            90
          );
          if (snap2 && Math.abs(snap2.x - x1) >= 40) {
            const slope = (snap2.y - y1) / (snap2.x - x1);
            const targetX2 = clamp(Math.max(snap2.x, lastCandleX), x1 + 40, rightX - 8);
            const projectedY2 = y1 + slope * (targetX2 - x1);
            if (projectedY2 >= topY + 8 && projectedY2 <= bottomY - 8) {
              x2 = targetX2;
              y2 = projectedY2;
            } else {
              x2 = snap2.x;
              y2 = snap2.y;
            }
          }
        }
      }

      return {
        label: String(tl.label || ''),
        role: tl.role,
        x1,
        y1,
        x2,
        y2,
        style: tl.style === 'dashed' ? 'dashed' : 'solid',
        tone,
        isPrimary: Boolean(tl.isPrimary),
      };
    })
    .filter((tl) => Math.hypot(tl.x2 - tl.x1, tl.y2 - tl.y1) >= 40);

  // Snap Full Left-to-Right Swing Structure Pivot Tags (HH, HL, LH, LL) directly onto candle wick tips
  const rawSwings = (rawMarkup?.swings || []).slice(0, 18);
  const candidateSwings: ChartMarkupSwing[] = rawSwings.map((sw): ChartMarkupSwing => {
    const tagUpper = String(sw.tag || '').toUpperCase();
    const inferredBelow =
      sw.position === 'below' ||
      tagUpper === 'HL' ||
      tagUpper === 'LL' ||
      tagUpper === 'EQL' ||
      tagUpper === 'SSL';
    const position: 'above' | 'below' = inferredBelow ? 'below' : 'above';
    const pNum = parseChartPrice(sw.price);
    let x = clamp(Number(sw.x ?? 450), leftX + 10, lastCandleX + 6);
    let y =
      pNum !== null
        ? clamp(rawPriceToY(pNum), topY + 14, bottomY - 14)
        : clamp(Number(sw.y ?? 450), topY + 14, bottomY - 14);

    if (pixelGeo) {
      const pKey = normalizeAnchorKey(sw.pivotId);
      const matchedPivot = pKey ? opticalPivotMap.get(pKey) : undefined;
      const maxSwingPullY = pNum !== null && calibratedSlope !== null ? 54 : 95;

      if (
        matchedPivot &&
        ((position === 'above' && matchedPivot.kind === 'high') ||
          (position === 'below' && matchedPivot.kind === 'low')) &&
        Math.abs(matchedPivot.y - y) <= maxSwingPullY + 16
      ) {
        x = clamp(matchedPivot.x, leftX + 10, rightX - 12);
        y = clamp(matchedPivot.y, topY + 12, bottomY - 12);
      } else {
        const snapped = pixelGeo.snapToCandleWick(
          x,
          y,
          position === 'above' ? 'high' : 'low',
          56,
          maxSwingPullY
        );
        if (snapped) {
          x = clamp(snapped.x, leftX + 10, rightX - 12);
          y = clamp(snapped.y, topY + 12, bottomY - 12);
        }
      }
    }

    return {
      tag: String(sw.tag || 'Pivot').slice(0, 8),
      x,
      y,
      pivotId: sw.pivotId,
      position,
      tone:
        sw.tone === 'bullish' || sw.tone === 'bearish' ? sw.tone : 'neutral',
      price: sw.price,
      isPrimary: Boolean(sw.isPrimary),
    };
  });

  // Deduplicate swings that snapped onto the exact same candle wick side
  const swings: ChartMarkupSwing[] = [];
  for (const sw of candidateSwings) {
    const duplicate = swings.some(
      (existing) =>
        existing.position === sw.position &&
        Math.abs(existing.x - sw.x) < 15 &&
        Math.abs(existing.y - sw.y) < 18
    );
    if (!duplicate) {
      swings.push(sw);
    }
  }

  // Position Box anchored directly on latest candle X extending into future space up to rightX
  const posStartX = Math.min(lastCandleX, rightX - 36);
  const posEndX = rightX;
  const projectionSpanX = Math.max(36, posEndX - posStartX);

  let positionBox: ResolvedPositionBox | null = null;
  const rawLevels: Array<Omit<ResolvedLevelLine, 'labelY'>> = [];
  const pathSegments: ResolvedPathSegment[] = [];

  const withClipArrow = (
    base: string,
    clipped: 'top' | 'bottom' | null
  ): string => {
    if (clipped === 'top') return `${base} ↑`;
    if (clipped === 'bottom') return `${base} ↓`;
    return base;
  };

  if (!standAside) {
    const riskTopY = Math.min(entryY, slY);
    const riskHeight = Math.max(6, Math.abs(slY - entryY));
    const rewardTopY = Math.min(entryY, tp3Y);
    const rewardHeight = Math.max(10, Math.abs(tp3Y - entryY));

    // Place R:R badge cleanly at the midpoint of the largest open reward leg so it never collides with Entry/TP pills
    const leg1Span = Math.abs(tp1Y - entryY);
    const leg2Span = Math.abs(tp2Y - tp1Y);
    const rrCenterY =
      leg1Span >= leg2Span
        ? (entryY + tp1Y) / 2
        : (tp1Y + tp2Y) / 2;

    positionBox = {
      startX: posStartX,
      endX: posEndX,
      entryY,
      slY,
      tp1Y,
      tp2Y,
      tp3Y,
      currentY,
      isBullish: bullish,
      isStandAside: false,
      riskTopY,
      riskHeight,
      rewardTopY,
      rewardHeight,
      rrCenterY,
      rrBadgeText: `R:R ${signal.riskRewardRatio}`,
    };

    if (signal.takeProfit3 && signal.takeProfit3 !== '—') {
      rawLevels.push({
        id: 'tp3',
        shortTag: withClipArrow('TP3', tp3Mapped.clipped),
        priceText: signal.takeProfit3,
        y: tp3Y,
        tone: 'tp',
        dashed: false,
      });
    }
    if (signal.takeProfit2 && signal.takeProfit2 !== '—') {
      rawLevels.push({
        id: 'tp2',
        shortTag: withClipArrow('TP2', tp2Mapped.clipped),
        priceText: signal.takeProfit2,
        y: tp2Y,
        tone: 'tp',
        dashed: true,
      });
    }
    if (signal.takeProfit1 && signal.takeProfit1 !== '—') {
      rawLevels.push({
        id: 'tp1',
        shortTag: withClipArrow('TP1', tp1Mapped.clipped),
        priceText: signal.takeProfit1,
        y: tp1Y,
        tone: 'tp',
        dashed: true,
      });
    }
    rawLevels.push({
      id: 'entry',
      shortTag: signal.signalType,
      priceText: signal.entryPrice,
      y: entryY,
      tone: 'entry',
      dashed: false,
    });
    if (signal.stopLoss && signal.stopLoss !== '—') {
      rawLevels.push({
        id: 'sl',
        shortTag: withClipArrow('SL', slMapped.clipped),
        priceText: signal.stopLoss,
        y: slY,
        tone: 'sl',
        dashed: false,
      });
    }

    const afterEntrySpan = Math.max(26, posEndX - posStartX - 5);
    const waveRetraceY = tp1Y + (entryY - tp1Y) * 0.28;
    pathSegments.push({
      points: [
        { x: lastCandleX, y: entryY },
        { x: posStartX + afterEntrySpan * 0.34, y: tp1Y },
        { x: posStartX + afterEntrySpan * 0.52, y: waveRetraceY },
        { x: posStartX + afterEntrySpan * 0.78, y: tp2Y },
        { x: posStartX + afterEntrySpan * 0.96, y: tp3Y },
      ],
      dashed: false,
      hasArrowhead: true,
    });
  } else {
    rawLevels.push({
      id: 'entry',
      shortTag: 'WATCH',
      priceText: signal.entryPrice,
      y: entryY,
      tone: 'entry',
      dashed: true,
    });
    pathSegments.push({
      points: [
        { x: lastCandleX, y: currentY },
        { x: posStartX + projectionSpanX * 0.32, y: currentY - 22 },
        { x: posStartX + projectionSpanX * 0.62, y: currentY + 18 },
        { x: posStartX + projectionSpanX * 0.92, y: entryY },
      ],
      dashed: true,
      hasArrowhead: true,
    });
  }

  // Non-overlapping labelY solver ONLY for callout badges (true line `y` is untouched)
  const sortedLevels: ResolvedLevelLine[] = [...rawLevels]
    .sort((a, b) => a.y - b.y)
    .map((lvl) => ({ ...lvl, labelY: lvl.y }));

  const minTagSpacingY = 22;
  for (let i = 1; i < sortedLevels.length; i++) {
    if (sortedLevels[i].labelY - sortedLevels[i - 1].labelY < minTagSpacingY) {
      sortedLevels[i].labelY = sortedLevels[i - 1].labelY + minTagSpacingY;
    }
  }
  if (
    sortedLevels.length > 0 &&
    sortedLevels[sortedLevels.length - 1].labelY > bottomY - 12
  ) {
    sortedLevels[sortedLevels.length - 1].labelY = bottomY - 12;
    for (let i = sortedLevels.length - 2; i >= 0; i--) {
      if (sortedLevels[i + 1].labelY - sortedLevels[i].labelY < minTagSpacingY) {
        sortedLevels[i].labelY = Math.max(
          topY + 12,
          sortedLevels[i + 1].labelY - minTagSpacingY
        );
      }
    }
  }

  return {
    isLightBg,
    plotBox: { leftX, rightX, topY, bottomY },
    anchorPoint: { x: lastCandleX, y: currentY },
    stampAnchor: pixelGeo?.stampAnchor ?? 'bottom-left',
    zones: resolvedZones,
    fairValueGaps,
    structureBreaks,
    liquidityLevels,
    trendlines,
    swings,
    positionBox,
    levelLines: sortedLevels,
    pathSegments,
    tone: overallTone,
  };
}

let cachedResolution: {
  srcKey: string;
  signalRef: TradingSignalResponse;
  markup: ResolvedChartMarkup;
} | null = null;

function getOrComputeMarkup(
  img: HTMLImageElement,
  signal: TradingSignalResponse
): ResolvedChartMarkup {
  const srcKey = `${img.src.length}:${img.src.slice(-48)}:${img.naturalWidth}x${img.naturalHeight}`;
  if (
    cachedResolution &&
    cachedResolution.srcKey === srcKey &&
    cachedResolution.signalRef === signal
  ) {
    return cachedResolution.markup;
  }
  const pixelGeo = analyzeChartPixels(img, signal);
  const markup = computeResolvedChartMarkup(signal, pixelGeo);
  cachedResolution = { srcKey, signalRef: signal, markup };
  return markup;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

interface PlacedLabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxesOverlap(a: PlacedLabelBox, b: PlacedLabelBox, pad = 3): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

export interface RenderMarkedChartOptions {
  layerFilter?: MarkupLayerFilter;
  subLayer?: StructureSubLayer;
  includeStamp?: boolean;
}

/**
 * Single unified high-DPI Canvas renderer shared by live in-app preview,
 * fullscreen lightbox, History inspector, and exported PNG.
 */
export function renderMarkedChartToCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  signal: TradingSignalResponse,
  options: RenderMarkedChartOptions = {}
): void {
  const {
    layerFilter = 'primary',
    subLayer = 'all',
    includeStamp = false,
  } = options;

  const natW = img.naturalWidth || img.width || 1280;
  const natH = img.naturalHeight || img.height || 800;
  const maxCanvasDim = 2880;
  const rawScale = natW < 1200 ? 2 : 1.5;
  const scale = Math.min(rawScale, maxCanvasDim / Math.max(natW, natH));

  const W = Math.max(1, Math.round(natW * scale));
  const H = Math.max(1, Math.round(natH * scale));

  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  if (!signal.isValidChart) return;

  const markup = getOrComputeMarkup(img, signal);
  const sx = (nx: number) => (nx / 1000) * W;
  const sy = (ny: number) => (ny / 1000) * H;
  const unit = Math.max(1.05, Math.min(W, H) / 960);

  const isPrimaryOnly = layerFilter === 'primary';
  const isLevelsOnly = layerFilter === 'setup';
  const showSetup =
    layerFilter === 'primary' || layerFilter === 'all' || layerFilter === 'setup';
  const showAnyStructure =
    layerFilter === 'primary' || layerFilter === 'all' || layerFilter === 'structure';

  const activeSub: StructureSubLayer = isPrimaryOnly ? 'all' : subLayer;
  const allowZones = activeSub === 'all' || activeSub === 'zones';
  const allowFvg = activeSub === 'all' || activeSub === 'fvg';
  const allowBosSwings = activeSub === 'all' || activeSub === 'bos_swings';
  const allowLiquidity = activeSub === 'all' || activeSub === 'liquidity';
  const allowTrendlines = activeSub === 'all' || activeSub === 'trendlines';

  const light = markup.isLightBg;
  const plotLeftPx = sx(markup.plotBox.leftX) + 4 * unit;
  const plotRightPx = sx(markup.plotBox.rightX) - 4 * unit;
  const plotTopPx = sy(markup.plotBox.topY) + 4 * unit;
  const plotBottomPx = sy(markup.plotBox.bottomY) - 4 * unit;

  // 2D Anti-Collision Label Tracker (pre-reserve right-edge execution pills so structure labels never collide)
  const placedLabels: PlacedLabelBox[] = [];

  const placeLabelBox = (
    prefX: number,
    prefY: number,
    w: number,
    h: number,
    offsets: Array<[number, number]> = [
      [0, 0],
      [34 * unit, 0],
      [72 * unit, 0],
      [0, -15 * unit],
      [0, 15 * unit],
      [-36 * unit, 0],
    ]
  ): { x: number; y: number } => {
    for (const [dx, dy] of offsets) {
      const cx = clamp(prefX + dx, plotLeftPx, Math.max(plotLeftPx, plotRightPx - w));
      const cy = clamp(prefY + dy, plotTopPx, Math.max(plotTopPx, plotBottomPx - h));
      const candidate: PlacedLabelBox = { x: cx, y: cy, w, h };
      if (!placedLabels.some((existing) => boxesOverlap(existing, candidate, 2.5 * unit))) {
        placedLabels.push(candidate);
        return { x: cx, y: cy };
      }
    }
    const fallbackX = clamp(prefX, plotLeftPx, Math.max(plotLeftPx, plotRightPx - w));
    const fallbackY = clamp(prefY, plotTopPx, Math.max(plotTopPx, plotBottomPx - h));
    placedLabels.push({ x: fallbackX, y: fallbackY, w, h });
    return { x: fallbackX, y: fallbackY };
  };

  if (showSetup) {
    ctx.save();
    ctx.font = `700 ${Math.round(10 * unit)}px ui-monospace, SFMono-Regular, monospace`;
    for (const lvl of markup.levelLines) {
      const tagText = `${lvl.shortTag} ${lvl.priceText}`;
      const tw = ctx.measureText(tagText).width;
      const pillH = 16.5 * unit;
      const pillW = tw + 11 * unit;
      const pillX = Math.max(
        plotLeftPx,
        Math.min(W - pillW - 4 * unit, sx(markup.plotBox.rightX) - pillW - 6 * unit)
      );
      const pillY = sy(lvl.labelY) - pillH / 2;
      placedLabels.push({ x: pillX, y: pillY, w: pillW, h: pillH });
    }
    ctx.restore();
  }

  if (showAnyStructure) {
    // 1. Supply / Demand / S&R / Order Block Zones
    if (allowZones) {
      const visibleZones = isPrimaryOnly
        ? markup.zones.filter((z) => z.isPrimary)
        : markup.zones;

      for (const z of visibleZones) {
        const zx = sx(z.x);
        const zy = sy(z.topY);
        const zw = sx(z.width);
        const zh = Math.max(11 * unit, sy(z.height));
        const alphaScale = z.mitigated ? 0.55 : 1;

        ctx.save();
        ctx.fillStyle =
          z.tone === 'bullish'
            ? `rgba(16, 185, 129, ${(light ? 0.14 : 0.16) * alphaScale})`
            : z.tone === 'bearish'
            ? `rgba(244, 63, 94, ${(light ? 0.13 : 0.16) * alphaScale})`
            : `rgba(245, 158, 11, ${0.14 * alphaScale})`;
        ctx.fillRect(zx, zy, zw, zh);

        const borderColor =
          z.tone === 'bullish'
            ? light
              ? 'rgba(5, 150, 105, 0.84)'
              : 'rgba(52, 211, 153, 0.78)'
            : z.tone === 'bearish'
            ? light
              ? 'rgba(225, 29, 72, 0.84)'
              : 'rgba(251, 113, 133, 0.78)'
            : 'rgba(217, 119, 6, 0.82)';

        ctx.strokeStyle = borderColor;
        ctx.lineWidth = (z.isOrderBlock ? 1.65 : 1.3) * unit;
        if (z.mitigated || z.tone === 'neutral') {
          ctx.setLineDash([5 * unit, 4 * unit]);
        }
        ctx.beginPath();
        ctx.moveTo(zx, zy);
        ctx.lineTo(zx + zw, zy);
        ctx.moveTo(zx, zy + zh);
        ctx.lineTo(zx + zw, zy + zh);
        if (z.isOrderBlock) {
          // Order Block origin anchor bar on left candle edge
          ctx.moveTo(zx, zy);
          ctx.lineTo(zx, zy + zh);
        }
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.font = `700 ${Math.round(9.8 * unit)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        const shortRole = z.isOrderBlock
          ? z.tone === 'bullish'
            ? 'BULL OB'
            : 'BEAR OB'
          : z.role.toUpperCase();
        const zoneLabel = `${shortRole}${z.priceText ? ` · ${z.priceText}` : ''}${
          z.mitigated ? ' (MIT)' : ''
        }`;
        const ztw = ctx.measureText(zoneLabel).width;
        const boxW = ztw + 8 * unit;
        const boxH = 13.5 * unit;
        const placed = placeLabelBox(
          zx + 5 * unit,
          zy + 2 * unit,
          boxW,
          boxH,
          [
            [0, 0],
            [48 * unit, 0],
            [96 * unit, 0],
            [0, Math.max(0, zh - boxH - 2 * unit)],
          ]
        );

        drawRoundedRect(ctx, placed.x, placed.y, boxW, boxH, 3.5 * unit);
        ctx.fillStyle = light ? 'rgba(255, 255, 255, 0.90)' : 'rgba(9, 13, 22, 0.84)';
        ctx.fill();

        ctx.fillStyle =
          z.tone === 'bullish'
            ? light
              ? '#047857'
              : '#6EE7B7'
            : z.tone === 'bearish'
            ? light
              ? '#BE123C'
              : '#FDA4AF'
            : light
            ? '#B45309'
            : '#FCD34D';
        ctx.fillText(zoneLabel, placed.x + 4 * unit, placed.y + 10 * unit);
        ctx.restore();
      }
    }

    // 2. Fair Value Gaps (FVG / Imbalances with 50% Consequent Encroachment Midline)
    if (allowFvg) {
      const visibleFvgs = isPrimaryOnly
        ? markup.fairValueGaps.filter((f) => f.isPrimary)
        : markup.fairValueGaps;

      for (const fvg of visibleFvgs) {
        const fx = sx(fvg.x);
        const fy = sy(fvg.topY);
        const fw = sx(fvg.width);
        const fh = Math.max(10 * unit, sy(fvg.height));
        const midPy = sy(fvg.midY);

        ctx.save();
        // Distinct Violet (Bullish FVG) / Amber (Bearish FVG) tint so FVGs never blend into Supply/Demand zones
        const isBull = fvg.tone === 'bullish';
        ctx.fillStyle = isBull
          ? light
            ? 'rgba(139, 92, 246, 0.13)'
            : 'rgba(168, 85, 247, 0.16)'
          : light
          ? 'rgba(245, 158, 11, 0.13)'
          : 'rgba(245, 158, 11, 0.16)';
        ctx.fillRect(fx, fy, fw, fh);

        const strokeCol = isBull
          ? light
            ? 'rgba(109, 40, 217, 0.82)'
            : 'rgba(192, 132, 252, 0.80)'
          : light
          ? 'rgba(180, 83, 9, 0.82)'
          : 'rgba(251, 191, 36, 0.80)';

        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1.15 * unit;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + fw, fy);
        ctx.moveTo(fx, fy + fh);
        ctx.lineTo(fx + fw, fy + fh);
        ctx.stroke();

        // 50% Consequent Encroachment (CE) dashed midline
        ctx.setLineDash([3.5 * unit, 3.5 * unit]);
        ctx.lineWidth = 0.95 * unit;
        ctx.beginPath();
        ctx.moveTo(fx, midPy);
        ctx.lineTo(fx + fw, midPy);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.font = `700 ${Math.round(9.5 * unit)}px ui-monospace, SFMono-Regular, monospace`;
        const fvgTag = `${isBull ? 'FVG +' : 'FVG −'}${
          fvg.priceText ? ` · ${fvg.priceText}` : ''
        }`;
        const ftw = ctx.measureText(fvgTag).width;
        const boxW = ftw + 8 * unit;
        const boxH = 13 * unit;
        const placed = placeLabelBox(
          fx + 6 * unit,
          midPy - boxH / 2,
          boxW,
          boxH,
          [
            [0, 0],
            [46 * unit, 0],
            [92 * unit, 0],
            [0, -12 * unit],
          ]
        );

        drawRoundedRect(ctx, placed.x, placed.y, boxW, boxH, 3.5 * unit);
        ctx.fillStyle = light ? 'rgba(255, 255, 255, 0.90)' : 'rgba(9, 13, 22, 0.86)';
        ctx.fill();
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 0.9 * unit;
        ctx.stroke();
        ctx.fillStyle = isBull
          ? light
            ? '#6D28D9'
            : '#D8B4FE'
          : light
          ? '#B45309'
          : '#FDE68A';
        ctx.fillText(fvgTag, placed.x + 4 * unit, placed.y + 9.6 * unit);
        ctx.restore();
      }
    }

    // 3. Liquidity Pools & Sweeps (EQH, EQL, BSL, SSL, Sweep)
    if (allowLiquidity) {
      const visibleLiq = isPrimaryOnly
        ? markup.liquidityLevels.filter((lq) => lq.isPrimary)
        : markup.liquidityLevels;

      for (const lq of visibleLiq) {
        const lx1 = sx(lq.x1);
        const lx2 = sx(lq.x2);
        const ly = sy(lq.y);

        ctx.save();
        const liqColor = light ? '#B45309' : '#FBBF24';
        ctx.strokeStyle = liqColor;
        ctx.lineWidth = 1.45 * unit;
        ctx.setLineDash([2.8 * unit, 3.2 * unit]);
        ctx.beginPath();
        ctx.moveTo(lx1, ly);
        ctx.lineTo(lx2, ly);
        ctx.stroke();

        // Origin & Sweep terminal markers
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(lx1, ly, 2.4 * unit, 0, Math.PI * 2);
        ctx.fillStyle = liqColor;
        ctx.fill();

        if (lq.swept) {
          const r = 3.5 * unit;
          ctx.lineWidth = 1.5 * unit;
          ctx.beginPath();
          ctx.moveTo(lx2 - r, ly - r);
          ctx.lineTo(lx2 + r, ly + r);
          ctx.moveTo(lx2 + r, ly - r);
          ctx.lineTo(lx2 - r, ly + r);
          ctx.stroke();
        }

        ctx.font = `700 ${Math.round(9.5 * unit)}px ui-monospace, SFMono-Regular, monospace`;
        const liqTag = `$ ${lq.kind}${lq.swept && lq.kind !== 'Sweep' ? ' SWEPT' : ''}${
          lq.priceText ? ` · ${lq.priceText}` : ''
        }`;
        const tw = ctx.measureText(liqTag).width;
        const boxW = tw + 9 * unit;
        const boxH = 13.5 * unit;
        const midX = (lx1 + lx2) / 2 - boxW / 2;
        const placed = placeLabelBox(
          midX,
          ly - boxH - 3 * unit,
          boxW,
          boxH,
          [
            [0, 0],
            [0, boxH + 6 * unit],
            [-40 * unit, 0],
            [40 * unit, 0],
          ]
        );

        drawRoundedRect(ctx, placed.x, placed.y, boxW, boxH, 3.5 * unit);
        ctx.fillStyle = 'rgba(9, 13, 22, 0.90)';
        ctx.fill();
        ctx.strokeStyle = liqColor;
        ctx.lineWidth = 1 * unit;
        ctx.stroke();
        ctx.fillStyle = '#FDE68A';
        ctx.fillText(liqTag, placed.x + 4.5 * unit, placed.y + 10 * unit);
        ctx.restore();
      }
    }

    // 4. Trendlines & Parallel Price Channels (wick-anchored)
    if (allowTrendlines) {
      const visibleTls = isPrimaryOnly
        ? markup.trendlines.filter((t) => t.isPrimary)
        : markup.trendlines;

      for (const tl of visibleTls) {
        ctx.save();
        const stroke =
          tl.tone === 'bullish'
            ? light
              ? '#059669'
              : '#34D399'
            : tl.tone === 'bearish'
            ? light
              ? '#E11D48'
              : '#FB7185'
            : light
            ? '#0284C7'
            : '#38BDF8';
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.85 * unit;
        if (tl.style === 'dashed') {
          ctx.setLineDash([6 * unit, 4 * unit]);
        }
        ctx.beginPath();
        ctx.moveTo(sx(tl.x1), sy(tl.y1));
        ctx.lineTo(sx(tl.x2), sy(tl.y2));
        ctx.stroke();

        if (tl.label) {
          const mx = (sx(tl.x1) + sx(tl.x2)) / 2;
          const my = (sy(tl.y1) + sy(tl.y2)) / 2;
          ctx.setLineDash([]);
          ctx.font = `700 ${Math.round(9.8 * unit)}px ui-monospace, SFMono-Regular, monospace`;
          const tw = ctx.measureText(tl.label).width;
          const boxW = tw + 10 * unit;
          const boxH = 14 * unit;
          const placed = placeLabelBox(
            mx - boxW / 2,
            my - boxH - 4 * unit,
            boxW,
            boxH,
            [
              [0, 0],
              [0, boxH + 8 * unit],
              [-36 * unit, -6 * unit],
              [36 * unit, 6 * unit],
            ]
          );

          drawRoundedRect(ctx, placed.x, placed.y, boxW, boxH, 4 * unit);
          ctx.fillStyle = 'rgba(9, 13, 22, 0.90)';
          ctx.fill();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1 * unit;
          ctx.stroke();
          ctx.fillStyle =
            tl.tone === 'bullish'
              ? '#6EE7B7'
              : tl.tone === 'bearish'
              ? '#FDA4AF'
              : '#7DD3FC';
          ctx.fillText(tl.label, placed.x + 5 * unit, placed.y + 10.2 * unit);
        }
        ctx.restore();
      }
    }

    // 5. Horizontal BOS & CHoCH Market Structure Breaks + Chronological Swing Pivots
    if (allowBosSwings) {
      const visibleBreaks = isPrimaryOnly
        ? markup.structureBreaks.filter((sb) => sb.isPrimary)
        : markup.structureBreaks;

      for (const sb of visibleBreaks) {
        const bx1 = sx(sb.x1);
        const bx2 = sx(sb.x2);
        const by = sy(sb.y);
        const isChoch = sb.kind === 'CHoCH';
        const stroke =
          sb.tone === 'bullish'
            ? light
              ? '#059669'
              : '#34D399'
            : light
            ? '#E11D48'
            : '#FB7185';

        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = (isChoch ? 1.75 : 1.55) * unit;
        if (isChoch) {
          ctx.setLineDash([5 * unit, 3.5 * unit]);
        }
        ctx.beginPath();
        ctx.moveTo(bx1, by);
        ctx.lineTo(bx2, by);
        ctx.stroke();

        // Small break-direction tick at break candle bx2
        ctx.setLineDash([]);
        const tickDir = sb.tone === 'bullish' ? -5 * unit : 5 * unit;
        ctx.beginPath();
        ctx.moveTo(bx2, by);
        ctx.lineTo(bx2, by + tickDir);
        ctx.stroke();

        ctx.font = `700 ${Math.round(9.5 * unit)}px ui-monospace, SFMono-Regular, monospace`;
        const sbTag = sb.kind;
        const tw = ctx.measureText(sbTag).width;
        const boxW = tw + 9 * unit;
        const boxH = 13.5 * unit;
        const prefY = sb.tone === 'bullish' ? by - boxH - 2 * unit : by + 2 * unit;
        const placed = placeLabelBox(
          (bx1 + bx2) / 2 - boxW / 2,
          prefY,
          boxW,
          boxH,
          [
            [0, 0],
            [-28 * unit, 0],
            [28 * unit, 0],
            [0, sb.tone === 'bullish' ? boxH + 4 * unit : -boxH - 4 * unit],
          ]
        );

        drawRoundedRect(ctx, placed.x, placed.y, boxW, boxH, 3.5 * unit);
        ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1 * unit;
        ctx.stroke();
        ctx.fillStyle = sb.tone === 'bullish' ? '#6EE7B7' : '#FDA4AF';
        ctx.fillText(sbTag, placed.x + 4.5 * unit, placed.y + 10 * unit);
        ctx.restore();
      }

      const visibleSwings = isPrimaryOnly
        ? markup.swings.filter((sw) => sw.isPrimary)
        : markup.swings;

      for (const sw of visibleSwings) {
        ctx.save();
        const px = sx(sw.x);
        const py = sy(sw.y);
        const dotColor =
          sw.tone === 'bullish'
            ? '#10B981'
            : sw.tone === 'bearish'
            ? '#F43F5E'
            : '#64748B';
        const textColor =
          sw.tone === 'bullish'
            ? '#6EE7B7'
            : sw.tone === 'bearish'
            ? '#FDA4AF'
            : '#E2E8F0';

        ctx.beginPath();
        ctx.arc(px, py, 3 * unit, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
        ctx.lineWidth = 1.15 * unit;
        ctx.strokeStyle = light ? '#FFFFFF' : '#090D16';
        ctx.stroke();

        ctx.font = `700 ${Math.round(9.6 * unit)}px ui-monospace, SFMono-Regular, monospace`;
        const tw = ctx.measureText(sw.tag).width;
        const boxW = tw + 9 * unit;
        const boxH = 13.5 * unit;
        const baseBoxY =
          sw.position === 'above' ? py - boxH - 6 * unit : py + 6 * unit;
        const dirSign = sw.position === 'above' ? -1 : 1;

        const placed = placeLabelBox(
          px - boxW / 2,
          baseBoxY,
          boxW,
          boxH,
          [
            [0, 0],
            [0, dirSign * 14 * unit],
            [-18 * unit, dirSign * 4 * unit],
            [18 * unit, dirSign * 4 * unit],
          ]
        );

        drawRoundedRect(ctx, placed.x, placed.y, boxW, boxH, 3.5 * unit);
        ctx.fillStyle = 'rgba(9, 13, 22, 0.90)';
        ctx.fill();
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 1 * unit;
        ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.fillText(sw.tag, placed.x + 4.5 * unit, placed.y + 10 * unit);
        ctx.restore();
      }
    }
  }

  // 6. TradingView Long / Short Position Tool + Undistorted Price Lines + Trajectory
  if (showSetup) {
    if (markup.positionBox) {
      const pb = markup.positionBox;
      const x1 = sx(pb.startX);
      const x2 = sx(pb.endX);
      const bw = Math.max(24 * unit, x2 - x1);

      ctx.save();
      // Stop-Loss Risk Block
      ctx.fillStyle = light
        ? 'rgba(244, 63, 94, 0.19)'
        : 'rgba(244, 63, 94, 0.22)';
      ctx.fillRect(x1, sy(pb.riskTopY), bw, Math.max(4 * unit, sy(pb.riskHeight)));

      // Take-Profit Reward Block
      ctx.fillStyle = light
        ? 'rgba(16, 185, 129, 0.18)'
        : 'rgba(16, 185, 129, 0.21)';
      ctx.fillRect(x1, sy(pb.rewardTopY), bw, Math.max(6 * unit, sy(pb.rewardHeight)));

      // Left vertical spine of Position Box at latest candle
      ctx.strokeStyle = light
        ? 'rgba(15, 23, 42, 0.35)'
        : 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 1.25 * unit;
      ctx.beginPath();
      ctx.moveTo(x1, sy(Math.min(pb.riskTopY, pb.rewardTopY)));
      ctx.lineTo(
        x1,
        sy(Math.max(pb.riskTopY + pb.riskHeight, pb.rewardTopY + pb.rewardHeight))
      );
      ctx.stroke();

      // R:R Badge centered in open reward space (hidden in pure Entry · SL · TP mode)
      const legGapPx = Math.abs(sy(pb.tp1Y) - sy(pb.entryY));
      if (!isLevelsOnly && legGapPx >= 36 * unit) {
        ctx.font = `700 ${Math.round(10 * unit)}px ui-monospace, SFMono-Regular, monospace`;
        const rrW = ctx.measureText(pb.rrBadgeText).width;
        const rrBoxW = rrW + 9 * unit;
        const rrX = Math.min(x2 - rrBoxW - 4 * unit, x1 + 5 * unit);
        const rrMidY = sy(pb.rrCenterY);
        drawRoundedRect(
          ctx,
          rrX,
          rrMidY - 7.5 * unit,
          rrBoxW,
          15 * unit,
          4 * unit
        );
        ctx.fillStyle = 'rgba(9, 13, 22, 0.86)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1 * unit;
        ctx.stroke();
        ctx.fillStyle = '#F1F5F9';
        ctx.fillText(pb.rrBadgeText, rrX + 4.5 * unit, rrMidY + 3.5 * unit);
      }
      ctx.restore();
    }

    // Horizontal Execution & Target Lines (exact calibrated Y) + Right-Edge Pointer Pills
    for (const lvl of markup.levelLines) {
      ctx.save();
      const anchorStartX = sx(
        markup.positionBox ? markup.positionBox.startX : markup.anchorPoint.x
      );
      const fullLeftX = sx(markup.plotBox.leftX + 8);
      const lineEndX = sx(markup.plotBox.rightX);
      const ly = sy(lvl.y);
      const tagY = sy(lvl.labelY);

      const strokeColor =
        lvl.tone === 'tp'
          ? light
            ? '#059669'
            : '#10B981'
          : lvl.tone === 'sl'
          ? light
            ? '#E11D48'
            : '#F43F5E'
          : lvl.tone === 'entry'
          ? light
            ? '#0284C7'
            : '#38BDF8'
          : '#64748B';

      // In pure "Entry · SL · TP" mode, extend a clean horizontal trace across historical candles
      // so traders can check SL & TP levels against swing wicks with zero clutter
      if (isLevelsOnly && anchorStartX > fullLeftX + 16 * unit) {
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.globalAlpha = light ? 0.45 : 0.42;
        ctx.lineWidth = (lvl.tone === 'entry' ? 1.45 : 1.2) * unit;
        ctx.setLineDash([4.5 * unit, 4 * unit]);
        ctx.beginPath();
        ctx.moveTo(fullLeftX, ly);
        ctx.lineTo(anchorStartX, ly);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = (lvl.tone === 'entry' ? 2.1 : 1.55) * unit;
      if (lvl.dashed) {
        ctx.setLineDash([5 * unit, 3.5 * unit]);
      }
      ctx.beginPath();
      ctx.moveTo(anchorStartX, ly);
      ctx.lineTo(lineEndX, ly);
      ctx.stroke();

      // Callout Price Pill inset slightly from rightX so exact 1px tick meeting axis border stays visible
      ctx.setLineDash([]);
      ctx.font = `700 ${Math.round(10 * unit)}px ui-monospace, SFMono-Regular, monospace`;
      const tagText = `${lvl.shortTag} ${lvl.priceText}`;
      const tw = ctx.measureText(tagText).width;
      const pillH = 16.5 * unit;
      const pillW = tw + 11 * unit;
      const tickStub = 6 * unit;
      const pillX = Math.max(
        sx(markup.plotBox.leftX) + 4 * unit,
        Math.min(W - pillW - 4 * unit, lineEndX - pillW - tickStub)
      );
      const pillY = tagY - pillH / 2;

      // Crisp leader connector from pill right edge directly to exact (rightX, ly) axis tick
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.35 * unit;
      ctx.beginPath();
      ctx.moveTo(pillX + pillW, tagY);
      ctx.lineTo(lineEndX, ly);
      ctx.stroke();

      drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 4 * unit);
      ctx.fillStyle =
        lvl.tone === 'tp'
          ? 'rgba(6, 78, 59, 0.95)'
          : lvl.tone === 'sl'
          ? 'rgba(136, 19, 55, 0.95)'
          : lvl.tone === 'entry'
          ? 'rgba(12, 74, 110, 0.97)'
          : 'rgba(15, 23, 42, 0.95)';
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2 * unit;
      ctx.stroke();

      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(tagText, pillX + 5.5 * unit, pillY + 11.8 * unit);
      ctx.restore();
    }

    if (!isLevelsOnly) {
      // Multi-Leg Projected Price-Action Path + Arrowhead
      const pathColor =
        markup.tone === 'bullish'
          ? light
            ? '#059669'
            : '#34D399'
          : markup.tone === 'bearish'
          ? light
            ? '#E11D48'
            : '#FB7185'
          : '#D97706';

      for (const seg of markup.pathSegments) {
        if (seg.points.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = seg.dashed ? '#0284C7' : pathColor;
        ctx.lineWidth = 2.2 * unit;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (seg.dashed) {
          ctx.setLineDash([6 * unit, 4 * unit]);
        }
        ctx.beginPath();
        ctx.moveTo(sx(seg.points[0].x), sy(seg.points[0].y));
        for (let i = 1; i < seg.points.length; i++) {
          ctx.lineTo(sx(seg.points[i].x), sy(seg.points[i].y));
        }
        ctx.stroke();

        if (seg.hasArrowhead) {
          ctx.setLineDash([]);
          const pLast = seg.points[seg.points.length - 1];
          const pPrev = seg.points[seg.points.length - 2];
          const angle = Math.atan2(
            sy(pLast.y) - sy(pPrev.y),
            sx(pLast.x) - sx(pPrev.x)
          );
          const headLen = 9.5 * unit;
          const tipX = sx(pLast.x);
          const tipY = sy(pLast.y);
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(
            tipX - headLen * Math.cos(angle - Math.PI / 6),
            tipY - headLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            tipX - headLen * Math.cos(angle + Math.PI / 6),
            tipY - headLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fillStyle = seg.dashed ? '#0284C7' : pathColor;
          ctx.fill();
        }
        ctx.restore();
      }

      // Dual-Contrast Anchor Ring on Exact Latest Candle Close
      ctx.save();
      const ax = sx(markup.anchorPoint.x);
      const ay = sy(markup.anchorPoint.y);
      ctx.beginPath();
      ctx.arc(ax, ay, 4.5 * unit, 0, Math.PI * 2);
      ctx.fillStyle = '#090D16';
      ctx.fill();
      ctx.lineWidth = 2 * unit;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ax, ay, 5.5 * unit, 0, Math.PI * 2);
      ctx.lineWidth = 1 * unit;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
      ctx.stroke();
      ctx.restore();
    }
  }

  // Exported PNG signature stamp placed cleanly inside plotBox (never overlapping OS status bar)
  if (includeStamp) {
    ctx.save();
    const modeLabel =
      layerFilter === 'setup'
        ? 'Entry · SL · TP'
        : layerFilter === 'all'
        ? 'Full SMC Structure'
        : layerFilter === 'structure'
        ? 'Structure Map'
        : 'Primary Setup';
    const stampText = `TraceFX Lens · ${signal.detectedPair} ${signal.detectedTimeframe} · ${signal.signalType} · ${modeLabel}`;
    ctx.font = `600 ${Math.round(10.5 * unit)}px system-ui, -apple-system, sans-serif`;
    const stW = ctx.measureText(stampText).width;
    const boxW = stW + 16 * unit;
    const boxH = 22 * unit;
    const stampX =
      markup.stampAnchor === 'bottom-left'
        ? sx(markup.plotBox.leftX) + 10 * unit
        : sx(markup.plotBox.rightX) - boxW - 10 * unit;
    const stampY =
      markup.stampAnchor === 'bottom-left'
        ? sy(markup.plotBox.bottomY) - boxH - 10 * unit
        : sy(markup.plotBox.topY) + 10 * unit;

    drawRoundedRect(ctx, stampX, stampY, boxW, boxH, 5 * unit);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1 * unit;
    ctx.stroke();
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(stampText, stampX + 8 * unit, stampY + 14.8 * unit);
    ctx.restore();
  }
}

/**
 * Renders the original chart screenshot + pixel-calibrated technical analysis
 * drawings onto a high-DPI HTML5 Canvas and triggers a crisp PNG download.
 */
export async function exportMarkedChartPng(
  imageDataUrl: string,
  signal: TradingSignalResponse,
  layerFilter: MarkupLayerFilter = 'primary',
  subLayer: StructureSubLayer = 'all'
): Promise<void> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load chart image for export'));
    el.src = imageDataUrl;
  });

  const canvas = document.createElement('canvas');
  renderMarkedChartToCanvas(canvas, img, signal, {
    layerFilter,
    subLayer,
    includeStamp: true,
  });

  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  const cleanPair = signal.detectedPair.replace(/[^a-zA-Z0-9]/g, '');
  const cleanType = signal.signalType.replace(/\s+/g, '-');
  const modeSuffix =
    layerFilter === 'setup'
      ? '-LevelsOnly'
      : layerFilter === 'all'
      ? '-FullStructure'
      : layerFilter === 'structure'
      ? '-StructureOnly'
      : '';
  link.download = `TraceFX-${cleanPair}-${signal.detectedTimeframe}-${cleanType}${modeSuffix}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

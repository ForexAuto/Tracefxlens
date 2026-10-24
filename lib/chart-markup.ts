import type {
  ChartMarkupLiquidity,
  ChartMarkupSwing,
  ChartMarkupTrendline,
  ChartMarkupZone,
  SignalType,
  TradingSignalResponse,
} from '@/lib/trading-data';

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
  snapToCandleWick: (
    nx: number,
    ny: number,
    mode: 'high' | 'low' | 'nearest',
    radiusNX?: number,
    radiusNY?: number
  ) => { x: number; y: number } | null;
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
 * Deterministic <3ms client-side pixel scanner that detects exact chart pane borders
 * (rightX price-axis divider, topY/bottomY toolbars), background theme (light vs dark),
 * live horizontal Bid/Ask current-price line Y, Y-axis printed label centroids,
 * right-most latest candlestick X, and local candle-wick tips.
 */
export function analyzeChartPixels(
  img: HTMLImageElement,
  signal: TradingSignalResponse
): ChartPixelGeometry | null {
  if (typeof document === 'undefined') return null;
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 80 || natH < 80) return null;

  const maxSampleDim = 720;
  const sScale = Math.min(1, maxSampleDim / Math.max(natW, natH));
  const sW = Math.max(80, Math.round(natW * sScale));
  const sH = Math.max(80, Math.round(natH * sScale));

  const sCanvas = document.createElement('canvas');
  sCanvas.width = sW;
  sCanvas.height = sH;
  const sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
  if (!sCtx) return null;

  sCtx.drawImage(img, 0, 0, sW, sH);
  let data: Uint8ClampedArray;
  try {
    data = sCtx.getImageData(0, 0, sW, sH).data;
  } catch {
    return null;
  }

  const toSX = (nx: number) => clamp(Math.round((nx / 1000) * (sW - 1)), 0, sW - 1);
  const toSY = (ny: number) => clamp(Math.round((ny / 1000) * (sH - 1)), 0, sH - 1);
  const toNX = (sx: number) => (sx / Math.max(1, sW - 1)) * 1000;
  const toNY = (sy: number) => (sy / Math.max(1, sH - 1)) * 1000;

  // 1. Sample interior plot area to find exact median chart background color
  const rSamples: number[] = [];
  const gSamples: number[] = [];
  const bSamples: number[] = [];
  for (let gx = 0; gx < 20; gx++) {
    const sx = toSX(150 + gx * 27);
    for (let gy = 0; gy < 20; gy++) {
      const sy = toSY(225 + gy * 22);
      const idx = (sy * sW + sx) * 4;
      rSamples.push(data[idx]);
      gSamples.push(data[idx + 1]);
      bSamples.push(data[idx + 2]);
    }
  }
  rSamples.sort((a, b) => a - b);
  gSamples.sort((a, b) => a - b);
  bSamples.sort((a, b) => a - b);
  const mid = rSamples.length >> 1;
  const bgR = rSamples[mid];
  const bgG = gSamples[mid];
  const bgB = bSamples[mid];
  const bgLuma = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  const isLightBg = bgLuma > 148;

  const distBg = (idx: number) =>
    Math.abs(data[idx] - bgR) +
    Math.abs(data[idx + 1] - bgG) +
    Math.abs(data[idx + 2] - bgB);

  const chromaAt = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    return mx - mn;
  };

  const rawMarkup = signal.chartMarkup;
  const hintLeftX = clamp(Number(rawMarkup?.plotBox?.leftX ?? 20), 6, 180);
  const hintRightX = clamp(Number(rawMarkup?.plotBox?.rightX ?? 860), 700, 965);
  const hintTopY = clamp(Number(rawMarkup?.plotBox?.topY ?? 60), 14, 250);
  const hintBottomY = clamp(Number(rawMarkup?.plotBox?.bottomY ?? 870), 540, 968);

  // 2. Detect exact vertical price-axis divider rightX
  let rightX = hintRightX;
  const scanY0 = toSY(220);
  const scanY1 = toSY(720);
  const scanSpanY = Math.max(1, scanY1 - scanY0 + 1);
  let foundAxisBorderSX = -1;

  for (let sx = toSX(720); sx <= toSX(948); sx++) {
    let nonBg = 0;
    let uniform = 0;
    for (let sy = scanY0; sy <= scanY1; sy++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 18) nonBg++;
      if (sy < scanY1) {
        const idxNext = ((sy + 1) * sW + sx) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 15) uniform++;
      }
    }
    const nonBgFrac = nonBg / scanSpanY;
    const uniformFrac = uniform / Math.max(1, scanSpanY - 1);

    if (nonBgFrac >= 0.8 && uniformFrac >= 0.78) {
      // Confirm right side contains sparse Y-axis label space (not solid chrome)
      const checkX0 = Math.min(sW - 1, sx + Math.max(3, Math.round(sW * 0.015)));
      const checkX1 = Math.min(sW - 1, sx + Math.max(8, Math.round(sW * 0.11)));
      if (checkX1 > checkX0) {
        let rightNonBg = 0;
        let rightTotal = 0;
        for (let rx = checkX0; rx <= checkX1; rx += 2) {
          for (let ry = scanY0; ry <= scanY1; ry += 3) {
            rightTotal++;
            if (distBg((ry * sW + rx) * 4) > 35) rightNonBg++;
          }
        }
        const rightDensity = rightNonBg / Math.max(1, rightTotal);
        if (rightDensity >= 0.01 && rightDensity <= 0.5) {
          foundAxisBorderSX = sx;
        }
      }
    }
  }

  if (foundAxisBorderSX !== -1) {
    rightX = clamp(toNX(foundAxisBorderSX), 720, 952);
  } else {
    // Borderless chart fallback: ensure rightX stays left of right-axis text column
    let textStartSX = -1;
    for (let sx = toSX(965); sx >= toSX(785); sx--) {
      let highContrast = 0;
      for (let sy = scanY0; sy <= scanY1; sy += 2) {
        if (distBg((sy * sW + sx) * 4) > 85) highContrast++;
      }
      const density = highContrast / Math.max(1, Math.floor(scanSpanY / 2));
      if (density >= 0.035 && density <= 0.38) {
        textStartSX = sx;
      }
    }
    if (textStartSX !== -1) {
      rightX = clamp(Math.min(hintRightX, toNX(textStartSX) - 10), 740, 945);
    }
  }

  // 3. Detect exact topY (below mobile/desktop toolbars) & bottomY (above time axis / sub-pane)
  let topY = hintTopY;
  const rowX0 = toSX(80);
  const rowX1 = toSX(rightX - 16);
  const rowSpanX = Math.max(1, rowX1 - rowX0 + 1);

  for (let sy = toSY(18); sy <= toSY(225); sy++) {
    let nonBg = 0;
    let uniform = 0;
    for (let sx = rowX0; sx <= rowX1; sx++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 18) nonBg++;
      if (sx < rowX1) {
        const idxNext = (sy * sW + sx + 1) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 15) uniform++;
      }
    }
    if (nonBg / rowSpanX >= 0.8 && uniform / Math.max(1, rowSpanX - 1) >= 0.78) {
      const belowSY = Math.min(sH - 1, sy + Math.max(4, Math.round(sH * 0.015)));
      let belowBgMatch = 0;
      for (let sx = rowX0; sx <= rowX1; sx += 3) {
        if (distBg((belowSY * sW + sx) * 4) <= 28) belowBgMatch++;
      }
      if (belowBgMatch / Math.max(1, Math.ceil(rowSpanX / 3)) >= 0.65) {
        topY = clamp(toNY(sy) + 2, 16, 235);
      }
    }
  }

  let bottomY = hintBottomY;
  const botSearchStart = toSY(Math.max(520, hintBottomY - 125));
  const botSearchEnd = toSY(962);
  let bestBotDist = Infinity;

  for (let sy = botSearchStart; sy <= botSearchEnd; sy++) {
    let nonBg = 0;
    let uniform = 0;
    for (let sx = rowX0; sx <= rowX1; sx++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 18) nonBg++;
      if (sx < rowX1) {
        const idxNext = (sy * sW + sx + 1) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 15) uniform++;
      }
    }
    if (nonBg / rowSpanX >= 0.78 && uniform / Math.max(1, rowSpanX - 1) >= 0.76) {
      const aboveSY = Math.max(0, sy - Math.max(4, Math.round(sH * 0.015)));
      let aboveBgMatch = 0;
      for (let sx = rowX0; sx <= rowX1; sx += 3) {
        if (distBg((aboveSY * sW + sx) * 4) <= 28) aboveBgMatch++;
      }
      if (aboveBgMatch / Math.max(1, Math.ceil(rowSpanX / 3)) >= 0.65) {
        const candidateNY = toNY(sy) - 2;
        const dist = Math.abs(candidateNY - hintBottomY);
        if (dist < bestBotDist) {
          bestBotDist = dist;
          bottomY = clamp(candidateNY, 540, 964);
        }
      }
    }
  }

  const leftX = hintLeftX;

  // 4. Detect Y-axis printed price label centroids (right of rightX)
  const axisX0 = toSX(Math.min(990, rightX + 6));
  const axisX1 = toSX(Math.min(996, rightX + 145));
  const axisLabelCentroidsY: number[] = [];

  if (axisX1 - axisX0 >= 6) {
    const axR: number[] = [];
    const axG: number[] = [];
    const axB: number[] = [];
    for (let sy = toSY(topY + 12); sy <= toSY(bottomY - 12); sy += 4) {
      for (let sx = axisX0; sx <= axisX1; sx += 3) {
        const idx = (sy * sW + sx) * 4;
        axR.push(data[idx]);
        axG.push(data[idx + 1]);
        axB.push(data[idx + 2]);
      }
    }
    axR.sort((a, b) => a - b);
    axG.sort((a, b) => a - b);
    axB.sort((a, b) => a - b);
    const am = axR.length >> 1;
    const abR = axR[am] ?? bgR;
    const abG = axG[am] ?? bgG;
    const abB = axB[am] ?? bgB;

    const axisSpanW = Math.max(1, axisX1 - axisX0 + 1);
    let bandStart = -1;
    for (let sy = toSY(topY + 6); sy <= toSY(bottomY - 6); sy++) {
      let ink = 0;
      let coloredFill = 0;
      for (let sx = axisX0; sx <= axisX1; sx++) {
        const idx = (sy * sW + sx) * 4;
        const d =
          Math.abs(data[idx] - abR) +
          Math.abs(data[idx + 1] - abG) +
          Math.abs(data[idx + 2] - abB);
        if (d > 75) ink++;
        if (chromaAt(idx) >= 26 && d > 45) coloredFill++;
      }
      // Exclude solid colored live-price badges so regular scale ticks stay distinct
      const isTextRow =
        coloredFill / axisSpanW < 0.42 && ink / axisSpanW >= 0.045;
      if (isTextRow) {
        if (bandStart === -1) bandStart = sy;
      } else if (bandStart !== -1) {
        const bandH = toNY(sy - 1) - toNY(bandStart);
        if (bandH >= 3 && bandH <= 22) {
          axisLabelCentroidsY.push(toNY((bandStart + sy - 1) / 2));
        }
        bandStart = -1;
      }
    }
  }

  // 5. Estimate approximate current price Y to bound Bid/Ask line & latest candle search
  const currentNum = parseChartPrice(signal.currentMarketPrice);
  const highRefP = parseChartPrice(rawMarkup?.axisCalibration?.highRefPrice);
  const lowRefP = parseChartPrice(rawMarkup?.axisCalibration?.lowRefPrice);
  const highRefY = Number(rawMarkup?.axisCalibration?.highRefY);
  const lowRefY = Number(rawMarkup?.axisCalibration?.lowRefY);
  let approxCurrentNY = clamp(
    Number(rawMarkup?.axisCalibration?.lastCandleY ?? 500),
    topY + 20,
    bottomY - 20
  );
  if (
    currentNum !== null &&
    highRefP !== null &&
    lowRefP !== null &&
    Number.isFinite(highRefY) &&
    Number.isFinite(lowRefY) &&
    highRefP > lowRefP &&
    lowRefY - highRefY > 100
  ) {
    const est =
      highRefY + ((highRefP - currentNum) / (highRefP - lowRefP)) * (lowRefY - highRefY);
    approxCurrentNY = clamp(est, topY + 15, bottomY - 15);
  }

  // 6. Detect exact horizontal Bid/Ask / current-price line across plotBox
  let detectedCurrentLineY: number | null = null;
  const lineSearchY0 = toSY(Math.max(topY + 8, approxCurrentNY - 85));
  const lineSearchY1 = toSY(Math.min(bottomY - 8, approxCurrentNY + 85));
  const plotSX0 = toSX(leftX + 12);
  const plotSX1 = toSX(rightX - 4);
  const plotSpanW = Math.max(1, plotSX1 - plotSX0 + 1);

  const candidateLineRows: Array<{ sy: number; score: number; badgeAttached: boolean }> = [];
  for (let sy = lineSearchY0; sy <= lineSearchY1; sy++) {
    let colored = 0;
    for (let sx = plotSX0; sx <= plotSX1; sx++) {
      const idx = (sy * sW + sx) * 4;
      if (chromaAt(idx) >= 20 && distBg(idx) >= 34) {
        colored++;
      }
    }
    const coloredFrac = colored / plotSpanW;
    if (coloredFrac >= 0.36) {
      // Check if a colored live-price badge sits on the right axis near this row
      let badgeHits = 0;
      if (axisX1 > axisX0) {
        for (let sx = axisX0; sx <= Math.min(sW - 1, axisX0 + 28); sx++) {
          const idx = (sy * sW + sx) * 4;
          if (chromaAt(idx) >= 24 && distBg(idx) >= 40) badgeHits++;
        }
      }
      const badgeAttached = badgeHits >= 5;
      candidateLineRows.push({
        sy,
        score: coloredFrac + (badgeAttached ? 0.35 : 0),
        badgeAttached,
      });
    }
  }

  if (candidateLineRows.length > 0) {
    // Merge adjacent 1-2px rows into distinct horizontal lines
    const mergedLines: Array<{ centerSY: number; score: number; badgeAttached: boolean }> = [];
    let grpStart = 0;
    for (let i = 1; i <= candidateLineRows.length; i++) {
      if (
        i === candidateLineRows.length ||
        candidateLineRows[i].sy - candidateLineRows[i - 1].sy > 2
      ) {
        const slice = candidateLineRows.slice(grpStart, i);
        const avgSY = slice.reduce((acc, r) => acc + r.sy, 0) / slice.length;
        const maxScore = Math.max(...slice.map((r) => r.score));
        const hasBadge = slice.some((r) => r.badgeAttached);
        mergedLines.push({ centerSY: avgSY, score: maxScore, badgeAttached: hasBadge });
        grpStart = i;
      }
    }

    mergedLines.sort((a, b) => b.score - a.score);
    const best = mergedLines[0];
    // If MT4/MT5 shows dual Ask (upper) + Bid (lower) lines within 8 normalized units,
    // pick Bid (lower Y -> larger NY) for SELL and Ask/badge line for BUY.
    const twin = mergedLines.find(
      (m) =>
        m !== best &&
        Math.abs(toNY(m.centerSY) - toNY(best.centerSY)) <= 9 &&
        m.score >= 0.55
    );
    if (twin) {
      const upperSY = Math.min(best.centerSY, twin.centerSY);
      const lowerSY = Math.max(best.centerSY, twin.centerSY);
      detectedCurrentLineY = toNY(signal.signalType === 'SELL' ? lowerSY : upperSY);
    } else {
      detectedCurrentLineY = toNY(best.centerSY);
    }
  }

  // 7. Build clean 2D candlestick/wick column profile (ignoring grid lines & watermarks)
  const pY0 = toSY(topY + 6);
  const pY1 = toSY(bottomY - 6);
  const pX0 = toSX(leftX + 6);
  const pX1 = toSX(rightX - 4);

  // Identify full-width horizontal lines so they never pollute candle wick detection
  const isFullHorizRow = new Uint8Array(sH);
  for (let sy = pY0; sy <= pY1; sy++) {
    let nonBg = 0;
    for (let sx = pX0; sx <= pX1; sx += 2) {
      if (distBg((sy * sW + sx) * 4) > 32) nonBg++;
    }
    if (nonBg / Math.max(1, Math.ceil((pX1 - pX0 + 1) / 2)) > 0.58) {
      isFullHorizRow[sy] = 1;
    }
  }

  const colCount = new Uint16Array(sW);
  const colMinSY = new Uint16Array(sW);
  const colMaxSY = new Uint16Array(sW);
  colMinSY.fill(sH);

  const watermarkMaxSX = toSX(leftX + 255);
  const watermarkMaxSY = toSY(topY + 68);

  for (let sx = pX0; sx <= pX1; sx++) {
    for (let sy = pY0; sy <= pY1; sy++) {
      if (isFullHorizRow[sy]) continue;
      if (sx <= watermarkMaxSX && sy <= watermarkMaxSY) continue;

      const idx = (sy * sW + sx) * 4;
      const d = distBg(idx);
      if (d < 40) continue;

      const chr = chromaAt(idx);
      let isCandle = chr >= 24 && d >= 40;
      if (!isCandle && d >= 115) {
        // High-contrast monochrome candle/wick: require vertical continuity to reject dotted grids
        let vNeighbors = 0;
        if (sy > pY0 && distBg(((sy - 1) * sW + sx) * 4) >= 95) vNeighbors++;
        if (sy < pY1 && distBg(((sy + 1) * sW + sx) * 4) >= 95) vNeighbors++;
        if (sy > pY0 + 1 && distBg(((sy - 2) * sW + sx) * 4) >= 95) vNeighbors++;
        if (sy < pY1 - 1 && distBg(((sy + 2) * sW + sx) * 4) >= 95) vNeighbors++;
        if (vNeighbors >= 2) isCandle = true;
      }

      if (isCandle) {
        colCount[sx]++;
        if (sy < colMinSY[sx]) colMinSY[sx] = sy;
        if (sy > colMaxSY[sx]) colMaxSY[sx] = sy;
      }
    }
  }

  // Filter isolated 1px noise columns
  const validCandleCol = new Uint8Array(sW);
  for (let sx = pX0; sx <= pX1; sx++) {
    if (colCount[sx] < 3) continue;
    let neighborhood = 0;
    for (let k = Math.max(pX0, sx - 2); k <= Math.min(pX1, sx + 2); k++) {
      neighborhood += colCount[k];
    }
    if (neighborhood >= 6) {
      validCandleCol[sx] = 1;
    }
  }

  // Detect right-most latest candlestick X near current price
  let detectedLastCandleX: number | null = null;
  const refPriceNY = detectedCurrentLineY ?? approxCurrentNY;
  const priceBandMinSY = toSY(Math.max(topY + 6, refPriceNY - 130));
  const priceBandMaxSY = toSY(Math.min(bottomY - 6, refPriceNY + 130));

  for (let sx = pX1 - 1; sx >= toSX(leftX + 140); sx--) {
    if (!validCandleCol[sx] || colCount[sx] < 4) continue;
    // Must overlap vertically with active current-price region
    if (colMinSY[sx] <= priceBandMaxSY && colMaxSY[sx] >= priceBandMinSY) {
      let clusterSum = 0;
      for (let k = Math.max(pX0, sx - 4); k <= Math.min(pX1, sx + 1); k++) {
        if (validCandleCol[k]) clusterSum += colCount[k];
      }
      if (clusterSum >= 9) {
        // Step slightly inward to center on the right-most candle body/wick
        const centeredSX = validCandleCol[sx - 1] ? sx - 1 : sx;
        detectedLastCandleX = clamp(toNX(centeredSX), leftX + 140, rightX - 12);
        break;
      }
    }
  }

  const snapToCandleWick = (
    nx: number,
    ny: number,
    mode: 'high' | 'low' | 'nearest',
    radiusNX = 44,
    radiusNY = 95
  ): { x: number; y: number } | null => {
    const cx = toSX(nx);
    const cy = toSY(ny);
    const rx = Math.max(4, Math.round((radiusNX / 1000) * sW));
    const ry = Math.max(6, Math.round((radiusNY / 1000) * sH));

    let bestSX = -1;
    let bestSY = -1;
    let bestScore = mode === 'high' ? Infinity : -Infinity;

    for (let sx = Math.max(pX0, cx - rx); sx <= Math.min(pX1, cx + rx); sx++) {
      if (!validCandleCol[sx]) continue;
      const distPenalty = Math.abs(sx - cx) * 0.32;

      if (mode === 'high') {
        const topWick = colMinSY[sx];
        if (Math.abs(topWick - cy) <= ry) {
          const score = topWick + distPenalty;
          if (score < bestScore) {
            bestScore = score;
            bestSX = sx;
            bestSY = topWick;
          }
        }
      } else if (mode === 'low') {
        const botWick = colMaxSY[sx];
        if (Math.abs(botWick - cy) <= ry) {
          const score = botWick - distPenalty;
          if (score > bestScore) {
            bestScore = score;
            bestSX = sx;
            bestSY = botWick;
          }
        }
      } else {
        const nearY = clamp(cy, colMinSY[sx], colMaxSY[sx]);
        const d = Math.hypot(sx - cx, nearY - cy);
        if (-d > bestScore) {
          bestScore = -d;
          bestSX = sx;
          bestSY = nearY;
        }
      }
    }

    if (bestSX === -1) return null;
    return { x: toNX(bestSX), y: toNY(bestSY) };
  };

  // Check whether bottom-left of plotBox is uncluttered for export stamp
  let blHits = 0;
  for (let sx = toSX(leftX + 8); sx <= toSX(leftX + 240); sx++) {
    if (validCandleCol[sx] && colMaxSY[sx] >= toSY(bottomY - 46)) {
      blHits++;
    }
  }
  const stampAnchor: 'bottom-left' | 'top-right' =
    blHits <= 3 ? 'bottom-left' : 'top-right';

  return {
    isLightBg,
    plotBox: { leftX, rightX, topY, bottomY },
    detectedCurrentLineY,
    detectedLastCandleX,
    axisLabelCentroidsY,
    snapToCandleWick,
    stampAnchor,
  };
}

function snapTickYToAxisCentroid(
  rawY: number,
  centroids: number[]
): number {
  if (centroids.length === 0) return rawY;
  let closest = rawY;
  let minDiff = 14.5;
  for (const c of centroids) {
    const diff = Math.abs(c - rawY);
    if (diff < minDiff) {
      minDiff = diff;
      closest = c;
    }
  }
  return closest;
}

/**
 * Computes a pixel-accurate, mathematically undistorted 0..1000 technical drawing
 * layout calibrated directly against the chart's price axis and candlestick wicks.
 */
export function computeResolvedChartMarkup(
  signal: TradingSignalResponse,
  pixelGeo?: ChartPixelGeometry | null
): ResolvedChartMarkup {
  const rawMarkup = signal.chartMarkup;
  const isLightBg = pixelGeo?.isLightBg ?? false;

  const leftX = pixelGeo
    ? pixelGeo.plotBox.leftX
    : clamp(Number(rawMarkup?.plotBox?.leftX ?? 22), 6, 200);
  const rightX = pixelGeo
    ? pixelGeo.plotBox.rightX
    : clamp(Number(rawMarkup?.plotBox?.rightX ?? 860), 700, 965);
  const topY = pixelGeo
    ? pixelGeo.plotBox.topY
    : clamp(Number(rawMarkup?.plotBox?.topY ?? 60), 16, 250);
  const bottomY = pixelGeo
    ? pixelGeo.plotBox.bottomY
    : clamp(Number(rawMarkup?.plotBox?.bottomY ?? 870), 540, 968);

  const minPlotY = topY + 10;
  const maxPlotY = bottomY - 10;

  const rawLastX = Number(rawMarkup?.axisCalibration?.lastCandleX ?? 755);
  const lastCandleX =
    pixelGeo?.detectedLastCandleX !== null && pixelGeo?.detectedLastCandleX !== undefined
      ? pixelGeo.detectedLastCandleX
      : clamp(rawLastX, leftX + 140, rightX - 18);

  const rawLastY = Number(rawMarkup?.axisCalibration?.lastCandleY ?? 500);
  const fallbackCurrentY =
    pixelGeo?.detectedCurrentLineY ?? clamp(rawLastY, minPlotY + 20, maxPlotY - 20);

  const currentNum = parseChartPrice(signal.currentMarketPrice);
  const entryNum = parseChartPrice(signal.entryPrice);
  const slNum = parseChartPrice(signal.stopLoss);
  const tp1Num = parseChartPrice(signal.takeProfit1);
  const tp2Num = parseChartPrice(signal.takeProfit2);
  const tp3Num = parseChartPrice(signal.takeProfit3);

  // Collect multi-point Y-axis calibration anchors (snapping each to printed Y-axis label centroids when close)
  const centroids = pixelGeo?.axisLabelCentroidsY ?? [];
  const calibPairs: Array<{ price: number; y: number }> = [];

  if (Array.isArray(rawMarkup?.axisCalibration?.axisTicks)) {
    for (const tick of rawMarkup.axisCalibration.axisTicks) {
      const p = parseChartPrice(tick.price);
      const y = Number(tick.y);
      if (p !== null && Number.isFinite(y) && y >= topY - 15 && y <= bottomY + 15) {
        calibPairs.push({
          price: p,
          y: snapTickYToAxisCentroid(clamp(y, topY, bottomY), centroids),
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
    calibPairs.push({
      price: highRefPrice,
      y: snapTickYToAxisCentroid(clamp(highRefY, topY, bottomY), centroids),
    });
  }
  if (
    lowRefPrice !== null &&
    Number.isFinite(lowRefY) &&
    lowRefY >= topY - 15 &&
    lowRefY <= bottomY + 15
  ) {
    calibPairs.push({
      price: lowRefPrice,
      y: snapTickYToAxisCentroid(clamp(lowRefY, topY, bottomY), centroids),
    });
  }

  if (
    currentNum !== null &&
    pixelGeo?.detectedCurrentLineY !== null &&
    pixelGeo?.detectedCurrentLineY !== undefined
  ) {
    calibPairs.push({
      price: currentNum,
      y: pixelGeo.detectedCurrentLineY,
    });
  }

  // Ordinary least-squares regression for exact Y-units-per-price slope
  let calibratedSlope: number | null = null;
  let meanPrice = 0;
  let meanY = 0;

  if (calibPairs.length >= 2) {
    meanPrice = calibPairs.reduce((s, pt) => s + pt.price, 0) / calibPairs.length;
    meanY = calibPairs.reduce((s, pt) => s + pt.y, 0) / calibPairs.length;
    let num = 0;
    let den = 0;
    for (const pt of calibPairs) {
      const dp = meanPrice - pt.price;
      const dy = pt.y - meanY;
      num += dp * dy;
      den += dp * dp;
    }
    if (den > 1e-12) {
      const slope = num / den; // positive when higher price -> smaller Y
      if (slope > 0) {
        calibratedSlope = slope;
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
    // Pin intercept directly to detected live horizontal price line when present for zero-offset Entry alignment
    if (
      currentNum !== null &&
      pixelGeo?.detectedCurrentLineY !== null &&
      pixelGeo?.detectedCurrentLineY !== undefined
    ) {
      const anchorY = pixelGeo.detectedCurrentLineY;
      rawPriceToY = (p: number) => anchorY + (currentNum - p) * calibratedSlope!;
    } else {
      rawPriceToY = (p: number) => meanY + (meanPrice - p) * calibratedSlope!;
    }
  } else if (setupNums.length >= 2) {
    const minP = Math.min(...setupNums);
    const maxP = Math.max(...setupNums);
    const span = Math.max(maxP - minP, 1e-6);
    const fallbackSlope = ((maxPlotY - minPlotY) * 0.78) / span;
    if (currentNum !== null) {
      rawPriceToY = (p: number) =>
        fallbackCurrentY + (currentNum - p) * fallbackSlope;
    } else {
      const topP = maxP + span * 0.12;
      const botP = minP - span * 0.12;
      rawPriceToY = (p: number) =>
        minPlotY + ((topP - p) / (topP - botP)) * (maxPlotY - minPlotY);
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

  // Resolve Supply / Demand / S&R / Order Block Zones across full left-to-right chart
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

      let zTop =
        topPriceNum !== null
          ? clamp(rawPriceToY(topPriceNum), topY + 6, bottomY - 16)
          : clamp(Number(z.topY ?? 450), topY + 8, bottomY - 24);
      let zBot =
        botPriceNum !== null
          ? clamp(rawPriceToY(botPriceNum), topY + 14, bottomY - 6)
          : topPriceNum !== null
          ? clamp(zTop + 20, topY + 16, bottomY - 6)
          : clamp(Number(z.bottomY ?? zTop + 26), topY + 16, bottomY - 6);

      if (zTop > zBot) {
        const tmp = zTop;
        zTop = zBot;
        zBot = tmp;
      }

      const height = clamp(zBot - zTop, 12, 72);
      const startX = clamp(
        Number(z.startX ?? leftX + 60),
        leftX + 6,
        Math.max(leftX + 50, lastCandleX - 28)
      );
      const rawEndX = Number(z.endX);
      const effectiveEndX =
        z.mitigated && Number.isFinite(rawEndX) && rawEndX > startX + 35
          ? clamp(rawEndX, startX + 45, rightX)
          : rightX;

      const isOrderBlock =
        z.role === 'Bullish OB' ||
        z.role === 'Bearish OB' ||
        z.label.toLowerCase().includes('ob') ||
        z.label.toLowerCase().includes('order block');

      resolvedZones.push({
        id: `zone-${idx}`,
        label: z.label || z.role,
        role: z.role,
        tone: getZoneTone(z.role),
        isOrderBlock,
        mitigated: Boolean(z.mitigated),
        isPrimary: anyExplicitPrimaryZone ? Boolean(z.isPrimary) : idx === 0,
        x: startX,
        width: Math.max(55, effectiveEndX - startX),
        topY: clamp(zTop, topY + 5, bottomY - height - 5),
        height,
        priceText: z.topPrice || z.bottomPrice || '',
      });
    });
  } else if (signal.keyLevels.length > 0) {
    signal.keyLevels.slice(0, 8).forEach((lvl, idx) => {
      const pNum = parseChartPrice(lvl.price);
      if (pNum === null) return;
      const centerY = clamp(rawPriceToY(pNum), topY + 16, bottomY - 16);
      const height = 20;
      const startX = clamp(
        leftX + 80 + (idx % 4) * 55,
        leftX + 12,
        Math.max(leftX + 60, lastCandleX - 40)
      );
      const role: ChartMarkupZone['role'] =
        lvl.role === 'Fair Value Gap' || lvl.role === 'Structure Break'
          ? 'Support'
          : lvl.role;
      resolvedZones.push({
        id: `fallback-zone-${idx}`,
        label: lvl.label,
        role,
        tone: getZoneTone(lvl.role),
        isOrderBlock: role === 'Bullish OB' || role === 'Bearish OB',
        mitigated: false,
        isPrimary: idx === 0,
        x: startX,
        width: Math.max(70, rightX - startX),
        topY: clamp(centerY - height / 2, topY + 6, bottomY - height - 6),
        height,
        priceText: lvl.price,
      });
    });
  }

  // Resolve Fair Value Gaps (FVG / Imbalances) with 50% Consequent Encroachment midline
  const fairValueGaps: ResolvedFvgRect[] = rawFvgs
    .slice(0, 8)
    .map((f, idx): ResolvedFvgRect => {
      const topP = parseChartPrice(f.topPrice);
      const botP = parseChartPrice(f.bottomPrice);

      let fTop =
        topP !== null
          ? clamp(rawPriceToY(topP), topY + 6, bottomY - 16)
          : clamp(Number(f.topY ?? 460), topY + 8, bottomY - 22);
      let fBot =
        botP !== null
          ? clamp(rawPriceToY(botP), topY + 14, bottomY - 6)
          : topP !== null
          ? clamp(fTop + 18, topY + 16, bottomY - 6)
          : clamp(Number(f.bottomY ?? fTop + 22), topY + 16, bottomY - 6);

      if (fTop > fBot) {
        const tmp = fTop;
        fTop = fBot;
        fBot = tmp;
      }

      const height = clamp(fBot - fTop, 11, 64);
      const startX = clamp(
        Number(f.startX ?? leftX + 120),
        leftX + 8,
        Math.max(leftX + 50, lastCandleX - 22)
      );
      const rawEndX = Number(f.endX);
      const effectiveEndX =
        f.mitigated && Number.isFinite(rawEndX) && rawEndX > startX + 30
          ? clamp(rawEndX, startX + 38, rightX)
          : rightX;

      const clampedTop = clamp(fTop, topY + 5, bottomY - height - 5);
      return {
        id: `fvg-${idx}`,
        label: f.label || (f.tone === 'bearish' ? 'Bearish FVG' : 'Bullish FVG'),
        tone: f.tone === 'bearish' ? 'bearish' : 'bullish',
        mitigated: Boolean(f.mitigated),
        isPrimary: Boolean(f.isPrimary),
        x: startX,
        width: Math.max(45, effectiveEndX - startX),
        topY: clampedTop,
        height,
        midY: clampedTop + height / 2,
        priceText: f.topPrice || f.bottomPrice || '',
      };
    });

  // Resolve Horizontal BOS & CHoCH Market Structure Breaks (snapped to origin swing wick)
  const rawBreaks = rawMarkup?.structureBreaks ?? [];
  const anyExplicitPrimaryBreak = rawBreaks.some((b) => Boolean(b.isPrimary));
  const structureBreaks: ResolvedStructureBreak[] = rawBreaks
    .slice(0, 10)
    .map((sb, idx): ResolvedStructureBreak => {
      const pNum = parseChartPrice(sb.price);
      let y =
        pNum !== null
          ? clamp(rawPriceToY(pNum), topY + 10, bottomY - 10)
          : clamp(Number(sb.y ?? 450), topY + 10, bottomY - 10);

      let x1 = clamp(Number(sb.startX ?? leftX + 80), leftX + 8, lastCandleX - 24);
      let x2 = clamp(
        Number(sb.endX ?? x1 + 140),
        x1 + 32,
        Math.min(rightX - 8, lastCandleX + 18)
      );

      if (pixelGeo) {
        const wickSnap = pixelGeo.snapToCandleWick(
          x1,
          y,
          sb.tone === 'bullish' ? 'high' : 'low',
          40,
          pNum !== null ? 24 : 75
        );
        if (wickSnap) {
          x1 = clamp(wickSnap.x, leftX + 8, lastCandleX - 20);
          if (pNum === null || Math.abs(wickSnap.y - y) <= 20) {
            y = wickSnap.y;
          }
          x2 = Math.max(x2, x1 + 36);
        }
      }

      return {
        id: `sb-${idx}`,
        kind: sb.kind === 'CHoCH' ? 'CHoCH' : 'BOS',
        label: sb.label || sb.kind,
        tone: sb.tone === 'bearish' ? 'bearish' : 'bullish',
        x1,
        x2,
        y,
        priceText: sb.price || '',
        isPrimary: anyExplicitPrimaryBreak
          ? Boolean(sb.isPrimary)
          : idx === rawBreaks.length - 1,
      };
    });

  // Resolve Liquidity Pools & Sweeps (EQH, EQL, BSL, SSL, Sweep)
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

      let x1 = clamp(Number(lq.startX ?? leftX + 70), leftX + 8, lastCandleX - 20);
      let x2 = clamp(
        Number(lq.endX ?? lastCandleX),
        x1 + 36,
        rightX - 6
      );

      const isUpperLiq =
        lq.kind === 'EQH' ||
        lq.kind === 'BSL' ||
        (lq.kind === 'Sweep' && lq.tone === 'bearish');

      if (pixelGeo) {
        const snap = pixelGeo.snapToCandleWick(
          x1,
          y,
          isUpperLiq ? 'high' : 'low',
          42,
          pNum !== null ? 22 : 70
        );
        if (snap) {
          x1 = clamp(snap.x, leftX + 8, lastCandleX - 18);
          if (pNum === null || Math.abs(snap.y - y) <= 18) {
            y = snap.y;
          }
          x2 = Math.max(x2, x1 + 36);
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
        swept: Boolean(lq.swept || lq.kind === 'Sweep'),
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
        const snap1 = pixelGeo.snapToCandleWick(x1, y1, wickMode, 52, 105);
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
            46,
            95
          );
          if (snap2 && Math.abs(snap2.x - x1) >= 42) {
            const slope = (snap2.y - y1) / (snap2.x - x1);
            const targetX2 = clamp(Math.max(snap2.x, lastCandleX), x1 + 42, rightX - 8);
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

  // Snap Full Left-to-Right Swing Structure Pivot Tags (HH, HL, LH, LL, EH, EL, Sweep)
  const rawSwings = (rawMarkup?.swings || []).slice(0, 18);
  const candidateSwings: ChartMarkupSwing[] = rawSwings.map((sw): ChartMarkupSwing => {
    const position: 'above' | 'below' =
      sw.position === 'below' ? 'below' : 'above';
    const pNum = parseChartPrice(sw.price);
    let x = clamp(Number(sw.x ?? 450), leftX + 12, lastCandleX + 6);
    let y =
      pNum !== null
        ? clamp(rawPriceToY(pNum), topY + 18, bottomY - 18)
        : clamp(Number(sw.y ?? 450), topY + 18, bottomY - 18);

    if (pixelGeo) {
      const snapped = pixelGeo.snapToCandleWick(
        x,
        y,
        position === 'above' ? 'high' : 'low',
        40,
        pNum !== null ? 55 : 95
      );
      if (snapped) {
        x = clamp(snapped.x, leftX + 12, rightX - 14);
        y = clamp(snapped.y, topY + 16, bottomY - 16);
      }
    }

    return {
      tag: String(sw.tag || 'Pivot').slice(0, 8),
      x,
      y,
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

      // R:R Badge centered in open reward space so it never collides with Entry/TP pills
      const legGapPx = Math.abs(sy(pb.tp1Y) - sy(pb.entryY));
      if (legGapPx >= 36 * unit) {
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
      const lineStartX = sx(
        markup.positionBox ? markup.positionBox.startX : markup.anchorPoint.x
      );
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

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = (lvl.tone === 'entry' ? 2.1 : 1.55) * unit;
      if (lvl.dashed) {
        ctx.setLineDash([5 * unit, 3.5 * unit]);
      }
      ctx.beginPath();
      ctx.moveTo(lineStartX, ly);
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

  // Exported PNG signature stamp placed cleanly inside plotBox (never overlapping OS status bar)
  if (includeStamp) {
    ctx.save();
    const modeLabel =
      layerFilter === 'all'
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
    layerFilter === 'all'
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

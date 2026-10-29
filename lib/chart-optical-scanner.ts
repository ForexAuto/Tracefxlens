import type {
  DetectedAxisTickAnchor,
  DetectedCandleBar,
  DetectedCandleEnvelope,
  DetectedFvgCandidate,
  DetectedPivotAnchor,
  DetectedPlotBounds,
} from '@/lib/trading-data';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface ChartOpticalGeometry {
  isLightBg: boolean;
  isPortrait: boolean;
  detectedPlotBox: DetectedPlotBounds;
  subPaneCount: number;
  subPaneDividerYs: number[];
  detectedAxisTicks: DetectedAxisTickAnchor[];
  liveBadgeY: number | null;
  verifiedBidAskLineY: number | null;
  candles: DetectedCandleBar[];
  detectedPivots: DetectedPivotAnchor[];
  detectedFvgCandidates: DetectedFvgCandidate[];
  candleEnvelope: DetectedCandleEnvelope | undefined;
  stampAnchor: 'bottom-left' | 'top-right';
  snapToCandleWick: (
    nx: number,
    ny: number,
    mode: 'high' | 'low' | 'nearest',
    radiusNX?: number,
    radiusNY?: number
  ) => { x: number; y: number; candleIndex: number } | null;
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
}

/**
 * Unified, high-precision client-side optical scanner engineered specifically for
 * Portrait AND Landscape screenshots from TradingView Mobile & MT4/MT5 Mobile
 * (as well as desktop charts).
 *
 * Isolates:
 * 1. Exact main candlestick `plotBox` (excluding OS status bars, top OHLC headers,
 *    borderless TradingView right price scales, MT4/MT5 multi-window RSI/MACD panes,
 *    time-axis labels, and bottom mobile navigation bars).
 * 2. Exact `Y` centroids of every printed right-axis price label (`T1..Tk`) plus
 *    any colored/inverted live price badge (`LIVE`) on the price scale.
 * 3. Individual candlesticks `C[0..N-1]` (`x`, `highY`, `lowY`, `bodyTopY`, `bodyBottomY`),
 *    filtering out MT4/MT5 dashed period-separator grids and TradingView center watermarks.
 * 4. True local swing high/low wick pivots (`H1..Hm`, `L1..Lm`) and 3-candle FVG gaps (`G1..Gk`).
 */
export function scanChartOpticalGeometry(
  img: HTMLImageElement,
  plotBoxHint?: Partial<DetectedPlotBounds>
): ChartOpticalGeometry | null {
  if (typeof document === 'undefined') return null;
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 80 || natH < 80) return null;

  const isPortrait = natW / natH < 0.88;

  // Sample at up to 1120px so 1px mobile candle wicks and 8pt axis numerals stay crisp
  const maxSampleDim = 1120;
  const scale = Math.min(1, maxSampleDim / Math.max(natW, natH));
  const sW = Math.max(120, Math.round(natW * scale));
  const sH = Math.max(120, Math.round(natH * scale));

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
  const toNX = (sx: number) => Math.round((sx / Math.max(1, sW - 1)) * 10000) / 10;
  const toNY = (sy: number) => Math.round((sy / Math.max(1, sH - 1)) * 10000) / 10;

  // 1. Sample interior candlestick plot area (X=120..660, Y=240..520) for median chart background RGB
  const rSamples: number[] = [];
  const gSamples: number[] = [];
  const bSamples: number[] = [];
  for (let gx = 0; gx < 22; gx++) {
    const sx = toSX(120 + gx * 25);
    for (let gy = 0; gy < 18; gy++) {
      const sy = toSY(235 + gy * 16);
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
  const bgR = rSamples[mid] ?? 15;
  const bgG = gSamples[mid] ?? 20;
  const bgB = bSamples[mid] ?? 30;
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

  // 2. Detect leftX (optional TradingView desktop drawing sidebar or MT4/MT5 frame border)
  let leftX = clamp(Number(plotBoxHint?.leftX ?? 14), 6, 150);
  const vScanY0 = toSY(240);
  const vScanY1 = toSY(530);
  const vSpan = Math.max(1, vScanY1 - vScanY0 + 1);

  for (let sx = toSX(18); sx <= toSX(125); sx++) {
    let nonBg = 0;
    let uniform = 0;
    for (let sy = vScanY0; sy <= vScanY1; sy++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 16) nonBg++;
      if (sy < vScanY1) {
        const idxNext = ((sy + 1) * sW + sx) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 13) uniform++;
      }
    }
    // Require solid continuous divider (rejects dashed MT4/MT5 vertical period separators!)
    if (nonBg / vSpan >= 0.85 && uniform / Math.max(1, vSpan - 1) >= 0.84) {
      const checkLeftSX = Math.max(0, sx - Math.max(4, Math.round(sW * 0.02)));
      const checkRightSX = Math.min(sW - 1, sx + Math.max(4, Math.round(sW * 0.02)));
      let rightBgMatches = 0;
      let leftNonPlotSurface = 0;
      const samples = Math.max(1, Math.ceil(vSpan / 3));
      for (let sy = vScanY0; sy <= vScanY1; sy += 3) {
        if (distBg((sy * sW + checkRightSX) * 4) <= 26) rightBgMatches++;
        if (distBg((sy * sW + checkLeftSX) * 4) > 14) leftNonPlotSurface++;
      }
      if (rightBgMatches / samples >= 0.68 && leftNonPlotSurface / samples >= 0.25) {
        leftX = clamp(toNX(sx) + 2, 10, 135);
      }
    }
  }

  // 3. Detect rightX (vertical Y-axis divider OR borderless TradingView mobile price-label column)
  // Portrait mobile right price scale can be 16%-26% wide (rightX ~ 730..855); Landscape ~ 845..955
  const minRightSearchNX = isPortrait ? 690 : 755;
  let rightX = clamp(
    Number(plotBoxHint?.rightX ?? (isPortrait ? 825 : 895)),
    minRightSearchNX,
    962
  );
  let foundSolidAxisBorderSX = -1;

  for (let sx = toSX(minRightSearchNX); sx <= toSX(958); sx++) {
    let nonBg = 0;
    let uniform = 0;
    let highChroma = 0;
    for (let sy = vScanY0; sy <= vScanY1; sy++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 15) nonBg++;
      if (chromaAt(idx) >= 26) highChroma++;
      if (sy < vScanY1) {
        const idxNext = ((sy + 1) * sW + sx) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 13) uniform++;
      }
    }

    // Solid neutral border (not a dashed period separator and not a tall colored candle wick)
    if (
      nonBg / vSpan >= 0.84 &&
      uniform / Math.max(1, vSpan - 1) >= 0.82 &&
      highChroma / vSpan <= 0.22
    ) {
      const checkX0 = Math.min(sW - 1, sx + Math.max(3, Math.round(sW * 0.012)));
      const checkX1 = Math.min(sW - 1, toSX(992));
      if (checkX1 - checkX0 >= 6) {
        let rightInk = 0;
        let rightCandleChroma = 0;
        let rightTotal = 0;
        for (let rx = checkX0; rx <= checkX1; rx += 2) {
          for (let ry = vScanY0; ry <= vScanY1; ry += 3) {
            rightTotal++;
            const rIdx = (ry * sW + rx) * 4;
            if (distBg(rIdx) > 38) rightInk++;
            if (chromaAt(rIdx) >= 32 && distBg(rIdx) > 45) rightCandleChroma++;
          }
        }
        const inkDensity = rightInk / Math.max(1, rightTotal);
        const chromaDensity = rightCandleChroma / Math.max(1, rightTotal);
        if (inkDensity >= 0.006 && inkDensity <= 0.45 && chromaDensity <= 0.12) {
          foundSolidAxisBorderSX = sx;
        }
      }
    }
  }

  if (foundSolidAxisBorderSX !== -1) {
    rightX = clamp(toNX(foundSolidAxisBorderSX), minRightSearchNX, 958);
  } else {
    // Borderless TradingView Mobile / Desktop Right Price Column Detector:
    // Locate vertically repeating right-aligned text bands on the right margin [720..994]
    // and set rightX cleanly to the left edge of those price digits!
    const probeX0 = toSX(isPortrait ? 720 : 800);
    const probeX1 = toSX(994);
    const textRowLeftSXs: number[] = [];

    for (let sy = toSY(200); sy <= toSY(680); sy++) {
      let rowInk = 0;
      let rowChroma = 0;
      let firstInkSX = -1;
      let lastInkSX = -1;
      // Scan from right margin inward to isolate the right-axis label cluster
      let gapRun = 0;
      for (let sx = probeX1; sx >= probeX0; sx--) {
        const idx = (sy * sW + sx) * 4;
        const d = distBg(idx);
        const chr = chromaAt(idx);
        if (d > 58) {
          if (lastInkSX === -1) lastInkSX = sx;
          firstInkSX = sx;
          rowInk++;
          if (chr >= 28) rowChroma++;
          gapRun = 0;
        } else if (lastInkSX !== -1) {
          gapRun++;
          // Stop inward scan once we cross the empty gutter (>3.2% width) left of the price digits
          if (gapRun > Math.max(6, Math.round(sW * 0.032))) {
            break;
          }
        }
      }
      const spanPx = lastInkSX !== -1 && firstInkSX !== -1 ? lastInkSX - firstInkSX + 1 : 0;
      if (
        rowInk >= Math.max(4, Math.round(sW * 0.012)) &&
        spanPx >= Math.max(10, Math.round(sW * 0.03)) &&
        spanPx <= Math.round(sW * (isPortrait ? 0.25 : 0.16)) &&
        rowChroma / Math.max(1, rowInk) <= 0.35 &&
        lastInkSX >= toSX(910)
      ) {
        textRowLeftSXs.push(firstInkSX);
      }
    }

    if (textRowLeftSXs.length >= 8) {
      textRowLeftSXs.sort((a, b) => a - b);
      // 20th percentile left-most digit X captures full multi-digit labels cleanly
      const p20SX = textRowLeftSXs[Math.floor(textRowLeftSXs.length * 0.2)];
      rightX = clamp(toNX(p20SX) - (isPortrait ? 12 : 8), minRightSearchNX, 955);
    }
  }

  // 4. Detect topY (mobile OS status bar + TradingView/MT4/MT5 top app header & symbol/timeframe bars)
  const maxTopSearchNY = isPortrait ? 275 : 225;
  let topY = clamp(Number(plotBoxHint?.topY ?? (isPortrait ? 85 : 52)), 14, maxTopSearchNY);
  const rowX0 = toSX(leftX + 32);
  const rowX1 = toSX(rightX - 16);
  const rowSpanX = Math.max(1, rowX1 - rowX0 + 1);

  // 4a. Detect top solid surface transition (e.g. mobile top bar with different fill color than plot bg)
  let lastNonPlotHeaderSY = -1;
  for (let sy = toSY(12); sy <= toSY(maxTopSearchNY); sy++) {
    let bgMatchCount = 0;
    let uniformRow = 0;
    for (let sx = rowX0; sx <= rowX1; sx += 2) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) <= 22) bgMatchCount++;
      if (sx + 2 <= rowX1) {
        const idxNext = (sy * sW + sx + 2) * 4;
        const step =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (step <= 14) uniformRow++;
      }
    }
    const samples = Math.max(1, Math.ceil(rowSpanX / 2));
    // Solid toolbar band whose surface color does NOT match main plot background
    if (bgMatchCount / samples <= 0.25 && uniformRow / Math.max(1, samples - 1) >= 0.72) {
      lastNonPlotHeaderSY = sy;
    }
  }
  if (lastNonPlotHeaderSY !== -1) {
    topY = clamp(toNY(lastNonPlotHeaderSY) + 3, 16, maxTopSearchNY);
  }

  // 4b. Detect explicit horizontal divider line below top toolbar
  for (let sy = toSY(16); sy <= toSY(maxTopSearchNY); sy++) {
    let nonBg = 0;
    let uniform = 0;
    let chroma = 0;
    for (let sx = rowX0; sx <= rowX1; sx++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 15) nonBg++;
      if (chromaAt(idx) >= 24) chroma++;
      if (sx < rowX1) {
        const idxNext = (sy * sW + sx + 1) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 13) uniform++;
      }
    }
    if (
      nonBg / rowSpanX >= 0.8 &&
      uniform / Math.max(1, rowSpanX - 1) >= 0.78 &&
      chroma / rowSpanX <= 0.24
    ) {
      const belowSY = Math.min(sH - 1, sy + Math.max(4, Math.round(sH * 0.015)));
      let belowBgMatch = 0;
      for (let sx = rowX0; sx <= rowX1; sx += 3) {
        if (distBg((belowSY * sW + sx) * 4) <= 26) belowBgMatch++;
      }
      if (belowBgMatch / Math.max(1, Math.ceil(rowSpanX / 3)) >= 0.65) {
        topY = Math.max(topY, clamp(toNY(sy) + 2, 16, maxTopSearchNY));
      }
    }
  }

  // 5. Detect bottomY & indicator sub-panes (RSI / MACD / Volume + mobile bottom bars & time axis)
  const rawDividerSYs: number[] = [];
  const minSubSearchNY = Math.max(topY + 260, 415);

  for (let sy = toSY(minSubSearchNY); sy <= toSY(972); sy++) {
    let nonBg = 0;
    let uniform = 0;
    let coloredChroma = 0;
    for (let sx = rowX0; sx <= rowX1; sx++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 15) nonBg++;
      if (chromaAt(idx) >= 24) coloredChroma++;
      if (sx < rowX1) {
        const idxNext = (sy * sW + sx + 1) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 12) uniform++;
      }
    }

    if (
      nonBg / rowSpanX >= 0.8 &&
      uniform / Math.max(1, rowSpanX - 1) >= 0.8 &&
      coloredChroma / rowSpanX <= 0.25
    ) {
      const aboveSY = Math.max(0, sy - Math.max(4, Math.round(sH * 0.014)));
      let aboveBgMatch = 0;
      for (let sx = rowX0; sx <= rowX1; sx += 3) {
        if (distBg((aboveSY * sW + sx) * 4) <= 30) aboveBgMatch++;
      }
      if (aboveBgMatch / Math.max(1, Math.ceil(rowSpanX / 3)) >= 0.58) {
        rawDividerSYs.push(sy);
      }
    }
  }

  const mergedDividersNY: number[] = [];
  if (rawDividerSYs.length > 0) {
    let grpStart = 0;
    for (let i = 1; i <= rawDividerSYs.length; i++) {
      if (
        i === rawDividerSYs.length ||
        rawDividerSYs[i] - rawDividerSYs[i - 1] > Math.max(3, Math.round(sH * 0.012))
      ) {
        const slice = rawDividerSYs.slice(grpStart, i);
        const avgSY = slice.reduce((a, b) => a + b, 0) / slice.length;
        const ny = toNY(avgSY);
        if (ny - topY >= 255) {
          mergedDividersNY.push(ny);
        }
        grpStart = i;
      }
    }
  }

  let bottomY = clamp(
    Number(plotBoxHint?.bottomY ?? (isPortrait ? 855 : 895)),
    440,
    968
  );
  let subPaneDividerYs: number[] = [];

  if (mergedDividersNY.length >= 2) {
    const firstDivider = mergedDividersNY[0];
    const lastDivider = mergedDividersNY[mergedDividersNY.length - 1];
    if (lastDivider - firstDivider >= 55) {
      bottomY = clamp(firstDivider - 2, 420, 960);
      subPaneDividerYs = mergedDividersNY.slice(0, -1);
    } else {
      bottomY = clamp(firstDivider - 2, 460, 964);
    }
  } else if (mergedDividersNY.length === 1) {
    const onlyDivider = mergedDividersNY[0];
    bottomY = clamp(onlyDivider - 2, 430, 964);
    if (onlyDivider <= 800) {
      const probeY0 = toSY(onlyDivider + 20);
      const probeY1 = toSY(Math.min(935, onlyDivider + 125));
      if (probeY1 > probeY0 + 6) {
        let bgLike = 0;
        let inkLike = 0;
        let total = 0;
        for (let sy = probeY0; sy <= probeY1; sy += 3) {
          for (let sx = rowX0; sx <= rowX1; sx += 4) {
            total++;
            const d = distBg((sy * sW + sx) * 4);
            if (d <= 28) bgLike++;
            if (d >= 48) inkLike++;
          }
        }
        if (
          bgLike / Math.max(1, total) >= 0.45 &&
          inkLike / Math.max(1, total) >= 0.012 &&
          inkLike / Math.max(1, total) <= 0.44
        ) {
          subPaneDividerYs = [onlyDivider];
        }
      }
    }
  } else {
    // Borderless mobile bottom chrome / time-axis detector:
    // Scan upward from bottom for non-plot toolbar surface OR horizontal time-axis label row
    let firstBottomChromeSY = -1;
    for (let sy = sH - 2; sy >= toSY(680); sy--) {
      let bgMatches = 0;
      const samples = Math.max(1, Math.ceil(rowSpanX / 3));
      for (let sx = rowX0; sx <= rowX1; sx += 3) {
        if (distBg((sy * sW + sx) * 4) <= 24) bgMatches++;
      }
      if (bgMatches / samples < 0.35) {
        firstBottomChromeSY = sy;
      } else if (firstBottomChromeSY !== -1 && sy < firstBottomChromeSY - Math.round(sH * 0.02)) {
        break;
      }
    }
    if (firstBottomChromeSY !== -1) {
      // Step ~24 normalized units above bottom chrome to clear borderless X-axis timestamps
      bottomY = clamp(toNY(firstBottomChromeSY) - (isPortrait ? 24 : 28), 540, 962);
    }
  }

  // 6. Detect Right Y-Axis Printed Price Labels (`T1..Tk`) & Colored/Inverted Live Badge (`LIVE`)
  const axisX0 = toSX(Math.min(990, rightX + 3));
  const axisX1 = toSX(996);
  const detectedAxisTicks: DetectedAxisTickAnchor[] = [];
  let liveBadgeY: number | null = null;

  if (axisX1 - axisX0 >= 8) {
    const axR: number[] = [];
    const axG: number[] = [];
    const axB: number[] = [];
    for (let sy = toSY(topY + 8); sy <= toSY(bottomY - 8); sy += 3) {
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
    const axisScanTopSY = toSY(topY + 4);
    const axisScanBotSY = toSY(bottomY - 4);

    // 6a. Detect solid colored OR inverted rectangular live-price pill badge on the Y-axis
    let pillStart = -1;
    let bestPill: { centerNY: number; score: number } | null = null;
    for (let sy = axisScanTopSY; sy <= axisScanBotSY + 1; sy++) {
      let pillFill = 0;
      if (sy <= axisScanBotSY) {
        for (let sx = axisX0; sx <= axisX1; sx++) {
          const idx = (sy * sW + sx) * 4;
          const dAxis =
            Math.abs(data[idx] - abR) +
            Math.abs(data[idx + 1] - abG) +
            Math.abs(data[idx + 2] - abB);
          // Colored pill (TradingView green/red/blue, MT5 blue/orange) OR solid inverted high-contrast box
          if ((chromaAt(idx) >= 24 && dAxis >= 42) || dAxis >= 165) {
            pillFill++;
          }
        }
      }
      const isPillRow = sy <= axisScanBotSY && pillFill / axisSpanW >= 0.42;
      if (isPillRow) {
        if (pillStart === -1) pillStart = sy;
      } else if (pillStart !== -1) {
        const pillHeightNY = toNY(sy - 1) - toNY(pillStart);
        if (pillHeightNY >= 6 && pillHeightNY <= 36) {
          const centerNY = toNY((pillStart + sy - 1) / 2);
          const score = pillHeightNY;
          if (!bestPill || score > bestPill.score) {
            bestPill = { centerNY, score };
          }
        }
        pillStart = -1;
      }
    }
    if (bestPill) {
      liveBadgeY = Math.round(bestPill.centerNY * 10) / 10;
    }

    // 6b. Detect regular printed numeric Y-axis scale label rows (`T1..Tk`)
    let bandStart = -1;
    const rawTickYs: number[] = [];
    for (let sy = axisScanTopSY; sy <= axisScanBotSY + 1; sy++) {
      let ink = 0;
      let pillFill = 0;
      if (sy <= axisScanBotSY) {
        for (let sx = axisX0; sx <= axisX1; sx++) {
          const idx = (sy * sW + sx) * 4;
          const dAxis =
            Math.abs(data[idx] - abR) +
            Math.abs(data[idx + 1] - abG) +
            Math.abs(data[idx + 2] - abB);
          if (dAxis > 56) ink++;
          if ((chromaAt(idx) >= 24 && dAxis >= 42) || dAxis >= 165) pillFill++;
        }
      }
      const isTextRow =
        sy <= axisScanBotSY &&
        pillFill / axisSpanW < 0.4 &&
        ink >= Math.max(2, Math.round(axisSpanW * 0.04));

      if (isTextRow) {
        if (bandStart === -1) bandStart = sy;
      } else if (bandStart !== -1) {
        const bandH = toNY(sy - 1) - toNY(bandStart);
        const centerNY = toNY((bandStart + sy - 1) / 2);
        // Must look like a single line of axis numerals and not overlap the live pill badge
        const nearLivePill =
          liveBadgeY !== null && Math.abs(centerNY - liveBadgeY) < 12;
        if (bandH >= 2.5 && bandH <= 24 && !nearLivePill) {
          rawTickYs.push(Math.round(centerNY * 10) / 10);
        }
        bandStart = -1;
      }
    }

    // Merge split scanlines within 9 normalized units and assign T1..Tk IDs top-to-bottom
    const mergedTickYs: number[] = [];
    for (const ty of rawTickYs) {
      if (
        mergedTickYs.length > 0 &&
        ty - mergedTickYs[mergedTickYs.length - 1] < 9
      ) {
        mergedTickYs[mergedTickYs.length - 1] =
          Math.round(((mergedTickYs[mergedTickYs.length - 1] + ty) / 2) * 10) / 10;
      } else {
        mergedTickYs.push(ty);
      }
    }

    // Cap to at most 14 evenly-distributed ticks so pointer tags never crowd the zoom strip
    const stepStride = mergedTickYs.length > 14 ? Math.ceil(mergedTickYs.length / 12) : 1;
    let tickCounter = 1;
    for (let i = 0; i < mergedTickYs.length; i += stepStride) {
      detectedAxisTicks.push({
        id: `T${tickCounter++}`,
        y: mergedTickYs[i],
      });
    }
  }

  // 7. Verify Bid/Ask horizontal line ONLY if it aligns with `liveBadgeY` on the right axis!
  let verifiedBidAskLineY: number | null = null;
  if (liveBadgeY !== null) {
    const searchY0 = toSY(Math.max(topY + 4, liveBadgeY - 8));
    const searchY1 = toSY(Math.min(bottomY - 4, liveBadgeY + 8));
    const plotSX0 = toSX(leftX + 14);
    const plotSX1 = toSX(rightX - 4);
    const spanW = Math.max(1, plotSX1 - plotSX0 + 1);
    let bestLineSY = -1;
    let bestFrac = 0;
    for (let sy = searchY0; sy <= searchY1; sy++) {
      let lineHits = 0;
      for (let sx = plotSX0; sx <= plotSX1; sx += 2) {
        const idx = (sy * sW + sx) * 4;
        if (distBg(idx) >= 28) lineHits++;
      }
      const frac = lineHits / Math.max(1, Math.ceil(spanW / 2));
      if (frac >= 0.35 && frac > bestFrac) {
        bestFrac = frac;
        bestLineSY = sy;
      }
    }
    verifiedBidAskLineY =
      bestLineSY !== -1
        ? Math.round(toNY(bestLineSY) * 10) / 10
        : liveBadgeY;
  }

  // 8. High-Resolution Candlestick, Wick, Swing Pivot & 3-Candle FVG Segmentation
  const pY0 = toSY(topY + 5);
  const pY1 = toSY(bottomY - 5);
  const pX0 = toSX(leftX + 5);
  const pX1 = toSX(rightX - 4);
  const plotHeightPx = Math.max(1, pY1 - pY0 + 1);
  const plotWidthPx = Math.max(1, pX1 - pX0 + 1);

  // 8a. Mask out full-width horizontal lines (grid lines, Bid/Ask rays, session lines)
  const isHorizLineRow = new Uint8Array(sH);
  for (let sy = pY0; sy <= pY1; sy++) {
    let nonBg = 0;
    let samples = 0;
    for (let sx = pX0; sx <= pX1; sx += 2) {
      samples++;
      if (distBg((sy * sW + sx) * 4) > 28) nonBg++;
    }
    if (nonBg / Math.max(1, samples) > 0.54) {
      isHorizLineRow[sy] = 1;
    }
  }

  // 8b. Mask out full-height vertical grid / MT4-MT5 dashed period-separator columns
  const isVertGridCol = new Uint8Array(sW);
  for (let sx = pX0; sx <= pX1; sx++) {
    let lowChromaNonBg = 0;
    let highChroma = 0;
    let transitions = 0;
    let prevOn = false;
    for (let sy = pY0; sy <= pY1; sy++) {
      if (isHorizLineRow[sy]) continue;
      const idx = (sy * sW + sx) * 4;
      const d = distBg(idx);
      const chr = chromaAt(idx);
      const on = d > 22;
      if (on !== prevOn) {
        transitions++;
        prevOn = on;
      }
      if (d > 22 && chr < 20) lowChromaNonBg++;
      if (chr >= 24 && d > 35) highChroma++;
    }
    const lowFrac = lowChromaNonBg / plotHeightPx;
    const hiFrac = highChroma / plotHeightPx;
    // Dashed MT4/MT5 period separator (high transition count spanning tall height) or solid vertical grid
    if (hiFrac < 0.04 && (lowFrac > 0.68 || (lowFrac > 0.28 && transitions >= 24))) {
      isVertGridCol[sx] = 1;
    }
  }

  // Mask top-left OHLC legend text box so symbol title letters aren't mistaken for top-left candle wicks
  const legendMaxSX = toSX(leftX + (isPortrait ? 420 : 280));
  const legendMaxSY = toSY(topY + (isPortrait ? 65 : 58));
  const horizContrastStep = Math.max(3, Math.round(sW * 0.006));

  const colCount = new Uint16Array(sW);
  const colMinSY = new Uint16Array(sW);
  const colMaxSY = new Uint16Array(sW);
  const colBullCount = new Uint16Array(sW);
  const colBearCount = new Uint16Array(sW);
  colMinSY.fill(sH);

  for (let sx = pX0; sx <= pX1; sx++) {
    if (isVertGridCol[sx]) continue;
    for (let sy = pY0; sy <= pY1; sy++) {
      if (isHorizLineRow[sy]) continue;
      if (sx <= legendMaxSX && sy <= legendMaxSY) continue;

      const idx = (sy * sW + sx) * 4;
      const d = distBg(idx);
      if (d < 34) continue; // Rejects faint TradingView center ticker watermarks!

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const chr = chromaAt(idx);

      let isCandlePixel = chr >= 20 && d >= 34;

      if (!isCandlePixel && d >= 54) {
        // Monochrome / white / black candle wick or MT4/MT5 hollow candle outline:
        // Require sharp horizontal contrast against nearby background AND 1px vertical continuity
        const leftRefSX = Math.max(pX0, sx - horizContrastStep);
        const rightRefSX = Math.min(pX1, sx + horizContrastStep);
        const idxL = (sy * sW + leftRefSX) * 4;
        const idxR = (sy * sW + rightRefSX) * 4;
        const hDiffL =
          Math.abs(r - data[idxL]) +
          Math.abs(g - data[idxL + 1]) +
          Math.abs(b - data[idxL + 2]);
        const hDiffR =
          Math.abs(r - data[idxR]) +
          Math.abs(g - data[idxR + 1]) +
          Math.abs(b - data[idxR + 2]);
        const hasSharpHorizEdge = Math.max(hDiffL, hDiffR) >= 44;

        let vCont = 0;
        if (sy > pY0 && distBg(((sy - 1) * sW + sx) * 4) >= 44) vCont++;
        if (sy < pY1 && distBg(((sy + 1) * sW + sx) * 4) >= 44) vCont++;
        if (hasSharpHorizEdge && vCont >= 1) {
          isCandlePixel = true;
        }
      }

      if (isCandlePixel) {
        colCount[sx]++;
        if (sy < colMinSY[sx]) colMinSY[sx] = sy;
        if (sy > colMaxSY[sx]) colMaxSY[sx] = sy;
        // Classify typical bullish (green/teal/cyan/white-on-dark) vs bearish (red/rose/orange/black-on-light)
        if (g > r + 14 || b > r + 18 || (!isLightBg && r > 195 && g > 195 && b > 195)) {
          colBullCount[sx]++;
        } else if (r > g + 14 || (isLightBg && r < 60 && g < 60 && b < 60)) {
          colBearCount[sx]++;
        }
      }
    }
  }

  // Suppress 1-2px isolated dust columns
  const activeCol = new Uint8Array(sW);
  for (let sx = pX0; sx <= pX1; sx++) {
    if (colCount[sx] < 2) continue;
    let sum = 0;
    for (let k = Math.max(pX0, sx - 2); k <= Math.min(pX1, sx + 2); k++) {
      sum += colCount[k];
    }
    if (sum >= 5) {
      activeCol[sx] = 1;
    }
  }

  // Bridge hollow candle interiors (1-3px gap between left and right vertical body walls at overlapping Y)
  const bridgedCol = new Uint8Array(activeCol);
  const maxBridgeGap = Math.max(2, Math.round(sW * 0.005));
  for (let sx = pX0 + 1; sx <= pX1 - maxBridgeGap - 1; sx++) {
    if (bridgedCol[sx]) continue;
    if (!activeCol[sx - 1]) continue;
    let nextActive = -1;
    for (let g = 1; g <= maxBridgeGap; g++) {
      if (activeCol[sx + g]) {
        nextActive = sx + g;
        break;
      }
    }
    if (
      nextActive !== -1 &&
      colMinSY[sx - 1] <= colMaxSY[nextActive] + 4 &&
      colMaxSY[sx - 1] >= colMinSY[nextActive] - 4
    ) {
      for (let fillX = sx; fillX < nextActive; fillX++) {
        bridgedCol[fillX] = 1;
        colMinSY[fillX] = Math.min(colMinSY[sx - 1], colMinSY[nextActive]);
        colMaxSY[fillX] = Math.max(colMaxSY[sx - 1], colMaxSY[nextActive]);
      }
    }
  }

  // Group contiguous active columns into raw runs, then split wide touching candle runs by median width
  interface RawColRun {
    x0: number;
    x1: number;
  }
  const rawRuns: RawColRun[] = [];
  let rStart = -1;
  for (let sx = pX0; sx <= pX1 + 1; sx++) {
    const on = sx <= pX1 && bridgedCol[sx] === 1;
    if (on) {
      if (rStart === -1) rStart = sx;
    } else if (rStart !== -1) {
      rawRuns.push({ x0: rStart, x1: sx - 1 });
      rStart = -1;
    }
  }

  const widths = rawRuns.map((r) => r.x1 - r.x0 + 1).sort((a, b) => a - b);
  const medianRunW =
    widths.length > 0
      ? clamp(widths[Math.floor(widths.length * 0.5)], 2, Math.round(plotWidthPx * 0.045))
      : 5;

  const finalRuns: RawColRun[] = [];
  for (const r of rawRuns) {
    const w = r.x1 - r.x0 + 1;
    if (w > medianRunW * 2.25 && medianRunW >= 3) {
      const parts = Math.max(2, Math.round(w / (medianRunW + 1)));
      const step = w / parts;
      for (let p = 0; p < parts; p++) {
        const sub0 = Math.round(r.x0 + p * step);
        const sub1 = Math.min(r.x1, Math.round(r.x0 + (p + 1) * step) - 1);
        if (sub1 >= sub0) finalRuns.push({ x0: sub0, x1: sub1 });
      }
    } else {
      finalRuns.push(r);
    }
  }

  const candles: DetectedCandleBar[] = [];
  for (const run of finalRuns) {
    let minSY = sH;
    let maxSY = 0;
    let bull = 0;
    let bear = 0;
    let totalInk = 0;
    for (let sx = run.x0; sx <= run.x1; sx++) {
      if (colCount[sx] === 0 && !bridgedCol[sx]) continue;
      totalInk += Math.max(1, colCount[sx]);
      if (colMinSY[sx] < minSY) minSY = colMinSY[sx];
      if (colMaxSY[sx] > maxSY) maxSY = colMaxSY[sx];
      bull += colBullCount[sx];
      bear += colBearCount[sx];
    }
    if (minSY > maxSY || totalInk < 3) continue;

    // Estimate candle body top/bottom vs thin 1px wicks by horizontal row thickness inside [run.x0..run.x1]
    const runW = run.x1 - run.x0 + 1;
    let bodyTopSY = minSY;
    let bodyBotSY = maxSY;
    if (runW >= 3 && maxSY - minSY >= 6) {
      const bodyThreshold = Math.max(2, Math.ceil(runW * 0.52));
      let foundBodyTop = -1;
      let foundBodyBot = -1;
      for (let sy = minSY; sy <= maxSY; sy++) {
        let rowHits = 0;
        for (let sx = run.x0; sx <= run.x1; sx++) {
          if (distBg((sy * sW + sx) * 4) >= 32) rowHits++;
        }
        // Hollow candle walls have 2 outer pixels spanning runW
        const spanWall =
          distBg((sy * sW + run.x0) * 4) >= 32 &&
          distBg((sy * sW + run.x1) * 4) >= 32;
        if (rowHits >= bodyThreshold || (runW >= 4 && spanWall)) {
          if (foundBodyTop === -1) foundBodyTop = sy;
          foundBodyBot = sy;
        }
      }
      if (foundBodyTop !== -1 && foundBodyBot !== -1 && foundBodyBot >= foundBodyTop) {
        bodyTopSY = foundBodyTop;
        bodyBotSY = foundBodyBot;
      }
    }

    const centerSX = (run.x0 + run.x1) / 2;
    const polarity: 'bullish' | 'bearish' | 'neutral' =
      bull > bear * 1.2 ? 'bullish' : bear > bull * 1.2 ? 'bearish' : 'neutral';

    candles.push({
      index: candles.length,
      x: toNX(centerSX),
      width: Math.max(2, toNX(run.x1) - toNX(run.x0)),
      highY: toNY(minSY),
      lowY: toNY(maxSY),
      bodyTopY: toNY(bodyTopSY),
      bodyBottomY: toNY(bodyBotSY),
      polarity,
    });
  }

  // Filter trailing isolated noise specks near rightX if detached from main candle series
  while (candles.length >= 4) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];
    const typicalGap = Math.max(12, (prev.x - prev2.x) * 4.2);
    if (
      last.x - prev.x > typicalGap &&
      last.lowY - last.highY < 14
    ) {
      candles.pop();
    } else {
      break;
    }
  }

  // 9. Compute Candle Envelope, Major Swing Pivots (`H1..Hm`, `L1..Lm`), and 3-Candle FVGs (`G1..Gk`)
  let candleEnvelope: DetectedCandleEnvelope | undefined;
  const detectedPivots: DetectedPivotAnchor[] = [];
  const detectedFvgCandidates: DetectedFvgCandidate[] = [];

  if (candles.length >= 3) {
    let minHighY = 1000;
    let maxLowY = 0;
    for (const c of candles) {
      if (c.highY < minHighY) minHighY = c.highY;
      if (c.lowY > maxLowY) maxLowY = c.lowY;
    }
    const lastC = candles[candles.length - 1];
    const approxLastCloseY =
      verifiedBidAskLineY ??
      liveBadgeY ??
      (lastC.polarity === 'bullish'
        ? lastC.bodyTopY
        : lastC.polarity === 'bearish'
        ? lastC.bodyBottomY
        : (lastC.bodyTopY + lastC.bodyBottomY) / 2);

    candleEnvelope = {
      candleCount: candles.length,
      firstCandleX: candles[0].x,
      lastCandleX: lastC.x,
      lastCandleCloseY: Math.round(approxLastCloseY * 10) / 10,
      minHighY,
      maxLowY,
    };

    // Extract prominent local Swing Highs and Swing Lows
    const win = clamp(Math.round(candles.length / 18), 2, 6);
    const rawHighPivots: Array<{ c: DetectedCandleBar; prominence: number }> = [];
    const rawLowPivots: Array<{ c: DetectedCandleBar; prominence: number }> = [];

    for (let i = 0; i < candles.length; i++) {
      const cur = candles[i];
      const i0 = Math.max(0, i - win);
      const i1 = Math.min(candles.length - 1, i + win);
      let isHigh = true;
      let isLow = true;
      let localMaxLow = cur.lowY;
      let localMinHigh = cur.highY;

      for (let j = i0; j <= i1; j++) {
        if (j === i) continue;
        if (candles[j].highY < cur.highY - 0.4) isHigh = false;
        if (candles[j].lowY > cur.lowY + 0.4) isLow = false;
        if (candles[j].lowY > localMaxLow) localMaxLow = candles[j].lowY;
        if (candles[j].highY < localMinHigh) localMinHigh = candles[j].highY;
      }

      if (isHigh && localMaxLow - cur.highY >= 12) {
        rawHighPivots.push({ c: cur, prominence: localMaxLow - cur.highY });
      }
      if (isLow && cur.lowY - localMinHigh >= 12) {
        rawLowPivots.push({ c: cur, prominence: cur.lowY - localMinHigh });
      }
    }

    // Keep top 8 swing highs & top 8 swing lows ordered left-to-right
    const selectedHighs = rawHighPivots
      .sort((a, b) => b.prominence - a.prominence)
      .slice(0, 8)
      .sort((a, b) => a.c.x - b.c.x);
    const selectedLows = rawLowPivots
      .sort((a, b) => b.prominence - a.prominence)
      .slice(0, 8)
      .sort((a, b) => a.c.x - b.c.x);

    selectedHighs.forEach((item, idx) => {
      detectedPivots.push({
        id: `H${idx + 1}`,
        kind: 'high',
        x: item.c.x,
        y: item.c.highY,
        candleIndex: item.c.index,
      });
    });
    selectedLows.forEach((item, idx) => {
      detectedPivots.push({
        id: `L${idx + 1}`,
        kind: 'low',
        x: item.c.x,
        y: item.c.lowY,
        candleIndex: item.c.index,
      });
    });

    // Extract physical 3-candle Fair Value Gaps (unclosed wick-to-wick imbalances)
    const minFvgHeight = Math.max(4.5, (maxLowY - minHighY) * 0.012);
    const rawGaps: Array<Omit<DetectedFvgCandidate, 'id'> & { height: number }> = [];

    for (let i = 1; i < candles.length - 1; i++) {
      const cPrev = candles[i - 1];
      const cMid = candles[i];
      const cNext = candles[i + 1];
      // Prevent matching across huge missing-candle gaps
      if (cNext.x - cPrev.x > 95) continue;

      // Bullish FVG: Candle i+1 low wick stays strictly ABOVE (smaller Y) Candle i-1 high wick
      if (cPrev.highY - cNext.lowY >= minFvgHeight) {
        const gapTopY = cNext.lowY;
        const gapBotY = cPrev.highY;
        let mitigatedEndX: number | undefined;
        const midGapY = (gapTopY + gapBotY) / 2;
        for (let k = i + 2; k < candles.length; k++) {
          if (candles[k].lowY >= midGapY) {
            mitigatedEndX = candles[k].x;
            break;
          }
        }
        rawGaps.push({
          tone: 'bullish',
          startX: cMid.x,
          topY: gapTopY,
          bottomY: gapBotY,
          mitigatedEndX,
          height: gapBotY - gapTopY,
        });
      }

      // Bearish FVG: Candle i+1 high wick stays strictly BELOW (larger Y) Candle i-1 low wick
      if (cNext.highY - cPrev.lowY >= minFvgHeight) {
        const gapTopY = cPrev.lowY;
        const gapBotY = cNext.highY;
        let mitigatedEndX: number | undefined;
        const midGapY = (gapTopY + gapBotY) / 2;
        for (let k = i + 2; k < candles.length; k++) {
          if (candles[k].highY <= midGapY) {
            mitigatedEndX = candles[k].x;
            break;
          }
        }
        rawGaps.push({
          tone: 'bearish',
          startX: cMid.x,
          topY: gapTopY,
          bottomY: gapBotY,
          mitigatedEndX,
          height: gapBotY - gapTopY,
        });
      }
    }

    // Prioritize unmitigated & prominent recent FVGs (up to 10)
    rawGaps
      .sort((a, b) => {
        const aUnmit = a.mitigatedEndX ? 0 : 1;
        const bUnmit = b.mitigatedEndX ? 0 : 1;
        if (aUnmit !== bUnmit) return bUnmit - aUnmit;
        return b.height - a.height;
      })
      .slice(0, 10)
      .sort((a, b) => a.startX - b.startX)
      .forEach((g, idx) => {
        detectedFvgCandidates.push({
          id: `G${idx + 1}`,
          tone: g.tone,
          startX: g.startX,
          topY: g.topY,
          bottomY: g.bottomY,
          mitigatedEndX: g.mitigatedEndX,
        });
      });
  }

  // 10. Helper Methods for Exact Wick, Origin-Candle, and Breakout-Candle Snapping
  const snapToCandleWick = (
    nx: number,
    ny: number,
    mode: 'high' | 'low' | 'nearest',
    radiusNX = 52,
    radiusNY = 95
  ): { x: number; y: number; candleIndex: number } | null => {
    if (candles.length === 0) return null;

    let best: DetectedCandleBar | null = null;
    let bestY = ny;
    let bestScore = mode === 'high' ? Infinity : -Infinity;

    for (const c of candles) {
      const dx = Math.abs(c.x - nx);
      if (dx > radiusNX) continue;

      if (mode === 'high') {
        const dy = Math.abs(c.highY - ny);
        if (dy <= radiusNY) {
          // Strongly favor true local high wick tip near target (nx, ny)
          const score = c.highY + dx * 0.36 + dy * 0.22;
          if (score < bestScore) {
            bestScore = score;
            best = c;
            bestY = c.highY;
          }
        }
      } else if (mode === 'low') {
        const dy = Math.abs(c.lowY - ny);
        if (dy <= radiusNY) {
          const score = c.lowY - dx * 0.36 - dy * 0.22;
          if (score > bestScore) {
            bestScore = score;
            best = c;
            bestY = c.lowY;
          }
        }
      } else {
        const clampedY = clamp(ny, c.highY, c.lowY);
        const dist = Math.hypot(dx, clampedY - ny);
        if (-dist > bestScore) {
          bestScore = -dist;
          best = c;
          bestY = clampedY;
        }
      }
    }

    if (!best) return null;
    return { x: best.x, y: bestY, candleIndex: best.index };
  };

  /**
   * Finds the physical origin candle for a Supply / Demand / Order Block / S&R zone
   * so zones NEVER start in empty background air away from real price action.
   */
  const findOriginCandleForBand = (
    prefStartX: number,
    bandTopY: number,
    bandBotY: number,
    roleTone: 'bullish' | 'bearish' | 'neutral',
    isOrderBlock: boolean
  ): DetectedCandleBar | null => {
    if (candles.length === 0) return null;
    const midY = (bandTopY + bandBotY) / 2;
    const bandHalfH = Math.max(8, (bandBotY - bandTopY) / 2);
    const tolY = Math.max(18, bandHalfH * 1.35);

    let bestCandle: DetectedCandleBar | null = null;
    let bestCost = Infinity;

    // Exclude the right-most 2 forming candles as zone origins if older candles exist
    const maxIdx = candles.length > 5 ? candles.length - 2 : candles.length - 1;

    for (let i = 0; i <= maxIdx; i++) {
      const c = candles[i];
      // Does candle [highY..lowY] intersect or touch [bandTopY - tolY .. bandBotY + tolY]?
      const vertDist =
        c.lowY < bandTopY
          ? bandTopY - c.lowY
          : c.highY > bandBotY
          ? c.highY - bandBotY
          : 0;
      if (vertDist > tolY) continue;

      const dx = Math.abs(c.x - prefStartX);
      // Favor candles whose high wick (bearish supply/OB) or low wick (bullish demand/OB) anchors the band edge
      const edgeDist =
        roleTone === 'bearish'
          ? Math.abs(c.highY - bandTopY)
          : roleTone === 'bullish'
          ? Math.abs(c.lowY - bandBotY)
          : Math.min(Math.abs(c.highY - midY), Math.abs(c.lowY - midY));

      const obBonus =
        isOrderBlock &&
        ((roleTone === 'bullish' && c.polarity === 'bearish') ||
          (roleTone === 'bearish' && c.polarity === 'bullish'))
          ? -8
          : 0;

      const cost = dx * 0.65 + vertDist * 2.4 + edgeDist * 0.75 + obBonus;
      if (cost < bestCost) {
        bestCost = cost;
        bestCandle = c;
      }
    }

    return bestCandle;
  };

  /**
   * Scans candles strictly to the right of `originX` to locate the exact first candle
   * that broke through `levelY` (for BOS / CHoCH / Liquidity Sweep horizontal rays).
   */
  const findBreakoutCandleX = (
    originX: number,
    levelY: number,
    tone: 'bullish' | 'bearish'
  ): number | null => {
    for (const c of candles) {
      if (c.x <= originX + 10) continue;
      if (tone === 'bullish' && c.highY <= levelY - 1.5) {
        return c.x;
      }
      if (tone === 'bearish' && c.lowY >= levelY + 1.5) {
        return c.x;
      }
    }
    return null;
  };

  // Check bottom-left clutter for export stamp placement
  let blHits = 0;
  for (const c of candles) {
    if (c.x <= leftX + 240 && c.lowY >= bottomY - 46) {
      blHits++;
    }
  }
  const stampAnchor: 'bottom-left' | 'top-right' =
    blHits <= 2 ? 'bottom-left' : 'top-right';

  return {
    isLightBg,
    isPortrait,
    detectedPlotBox: { leftX, rightX, topY, bottomY },
    subPaneCount: subPaneDividerYs.length,
    subPaneDividerYs,
    detectedAxisTicks,
    liveBadgeY,
    verifiedBidAskLineY,
    candles,
    detectedPivots,
    detectedFvgCandidates,
    candleEnvelope,
    stampAnchor,
    snapToCandleWick,
    findOriginCandleForBand,
    findBreakoutCandleX,
  };
}

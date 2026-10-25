import type {
  DetectedPlotBounds,
  TradingSignalResponse,
  VisionEnhancementPayload,
} from '@/lib/trading-data';
import { renderMarkedChartToCanvas } from '@/lib/chart-markup';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode chart image'));
    img.src = src;
  });
}

export interface SubPaneScanResult {
  detectedPlotBox: DetectedPlotBounds;
  subPaneCount: number;
  subPaneDividerYs: number[];
  isLightBg: boolean;
}

/**
 * Deterministic Pre-AI Pixel Scan:
 * - Detects background luminance (dark vs light theme)
 * - Detects vertical Y-axis divider line (rightX)
 * - Detects top toolbar border (topY)
 * - Detects horizontal sub-pane dividers (RSI / MACD / Volume / Stochastic stacked panes)
 *   so main candlestick plotBox.bottomY stops strictly above the first indicator sub-pane!
 */
export function scanChartSubPanesAndBounds(
  img: HTMLImageElement
): SubPaneScanResult | null {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return null;

  const maxSampleDim = 680;
  const scale = Math.min(1, maxSampleDim / Math.max(natW, natH));
  const sW = Math.max(80, Math.round(natW * scale));
  const sH = Math.max(80, Math.round(natH * scale));

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
  const toNX = (sx: number) => Math.round((sx / Math.max(1, sW - 1)) * 1000);
  const toNY = (sy: number) => Math.round((sy / Math.max(1, sH - 1)) * 1000);

  // 1. Sample upper-middle candlestick region (Y=180..480) to get clean main chart background color
  const rSamples: number[] = [];
  const gSamples: number[] = [];
  const bSamples: number[] = [];
  for (let gx = 0; gx < 18; gx++) {
    const sx = toSX(140 + gx * 30);
    for (let gy = 0; gy < 16; gy++) {
      const sy = toSY(180 + gy * 18);
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

  // 2. Detect leftX (optional left drawing toolbar on TradingView desktop)
  let leftX = 18;
  const vScanY0 = toSY(200);
  const vScanY1 = toSY(520);
  const vSpan = Math.max(1, vScanY1 - vScanY0 + 1);
  for (let sx = toSX(24); sx <= toSX(120); sx++) {
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
        if (stepDiff <= 14) uniform++;
      }
    }
    if (nonBg / vSpan >= 0.8 && uniform / Math.max(1, vSpan - 1) >= 0.78) {
      // Confirm right of this vertical line matches main chart background
      const checkSX = Math.min(sW - 1, sx + Math.max(4, Math.round(sW * 0.02)));
      let rightBgMatches = 0;
      for (let sy = vScanY0; sy <= vScanY1; sy += 3) {
        if (distBg((sy * sW + checkSX) * 4) <= 28) rightBgMatches++;
      }
      if (rightBgMatches / Math.max(1, Math.ceil(vSpan / 3)) >= 0.65) {
        leftX = clamp(toNX(sx) + 2, 12, 130);
      }
    }
  }

  // 3. Detect rightX (vertical Y-axis divider line before price scale labels)
  let rightX = 875;
  let foundAxisBorderSX = -1;
  for (let sx = toSX(720); sx <= toSX(952); sx++) {
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
        if (stepDiff <= 15) uniform++;
      }
    }
    if (nonBg / vSpan >= 0.78 && uniform / Math.max(1, vSpan - 1) >= 0.76) {
      const checkX0 = Math.min(sW - 1, sx + Math.max(3, Math.round(sW * 0.015)));
      const checkX1 = Math.min(sW - 1, sx + Math.max(8, Math.round(sW * 0.11)));
      if (checkX1 > checkX0) {
        let rightNonBg = 0;
        let rightTotal = 0;
        for (let rx = checkX0; rx <= checkX1; rx += 2) {
          for (let ry = vScanY0; ry <= vScanY1; ry += 3) {
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
    let textStartSX = -1;
    for (let sx = toSX(965); sx >= toSX(785); sx--) {
      let highContrast = 0;
      for (let sy = vScanY0; sy <= vScanY1; sy += 2) {
        if (distBg((sy * sW + sx) * 4) > 85) highContrast++;
      }
      const density = highContrast / Math.max(1, Math.floor(vSpan / 2));
      if (density >= 0.035 && density <= 0.38) {
        textStartSX = sx;
      }
    }
    if (textStartSX !== -1) {
      rightX = clamp(toNX(textStartSX) - 10, 740, 945);
    }
  }

  // 4. Detect topY (horizontal border below mobile OS bar + TradingView/MT5 top toolbar)
  let topY = 52;
  const rowX0 = toSX(leftX + 35);
  const rowX1 = toSX(rightX - 16);
  const rowSpanX = Math.max(1, rowX1 - rowX0 + 1);

  for (let sy = toSY(18); sy <= toSY(220); sy++) {
    let nonBg = 0;
    let uniform = 0;
    for (let sx = rowX0; sx <= rowX1; sx++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 16) nonBg++;
      if (sx < rowX1) {
        const idxNext = (sy * sW + sx + 1) * 4;
        const stepDiff =
          Math.abs(data[idx] - data[idxNext]) +
          Math.abs(data[idx + 1] - data[idxNext + 1]) +
          Math.abs(data[idx + 2] - data[idxNext + 2]);
        if (stepDiff <= 14) uniform++;
      }
    }
    if (nonBg / rowSpanX >= 0.78 && uniform / Math.max(1, rowSpanX - 1) >= 0.76) {
      const belowSY = Math.min(sH - 1, sy + Math.max(4, Math.round(sH * 0.015)));
      let belowBgMatch = 0;
      for (let sx = rowX0; sx <= rowX1; sx += 3) {
        if (distBg((belowSY * sW + sx) * 4) <= 28) belowBgMatch++;
      }
      if (belowBgMatch / Math.max(1, Math.ceil(rowSpanX / 3)) >= 0.65) {
        topY = clamp(toNY(sy) + 2, 16, 225);
      }
    }
  }

  // 5. Scan full lower range (Y=450..962) for ALL solid horizontal pane dividers:
  //    - Divider between Main Candlestick Chart & Indicator Sub-Pane 1 (RSI / MACD / Stoch / Vol)
  //    - Divider between Sub-Pane 1 & Sub-Pane 2
  //    - Bottom Time-Axis / OS Navigation border
  const rawDividerSYs: number[] = [];
  for (let sy = toSY(455); sy <= toSY(962); sy++) {
    let nonBg = 0;
    let uniform = 0;
    let coloredChroma = 0;
    for (let sx = rowX0; sx <= rowX1; sx++) {
      const idx = (sy * sW + sx) * 4;
      if (distBg(idx) > 15) nonBg++;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const chr = Math.max(r, g, b) - Math.min(r, g, b);
      if (chr >= 24) coloredChroma++;

      if (sx < rowX1) {
        const idxNext = (sy * sW + sx + 1) * 4;
        const stepDiff =
          Math.abs(r - data[idxNext]) +
          Math.abs(g - data[idxNext + 1]) +
          Math.abs(b - data[idxNext + 2]);
        if (stepDiff <= 12) uniform++;
      }
    }

    // Pane dividers in TradingView / MT4 / MT5 / cTrader are low-chroma neutral borders (not colored Bid/Ask lines!)
    const nonBgFrac = nonBg / rowSpanX;
    const uniformFrac = uniform / Math.max(1, rowSpanX - 1);
    const chromaFrac = coloredChroma / rowSpanX;

    if (nonBgFrac >= 0.82 && uniformFrac >= 0.82 && chromaFrac <= 0.25) {
      // Verify chart background immediately above this divider (excludes solid bottom toolbars)
      const aboveSY = Math.max(0, sy - Math.max(4, Math.round(sH * 0.015)));
      let aboveBgMatch = 0;
      for (let sx = rowX0; sx <= rowX1; sx += 3) {
        if (distBg((aboveSY * sW + sx) * 4) <= 30) aboveBgMatch++;
      }
      if (aboveBgMatch / Math.max(1, Math.ceil(rowSpanX / 3)) >= 0.6) {
        rawDividerSYs.push(sy);
      }
    }
  }

  // Merge adjacent 1-3px divider rows into distinct normalized Y positions
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
        // Must leave at least 310 normalized height for main price pane
        if (ny - topY >= 310) {
          mergedDividersNY.push(ny);
        }
        grpStart = i;
      }
    }
  }

  let bottomY = 885;
  let subPaneDividerYs: number[] = [];

  if (mergedDividersNY.length >= 2) {
    // Multiple horizontal dividers -> first divider is the exact bottom of the main candlestick pane,
    // and the space below it contains 1 or more indicator sub-panes (RSI / MACD / Volume) before the time axis!
    const firstDivider = mergedDividersNY[0];
    const lastDivider = mergedDividersNY[mergedDividersNY.length - 1];
    if (lastDivider - firstDivider >= 65) {
      bottomY = clamp(firstDivider - 2, 460, 955);
      subPaneDividerYs = mergedDividersNY.slice(0, -1);
    } else {
      bottomY = clamp(lastDivider - 2, 520, 962);
    }
  } else if (mergedDividersNY.length === 1) {
    const onlyDivider = mergedDividersNY[0];
    bottomY = clamp(onlyDivider - 2, 470, 962);
    // Check if there is still a large chart-background indicator pane below this single divider (e.g. borderless bottom time axis)
    if (onlyDivider <= 790) {
      const probeY0 = toSY(onlyDivider + 22);
      const probeY1 = toSY(Math.min(930, onlyDivider + 125));
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
        const bgFrac = bgLike / Math.max(1, total);
        const inkFrac = inkLike / Math.max(1, total);
        if (bgFrac >= 0.48 && inkFrac >= 0.015 && inkFrac <= 0.42) {
          subPaneDividerYs = [onlyDivider];
        }
      }
    }
  }

  return {
    detectedPlotBox: {
      leftX,
      rightX,
      topY,
      bottomY,
    },
    subPaneCount: subPaneDividerYs.length,
    subPaneDividerYs,
    isLightBg,
  };
}

/**
 * Generates an AI-only copy of the screenshot stamped with a subtle, razor-sharp
 * 0..1000 coordinate ruler grid (every 100 units, plus minor 50-unit ticks on Y)
 * and marks any detected indicator sub-pane boundary so Gemini never confuses
 * RSI/MACD sub-panes with candlestick price wicks.
 */
function buildRulerGridDataUrl(
  img: HTMLImageElement,
  scan: SubPaneScanResult
): string | undefined {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return undefined;

  const maxDim = 1080;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const W = Math.max(320, Math.round(natW * scale));
  const H = Math.max(240, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.drawImage(img, 0, 0, W, H);

  const sx = (nx: number) => (nx / 1000) * W;
  const sy = (ny: number) => (ny / 1000) * H;
  const unit = Math.max(1, Math.min(W, H) / 860);
  const light = scan.isLightBg;

  const majorStroke = light ? 'rgba(2, 132, 199, 0.28)' : 'rgba(56, 189, 248, 0.28)';
  const minorStroke = light ? 'rgba(2, 132, 199, 0.14)' : 'rgba(56, 189, 248, 0.14)';
  const badgeBg = light ? 'rgba(15, 23, 42, 0.78)' : 'rgba(2, 6, 23, 0.82)';
  const badgeFg = '#38BDF8';

  ctx.save();
  ctx.font = `700 ${Math.max(9, Math.round(10 * unit))}px ui-monospace, SFMono-Regular, monospace`;

  // Vertical X coordinate lines (100..900)
  for (let nx = 100; nx <= 900; nx += 100) {
    const x = Math.round(sx(nx)) + 0.5;
    ctx.strokeStyle = majorStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();

    const lbl = `X${nx}`;
    const tw = ctx.measureText(lbl).width;
    const bx = clamp(x - tw / 2 - 3, 2, W - tw - 8);
    const by = clamp(sy(scan.detectedPlotBox.topY) + 3, 2, H - 18);
    ctx.setLineDash([]);
    ctx.fillStyle = badgeBg;
    ctx.fillRect(bx, by, tw + 6, 13 * unit);
    ctx.fillStyle = badgeFg;
    ctx.fillText(lbl, bx + 3, by + 10 * unit);
  }

  // Horizontal Y coordinate lines (50..950)
  for (let ny = 50; ny <= 950; ny += 50) {
    const y = Math.round(sy(ny)) + 0.5;
    const isMajor = ny % 100 === 0;
    ctx.strokeStyle = isMajor ? majorStroke : minorStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash(isMajor ? [4, 4] : [2, 5]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();

    if (isMajor) {
      const lbl = `Y${ny}`;
      const tw = ctx.measureText(lbl).width;
      const bx = clamp(sx(scan.detectedPlotBox.leftX) + 4, 2, W - tw - 10);
      const by = clamp(y - 6.5 * unit, 2, H - 15 * unit);
      ctx.setLineDash([]);
      ctx.fillStyle = badgeBg;
      ctx.fillRect(bx, by, tw + 6, 13 * unit);
      ctx.fillStyle = badgeFg;
      ctx.fillText(lbl, bx + 3, by + 10 * unit);
    }
  }

  // Highlight main candlestick plotBox border + shade out sub-pane region if present
  const pb = scan.detectedPlotBox;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    sx(pb.leftX),
    sy(pb.topY),
    sx(pb.rightX - pb.leftX),
    sy(pb.bottomY - pb.topY)
  );

  if (scan.subPaneCount > 0) {
    const subTopPx = sy(pb.bottomY);
    ctx.fillStyle = light ? 'rgba(244, 63, 94, 0.08)' : 'rgba(244, 63, 94, 0.12)';
    ctx.fillRect(0, subTopPx, W, H - subTopPx);

    ctx.strokeStyle = 'rgba(251, 113, 133, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, subTopPx);
    ctx.lineTo(W, subTopPx);
    ctx.stroke();

    const warn = `INDICATOR SUB-PANE BELOW Y=${pb.bottomY} (DO NOT PLACE PRICE ZONES HERE)`;
    const wtw = ctx.measureText(warn).width;
    const wx = clamp(sx(pb.leftX) + 44, 4, Math.max(4, W - wtw - 12));
    const wy = clamp(subTopPx + 4, 4, H - 16 * unit);
    ctx.fillStyle = 'rgba(136, 19, 55, 0.9)';
    ctx.fillRect(wx, wy, Math.min(W - 8, wtw + 10), 14 * unit);
    ctx.fillStyle = '#FFE4E6';
    ctx.fillText(warn, wx + 5, wy + 10.5 * unit);
  }

  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * Generates a 2x magnified high-clarity crop of the right-most active candles
 * AND the entire Y-axis price scale, stamped with exact full-image Y-ruler ticks
 * so tiny mobile Y-axis digits and live Bid/Ask badges read with crystal clarity.
 */
function buildRightEdgeZoomDataUrl(
  img: HTMLImageElement,
  scan: SubPaneScanResult
): string | undefined {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return undefined;

  const pb = scan.detectedPlotBox;
  const cropStartNX = clamp(pb.rightX - 310, 480, 760);
  const cropEndNX = 1000;
  const cropStartNY = clamp(pb.topY - 12, 0, 220);
  const cropEndNY = clamp(pb.bottomY + 14, 520, 1000);

  const srcX = Math.round((cropStartNX / 1000) * natW);
  const srcY = Math.round((cropStartNY / 1000) * natH);
  const srcW = Math.max(60, Math.round(((cropEndNX - cropStartNX) / 1000) * natW));
  const srcH = Math.max(80, Math.round(((cropEndNY - cropStartNY) / 1000) * natH));

  // Upscale 2x (clamped to crisp max 1150px height so payload stays compact & fast on mobile)
  const targetScale = clamp(960 / Math.max(srcW, srcH), 1.35, 2.25);
  const outW = Math.round(srcW * targetScale);
  const outH = Math.round(srcH * targetScale);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

  // Stamp full-image Y-ruler markers along the left edge of the zoomed crop so Y values map 1:1
  ctx.save();
  ctx.font = '700 11px ui-monospace, SFMono-Regular, monospace';
  const spanNY = Math.max(1, cropEndNY - cropStartNY);
  for (let ny = Math.ceil(cropStartNY / 50) * 50; ny <= cropEndNY - 10; ny += 50) {
    const py = ((ny - cropStartNY) / spanNY) * outH;
    ctx.strokeStyle =
      ny % 100 === 0 ? 'rgba(56, 189, 248, 0.34)' : 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(outW, py);
    ctx.stroke();

    if (ny % 100 === 0) {
      const tag = `Y=${ny}`;
      const tw = ctx.measureText(tag).width;
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.84)';
      ctx.fillRect(3, clamp(py - 8, 2, outH - 16), tw + 6, 14);
      ctx.fillStyle = '#38BDF8';
      ctx.fillText(tag, 6, clamp(py + 3, 12, outH - 4));
    }
  }
  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.86);
}

/**
 * Runs the complete Pre-AI Vision Enhancer on the client before calling `/api/analyze`.
 * Wrapped in defensive error handling so if anything fails on an older WebView,
 * it returns `undefined` and `/api/analyze` runs seamlessly on the raw screenshot.
 */
export async function buildVisionEnhancementPayload(
  imageDataUrl: string
): Promise<VisionEnhancementPayload | undefined> {
  try {
    const img = await loadImageElement(imageDataUrl);
    const scan = scanChartSubPanesAndBounds(img);
    if (!scan) return undefined;

    const rulerGridDataUrl = buildRulerGridDataUrl(img, scan);
    const rightEdgeZoomDataUrl = buildRightEdgeZoomDataUrl(img, scan);

    return {
      rulerGridDataUrl,
      rightEdgeZoomDataUrl,
      detectedPlotBox: scan.detectedPlotBox,
      subPaneCount: scan.subPaneCount,
      subPaneDividerYs: scan.subPaneDividerYs,
      isLightBg: scan.isLightBg,
    };
  } catch {
    return undefined;
  }
}

/**
 * Renders Draft 1's actual drawn markup (`renderMarkedChartToCanvas`) onto a compact
 * offscreen JPEG so Pass 2 ("Visual Self-Check") can visually inspect every zone,
 * FVG, BOS line, Entry, Stop Loss, and TP line on top of the candlesticks.
 */
export async function renderDraftMarkupPreviewDataUrl(
  imageDataUrl: string,
  draftSignal: TradingSignalResponse
): Promise<string | undefined> {
  try {
    const img = await loadImageElement(imageDataUrl);
    const tempCanvas = document.createElement('canvas');
    renderMarkedChartToCanvas(tempCanvas, img, draftSignal, {
      layerFilter: 'all',
      subLayer: 'all',
      includeStamp: false,
    });

    const maxDim = 1080;
    const scale = Math.min(1, maxDim / Math.max(tempCanvas.width, tempCanvas.height));
    if (scale < 0.99) {
      const scaled = document.createElement('canvas');
      scaled.width = Math.max(320, Math.round(tempCanvas.width * scale));
      scaled.height = Math.max(240, Math.round(tempCanvas.height * scale));
      const sCtx = scaled.getContext('2d');
      if (sCtx) {
        sCtx.imageSmoothingEnabled = true;
        sCtx.imageSmoothingQuality = 'high';
        sCtx.drawImage(tempCanvas, 0, 0, scaled.width, scaled.height);
        return scaled.toDataURL('image/jpeg', 0.84);
      }
    }

    return tempCanvas.toDataURL('image/jpeg', 0.84);
  } catch {
    return undefined;
  }
}

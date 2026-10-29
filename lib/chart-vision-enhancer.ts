import type {
  DetectedPlotBounds,
  TradingSignalResponse,
  VisionEnhancementPayload,
} from '@/lib/trading-data';
import {
  type ChartOpticalGeometry,
  scanChartOpticalGeometry,
} from '@/lib/chart-optical-scanner';
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

export function scanChartSubPanesAndBounds(
  img: HTMLImageElement
): SubPaneScanResult | null {
  const geo = scanChartOpticalGeometry(img);
  if (!geo) return null;
  return {
    detectedPlotBox: geo.detectedPlotBox,
    subPaneCount: geo.subPaneCount,
    subPaneDividerYs: geo.subPaneDividerYs,
    isLightBg: geo.isLightBg,
  };
}

/**
 * Generates an AI-only copy of the screenshot stamped with:
 * 1. Exact plotBox border + shaded top/bottom chrome & indicator sub-pane exclusion zones.
 * 2. Crisp 0..1000 coordinate ruler grid strictly inside the plotBox.
 * 3. Pre-detected swing wick pivot anchors (`H1..H8` on high wicks, `L1..L8` on low wicks)
 *    and 3-candle Fair Value Gap anchors (`G1..Gk`) so Gemini 3.1 can lock directly to
 *    physical candle structures without guessing X/Y coordinates.
 */
function buildRulerGridDataUrl(
  img: HTMLImageElement,
  scan: ChartOpticalGeometry
): string | undefined {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return undefined;

  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const W = Math.max(360, Math.round(natW * scale));
  const H = Math.max(280, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);

  const sx = (nx: number) => (nx / 1000) * W;
  const sy = (ny: number) => (ny / 1000) * H;
  const unit = Math.max(1, Math.min(W, H) / 780);
  const light = scan.isLightBg;
  const pb = scan.detectedPlotBox;

  const majorStroke = light ? 'rgba(2, 132, 199, 0.26)' : 'rgba(56, 189, 248, 0.26)';
  const minorStroke = light ? 'rgba(2, 132, 199, 0.13)' : 'rgba(56, 189, 248, 0.13)';
  const badgeBg = light ? 'rgba(15, 23, 42, 0.82)' : 'rgba(2, 6, 23, 0.86)';
  const badgeFg = '#38BDF8';

  ctx.save();
  ctx.font = `700 ${Math.max(9, Math.round(9.8 * unit))}px ui-monospace, SFMono-Regular, monospace`;

  const plotLeftPx = sx(pb.leftX);
  const plotRightPx = sx(pb.rightX);
  const plotTopPx = sy(pb.topY);
  const plotBotPx = sy(pb.bottomY);

  // Vertical X coordinate lines strictly inside plotBox
  for (let nx = 100; nx <= 900; nx += 100) {
    if (nx < pb.leftX + 15 || nx > pb.rightX - 10) continue;
    const x = Math.round(sx(nx)) + 0.5;
    ctx.strokeStyle = majorStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, plotTopPx);
    ctx.lineTo(x, plotBotPx);
    ctx.stroke();

    const lbl = `X${nx}`;
    const tw = ctx.measureText(lbl).width;
    const bx = clamp(x - tw / 2 - 3, plotLeftPx + 2, plotRightPx - tw - 8);
    const by = clamp(plotTopPx + 3, 2, H - 18);
    ctx.setLineDash([]);
    ctx.fillStyle = badgeBg;
    ctx.fillRect(bx, by, tw + 6, 13 * unit);
    ctx.fillStyle = badgeFg;
    ctx.fillText(lbl, bx + 3, by + 10 * unit);
  }

  // Horizontal Y coordinate lines strictly inside plotBox
  for (let ny = 50; ny <= 950; ny += 50) {
    if (ny < pb.topY + 12 || ny > pb.bottomY - 12) continue;
    const y = Math.round(sy(ny)) + 0.5;
    const isMajor = ny % 100 === 0;
    ctx.strokeStyle = isMajor ? majorStroke : minorStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash(isMajor ? [4, 4] : [2, 5]);
    ctx.beginPath();
    ctx.moveTo(plotLeftPx, y);
    ctx.lineTo(plotRightPx, y);
    ctx.stroke();

    if (isMajor) {
      const lbl = `Y${ny}`;
      const tw = ctx.measureText(lbl).width;
      const bx = clamp(plotLeftPx + 4, 2, W - tw - 10);
      const by = clamp(y - 6.5 * unit, plotTopPx + 2, plotBotPx - 14 * unit);
      ctx.setLineDash([]);
      ctx.fillStyle = badgeBg;
      ctx.fillRect(bx, by, tw + 6, 13 * unit);
      ctx.fillStyle = badgeFg;
      ctx.fillText(lbl, bx + 3, by + 10 * unit);
    }
  }

  // Stamp pre-detected 3-candle FVG anchors (`G1..Gk`) lightly so Gemini can cite exact gapId
  ctx.setLineDash([]);
  ctx.font = `700 ${Math.max(8, Math.round(9 * unit))}px ui-monospace, SFMono-Regular, monospace`;
  for (const gap of scan.detectedFvgCandidates.slice(0, 8)) {
    const gx = sx(gap.startX);
    const gy = sy((gap.topY + gap.bottomY) / 2);
    const lbl = gap.id;
    const tw = ctx.measureText(lbl).width;
    const bx = clamp(gx + 3, plotLeftPx + 4, plotRightPx - tw - 8);
    const by = clamp(gy - 6 * unit, plotTopPx + 4, plotBotPx - 13 * unit);
    ctx.fillStyle = 'rgba(88, 28, 135, 0.85)';
    ctx.fillRect(bx, by, tw + 5, 11.5 * unit);
    ctx.fillStyle = '#F3E8FF';
    ctx.fillText(lbl, bx + 2.5, by + 8.8 * unit);
  }

  // Stamp pre-detected Swing Wick Pivot Anchors (`H1..H8` above high wicks, `L1..L8` below low wicks)
  for (const piv of scan.detectedPivots) {
    const px = sx(piv.x);
    const py = sy(piv.y);
    const isHigh = piv.kind === 'high';
    const lbl = piv.id;
    const tw = ctx.measureText(lbl).width;
    const bw = tw + 6;
    const bh = 12 * unit;
    const bx = clamp(px - bw / 2, plotLeftPx + 2, plotRightPx - bw - 2);
    const by = isHigh
      ? clamp(py - bh - 5 * unit, plotTopPx + 2, plotBotPx - bh - 2)
      : clamp(py + 5 * unit, plotTopPx + 2, plotBotPx - bh - 2);

    ctx.strokeStyle = isHigh ? '#34D399' : '#FB7185';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(px, py, 2.5 * unit, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = isHigh ? '#6EE7B7' : '#FDA4AF';
    ctx.fillText(lbl, bx + 3, by + 9.2 * unit);
  }

  // Frame main candlestick plotBox border & shade out excluded sub-panes / mobile bars
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.72)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    plotLeftPx,
    plotTopPx,
    plotRightPx - plotLeftPx,
    plotBotPx - plotTopPx
  );

  if (pb.bottomY < 965) {
    ctx.fillStyle = light ? 'rgba(244, 63, 94, 0.08)' : 'rgba(244, 63, 94, 0.13)';
    ctx.fillRect(0, plotBotPx, W, H - plotBotPx);

    if (scan.subPaneCount > 0) {
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, plotBotPx);
      ctx.lineTo(W, plotBotPx);
      ctx.stroke();

      const warn = `INDICATOR SUB-PANE BELOW Y=${Math.round(pb.bottomY)} (KEEP PRICE MARKUP ABOVE)`;
      const wtw = ctx.measureText(warn).width;
      const wx = clamp(plotLeftPx + 20, 4, Math.max(4, W - wtw - 12));
      const wy = clamp(plotBotPx + 4, 4, H - 16 * unit);
      ctx.fillStyle = 'rgba(136, 19, 55, 0.92)';
      ctx.fillRect(wx, wy, Math.min(W - 8, wtw + 10), 14 * unit);
      ctx.fillStyle = '#FFE4E6';
      ctx.fillText(warn, wx + 5, wy + 10.5 * unit);
    }
  }

  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.86);
}

/**
 * Generates a 2× magnified crop of the right-most active candles + full Y-axis price column,
 * stamping explicit `[T1]..[Tk]` pointer tags aligned to the exact pixel center of every
 * printed Y-axis number (plus `[LIVE]` on any colored/inverted live price badge).
 *
 * Gemini 3.1 simply reads the printed number next to `[T1]..[Tk]` — eliminating 100% of
 * AI Y-coordinate guessing error!
 */
function buildRightEdgeZoomDataUrl(
  img: HTMLImageElement,
  scan: ChartOpticalGeometry
): string | undefined {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return undefined;

  const pb = scan.detectedPlotBox;
  const candleMarginNX = scan.isPortrait ? 330 : 270;
  const cropStartNX = clamp(pb.rightX - candleMarginNX, 380, 760);
  const cropEndNX = 1000;
  const cropStartNY = clamp(pb.topY - 12, 0, 275);
  const cropEndNY = clamp(pb.bottomY + 12, 430, 1000);

  const srcX = Math.round((cropStartNX / 1000) * natW);
  const srcY = Math.round((cropStartNY / 1000) * natH);
  const srcW = Math.max(60, Math.round(((cropEndNX - cropStartNX) / 1000) * natW));
  const srcH = Math.max(80, Math.round(((cropEndNY - cropStartNY) / 1000) * natH));

  const targetScale = clamp(1220 / Math.max(srcW, srcH), 1.45, 2.5);
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

  const spanNX = Math.max(1, cropEndNX - cropStartNX);
  const spanNY = Math.max(1, cropEndNY - cropStartNY);
  const toCropX = (nx: number) => ((nx - cropStartNX) / spanNX) * outW;
  const toCropY = (ny: number) => ((ny - cropStartNY) / spanNY) * outH;
  const axisBorderCropX = clamp(toCropX(pb.rightX), 44, outW - 28);

  ctx.save();
  ctx.font = '700 11px ui-monospace, SFMono-Regular, monospace';

  // Secondary subtle full-image Y=100..900 lines on left side of crop
  for (let ny = Math.ceil(cropStartNY / 100) * 100; ny <= cropEndNY - 10; ny += 100) {
    const py = toCropY(ny);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(axisBorderCropX - 4, py);
    ctx.stroke();

    const tag = `Y${ny}`;
    const tw = ctx.measureText(tag).width;
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
    ctx.fillRect(3, clamp(py - 7, 2, outH - 15), tw + 6, 14);
    ctx.fillStyle = '#7DD3FC';
    ctx.fillText(tag, 6, clamp(py + 3.5, 12, outH - 4));
  }

  // Primary `[T1]..[Tk]` exact axis-label pointers sitting immediately left of `rightX`
  // pointing directly into each printed Y-axis price number!
  ctx.font = '700 11.5px ui-monospace, SFMono-Regular, monospace';
  for (const tick of scan.detectedAxisTicks) {
    if (tick.y < cropStartNY || tick.y > cropEndNY) continue;
    const py = toCropY(tick.y);
    const label = tick.id;
    const tw = ctx.measureText(label).width;
    const boxW = tw + 8;
    const boxH = 15;
    const boxX = clamp(axisBorderCropX - boxW - 8, 38, outW - boxW - 24);
    const boxY = clamp(py - boxH / 2, 2, outH - boxH - 2);

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Leader pointer line directly to the printed Y-axis label row
    ctx.beginPath();
    ctx.moveTo(boxX + boxW, py);
    ctx.lineTo(axisBorderCropX + 2, py);
    ctx.stroke();

    ctx.fillStyle = '#38BDF8';
    ctx.fillText(label, boxX + 4, boxY + 11.2);
  }

  // Stamp `[LIVE]` pointer if a colored/inverted live Bid/Ask pill badge exists on the axis
  if (
    scan.liveBadgeY !== null &&
    scan.liveBadgeY >= cropStartNY &&
    scan.liveBadgeY <= cropEndNY
  ) {
    const py = toCropY(scan.liveBadgeY);
    const label = 'LIVE';
    const tw = ctx.measureText(label).width;
    const boxW = tw + 8;
    const boxH = 15;
    const boxX = clamp(axisBorderCropX - boxW - 8, 38, outW - boxW - 24);
    const boxY = clamp(py - boxH / 2, 2, outH - boxH - 2);

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(6, 78, 59, 0.95)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#34D399';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.beginPath();
    ctx.moveTo(boxX + boxW, py);
    ctx.lineTo(axisBorderCropX + 2, py);
    ctx.stroke();

    ctx.fillStyle = '#A7F3D0';
    ctx.fillText(label, boxX + 4, boxY + 11.2);
  }

  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Runs the complete Pre-AI Optical Scanner & Calibration Stamper on the client
 * before calling `/api/analyze`.
 */
export async function buildVisionEnhancementPayload(
  imageDataUrl: string
): Promise<VisionEnhancementPayload | undefined> {
  try {
    const img = await loadImageElement(imageDataUrl);
    const scan = scanChartOpticalGeometry(img);
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
      detectedAxisTicks: scan.detectedAxisTicks,
      liveBadgeY: scan.liveBadgeY,
      detectedPivots: scan.detectedPivots,
      detectedFvgCandidates: scan.detectedFvgCandidates,
      candleEnvelope: scan.candleEnvelope,
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

    const maxDim = 1180;
    const scale = Math.min(1, maxDim / Math.max(tempCanvas.width, tempCanvas.height));
    if (scale < 0.99) {
      const scaled = document.createElement('canvas');
      scaled.width = Math.max(360, Math.round(tempCanvas.width * scale));
      scaled.height = Math.max(260, Math.round(tempCanvas.height * scale));
      const sCtx = scaled.getContext('2d');
      if (sCtx) {
        sCtx.imageSmoothingEnabled = true;
        sCtx.imageSmoothingQuality = 'high';
        sCtx.drawImage(tempCanvas, 0, 0, scaled.width, scaled.height);
        return scaled.toDataURL('image/jpeg', 0.86);
      }
    }

    return tempCanvas.toDataURL('image/jpeg', 0.86);
  } catch {
    return undefined;
  }
}

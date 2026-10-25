import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import type {
  AnalyzeStreamEvent,
  KeyPriceLevel,
  SignalType,
  TradingSignalResponse,
  VisionEnhancementPayload,
  VisionVerificationMeta,
  ZoneRole,
} from '@/lib/trading-data';
import { fetchHybridOhlcContext } from '@/lib/live-ohlc';
import {
  deriveExecutionCategory,
  normalizeKeyLevelRole,
  normalizeSignalType,
  parseNumPrice,
  sanitizeChartMarkup,
} from '@/lib/signal-sanitizer';

interface ModelCandidate {
  model: string;
  label: string;
  firstChunkTimeoutMs: number;
  stallTimeoutMs: number;
  thinkingConfig?: {
    thinkingLevel?: ThinkingLevel;
    thinkingBudget?: number;
  };
}

/**
 * Ordered for fastest real-time Step 1 chart verification + zero-hang failover,
 * with generous stallTimeoutMs so full left-to-right SMC & market-structure markup streams cleanly:
 * 1. gemini-3.8-flash with LOW thinking (fast primary reasoning; fails over immediately on 429/503 or timeout)
 * 2. gemini-3.1-flash-lite with native MINIMAL default (fastest first-token vision response & highest quota availability)
 * 3. gemini-flash-latest with thinkingBudget: 0
 */
const MODEL_CANDIDATES: ModelCandidate[] = [
  {
    model: 'gemini-3.8-flash',
    label: 'primary vision model',
    firstChunkTimeoutMs: 6500,
    stallTimeoutMs: 18000,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  },
  {
    model: 'gemini-3.1-flash-lite',
    label: 'high-speed vision model',
    firstChunkTimeoutMs: 11500,
    stallTimeoutMs: 18000,
  },
  {
    model: 'gemini-flash-latest',
    label: 'backup vision model',
    firstChunkTimeoutMs: 11500,
    stallTimeoutMs: 18000,
    thinkingConfig: { thinkingBudget: 0 },
  },
];

function isRetryableModelError(err: unknown): boolean {
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const upper = raw.toUpperCase();
  return (
    upper.includes('MODEL_TIMEOUT') ||
    upper.includes('ABORT') ||
    upper.includes('TIMEOUT') ||
    upper.includes('503') ||
    upper.includes('429') ||
    upper.includes('500') ||
    upper.includes('502') ||
    upper.includes('504') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('QUOTA') ||
    upper.includes('INTERNAL') ||
    upper.includes('FETCH FAILED') ||
    upper.includes('ENDED EARLY')
  );
}

/**
 * Unwraps nested JSON error payloads thrown by @google/genai into clean,
 * plain-English human sentences with zero raw JSON braces.
 */
function formatCleanErrorMessage(err: unknown): string {
  let raw = err instanceof Error ? err.message : String(err || '');

  for (let i = 0; i < 3; i++) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as {
          error?: { message?: string; code?: number; status?: string } | string;
          message?: string;
        };
        if (typeof parsed.error === 'object' && parsed.error?.message) {
          raw = parsed.error.message;
          continue;
        }
        if (typeof parsed.error === 'string') {
          raw = parsed.error;
          continue;
        }
        if (typeof parsed.message === 'string') {
          raw = parsed.message;
          continue;
        }
      } catch {
        break;
      }
    }
    break;
  }

  const upper = raw.toUpperCase();
  if (upper.includes('MODEL_TIMEOUT') || upper.includes('TIMEOUT')) {
    return 'AI chart verification timed out due to heavy server load. Please tap Retry Chart Scan.';
  }

  if (
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED')
  ) {
    return 'AI vision servers are experiencing temporary high demand right now. Tap Retry Chart Scan in a few seconds.';
  }

  if (
    upper.includes('429') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('QUOTA')
  ) {
    return 'Request rate limit reached due to high traffic. Please wait a few seconds and tap Retry Chart Scan.';
  }

  if (raw.trim().startsWith('{')) {
    return 'Temporary connection issue while analyzing the chart. Please tap Retry Chart Scan.';
  }

  return raw.trim() || 'Unable to complete chart analysis right now. Please retry.';
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Extracts standalone JSON objects from an arbitrary line or chunk fragment.
 * Isolates balanced `{ ... }` blocks safely so markdown fences or trailing text
 * never prevent Step 1 approval or subsequent steps from parsing.
 */
function parseJsonObjectsFromChunk(input: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const cleaned = input
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  if (!cleaned) return results;

  // Fast path: direct single-line JSON object
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const direct = JSON.parse(cleaned) as Record<string, unknown>;
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
        return [direct];
      }
    } catch {
      // Fall through to balanced brace scanner (e.g. multiple objects concatenated on one line)
    }
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let startIdx = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        startIdx = i;
      }
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const slice = cleaned.slice(startIdx, i + 1);
          try {
            const parsed = JSON.parse(slice) as Record<string, unknown>;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              results.push(parsed);
            }
          } catch {
            // Ignore malformed fragment
          }
          startIdx = -1;
        }
      }
    }
  }

  return results;
}

/**
 * Consumes streaming text buffer line-by-line AND flushes complete balanced JSON objects
 * on the active line even before `\n` arrives so Step 1 approval ticks immediately.
 */
function drainStreamBuffer(
  buffer: string,
  flushRemainder = false
): {
  objects: Record<string, unknown>[];
  remainder: string;
} {
  const objects: Record<string, unknown>[] = [];
  const lines = buffer.split('\n');
  const trailing = flushRemainder ? '' : (lines.pop() ?? '');

  for (const line of lines) {
    const extracted = parseJsonObjectsFromChunk(line);
    if (extracted.length > 0) {
      objects.push(...extracted);
    }
  }

  if (!flushRemainder && trailing.trim()) {
    const trimmedTrailing = trailing
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    if (trimmedTrailing.startsWith('{') && trimmedTrailing.endsWith('}')) {
      const earlyObjects = parseJsonObjectsFromChunk(trimmedTrailing);
      if (earlyObjects.length > 0) {
        objects.push(...earlyObjects);
        return { objects, remainder: '' };
      }
    }
  }

  return { objects, remainder: trailing };
}

/**
 * Pulls next item from async iterator with a strict millisecond timeout so a stalled
 * upstream connection never hangs Step 1 ("Chart Verification") indefinitely.
 */
async function nextChunkWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
  onTimeoutAbort: () => void
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeoutAbort();
          reject(new Error('MODEL_TIMEOUT: Upstream stream timed out waiting for chunk.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'Server Gemini API key is not configured.' },
      { status: 500 }
    );
  }

  let imageDataUrl = '';
  let selectedPair = 'EUR/USD';
  let selectedTimeframe = 'H1';
  let visionEnhancement: VisionEnhancementPayload | undefined;

  try {
    const body = await req.json();
    imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';
    selectedPair = body.pair || 'EUR/USD';
    selectedTimeframe = body.timeframe || 'H1';
    if (body.visionEnhancement && typeof body.visionEnhancement === 'object') {
      visionEnhancement = body.visionEnhancement as VisionEnhancementPayload;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  if (!imageDataUrl) {
    return NextResponse.json(
      { error: 'Please upload a valid chart screenshot to analyze.' },
      { status: 400 }
    );
  }

  const parseDataUrl = (url?: string): { mimeType: string; data: string } | null => {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return null;
    return { mimeType: m[1], data: m[2] };
  };

  const mainImagePart = parseDataUrl(imageDataUrl);
  if (!mainImagePart) {
    return NextResponse.json(
      { error: 'Unsupported image format. Upload a PNG, JPEG, or WebP screenshot.' },
      { status: 400 }
    );
  }

  const rulerImagePart = parseDataUrl(visionEnhancement?.rulerGridDataUrl);
  const rightZoomPart = parseDataUrl(visionEnhancement?.rightEdgeZoomDataUrl);
  const detectedPlotBox = visionEnhancement?.detectedPlotBox;
  const subPaneCount = Math.max(0, Number(visionEnhancement?.subPaneCount ?? 0));
  const hasSubPanes = subPaneCount > 0;

  const mimeType = mainImagePart.mimeType;
  const base64Data = mainImagePart.data;

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = `You are an institutional quantitative Smart Money Concepts (SMC) and price-action technical analyst for TraceFX Lens.
You MUST stream your real-time chart inspection as a sequence of standalone single-line JSON objects (NDJSON), one JSON object per line, with NO markdown code fences and NO prose outside the JSON objects.

STEP 1 — MANDATORY CHART APPROVAL GATEKEEPER (OUTPUT THIS FIRST):
Inspect the uploaded image first. Is it a genuine financial trading price chart (candlesticks, OHLC bars, Heikin Ashi, or price line chart)?
- If NO (e.g. a photo, meme, error dialog screenshot, wallet balance screen, text page, or unrecognizable blur), output ONLY this single JSON object and STOP immediately:
{"event":"approval","approved":false,"finding":"Explain clearly in 1 sentence what the image shows instead of a financial price chart and ask for a clear chart screenshot."}

- If YES (it IS a valid financial trading chart), you MUST perform a FULL LEFT-TO-RIGHT SCAN across the entire visible chart from the left-most candles to the right-most latest candle, outputting these 6 JSON objects sequentially in exact order, one per line:

Line 1 (Step 1 Approval & Axis Calibration):
{"event":"approval","approved":true,"detectedPair":"<pair printed on chart or ${selectedPair}>","detectedTimeframe":"<timeframe printed on chart or ${selectedTimeframe}>","finding":"<1 specific sentence confirming chart type, detected instrument/timeframe, and the visible price scale range read from the axis>"}

Line 2 (Step 2 Full Left-to-Right Market Structure & Swing Mapping):
{"event":"step","step":2,"finding":"<1 specific sentence describing the full chronological left-to-right swing sequence (HH, HL, LH, LL), trend channels, and BOS/CHoCH breaks visible across the chart>"}

Line 3 (Step 3 Institutional Zones, Order Blocks, FVGs & Liquidity Scan):
{"event":"step","step":3,"finding":"<1 specific sentence naming all major Supply/Demand zones, Order Blocks, Fair Value Gaps (FVG), Support/Resistance, and Liquidity pools/sweeps (EQH/EQL/BSL/SSL) across the chart>"}

Line 4 (Step 4 Directional Signal Classification):
{"event":"step","step":4,"finding":"<1 specific sentence explaining why BUY, SELL, or HOLD is selected at the current market price>"}

Line 5 (Step 5 Entry, Stop-Loss & TP1-TP3 Validation):
{"event":"step","step":5,"finding":"<1 specific sentence confirming exact Entry, SL, and TP1-TP3 price ordering invariants and calculated R:R ratio>"}

Line 6 (Final Validated Signal Ticket + Exhaustive Left-to-Right Spatial Chart Markup in [0..1000] image space where x:0=left..1000=right, y:0=top..1000=bottom):
{"event":"result","signalType":"<BUY|SELL|HOLD>","detectedPair":"<string>","detectedTimeframe":"<string>","currentMarketPrice":"<exact price>","entryPrice":"<exact price>","entryTriggerNote":"<1 concise sentence>","stopLoss":"<exact price>","takeProfit1":"<exact price>","takeProfit2":"<exact price>","takeProfit3":"<exact price>","riskRewardRatio":"<1 : X.X>","marketStructure":"<short label>","confidenceSummary":"<short confluence label>","technicalRationale":["<observation 1>","<observation 2>","<observation 3>","<observation 4>"],"keyLevels":[{"label":"<zone/OB/FVG/liquidity name>","price":"<exact price>","role":"<Support|Resistance|Supply Zone|Demand Zone|Bullish OB|Bearish OB|Fair Value Gap|Liquidity|Structure Break>"}],"invalidationCondition":"<1 concise invalidation sentence>","chartMarkup":{"plotBox":{"leftX":18,"rightX":825,"topY":150,"bottomY":855},"axisCalibration":{"highRefPrice":"<top visible Y-axis price>","highRefY":195,"lowRefPrice":"<bottom visible Y-axis price>","lowRefY":810,"axisTicks":[{"price":"<visible axis label 1>","y":195},{"price":"<visible axis label 2>","y":400},{"price":"<visible axis label 3>","y":605},{"price":"<visible axis label 4>","y":810}],"lastCandleX":775,"lastCandleY":548},"zones":[{"label":"<Supply/Demand/OB/S&R name>","role":"<Demand Zone|Supply Zone|Support|Resistance|Bullish OB|Bearish OB>","startX":120,"endX":825,"topY":500,"bottomY":540,"topPrice":"<price>","bottomPrice":"<price>","mitigated":false,"isPrimary":true}],"fairValueGaps":[{"label":"<Bullish FVG|Bearish FVG>","tone":"<bullish|bearish>","startX":340,"endX":825,"topY":440,"bottomY":468,"topPrice":"<price>","bottomPrice":"<price>","mitigated":false,"isPrimary":false}],"structureBreaks":[{"kind":"<BOS|CHoCH>","label":"<BOS|CHoCH>","tone":"<bullish|bearish>","startX":280,"endX":465,"y":390,"price":"<broken swing price>","isPrimary":true}],"liquidityLevels":[{"kind":"<EQH|EQL|BSL|SSL|Sweep>","label":"<EQH|EQL|BSL|SSL|Liq Sweep>","tone":"<bullish|bearish|neutral>","startX":190,"endX":620,"y":240,"price":"<liquidity price>","swept":true,"isPrimary":false}],"trendlines":[{"label":"<Trendline|Channel Upper|Channel Lower>","role":"<Trendline|Channel Upper|Channel Lower>","x1":140,"y1":260,"x2":775,"y2":520,"style":"<solid|dashed>","tone":"<bullish|bearish|neutral>","isPrimary":false}],"swings":[{"tag":"<HH|HL|LH|LL>","x":145,"y":260,"position":"<above|below>","tone":"<bullish|bearish|neutral>","price":"<swing price>","isPrimary":false}]}}

EXHAUSTIVE LEFT-TO-RIGHT SMC & MARKET STRUCTURE MAPPING RULES (CRITICAL):
- Scan the ENTIRE visible chart chronologically from left (plotBox.leftX) to right (lastCandleX). Do NOT stop at 1 or 2 annotations:
  1. zones: Mark ALL distinct visible Supply Zones, Demand Zones, Support, Resistance, Bullish Order Blocks ("Bullish OB"), and Bearish Order Blocks ("Bearish OB") across the chart (aim for 4 to 10 zones when present). If an older zone was mitigated/broken at candle X, set endX to that mitigation X and mitigated:true; if unmitigated/active, omit endX or set endX to plotBox.rightX.
  2. fairValueGaps: Mark ALL clear 3-candle Fair Value Gaps / imbalances across the chart (2 to 6 FVGs when visible) with accurate topPrice, bottomPrice, startX, and endX (mitigation candle X if filled, or plotBox.rightX if unmitigated).
  3. structureBreaks: Mark ALL visible horizontal BOS (Break of Structure) and CHoCH (Change of Character) levels from left to right (2 to 8 breaks when visible), where startX is the broken swing high/low candle X, endX is the candle X that broke through it, and price/y is that exact swing level.
  4. liquidityLevels: Mark visible Equal Highs ("EQH"), Equal Lows ("EQL"), Buy-Side Liquidity ("BSL"), Sell-Side Liquidity ("SSL"), and Liquidity Sweeps ("Sweep") (2 to 6 levels when visible).
  5. trendlines: Mark visible diagonal Trendlines and parallel Price Channels ("Channel Upper", "Channel Lower") connecting real swing wicks (1 to 4 lines when present).
  6. swings: Mark the FULL chronological swing structure sequence from left to right across the entire chart ("HH", "HL", "LH", "LL", 6 to 15 swing points) placed directly on each swing candle wick tip (position:"above" for highs HH/LH, position:"below" for lows HL/LL).
  7. isPrimary: Set "isPrimary":true ONLY on the 1-2 key zones/FVGs/breaks/trendlines that directly anchor the current trade setup at the right edge; set "isPrimary":false on historical/secondary structures.
- SPATIAL & MATHEMATICAL INVARIANTS:
  - ONLY output signalType as "BUY", "SELL", or "HOLD". NEVER output pending orders.
  - All chartMarkup coordinates use normalized 0..1000 full-image coordinates (x=0 left edge, x=1000 right edge; y=0 top edge, y=1000 bottom edge).
  - Set plotBox to frame ONLY the main price candlestick grid: topY below toolbars, bottomY above time-axis dates or RSI/MACD sub-panes, rightX at the vertical border before Y-axis price digits.
  - Provide 4 to 6 exact visible Y-axis price labels and their y positions in axisCalibration.axisTicks so all prices map with zero vertical drift.
  - Set axisCalibration.lastCandleX and lastCandleY to the exact x,y of the right-most latest candlestick close.
  - Do NOT use double quotes inside finding strings; use single quotes if quoting text.
  - For BUY: entryPrice equals currentMarketPrice, and stopLoss < entryPrice < takeProfit1 < takeProfit2 < takeProfit3.
  - For SELL: entryPrice equals currentMarketPrice, and stopLoss > entryPrice > takeProfit1 > takeProfit2 > takeProfit3.
  - For HOLD: select HOLD if price is choppy, mid-range, or lacks immediate market entry confluence; set entryPrice to the key breakout/rejection level to watch.
  - Calculate riskRewardRatio accurately from |takeProfit2 - entryPrice| / |entryPrice - stopLoss| formatted as "1 : X.X".`;

  const visionGuideLines: string[] = [];
  if (rulerImagePart) {
    visionGuideLines.push(
      `- Image 2 is a 0..1000 Coordinate Ruler Grid stamped onto the exact same screenshot (X100..X900 vertical dashed lines, Y100..Y900 horizontal dashed lines). Read X and Y coordinates DIRECTLY from those gridlines instead of guessing!`
    );
  }
  if (rightZoomPart) {
    visionGuideLines.push(
      `- Image ${rulerImagePart ? '3' : '2'} is a 2x Magnified Crop of the right-most active candles + Y-axis price scale stamped with full-image Y= markers. Use this 2x zoom to read exact decimal digits on the Y-axis, live Bid/Ask badge price, and recent candle wicks with 100% precision.`
    );
  }
  if (detectedPlotBox) {
    visionGuideLines.push(
      `- Pre-AI Pixel Scan measured main candlestick plotBox bounds at approx leftX:${detectedPlotBox.leftX}, rightX:${detectedPlotBox.rightX}, topY:${detectedPlotBox.topY}, bottomY:${detectedPlotBox.bottomY}.${
        hasSubPanes
          ? ` CRITICAL SUB-PANE ALERT: ${subPaneCount} indicator sub-pane(s) (RSI/MACD/Volume) were detected BELOW Y=${detectedPlotBox.bottomY}. NEVER place candlestick zones, FVGs, swings, or axisTicks below Y=${detectedPlotBox.bottomY}! You MAY still read RSI/MACD divergence visually for technicalRationale confluence.`
          : ''
      }`
    );
  }

  const encoder = new TextEncoder();
  let clientCancelled = false;

  const stream = new ReadableStream({
    cancel() {
      clientCancelled = true;
    },
    async start(controller) {
      const isAborted = () => clientCancelled || req.signal.aborted;

      const sendEvent = (payload: AnalyzeStreamEvent) => {
        if (isAborted()) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          clientCancelled = true;
        }
      };

      // Immediately flush initial bytes so Next.js & Cloud Run never buffer HTTP 200 headers
      sendEvent({
        event: 'status',
        message: `Connected to AI gatekeeper — calibrating ${selectedPair} ruler grid, axis & live OHLC math...`,
      });

      // Fetch Hybrid Live OHLC + 14-ATR mathematical context (non-blocking 3.2s max, returns null safely if offline)
      const hybridOhlc = await fetchHybridOhlcContext(
        selectedPair,
        selectedTimeframe,
        req.signal
      );

      const promptText = [
        `Inspect and analyze this uploaded screenshot across its full visible width from left to right.`,
        `Selected pair context: ${selectedPair}`,
        `Selected timeframe context: ${selectedTimeframe}`,
        visionGuideLines.length > 0
          ? `\nPRECISION VISION CALIBRATION AIDS ATTACHED:\n${visionGuideLines.join('\n')}`
          : '',
        hybridOhlc ? `\n${hybridOhlc.promptBlock}` : '',
        `\nFirst verify and approve whether Image 1 is a valid trading chart on Line 1, then stream Steps 2-5 and the final result JSON object (including full left-to-right zones, Order Blocks, FVGs, BOS/CHoCH breaks, liquidity pools/sweeps, trendlines/channels, and swing points) one per line.`,
      ]
        .filter(Boolean)
        .join('\n');

      let rejected = false;
      let sentResult = false;
      let approvalSent = false;
      const emittedSteps = new Set<number>();
      const collectedAudit: Array<{ step: number; title: string; finding: string }> = [];
      let lastError: unknown = null;

      const stepTitles: Record<number, string> = {
        1: 'Chart Verification & Axis Calibration',
        2: `${selectedTimeframe} Market Structure Mapping`,
        3: 'Supply, Demand & Liquidity Scan',
        4: 'Directional Bias & Signal Classification',
        5: 'Entry, Stop-Loss & TP1–TP3 Validation',
      };

      const ensureStepOneApproved = (
        detectedPairHint?: unknown,
        detectedTfHint?: unknown,
        findingHint?: string
      ) => {
        if (approvalSent || rejected) return;
        approvalSent = true;
        const finding =
          findingHint ||
          `Confirmed valid ${String(detectedPairHint || selectedPair)} (${String(
            detectedTfHint || selectedTimeframe
          )}) price chart and calibrated axis.`;

        collectedAudit.push({
          step: 1,
          title: stepTitles[1],
          finding,
        });

        sendEvent({
          event: 'approval',
          approved: true,
          detectedPair: detectedPairHint ? String(detectedPairHint) : selectedPair,
          detectedTimeframe: detectedTfHint ? String(detectedTfHint) : selectedTimeframe,
          finding,
        });
      };

      const handleParsedObject = (obj: Record<string, unknown>) => {
        if (isAborted() || rejected || sentResult) return;

        const eventType = String(obj.event || '').toLowerCase();
        const stepNum = typeof obj.step === 'number' ? obj.step : Number(obj.step);
        const hasApprovalFlag =
          typeof obj.approved === 'boolean' ||
          (typeof obj.isValidChart === 'boolean' && !obj.signalType && !obj.entryPrice);

        // 1. Handle Step 1 Approval Gatekeeper (explicit event="approval", step=1, or boolean approved/isValidChart)
        if (eventType === 'approval' || stepNum === 1 || hasApprovalFlag) {
          if (approvalSent) return;

          const approved =
            typeof obj.approved === 'boolean'
              ? obj.approved
              : typeof obj.isValidChart === 'boolean'
              ? obj.isValidChart
              : true;

          const finding = String(
            obj.finding ||
              obj.validationMessage ||
              obj.message ||
              (approved
                ? `Confirmed valid ${selectedPair} (${selectedTimeframe}) price chart.`
                : 'Uploaded image does not appear to be a valid financial price chart.')
          );

          approvalSent = true;
          sendEvent({
            event: 'approval',
            approved,
            detectedPair: obj.detectedPair ? String(obj.detectedPair) : selectedPair,
            detectedTimeframe: obj.detectedTimeframe
              ? String(obj.detectedTimeframe)
              : selectedTimeframe,
            finding,
          });

          if (approved) {
            collectedAudit.push({
              step: 1,
              title: stepTitles[1],
              finding,
            });
          } else {
            rejected = true;
          }
          return;
        }

        // 2. Handle Structural Checkpoints (Steps 2..5)
        if (
          (eventType === 'step' || (Number.isFinite(stepNum) && stepNum >= 2 && stepNum <= 5)) &&
          !rejected
        ) {
          if (stepNum >= 2 && stepNum <= 5) {
            // Guarantee Step 1 cannot stay stuck on "Verifying" if model jumped straight to Step 2+
            ensureStepOneApproved(obj.detectedPair, obj.detectedTimeframe);

            const finding = String(obj.finding || obj.message || '').trim();
            if (finding && !emittedSteps.has(stepNum)) {
              emittedSteps.add(stepNum);
              collectedAudit.push({
                step: stepNum,
                title: stepTitles[stepNum] || `Stage ${stepNum}`,
                finding,
              });
              sendEvent({
                event: 'step',
                step: stepNum,
                finding,
              });
            }
          }
          return;
        }

        // 3. Handle Final Signal Ticket
        if (
          (eventType === 'result' || Boolean(obj.signalType) || Boolean(obj.data)) &&
          !rejected &&
          !sentResult
        ) {
          const rawSignalObj =
            obj.data && typeof obj.data === 'object'
              ? (obj.data as Record<string, unknown>)
              : obj;

          if (rawSignalObj.isValidChart === false) {
            const rejectFinding = String(
              rawSignalObj.validationMessage ||
                rawSignalObj.finding ||
                'Uploaded image does not appear to be a valid financial price chart.'
            );
            approvalSent = true;
            rejected = true;
            sendEvent({
              event: 'approval',
              approved: false,
              finding: rejectFinding,
            });
            return;
          }

          ensureStepOneApproved(
            rawSignalObj.detectedPair,
            rawSignalObj.detectedTimeframe
          );

          const signalType: SignalType = normalizeSignalType(rawSignalObj.signalType);

          const sanitizedMarkup = sanitizeChartMarkup(
            rawSignalObj.chartMarkup,
            rawSignalObj.entryPrice,
            detectedPlotBox,
            hasSubPanes
          );

          const rawKeyLevels: KeyPriceLevel[] = Array.isArray(rawSignalObj.keyLevels)
            ? rawSignalObj.keyLevels
                .map((item) => {
                  const kr = (item && typeof item === 'object' ? item : {}) as Record<
                    string,
                    unknown
                  >;
                  const label = String(kr.label || 'Structure Level').trim();
                  const price = String(kr.price || '').trim();
                  if (!price) return null;
                  return {
                    label,
                    price,
                    role: normalizeKeyLevelRole(kr.role, label),
                  };
                })
                .filter((k): k is KeyPriceLevel => k !== null)
            : [];

          // Supplement keyLevels with detected SMC zones, FVGs, liquidity & structure breaks so the ticket reflects the full scan
          const seenPrices = new Set(
            rawKeyLevels.map((k) => k.price.replace(/[^0-9.]/g, ''))
          );
          const tryPushLevel = (label: string, price: string | undefined, role: ZoneRole) => {
            if (!price || rawKeyLevels.length >= 14) return;
            const norm = price.replace(/[^0-9.]/g, '');
            if (!norm || seenPrices.has(norm)) return;
            seenPrices.add(norm);
            rawKeyLevels.push({ label, price, role });
          };

          if (sanitizedMarkup) {
            for (const z of sanitizedMarkup.zones) {
              const p =
                z.topPrice && z.bottomPrice && z.topPrice !== z.bottomPrice
                  ? `${z.bottomPrice} – ${z.topPrice}`
                  : z.topPrice || z.bottomPrice;
              tryPushLevel(z.label, p, z.role);
            }
            for (const f of sanitizedMarkup.fairValueGaps || []) {
              const p =
                f.topPrice && f.bottomPrice && f.topPrice !== f.bottomPrice
                  ? `${f.bottomPrice} – ${f.topPrice}`
                  : f.topPrice || f.bottomPrice;
              tryPushLevel(f.label, p, 'Fair Value Gap');
            }
            for (const lq of sanitizedMarkup.liquidityLevels || []) {
              tryPushLevel(lq.label, lq.price, 'Liquidity');
            }
            for (const sb of sanitizedMarkup.structureBreaks || []) {
              tryPushLevel(
                `${sb.tone === 'bullish' ? 'Bullish' : 'Bearish'} ${sb.kind}`,
                sb.price,
                'Structure Break'
              );
            }
          }

          // Determine if Live OHLC matched the chart's detected symbol & price regime
          let ohlcSynced = false;
          if (hybridOhlc) {
            const detNorm = String(rawSignalObj.detectedPair || selectedPair)
              .replace(/[^A-Z0-9]/gi, '')
              .toUpperCase();
            const selNorm = selectedPair.replace(/[^A-Z0-9]/gi, '').toUpperCase();
            const chartCur = parseNumPrice(rawSignalObj.currentMarketPrice);
            const liveCur = parseNumPrice(hybridOhlc.latestClose);
            if (
              detNorm === selNorm &&
              chartCur !== null &&
              liveCur !== null &&
              Math.abs(chartCur - liveCur) / Math.max(liveCur, 1e-9) <= 0.045
            ) {
              ohlcSynced = true;
            }
          }

          const visionVerification: VisionVerificationMeta = {
            rulerCalibrated: Boolean(rulerImagePart),
            rightEdgeZoomed: Boolean(rightZoomPart),
            subPanesDetected: subPaneCount,
            ohlcSynced,
            ohlcSource: ohlcSynced ? hybridOhlc?.source : undefined,
            ohlcAtr: ohlcSynced ? hybridOhlc?.atr14 : undefined,
            selfChecked: false,
          };

          const signalResult: TradingSignalResponse = {
            isValidChart: true,
            validationMessage: '',
            signalType,
            executionCategory: deriveExecutionCategory(signalType),
            detectedPair: String(rawSignalObj.detectedPair || selectedPair),
            detectedTimeframe: String(rawSignalObj.detectedTimeframe || selectedTimeframe),
            currentMarketPrice: String(rawSignalObj.currentMarketPrice || '—'),
            entryPrice: String(rawSignalObj.entryPrice || '—'),
            entryTriggerNote: String(rawSignalObj.entryTriggerNote || ''),
            stopLoss: String(rawSignalObj.stopLoss || '—'),
            takeProfit1: String(rawSignalObj.takeProfit1 || '—'),
            takeProfit2: String(rawSignalObj.takeProfit2 || '—'),
            takeProfit3: String(rawSignalObj.takeProfit3 || '—'),
            riskRewardRatio: String(rawSignalObj.riskRewardRatio || '1 : 2.0'),
            marketStructure: String(rawSignalObj.marketStructure || 'Price Structure'),
            confidenceSummary: String(
              rawSignalObj.confidenceSummary || 'Confluence Evaluated'
            ),
            technicalRationale: Array.isArray(rawSignalObj.technicalRationale)
              ? rawSignalObj.technicalRationale.map(String).slice(0, 6)
              : [],
            keyLevels: rawKeyLevels.slice(0, 14),
            invalidationCondition: String(rawSignalObj.invalidationCondition || ''),
            chartMarkup: sanitizedMarkup,
            visionVerification,
            auditTrail: collectedAudit,
          };

          sentResult = true;
          sendEvent({
            event: 'result',
            data: signalResult,
          });
        }
      };

      try {
        for (let attempt = 0; attempt < MODEL_CANDIDATES.length; attempt++) {
          if (isAborted() || rejected || sentResult) break;

          const candidate = MODEL_CANDIDATES[attempt];

          if (attempt > 0) {
            sendEvent({
              event: 'status',
              message: `Switching to ${candidate.label} to complete verification...`,
            });
            await abortableDelay(250, req.signal);
            if (isAborted()) break;
          }

          const attemptController = new AbortController();
          const forwardClientAbort = () => attemptController.abort();
          req.signal.addEventListener('abort', forwardClientAbort, { once: true });

          try {
            let connectTimer: ReturnType<typeof setTimeout> | null = null;
            const multimodalParts: Array<
              | { inlineData: { mimeType: string; data: string } }
              | { text: string }
            > = [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ];

            if (rulerImagePart) {
              multimodalParts.push({
                inlineData: {
                  mimeType: rulerImagePart.mimeType,
                  data: rulerImagePart.data,
                },
              });
            }

            if (rightZoomPart) {
              multimodalParts.push({
                inlineData: {
                  mimeType: rightZoomPart.mimeType,
                  data: rightZoomPart.data,
                },
              });
            }

            multimodalParts.push({ text: promptText });

            const responseStream = await Promise.race([
              ai.models.generateContentStream({
                model: candidate.model,
                contents: {
                  parts: multimodalParts,
                },
                config: {
                  systemInstruction,
                  temperature: 0.2,
                  abortSignal: attemptController.signal,
                  ...(candidate.thinkingConfig
                    ? { thinkingConfig: candidate.thinkingConfig }
                    : {}),
                },
              }),
              new Promise<never>((_, reject) => {
                connectTimer = setTimeout(() => {
                  attemptController.abort();
                  reject(
                    new Error(
                      `MODEL_TIMEOUT: ${candidate.model} did not respond within ${candidate.firstChunkTimeoutMs}ms.`
                    )
                  );
                }, candidate.firstChunkTimeoutMs);
              }),
            ]).finally(() => {
              if (connectTimer) clearTimeout(connectTimer);
            });

            let buffer = '';
            let receivedAnyText = false;
            const iterator = responseStream[Symbol.asyncIterator]();

            while (!isAborted()) {
              const timeoutWindow = receivedAnyText
                ? candidate.stallTimeoutMs
                : candidate.firstChunkTimeoutMs;

              const { value: chunk, done } = await nextChunkWithTimeout(
                iterator,
                timeoutWindow,
                () => attemptController.abort()
              );

              if (done) break;
              if (isAborted()) break;

              const textPiece = chunk?.text;
              if (!textPiece) continue;

              receivedAnyText = true;
              buffer += textPiece;

              const { objects, remainder } = drainStreamBuffer(buffer, false);
              buffer = remainder;

              for (const parsedObj of objects) {
                handleParsedObject(parsedObj);
              }

              if (rejected || sentResult || isAborted()) {
                break;
              }
            }

            if (!isAborted() && !rejected && !sentResult && buffer.trim()) {
              const { objects } = drainStreamBuffer(buffer, true);
              for (const parsedObj of objects) {
                handleParsedObject(parsedObj);
              }
            }

            if (rejected || sentResult || isAborted()) {
              break;
            }

            lastError = new Error(
              'MODEL_STREAM_ENDED_EARLY: Stream closed before final signal coordinates.'
            );
            if (attempt < MODEL_CANDIDATES.length - 1) {
              continue;
            }
          } catch (attemptErr: unknown) {
            if (isAborted()) break;
            lastError = attemptErr;

            if (
              isRetryableModelError(attemptErr) &&
              attempt < MODEL_CANDIDATES.length - 1
            ) {
              continue;
            }
            break;
          } finally {
            req.signal.removeEventListener('abort', forwardClientAbort);
          }
        }

        if (!isAborted() && !rejected && !sentResult) {
          sendEvent({
            event: 'error',
            message: formatCleanErrorMessage(lastError),
          });
        }
      } finally {
        if (!clientCancelled) {
          try {
            controller.close();
          } catch {
            // Stream already closed
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

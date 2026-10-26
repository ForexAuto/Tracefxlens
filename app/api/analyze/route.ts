import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import type {
  AnalysisMode,
  AnalyzeStreamEvent,
  KeyPriceLevel,
  OhlcVerificationMode,
  SignalType,
  TradingSignalResponse,
  VisionEnhancementPayload,
  VisionVerificationMeta,
  ZoneRole,
} from '@/lib/trading-data';
import {
  fetchHybridOhlcContext,
  fetchTopDownCrtOhlcContext,
} from '@/lib/live-ohlc';
import {
  buildMacroCorrelationContext,
  fetchMacroCorrelationFeed,
} from '@/lib/macro-correlation';
import {
  deriveExecutionCategory,
  enforceTopDownCrtDominance,
  normalizeKeyLevelRole,
  normalizeSignalType,
  parseNumPrice,
  sanitizeChartMarkup,
  sanitizeCrtContext,
} from '@/lib/signal-sanitizer';
import {
  hasGeminiKey,
  hasOpenRouterKey,
  type OpenRouterImageInput,
  resolveOpenRouterVisionCascade,
  streamOpenRouterVision,
} from '@/lib/openrouter-server';
import {
  DEFAULT_VISION_MODEL_ID,
  isOpenRouterModelSelection,
} from '@/lib/vision-models';

interface ModelCandidate {
  provider: 'gemini' | 'openrouter';
  model: string;
  label: string;
  firstChunkTimeoutMs: number;
  stallTimeoutMs: number;
  thinkingConfig?: {
    thinkingLevel?: ThinkingLevel;
    thinkingBudget?: number;
  };
}

function isRetryableModelError(err: unknown): boolean {
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const upper = raw.toUpperCase();
  if (upper.includes('NOT CONFIGURED')) {
    return false;
  }
  return (
    upper.includes('MODEL_TIMEOUT') ||
    upper.includes('ABORT') ||
    upper.includes('TIMEOUT') ||
    upper.includes('OPENROUTER ') ||
    upper.includes('HARNESS') ||
    upper.includes('UPSTREAM') ||
    upper.includes('PROVIDER') ||
    upper.includes('400') ||
    upper.includes('403') ||
    upper.includes('404') ||
    upper.includes('408') ||
    upper.includes('422') ||
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
    upper.includes('ENDED EARLY') ||
    upper.includes('EMPTY STREAMING')
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
 * Stateful balanced-brace stream scanner that extracts complete `{ ... }` JSON objects
 * across BOTH single-line NDJSON and multi-line pretty-printed streams (including ```json fences),
 * returning any unfinished trailing `{ ...` fragment in `remainder` until more tokens arrive.
 */
function drainStreamBuffer(
  buffer: string,
  flushRemainder = false
): {
  objects: Record<string, unknown>[];
  remainder: string;
} {
  const objects: Record<string, unknown>[] = [];
  if (!buffer) return { objects, remainder: '' };

  let depth = 0;
  let inString = false;
  let escape = false;
  let startIdx = -1;
  let consumedUpTo = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];

    if (depth > 0) {
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
          const candidateSlice = buffer.slice(startIdx, i + 1);
          try {
            const parsed = JSON.parse(candidateSlice) as Record<string, unknown>;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              objects.push(parsed);
            }
          } catch {
            // Ignore non-JSON `{...}` prose fragment
          }
          startIdx = -1;
          consumedUpTo = i + 1;
        }
      }
    }
  }

  if (flushRemainder) {
    if (startIdx !== -1 && startIdx >= consumedUpTo) {
      const fallbackObjs = parseJsonObjectsFromChunk(buffer.slice(startIdx));
      if (fallbackObjs.length > 0) {
        objects.push(...fallbackObjs);
      }
    }
    return { objects, remainder: '' };
  }

  if (depth > 0 && startIdx !== -1) {
    return { objects, remainder: buffer.slice(startIdx) };
  }

  return { objects, remainder: '' };
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
  const geminiReady = hasGeminiKey();
  const openRouterReady = hasOpenRouterKey();

  if (!geminiReady && !openRouterReady) {
    return NextResponse.json(
      {
        error:
          'Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured on the server. Add one in Settings > Secrets.',
      },
      { status: 500 }
    );
  }

  let imageDataUrl = '';
  let macroImageDataUrl = '';
  let analysisMode: AnalysisMode = 'single';
  let selectedPair = 'EUR/USD';
  let selectedTimeframe = 'H1';
  let visionModel = DEFAULT_VISION_MODEL_ID;
  let ohlcAssistEnabled = true;
  let visionEnhancement: VisionEnhancementPayload | undefined;
  let macroVisionEnhancement: VisionEnhancementPayload | undefined;

  try {
    const body = await req.json();
    imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';
    macroImageDataUrl =
      typeof body.macroImageDataUrl === 'string' ? body.macroImageDataUrl : '';
    analysisMode =
      body.analysisMode === 'top_down_crt' ? 'top_down_crt' : 'single';
    selectedPair = body.pair || 'EUR/USD';
    selectedTimeframe =
      analysisMode === 'top_down_crt' ? 'H1 → M5' : body.timeframe || 'H1';
    if (typeof body.visionModel === 'string' && body.visionModel.trim()) {
      visionModel = body.visionModel.trim();
    }
    if (typeof body.ohlcAssistEnabled === 'boolean') {
      ohlcAssistEnabled = body.ohlcAssistEnabled;
    }
    if (body.visionEnhancement && typeof body.visionEnhancement === 'object') {
      visionEnhancement = body.visionEnhancement as VisionEnhancementPayload;
    }
    if (
      body.macroVisionEnhancement &&
      typeof body.macroVisionEnhancement === 'object'
    ) {
      macroVisionEnhancement =
        body.macroVisionEnhancement as VisionEnhancementPayload;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const wantsOpenRouter = isOpenRouterModelSelection(visionModel);
  if (wantsOpenRouter && !openRouterReady) {
    return NextResponse.json(
      {
        error:
          'OPENROUTER_API_KEY is not configured yet. Add OPENROUTER_API_KEY in Settings > Secrets to use OpenRouter Free Vision models, or select Gemini 3.8 Flash.',
      },
      { status: 400 }
    );
  }

  const isTopDownCrt = analysisMode === 'top_down_crt';

  if (!imageDataUrl) {
    return NextResponse.json(
      {
        error: isTopDownCrt
          ? 'Please upload the M5 Execution chart screenshot to run Top-Down CRT analysis.'
          : 'Please upload a valid chart screenshot to analyze.',
      },
      { status: 400 }
    );
  }

  if (isTopDownCrt && !macroImageDataUrl) {
    return NextResponse.json(
      {
        error:
          'Top-Down CRT mode requires both the H1 Macro chart and the M5 Execution chart.',
      },
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

  const macroImagePart = isTopDownCrt ? parseDataUrl(macroImageDataUrl) : null;
  if (isTopDownCrt && !macroImagePart) {
    return NextResponse.json(
      { error: 'Unsupported H1 Macro image format. Upload a PNG, JPEG, or WebP screenshot.' },
      { status: 400 }
    );
  }

  const rulerImagePart = parseDataUrl(visionEnhancement?.rulerGridDataUrl);
  const rightZoomPart = parseDataUrl(visionEnhancement?.rightEdgeZoomDataUrl);
  const detectedPlotBox = visionEnhancement?.detectedPlotBox;
  const subPaneCount = Math.max(0, Number(visionEnhancement?.subPaneCount ?? 0));
  const hasSubPanes = subPaneCount > 0;

  const macroRulerPart = isTopDownCrt
    ? parseDataUrl(macroVisionEnhancement?.rulerGridDataUrl)
    : null;
  const macroDetectedPlotBox = macroVisionEnhancement?.detectedPlotBox;
  const macroSubPaneCount = Math.max(
    0,
    Number(macroVisionEnhancement?.subPaneCount ?? 0)
  );
  const macroHasSubPanes = macroSubPaneCount > 0;

  const ai = geminiReady
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // Build ordered multimodal image stack + dynamic image index mapping
  const imagePartsWithLabels: Array<{
    part: { inlineData: { mimeType: string; data: string } };
    essential?: boolean;
    guideLine?: string;
  }> = [];

  if (isTopDownCrt && macroImagePart) {
    // 1. H1 Macro Chart
    const h1CleanIdx = imagePartsWithLabels.length + 1;
    imagePartsWithLabels.push({
      part: { inlineData: macroImagePart },
      essential: !macroRulerPart,
      guideLine: `- Image ${h1CleanIdx} is the DOMINATING H1 MACRO CHART (used for Candle Range Theory [CRT High, CRT Low, 50% Equilibrium], liquidity purge validation, macro bias, and TP1–TP3 target projection).`,
    });

    if (macroRulerPart) {
      const h1RulerIdx = imagePartsWithLabels.length + 1;
      imagePartsWithLabels.push({
        part: { inlineData: macroRulerPart },
        essential: true,
        guideLine: `- Image ${h1RulerIdx} is the 0..1000 Coordinate Ruler Grid stamped onto the H1 Macro Chart. Read macroChartMarkup coordinates DIRECTLY from Image ${h1RulerIdx}.${
          macroDetectedPlotBox
            ? ` Pre-AI scan measured H1 main plotBox at leftX:${macroDetectedPlotBox.leftX}, rightX:${macroDetectedPlotBox.rightX}, topY:${macroDetectedPlotBox.topY}, bottomY:${macroDetectedPlotBox.bottomY}${
                macroHasSubPanes
                  ? ` (${macroSubPaneCount} sub-pane(s) below Y=${macroDetectedPlotBox.bottomY} — keep H1 annotations above Y=${macroDetectedPlotBox.bottomY}).`
                  : '.'
              }`
            : ''
        }`,
      });
    }

    // 2. M5 Execution Chart
    const m5CleanIdx = imagePartsWithLabels.length + 1;
    imagePartsWithLabels.push({
      part: { inlineData: mainImagePart },
      essential: !rulerImagePart,
      guideLine: `- Image ${m5CleanIdx} is the M5 EXECUTION CHART (used ONLY as an execution microscope for entry timing, M5 CHoCH/MSS + FVG trigger, and tight Stop-Loss risk compression — NEVER allowed to override H1 macro bias).`,
    });

    if (rulerImagePart) {
      const m5RulerIdx = imagePartsWithLabels.length + 1;
      imagePartsWithLabels.push({
        part: { inlineData: rulerImagePart },
        essential: true,
        guideLine: `- Image ${m5RulerIdx} is the 0..1000 Coordinate Ruler Grid stamped onto the M5 Execution Chart. Read chartMarkup coordinates DIRECTLY from Image ${m5RulerIdx}.${
          detectedPlotBox
            ? ` Pre-AI scan measured M5 main plotBox at leftX:${detectedPlotBox.leftX}, rightX:${detectedPlotBox.rightX}, topY:${detectedPlotBox.topY}, bottomY:${detectedPlotBox.bottomY}${
                hasSubPanes
                  ? ` (${subPaneCount} sub-pane(s) below Y=${detectedPlotBox.bottomY} — keep M5 annotations above Y=${detectedPlotBox.bottomY}).`
                  : '.'
              }`
            : ''
        }`,
      });
    }

    if (rightZoomPart) {
      const m5ZoomIdx = imagePartsWithLabels.length + 1;
      imagePartsWithLabels.push({
        part: { inlineData: rightZoomPart },
        guideLine: `- Image ${m5ZoomIdx} is a 2x Magnified Crop of the M5 Execution Chart's right-most active candles + Y-axis price scale. Read exact M5 currentMarketPrice, entryPrice, and tight Stop-Loss decimals here.`,
      });
    }
  } else {
    // Classic Single-Chart Mode
    imagePartsWithLabels.push({
      part: { inlineData: mainImagePart },
      essential: !rulerImagePart,
    });

    if (rulerImagePart) {
      imagePartsWithLabels.push({
        part: { inlineData: rulerImagePart },
        essential: true,
        guideLine: `- Image 2 is a 0..1000 Coordinate Ruler Grid stamped onto the exact same screenshot (X100..X900 vertical dashed lines, Y100..Y900 horizontal dashed lines). Read X and Y coordinates DIRECTLY from those gridlines instead of guessing!`,
      });
    }

    if (rightZoomPart) {
      imagePartsWithLabels.push({
        part: { inlineData: rightZoomPart },
        essential: true,
        guideLine: `- Image ${
          rulerImagePart ? '3' : '2'
        } is a 2x Magnified Crop of the right-most active candles + Y-axis price scale stamped with full-image Y= markers. Use this 2x zoom to read exact decimal digits on the Y-axis, live Bid/Ask badge price, and recent candle wicks with 100% precision.`,
      });
    }
  }

  const visionGuideLines: string[] = imagePartsWithLabels
    .map((x) => x.guideLine)
    .filter((g): g is string => Boolean(g));

  if (!isTopDownCrt && detectedPlotBox) {
    visionGuideLines.push(
      `- Pre-AI Pixel Scan measured main candlestick plotBox bounds at approx leftX:${detectedPlotBox.leftX}, rightX:${detectedPlotBox.rightX}, topY:${detectedPlotBox.topY}, bottomY:${detectedPlotBox.bottomY}.${
        hasSubPanes
          ? ` CRITICAL SUB-PANE ALERT: ${subPaneCount} indicator sub-pane(s) (RSI/MACD/Volume) were detected BELOW Y=${detectedPlotBox.bottomY}. NEVER place candlestick zones, FVGs, swings, or axisTicks below Y=${detectedPlotBox.bottomY}! You MAY still read RSI/MACD divergence visually for technicalRationale confluence.`
          : ''
      }`
    );
  }

  const singleChartSystemInstruction = `You are an institutional quantitative Smart Money Concepts (SMC) and price-action technical analyst for TraceFX Lens.
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

  const topDownCrtSystemInstruction = `You are an institutional Candle Range Theory (CRT) + Smart Money Concepts (SMC) multi-timeframe execution strategist for TraceFX Lens.
You MUST stream your real-time dual-chart inspection as a sequence of standalone single-line JSON objects (NDJSON), one JSON object per line, with NO markdown code fences and NO prose outside the JSON objects.

THE IRONCLAD TOP-DOWN CRT LAW (NON-NEGOTIABLE):
1. H1 ALWAYS DOMINATES: The H1 Macro Chart sets the directional bias, validates whether a real CRT setup exists (CRT Range High / CRT Range Low liquidity purge + reclaim back inside range, or clean H1 POI continuation), and defines the macro Draw on Liquidity targets (TP1, TP2, TP3).
2. M5 IS ONLY AN EXECUTION MICROSCOPE: The M5 Execution Chart shows entry precision, micro displacement (CHoCH / MSS + FVG / OB), noise, and how tight Stop-Loss risk can be compressed—it NEVER overrides H1 macro bias.
3. HARD VETO TO HOLD:
   - If the H1 CRT setup is NOT valid (e.g., H1 is choppy mid-range with no CRT High/Low purge or clean H1 POI reaction), an M5 signal by itself is MEANINGLESS -> you MUST set "h1CrtValid":false and "signalType":"HOLD".
   - If H1 CRT is valid BULLISH, you may ONLY output "BUY" (if M5 confirms bullish CHoCH/FVG execution) or "HOLD" (if M5 is still bearish/unconfirmed). NEVER output "SELL" against a Bullish H1!
   - If H1 CRT is valid BEARISH, you may ONLY output "SELL" (if M5 confirms bearish CHoCH/FVG execution) or "HOLD" (if M5 is still bullish/unconfirmed). NEVER output "BUY" against a Bearish H1!

STEP 1 — MANDATORY DUAL-CHART GATEKEEPER (OUTPUT THIS FIRST):
Inspect BOTH uploaded charts (the H1 Macro Chart and the M5 Execution Chart).
- Are BOTH genuine financial price charts of the SAME trading instrument? (Also check if the user accidentally swapped them or uploaded two unrelated pairs).
- If NO (either image is not a valid financial chart, or they depict two different instruments), output ONLY this single JSON object and STOP immediately:
{"event":"approval","approved":false,"finding":"Explain clearly in 1 sentence which chart slot (H1 Macro or M5 Execution) is invalid or mismatched and ask the user to upload matching H1 and M5 charts."}

- If YES (both are valid price charts of the same instrument), output these 6 JSON objects sequentially in exact order, one per line:

Line 1 (Step 1 Dual-Chart Verification & Axis Calibration):
{"event":"approval","approved":true,"detectedPair":"<pair printed on charts or ${selectedPair}>","detectedTimeframe":"H1 → M5","finding":"<1 specific sentence confirming both the H1 Macro chart and M5 Execution chart for the instrument and their calibrated price ranges>"}

Line 2 (Step 2 H1 Macro CRT Range, Purge & Bias Audit):
{"event":"step","step":2,"finding":"<1 specific sentence identifying the governing H1 CRT High, CRT Low, 50% Equilibrium, whether SSL/BSL was purged and reclaimed, and whether H1 CRT is Valid Bullish, Valid Bearish, or Invalid>"}

Line 3 (Step 3 M5 Execution Structure, CHoCH & FVG Scan):
{"event":"step","step":3,"finding":"<1 specific sentence inspecting the M5 Execution chart for micro CHoCH/MSS displacement, unmitigated M5 FVG/Order Block, or unconfirmed noise>"}

Line 4 (Step 4 H1 Dominance Filter & Signal Veto Check):
{"event":"step","step":4,"finding":"<1 specific sentence stating whether M5 aligns with H1 to fire BUY/SELL, OR whether H1 vetoed M5 noise into HOLD>"}

Line 5 (Step 5 H1 Target Projection & M5 Tight Risk Validation):
{"event":"step","step":5,"finding":"<1 specific sentence confirming M5 tight Stop-Loss compression vs H1 macro TP1-TP3 targets and resulting amplified R:R ratio>"}

Line 6 (Final Validated Top-Down CRT Signal Ticket + Dual Spatial Markup for BOTH M5 [chartMarkup] and H1 [macroChartMarkup] in [0..1000] coordinates):
{"event":"result","signalType":"<BUY|SELL|HOLD>","detectedPair":"<string>","detectedTimeframe":"H1 → M5","currentMarketPrice":"<exact M5 current price>","entryPrice":"<exact M5 entry or watch trigger>","entryTriggerNote":"<1 concise sentence linking H1 CRT bias + M5 trigger>","stopLoss":"<exact tight M5 invalidation price>","takeProfit1":"<H1 CRT 50% EQ or first H1 internal target>","takeProfit2":"<Opposing H1 CRT Range High/Low draw on liquidity>","takeProfit3":"<External H1 swing/expansion liquidity target>","riskRewardRatio":"<1 : X.X>","marketStructure":"<e.g. H1 Bullish CRT + M5 CHoCH>","confidenceSummary":"<e.g. Top-Down CRT Aligned or H1 Veto · Stand Aside>","crtContext":{"macroTimeframe":"H1","executionTimeframe":"M5","h1CrtValid":true,"h1Bias":"<BULLISH|BEARISH|NEUTRAL>","crtRangeHigh":"<exact H1 CRT High price>","crtRangeLow":"<exact H1 CRT Low price>","crtEquilibrium":"<exact H1 50% midpoint price>","crtSweepStatus":"<1 crisp phrase on H1 CRT purge/rejection or why invalid>","m5ExecutionTrigger":"<1 crisp phrase on M5 CHoCH/FVG trigger & tight SL>","alignmentVerdict":"<1 crisp phrase summarizing H1 dominance + M5 execution outcome>"},"technicalRationale":["<H1 CRT range & purge observation>","<H1 draw-on-liquidity target rationale>","<M5 execution CHoCH/FVG & noise filter observation>","<Risk compression: tight M5 SL vs H1 reward math>"],"keyLevels":[{"label":"<e.g. H1 CRT High / H1 CRT Low / H1 50% EQ / M5 Bullish OB / M5 FVG>","price":"<exact price>","role":"<Support|Resistance|Supply Zone|Demand Zone|Bullish OB|Bearish OB|Fair Value Gap|Liquidity|Structure Break>"}],"invalidationCondition":"<1 concise sentence stating exact M5 SL breach & H1 CRT invalidation>","chartMarkup":<full 0..1000 spatial markup object calibrated strictly to the M5 Execution Chart>,"macroChartMarkup":<full 0..1000 spatial markup object calibrated strictly to the H1 Macro Chart marking CRT High/Low liquidity, H1 OB/FVG zones, H1 BOS/CHoCH, and H1 swings>}

DUAL-CHART MARKUP & MATHEMATICAL INVARIANTS:
- Both "chartMarkup" (for the M5 Execution Chart) and "macroChartMarkup" (for the H1 Macro Chart) MUST follow the exact schema:
  {"plotBox":{"leftX":...,"rightX":...,"topY":...,"bottomY":...},"axisCalibration":{"highRefPrice":"...","highRefY":...,"lowRefPrice":"...","lowRefY":...,"axisTicks":[{"price":"...","y":...}],"lastCandleX":...,"lastCandleY":...},"zones":[...],"fairValueGaps":[...],"structureBreaks":[...],"liquidityLevels":[...],"trendlines":[...],"swings":[...]}
- On "macroChartMarkup" (H1 Chart): mark the H1 CRT High & CRT Low in liquidityLevels (with swept:true on the purged side and isPrimary:true), mark H1 Supply/Demand/OB zones (3–7 zones), H1 FVGs, H1 BOS/CHoCH, and H1 HH/HL/LH/LL swings using the H1 chart's 0..1000 ruler coordinates and H1 Y-axis ticks!
- On "chartMarkup" (M5 Chart): mark the M5 execution Order Blocks/Zones, M5 FVGs, M5 CHoCH/BOS trigger (isPrimary:true), M5 liquidity sweeps, and M5 swings using the M5 chart's 0..1000 ruler coordinates and M5 Y-axis ticks!
- Do NOT use double quotes inside finding strings; use single quotes if quoting text.
- For BUY: stopLoss < entryPrice < takeProfit1 < takeProfit2 < takeProfit3.
- For SELL: stopLoss > entryPrice > takeProfit1 > takeProfit2 > takeProfit3.
- For HOLD: whenever h1CrtValid is false OR M5 has not triggered in H1's direction, output HOLD and set entryPrice to the exact M5 CHoCH or H1 CRT level required to arm a valid setup.`;

  const systemInstruction = isTopDownCrt
    ? topDownCrtSystemInstruction
    : singleChartSystemInstruction;

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
        message: isTopDownCrt
          ? `Connected to Top-Down CRT gatekeeper — calibrating ${selectedPair} H1 macro & M5 execution axes${
              ohlcAssistEnabled ? ' + spot OHLC & DXY/US10Y...' : '...'
            }`
          : `Connected to AI gatekeeper — calibrating ${selectedPair} ruler grid & axis${
              ohlcAssistEnabled ? ' + spot OHLC & DXY/US10Y...' : '...'
            }`,
      });

      const [hybridOhlc, topDownOhlc, macroFeed] = ohlcAssistEnabled
        ? await Promise.all([
            isTopDownCrt
              ? Promise.resolve(null)
              : fetchHybridOhlcContext(
                  selectedPair,
                  selectedTimeframe,
                  req.signal
                ),
            isTopDownCrt
              ? fetchTopDownCrtOhlcContext(selectedPair, req.signal)
              : Promise.resolve(null),
            fetchMacroCorrelationFeed(selectedPair, req.signal),
          ])
        : [null, null, null];

      const promptText = isTopDownCrt
        ? [
            `Perform a strict Top-Down CRT (H1 Macro Dominance + M5 Execution Trigger) analysis on ${selectedPair}.`,
            `Selected pair context: ${selectedPair}`,
            `Workflow Mode: Top-Down CRT (H1 sets What to Trade & Targets; M5 sets When to Pull the Trigger & Tight Risk; M5 NEVER overrides H1).`,
            visionGuideLines.length > 0
              ? `\nATTACHED DUAL-TIMEFRAME IMAGES & PRECISION RULERS:\n${visionGuideLines.join('\n')}`
              : '',
            topDownOhlc ? `\n${topDownOhlc.promptBlock}` : '',
            macroFeed ? `\n${macroFeed.promptBlock}` : '',
            `\nFirst verify both H1 and M5 screenshots on Line 1, then stream Steps 2–5 and the final result JSON object (including crtContext, M5 chartMarkup, and H1 macroChartMarkup) one per line.`,
          ]
            .filter(Boolean)
            .join('\n')
        : [
            `Inspect and analyze this uploaded screenshot across its full visible width from left to right.`,
            `Selected pair context: ${selectedPair}`,
            `Selected timeframe context: ${selectedTimeframe}`,
            visionGuideLines.length > 0
              ? `\nPRECISION VISION CALIBRATION AIDS ATTACHED:\n${visionGuideLines.join('\n')}`
              : '',
            hybridOhlc ? `\n${hybridOhlc.promptBlock}` : '',
            macroFeed ? `\n${macroFeed.promptBlock}` : '',
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

      const stepTitles: Record<number, string> = isTopDownCrt
        ? {
            1: 'H1 & M5 Chart Verification & Axis Calibration',
            2: 'H1 Macro CRT Range, Purge & Bias Audit',
            3: 'M5 Execution Structure, CHoCH & FVG Scan',
            4: 'H1 Dominance Filter & Signal Veto Check',
            5: 'H1 Target Projection & M5 Tight Risk Validation',
          }
        : {
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
          (isTopDownCrt
            ? `Confirmed valid ${String(
                detectedPairHint || selectedPair
              )} H1 Macro and M5 Execution price charts and calibrated both axes.`
            : `Confirmed valid ${String(detectedPairHint || selectedPair)} (${String(
                detectedTfHint || selectedTimeframe
              )}) price chart and calibrated axis.`);

        collectedAudit.push({
          step: 1,
          title: stepTitles[1],
          finding,
        });

        sendEvent({
          event: 'approval',
          approved: true,
          detectedPair: detectedPairHint ? String(detectedPairHint) : selectedPair,
          detectedTimeframe: isTopDownCrt
            ? 'H1 → M5'
            : detectedTfHint
            ? String(detectedTfHint)
            : selectedTimeframe,
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
                ? isTopDownCrt
                  ? `Confirmed valid ${selectedPair} H1 Macro and M5 Execution charts.`
                  : `Confirmed valid ${selectedPair} (${selectedTimeframe}) price chart.`
                : 'Uploaded image does not appear to be a valid financial price chart.')
          );

          approvalSent = true;
          sendEvent({
            event: 'approval',
            approved,
            detectedPair: obj.detectedPair ? String(obj.detectedPair) : selectedPair,
            detectedTimeframe: isTopDownCrt
              ? 'H1 → M5'
              : obj.detectedTimeframe
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

          let signalType: SignalType = normalizeSignalType(rawSignalObj.signalType);
          let crtContext = isTopDownCrt
            ? sanitizeCrtContext(rawSignalObj.crtContext)
            : undefined;
          let vetoReason: string | undefined;

          if (isTopDownCrt) {
            if (!crtContext) {
              crtContext = {
                macroTimeframe: 'H1',
                executionTimeframe: 'M5',
                h1CrtValid: signalType !== 'HOLD',
                h1Bias:
                  signalType === 'BUY'
                    ? 'BULLISH'
                    : signalType === 'SELL'
                    ? 'BEARISH'
                    : 'NEUTRAL',
                crtRangeHigh: topDownOhlc?.crtReferenceHigh,
                crtRangeLow: topDownOhlc?.crtReferenceLow,
                crtEquilibrium: topDownOhlc?.crtEquilibrium,
                crtSweepStatus:
                  signalType === 'HOLD'
                    ? 'No confirmed H1 CRT sweep & M5 alignment.'
                    : `H1 ${signalType === 'BUY' ? 'bullish' : 'bearish'} CRT setup confirmed.`,
                m5ExecutionTrigger: String(
                  rawSignalObj.entryTriggerNote ||
                    'Evaluated M5 execution structure against H1.'
                ),
                alignmentVerdict:
                  signalType === 'HOLD'
                    ? 'Stand Aside — awaiting H1 CRT + M5 CHoCH alignment'
                    : `H1 ${signalType === 'BUY' ? 'Bullish' : 'Bearish'} CRT Dominates · M5 Trigger Aligned`,
              };
            }

            const enforced = enforceTopDownCrtDominance(signalType, crtContext);
            signalType = enforced.signalType;
            crtContext = enforced.crtContext;
            vetoReason = enforced.vetoReason;
          }

          const sanitizedMarkup = sanitizeChartMarkup(
            rawSignalObj.chartMarkup,
            rawSignalObj.entryPrice,
            detectedPlotBox,
            hasSubPanes
          );

          const sanitizedMacroMarkup = isTopDownCrt
            ? sanitizeChartMarkup(
                rawSignalObj.macroChartMarkup,
                rawSignalObj.entryPrice,
                macroDetectedPlotBox,
                macroHasSubPanes
              )
            : undefined;

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

          // Supplement keyLevels with CRT Range boundaries + detected SMC zones/FVGs/liquidity
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

          if (isTopDownCrt && crtContext) {
            tryPushLevel('H1 CRT High', crtContext.crtRangeHigh, 'Liquidity');
            tryPushLevel('H1 CRT 50% Equilibrium', crtContext.crtEquilibrium, 'Support');
            tryPushLevel('H1 CRT Low', crtContext.crtRangeLow, 'Liquidity');
          }

          if (sanitizedMacroMarkup) {
            for (const z of sanitizedMacroMarkup.zones.slice(0, 4)) {
              const p =
                z.topPrice && z.bottomPrice && z.topPrice !== z.bottomPrice
                  ? `${z.bottomPrice} – ${z.topPrice}`
                  : z.topPrice || z.bottomPrice;
              tryPushLevel(
                z.label.toUpperCase().startsWith('H1') ? z.label : `H1 ${z.label}`,
                p,
                z.role
              );
            }
          }

          if (sanitizedMarkup) {
            const prefix = isTopDownCrt ? 'M5 ' : '';
            for (const z of sanitizedMarkup.zones) {
              const p =
                z.topPrice && z.bottomPrice && z.topPrice !== z.bottomPrice
                  ? `${z.bottomPrice} – ${z.topPrice}`
                  : z.topPrice || z.bottomPrice;
              const lbl =
                prefix && !z.label.toUpperCase().startsWith('M5') && !z.label.toUpperCase().startsWith('H1')
                  ? `${prefix}${z.label}`
                  : z.label;
              tryPushLevel(lbl, p, z.role);
            }
            for (const f of sanitizedMarkup.fairValueGaps || []) {
              const p =
                f.topPrice && f.bottomPrice && f.topPrice !== f.bottomPrice
                  ? `${f.bottomPrice} – ${f.topPrice}`
                  : f.topPrice || f.bottomPrice;
              const lbl =
                prefix && !f.label.toUpperCase().startsWith('M5') && !f.label.toUpperCase().startsWith('H1')
                  ? `${prefix}${f.label}`
                  : f.label;
              tryPushLevel(lbl, p, 'Fair Value Gap');
            }
            for (const lq of sanitizedMarkup.liquidityLevels || []) {
              tryPushLevel(lq.label, lq.price, 'Liquidity');
            }
            for (const sb of sanitizedMarkup.structureBreaks || []) {
              tryPushLevel(
                `${prefix}${sb.tone === 'bullish' ? 'Bullish' : 'Bearish'} ${sb.kind}`,
                sb.price,
                'Structure Break'
              );
            }
          }

          // Determine if Live OHLC matched the chart's detected symbol & price regime
          let ohlcSynced = false;
          let resolvedOhlcMode: OhlcVerificationMode | undefined =
            ohlcAssistEnabled ? undefined : 'disabled';
          let resolvedOhlcAgeSec: number | undefined;
          let resolvedOhlcSource: string | undefined;
          let resolvedOhlcAtr: string | undefined;

          const activeRefOhlc = isTopDownCrt
            ? topDownOhlc?.m5 || topDownOhlc?.h1 || null
            : hybridOhlc;

          const detPairResolved = String(rawSignalObj.detectedPair || selectedPair);
          const detNorm = detPairResolved
            .replace(/[^A-Z0-9]/gi, '')
            .toUpperCase();
          const selNorm = selectedPair.replace(/[^A-Z0-9]/gi, '').toUpperCase();

          if (ohlcAssistEnabled && activeRefOhlc) {
            const chartCur = parseNumPrice(rawSignalObj.currentMarketPrice);
            const liveCur = parseNumPrice(activeRefOhlc.latestClose);
            if (
              detNorm === selNorm &&
              chartCur !== null &&
              liveCur !== null &&
              Math.abs(chartCur - liveCur) / Math.max(liveCur, 1e-9) <= 0.045
            ) {
              ohlcSynced = true;
              resolvedOhlcMode = isTopDownCrt
                ? topDownOhlc?.ohlcMode || activeRefOhlc.ohlcMode
                : activeRefOhlc.ohlcMode;
              resolvedOhlcAgeSec =
                activeRefOhlc.spotAgeSeconds ?? activeRefOhlc.lastBarAgeSeconds;
              resolvedOhlcSource = activeRefOhlc.source;
              resolvedOhlcAtr = isTopDownCrt
                ? topDownOhlc?.h1 && topDownOhlc?.m5
                  ? `H1 ${topDownOhlc.h1.atr14} · M5 ${topDownOhlc.m5.atr14}`
                  : activeRefOhlc.atr14
                : activeRefOhlc.atr14;
            }
          }

          // Historical Screenshot Auto-Guard: only attach live DXY & US10Y macro context when
          // Live Assist is enabled AND the chart is verified to be in the current live spot regime
          // (or when activeRefOhlc was unavailable for the pair while symbol matches).
          const canAttachLiveMacro =
            ohlcAssistEnabled &&
            Boolean(macroFeed) &&
            (activeRefOhlc ? ohlcSynced : detNorm === selNorm);

          const finalizedMacroContext =
            canAttachLiveMacro && macroFeed
              ? buildMacroCorrelationContext(
                  macroFeed.previewContext.dxy,
                  macroFeed.previewContext.us10y,
                  detPairResolved,
                  signalType
                )
              : undefined;

          const visionVerification: VisionVerificationMeta = {
            rulerCalibrated: Boolean(rulerImagePart || macroRulerPart),
            rightEdgeZoomed: Boolean(rightZoomPart),
            subPanesDetected: subPaneCount + macroSubPaneCount,
            ohlcSynced,
            ohlcMode: resolvedOhlcMode,
            ohlcAgeSeconds: resolvedOhlcAgeSec,
            ohlcSource: resolvedOhlcSource,
            ohlcAtr: resolvedOhlcAtr,
            macroSynced: Boolean(finalizedMacroContext),
            selfChecked: false,
          };

          const rawRationale = Array.isArray(rawSignalObj.technicalRationale)
            ? rawSignalObj.technicalRationale.map(String).slice(0, 6)
            : [];
          if (vetoReason && !rawRationale.some((r) => r.includes('vetoed'))) {
            rawRationale.unshift(vetoReason);
          }

          const rawTriggerNote = String(rawSignalObj.entryTriggerNote || '');

          const signalResult: TradingSignalResponse = {
            isValidChart: true,
            validationMessage: '',
            analysisMode,
            crtContext,
            macroContext: finalizedMacroContext,
            signalType,
            executionCategory: deriveExecutionCategory(signalType),
            detectedPair: detPairResolved,
            detectedTimeframe: isTopDownCrt
              ? 'H1 → M5'
              : String(rawSignalObj.detectedTimeframe || selectedTimeframe),
            currentMarketPrice: String(rawSignalObj.currentMarketPrice || '—'),
            entryPrice: String(rawSignalObj.entryPrice || '—'),
            entryTriggerNote: vetoReason
              ? `${vetoReason}${rawTriggerNote ? ` (${rawTriggerNote})` : ''}`
              : rawTriggerNote,
            stopLoss: String(rawSignalObj.stopLoss || '—'),
            takeProfit1: String(rawSignalObj.takeProfit1 || '—'),
            takeProfit2: String(rawSignalObj.takeProfit2 || '—'),
            takeProfit3: String(rawSignalObj.takeProfit3 || '—'),
            riskRewardRatio: String(rawSignalObj.riskRewardRatio || '1 : 2.0'),
            marketStructure: String(
              rawSignalObj.marketStructure ||
                (isTopDownCrt ? 'H1 CRT + M5 Structure' : 'Price Structure')
            ),
            confidenceSummary: String(
              vetoReason
                ? 'H1 Dominance Veto · Stand Aside'
                : rawSignalObj.confidenceSummary || 'Confluence Evaluated'
            ),
            technicalRationale: rawRationale.slice(0, 6),
            keyLevels: rawKeyLevels.slice(0, 14),
            invalidationCondition: String(rawSignalObj.invalidationCondition || ''),
            chartMarkup: sanitizedMarkup,
            macroChartMarkup: sanitizedMacroMarkup,
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
        const candidates: ModelCandidate[] = [];

        if (wantsOpenRouter && openRouterReady) {
          const orIds = await resolveOpenRouterVisionCascade(visionModel, 4);
          for (const id of orIds) {
            candidates.push({
              provider: 'openrouter',
              model: id,
              label: id.replace(':free', ''),
              firstChunkTimeoutMs: 18000,
              stallTimeoutMs: 30000,
            });
          }
          // Final safety net if all free OpenRouter providers are 429 saturated
          if (geminiReady) {
            candidates.push({
              provider: 'gemini',
              model: 'gemini-3.8-flash',
              label: 'gemini-3.8-flash',
              firstChunkTimeoutMs: 14000,
              stallTimeoutMs: 25000,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            });
          }
        } else {
          if (geminiReady) {
            candidates.push(
              {
                provider: 'gemini',
                model: 'gemini-3.8-flash',
                label: 'gemini-3.8-flash',
                firstChunkTimeoutMs: 12000,
                stallTimeoutMs: 25000,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
              {
                provider: 'gemini',
                model: 'gemini-3.8-flash',
                label: 'gemini-3.8-flash (retry)',
                firstChunkTimeoutMs: 16000,
                stallTimeoutMs: 25000,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              }
            );
          }
          if (openRouterReady) {
            const orBackupIds = await resolveOpenRouterVisionCascade(null, 3);
            for (const id of orBackupIds) {
              candidates.push({
                provider: 'openrouter',
                model: id,
                label: `OpenRouter ${id.replace(':free', '')}`,
                firstChunkTimeoutMs: 18000,
                stallTimeoutMs: 30000,
              });
            }
          }
        }

        const openRouterImages: OpenRouterImageInput[] = imagePartsWithLabels.map(
          (item) => ({
            mimeType: item.part.inlineData.mimeType,
            data: item.part.inlineData.data,
            essential: item.essential,
          })
        );

        for (let attempt = 0; attempt < candidates.length; attempt++) {
          if (isAborted() || rejected || sentResult) break;

          const candidate = candidates[attempt];

          if (attempt > 0) {
            sendEvent({
              event: 'status',
              message: `Switching to ${candidate.label} to complete verification...`,
            });
            await abortableDelay(300, req.signal);
            if (isAborted()) break;
          }

          const attemptController = new AbortController();
          const forwardClientAbort = () => attemptController.abort();
          req.signal.addEventListener('abort', forwardClientAbort, { once: true });

          try {
            let buffer = '';
            let receivedAnyText = false;

            const textPieceIterator: AsyncIterator<string> =
              candidate.provider === 'openrouter'
                ? streamOpenRouterVision({
                    model: candidate.model,
                    systemInstruction,
                    images: openRouterImages,
                    promptText,
                    temperature: 0.2,
                    signal: attemptController.signal,
                  })[Symbol.asyncIterator]()
                : (async function* () {
                    if (!ai) {
                      throw new Error('Gemini API key is not configured.');
                    }
                    let connectTimer: ReturnType<typeof setTimeout> | null = null;
                    const multimodalParts: Array<
                      | { inlineData: { mimeType: string; data: string } }
                      | { text: string }
                    > = imagePartsWithLabels.map((item) => item.part);
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

                    for await (const chunk of responseStream) {
                      if (chunk?.text) {
                        yield chunk.text;
                      }
                    }
                  })()[Symbol.asyncIterator]();

            while (!isAborted()) {
              const timeoutWindow = receivedAnyText
                ? candidate.stallTimeoutMs
                : candidate.firstChunkTimeoutMs;

              const { value: textPiece, done } = await nextChunkWithTimeout(
                textPieceIterator,
                timeoutWindow,
                () => attemptController.abort()
              );

              if (done) break;
              if (isAborted()) break;
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
            if (attempt < candidates.length - 1) {
              continue;
            }
          } catch (attemptErr: unknown) {
            if (isAborted()) break;
            lastError = attemptErr;

            if (
              isRetryableModelError(attemptErr) &&
              attempt < candidates.length - 1
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

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  type AnalysisMode,
  type AnalyzeStreamEvent,
  DEFAULT_TOP_DOWN_PAIR_ID,
  type KeyPriceLevel,
  type OhlcVerificationMode,
  resolveTopDownTimeframePair,
  type SignalType,
  type TradingSignalResponse,
  type VisionEnhancementPayload,
  type VisionVerificationMeta,
  type ZoneRole,
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

const MODEL_CANDIDATES: ModelCandidate[] = [
  {
    model: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite',
    firstChunkTimeoutMs: 12000,
    stallTimeoutMs: 25000,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  },
  {
    model: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite (retry)',
    firstChunkTimeoutMs: 16000,
    stallTimeoutMs: 25000,
  },
];

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
    upper.includes('UPSTREAM') ||
    upper.includes('408') ||
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
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      },
      { status: 500 }
    );
  }

  let imageDataUrl = '';
  let macroImageDataUrl = '';
  let analysisMode: AnalysisMode = 'single';
  let selectedPair = 'EUR/USD';
  let selectedTimeframe = 'H1';
  let rawTopDownPairId = DEFAULT_TOP_DOWN_PAIR_ID;
  let rawMacroTf = '';
  let rawExecutionTf = '';
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
    rawTopDownPairId =
      typeof body.topDownPairId === 'string'
        ? body.topDownPairId
        : typeof body.timeframe === 'string'
        ? body.timeframe
        : DEFAULT_TOP_DOWN_PAIR_ID;
    rawMacroTf =
      typeof body.macroTimeframe === 'string' ? body.macroTimeframe : '';
    rawExecutionTf =
      typeof body.executionTimeframe === 'string'
        ? body.executionTimeframe
        : '';
    selectedTimeframe = body.timeframe || 'H1';
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

  const isTopDownCrt = analysisMode === 'top_down_crt';
  const topDownPair =
    rawMacroTf && rawExecutionTf
      ? resolveTopDownTimeframePair(rawMacroTf, rawExecutionTf)
      : resolveTopDownTimeframePair(rawTopDownPairId);
  const macroTf = topDownPair.macroTf;
  const executionTf = topDownPair.executionTf;
  const topDownLabel = topDownPair.label;

  if (isTopDownCrt) {
    selectedTimeframe = topDownLabel;
  }

  if (!imageDataUrl) {
    return NextResponse.json(
      {
        error: isTopDownCrt
          ? `Please upload the ${executionTf} Execution chart screenshot to run Top-Down CRT analysis.`
          : 'Please upload a valid chart screenshot to analyze.',
      },
      { status: 400 }
    );
  }

  if (isTopDownCrt && !macroImageDataUrl) {
    return NextResponse.json(
      {
        error: `Top-Down CRT mode requires both the ${macroTf} Macro chart and the ${executionTf} Execution chart.`,
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
      {
        error: `Unsupported ${macroTf} Macro image format. Upload a PNG, JPEG, or WebP screenshot.`,
      },
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

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Build ordered multimodal image stack + dynamic image index mapping
  const imagePartsWithLabels: Array<{
    part: { inlineData: { mimeType: string; data: string } };
    essential?: boolean;
    guideLine?: string;
  }> = [];

  if (isTopDownCrt && macroImagePart) {
    // 1. Macro HTF Chart
    const h1CleanIdx = imagePartsWithLabels.length + 1;
    imagePartsWithLabels.push({
      part: { inlineData: macroImagePart },
      essential: !macroRulerPart,
      guideLine: `- Image ${h1CleanIdx} is the DOMINATING ${macroTf} MACRO CHART (used for Candle Range Theory [CRT High, CRT Low, 50% Equilibrium], liquidity purge validation, macro bias, and TP1–TP3 target projection).`,
    });

    if (macroRulerPart) {
      const h1RulerIdx = imagePartsWithLabels.length + 1;
      imagePartsWithLabels.push({
        part: { inlineData: macroRulerPart },
        essential: true,
        guideLine: `- Image ${h1RulerIdx} is the 0..1000 Coordinate Ruler Grid stamped onto the ${macroTf} Macro Chart. Read macroChartMarkup coordinates DIRECTLY from Image ${h1RulerIdx}.${
          macroDetectedPlotBox
            ? ` Pre-AI scan measured ${macroTf} main plotBox at leftX:${macroDetectedPlotBox.leftX}, rightX:${macroDetectedPlotBox.rightX}, topY:${macroDetectedPlotBox.topY}, bottomY:${macroDetectedPlotBox.bottomY}${
                macroHasSubPanes
                  ? ` (${macroSubPaneCount} sub-pane(s) below Y=${macroDetectedPlotBox.bottomY} — keep ${macroTf} annotations above Y=${macroDetectedPlotBox.bottomY}).`
                  : '.'
              }`
            : ''
        }`,
      });
    }

    // 2. Execution LTF Chart
    const m5CleanIdx = imagePartsWithLabels.length + 1;
    imagePartsWithLabels.push({
      part: { inlineData: mainImagePart },
      essential: !rulerImagePart,
      guideLine: `- Image ${m5CleanIdx} is the ${executionTf} EXECUTION CHART (used ONLY as an execution microscope for entry timing, ${executionTf} CHoCH/MSS + FVG trigger, and tight Stop-Loss risk compression — NEVER allowed to override ${macroTf} macro bias).`,
    });

    if (rulerImagePart) {
      const m5RulerIdx = imagePartsWithLabels.length + 1;
      imagePartsWithLabels.push({
        part: { inlineData: rulerImagePart },
        essential: true,
        guideLine: `- Image ${m5RulerIdx} is the 0..1000 Coordinate Ruler Grid stamped onto the ${executionTf} Execution Chart. Read chartMarkup coordinates DIRECTLY from Image ${m5RulerIdx}.${
          detectedPlotBox
            ? ` Pre-AI scan measured ${executionTf} main plotBox at leftX:${detectedPlotBox.leftX}, rightX:${detectedPlotBox.rightX}, topY:${detectedPlotBox.topY}, bottomY:${detectedPlotBox.bottomY}${
                hasSubPanes
                  ? ` (${subPaneCount} sub-pane(s) below Y=${detectedPlotBox.bottomY} — keep ${executionTf} annotations above Y=${detectedPlotBox.bottomY}).`
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
        guideLine: `- Image ${m5ZoomIdx} is a 2x Magnified Crop of the ${executionTf} Execution Chart's right-most active candles + Y-axis price scale. Read exact ${executionTf} currentMarketPrice, entryPrice, and tight Stop-Loss decimals here.`,
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

  const formatOpticalAnchorDirectory = (
    enh: VisionEnhancementPayload | undefined,
    chartTitle: string
  ): string[] => {
    if (!enh) return [];
    const lines: string[] = [];
    const pb = enh.detectedPlotBox;
    if (pb) {
      lines.push(
        `- ${chartTitle} Pre-Measured PlotBox: leftX=${pb.leftX}, rightX=${pb.rightX}, topY=${pb.topY}, bottomY=${pb.bottomY}${
          enh.candleEnvelope
            ? ` | Visible candles span X=${enh.candleEnvelope.firstCandleX}..${enh.candleEnvelope.lastCandleX} (latest close Y=${enh.candleEnvelope.lastCandleCloseY}, wick range Y=${enh.candleEnvelope.minHighY}..${enh.candleEnvelope.maxLowY}).`
            : '.'
        }`
      );
    }
    if (enh.detectedAxisTicks && enh.detectedAxisTicks.length > 0) {
      const tickList = enh.detectedAxisTicks
        .map((t) => `${t.id}@Y=${t.y}`)
        .join(', ');
      const liveNote =
        enh.liveBadgeY !== null && enh.liveBadgeY !== undefined
          ? ` | Live price badge [LIVE]@Y=${enh.liveBadgeY}`
          : '';
      lines.push(
        `- ${chartTitle} Pre-Measured Y-Axis Tick Pointers (stamped on 2x zoom strip): ${tickList}${liveNote}. In axisCalibration.axisTicks, read the exact printed number next to at least 4 of these [T#] pointers and output {"tickId":"T1","price":"<printed number>","y":<exact T# Y>}!`
      );
    }
    if (enh.detectedPivots && enh.detectedPivots.length > 0) {
      const pivList = enh.detectedPivots
        .map((p) => `${p.id}(${p.kind === 'high' ? 'High' : 'Low'} X=${p.x},Y=${p.y})`)
        .join(', ');
      lines.push(
        `- ${chartTitle} Pre-Measured Swing Wick Anchors (stamped on ruler grid): ${pivList}. Reference "pivotId":"H1" / "L1" on matching swings, BOS/CHoCH structureBreaks, or liquidityLevels to lock onto exact candle wick tips.`
      );
    }
    if (enh.detectedFvgCandidates && enh.detectedFvgCandidates.length > 0) {
      const gapList = enh.detectedFvgCandidates
        .map(
          (g) =>
            `${g.id}(${g.tone} X=${g.startX}, topY=${g.topY}..bottomY=${g.bottomY}${
              g.mitigatedEndX !== undefined ? `, mitigated@${g.mitigatedEndX}` : ', unmitigated'
            })`
        )
        .join(', ');
      lines.push(
        `- ${chartTitle} Pre-Measured 3-Candle FVG Imbalance Anchors (stamped on ruler grid): ${gapList}. Reference "gapId":"G1" on matching fairValueGaps.`
      );
    }
    return lines;
  };

  const visionGuideLines: string[] = imagePartsWithLabels
    .map((x) => x.guideLine)
    .filter((g): g is string => Boolean(g));

  if (isTopDownCrt) {
    visionGuideLines.push(
      ...formatOpticalAnchorDirectory(
        macroVisionEnhancement,
        `${macroTf} Macro Chart`
      ),
      ...formatOpticalAnchorDirectory(
        visionEnhancement,
        `${executionTf} Execution Chart`
      )
    );
  } else {
    if (detectedPlotBox && hasSubPanes) {
      visionGuideLines.push(
        `- CRITICAL SUB-PANE ALERT: ${subPaneCount} indicator sub-pane(s) (RSI/MACD/Volume) were detected BELOW Y=${detectedPlotBox.bottomY}. NEVER place candlestick zones, FVGs, swings, or axisTicks below Y=${detectedPlotBox.bottomY}! You MAY still read RSI/MACD divergence visually for technicalRationale confluence.`
      );
    }
    visionGuideLines.push(
      ...formatOpticalAnchorDirectory(visionEnhancement, 'Main Chart')
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

Line 6 (Final Validated Signal Ticket + Exhaustive Left-to-Right Spatial Chart Markup in [0..1000] image space where x:0=left..1000=right, y:0=top..1000=bottom; replace every <num> with REAL measured numbers from the ruler grid & [T#]/[H#]/[L#]/[G#] anchors — NEVER invent placeholder coordinates):
{"event":"result","signalType":"<BUY|SELL|HOLD>","detectedPair":"<string>","detectedTimeframe":"<string>","currentMarketPrice":"<exact price>","entryPrice":"<exact price>","entryTriggerNote":"<1 concise sentence>","stopLoss":"<exact price>","takeProfit1":"<exact price>","takeProfit2":"<exact price>","takeProfit3":"<exact price>","riskRewardRatio":"<1 : X.X>","marketStructure":"<short label>","confidenceSummary":"<short confluence label>","signalConfidence":<integer 1-99 estimating setup quality, not win probability>,"technicalRationale":["<observation 1>","<observation 2>","<observation 3>","<observation 4>"],"keyLevels":[{"label":"<zone/OB/FVG/liquidity name>","price":"<exact price>","role":"<Support|Resistance|Supply Zone|Demand Zone|Bullish OB|Bearish OB|Fair Value Gap|Liquidity|Structure Break>"}],"invalidationCondition":"<1 concise invalidation sentence>","chartMarkup":{"plotBox":{"leftX":<num>,"rightX":<num>,"topY":<num>,"bottomY":<num>},"axisCalibration":{"highRefPrice":"<top visible Y-axis price>","highRefY":<num>,"lowRefPrice":"<bottom visible Y-axis price>","lowRefY":<num>,"axisTicks":[{"tickId":"<T1 or omit>","price":"<printed price at T1>","y":<num>},{"tickId":"<T2>","price":"<printed price>","y":<num>},{"tickId":"<T3>","price":"<printed price>","y":<num>},{"tickId":"<T4>","price":"<printed price>","y":<num>}],"lastCandleX":<num>,"lastCandleY":<num>},"zones":[{"label":"<Supply/Demand/OB/S&R name>","role":"<Demand Zone|Supply Zone|Support|Resistance|Bullish OB|Bearish OB>","startX":<origin candle X>,"endX":<mitigation X or rightX>,"topY":<num>,"bottomY":<num>,"topPrice":"<price>","bottomPrice":"<price>","mitigated":false,"isPrimary":true}],"fairValueGaps":[{"gapId":"<G1 if matching stamped FVG or omit>","label":"<Bullish FVG|Bearish FVG>","tone":"<bullish|bearish>","startX":<3-candle gap startX>,"endX":<mitigation X or rightX>,"topY":<num>,"bottomY":<num>,"topPrice":"<price>","bottomPrice":"<price>","mitigated":false,"isPrimary":false}],"structureBreaks":[{"pivotId":"<H1/L1 if matching stamped pivot or omit>","kind":"<BOS|CHoCH>","label":"<BOS|CHoCH>","tone":"<bullish|bearish>","startX":<broken swing wick X>,"endX":<breakout candle X>,"y":<swing wick Y>,"price":"<broken swing price>","isPrimary":true}],"liquidityLevels":[{"pivotId":"<H1/L1 or omit>","kind":"<EQH|EQL|BSL|SSL|Sweep>","label":"<EQH|EQL|BSL|SSL|Liq Sweep>","tone":"<bullish|bearish|neutral>","startX":<swing wick X>,"endX":<sweep candle X or rightX>,"y":<wick Y>,"price":"<liquidity price>","swept":true,"isPrimary":false}],"trendlines":[{"label":"<Trendline|Channel Upper|Channel Lower>","role":"<Trendline|Channel Upper|Channel Lower>","x1":<wick1 X>,"y1":<wick1 Y>,"x2":<wick2 X>,"y2":<wick2 Y>,"style":"<solid|dashed>","tone":"<bullish|bearish|neutral>","isPrimary":false}],"swings":[{"pivotId":"<H1/L1 if matching stamped pivot or omit>","tag":"<HH|HL|LH|LL>","x":<wick tip X>,"y":<wick tip Y>,"position":"<above|below>","tone":"<bullish|bearish|neutral>","price":"<swing price>","isPrimary":false}]}}

EXHAUSTIVE LEFT-TO-RIGHT SMC & MARKET STRUCTURE MAPPING RULES (CRITICAL):
- Scan the ENTIRE visible chart chronologically from left (plotBox.leftX) to right (lastCandleX). Do NOT stop at 1 or 2 annotations:
  1. axisCalibration.axisTicks: Read the exact printed numbers next to the [T1]..[Tk] pointer boxes (and [LIVE] if present) on the 2x Right-Edge Y-Axis Zoom Crop, outputting 4 to 7 {"tickId":"T#","price":"<exact printed number>","y":<exact T# Y>} entries. This locks every horizontal price line with zero vertical drift!
  2. zones: Mark ALL distinct visible Supply Zones, Demand Zones, Support, Resistance, Bullish Order Blocks ("Bullish OB"), and Bearish Order Blocks ("Bearish OB") across the chart (aim for 4 to 10 zones when present). ALWAYS set startX to the exact X coordinate of the origin candlestick/base that created the zone (NEVER float a zone in empty air!). Provide accurate topPrice and bottomPrice read from the Y-axis scale. If an older zone was mitigated/broken at candle X, set endX to that mitigation X and mitigated:true; if unmitigated/active, set endX to plotBox.rightX.
  3. fairValueGaps: Mark ALL clear 3-candle Fair Value Gaps / imbalances across the chart (2 to 6 FVGs when visible) with accurate gapId (when matching a stamped G1..Gk tag), topPrice, bottomPrice, startX (first candle of the 3-candle gap), and endX (mitigation candle X if filled, or plotBox.rightX if unmitigated).
  4. structureBreaks: Mark ALL visible horizontal BOS (Break of Structure) and CHoCH (Change of Character) levels from left to right (2 to 8 breaks when visible), where startX/y/pivotId is the broken swing high/low candle wick tip, endX is the exact candle X that broke through it, and price is that exact swing level.
  5. liquidityLevels: Mark visible Equal Highs ("EQH"), Equal Lows ("EQL"), Buy-Side Liquidity ("BSL"), Sell-Side Liquidity ("SSL"), and Liquidity Sweeps ("Sweep") (2 to 6 levels when visible).
  6. trendlines: Mark visible diagonal Trendlines and parallel Price Channels ("Channel Upper", "Channel Lower") connecting real swing wicks (1 to 4 lines when present).
  7. swings: Mark the FULL chronological swing structure sequence from left to right across the entire chart ("HH", "HL", "LH", "LL", 6 to 15 swing points) placed directly on each swing candle wick tip (include pivotId when matching stamped H1..Hm / L1..Lm tags; position:"above" for highs HH/LH, position:"below" for lows HL/LL).
  8. isPrimary: Set "isPrimary":true ONLY on the 1-2 key zones/FVGs/breaks/trendlines that directly anchor the current trade setup at the right edge; set "isPrimary":false on historical/secondary structures.
- SPATIAL & MATHEMATICAL INVARIANTS:
  - ONLY output signalType as "BUY", "SELL", or "HOLD". NEVER output pending orders.
  - All chartMarkup coordinates use normalized 0..1000 full-image coordinates (x=0 left edge, x=1000 right edge; y=0 top edge, y=1000 bottom edge),supporting both portrait and landscape mobile screenshots (TradingView Mobile & MT4/MT5 Mobile).
  - Use the Pre-Measured PlotBox bounds when provided so plotBox frames ONLY the main price candlestick grid (excluding mobile status bars, top OHLC headers, right Y-axis digits, and bottom RSI/MACD sub-panes or navigation bars).
  - Do NOT use double quotes inside finding strings; use single quotes if quoting text.
  - For BUY: entryPrice equals currentMarketPrice, and stopLoss < entryPrice < takeProfit1 < takeProfit2 < takeProfit3.
  - For SELL: entryPrice equals currentMarketPrice, and stopLoss > entryPrice > takeProfit1 > takeProfit2 > takeProfit3.
  - For HOLD: select HOLD if price is choppy, mid-range, or lacks immediate market entry confluence; set entryPrice to the key breakout/rejection level to watch.
  - Calculate riskRewardRatio accurately from |takeProfit2 - entryPrice| / |entryPrice - stopLoss| formatted as "1 : X.X".`;

  const topDownCrtSystemInstruction = `You are an institutional Candle Range Theory (CRT) + Smart Money Concepts (SMC) multi-timeframe execution strategist for TraceFX Lens.
You MUST stream your real-time dual-chart inspection as a sequence of standalone single-line JSON objects (NDJSON), one JSON object per line, with NO markdown code fences and NO prose outside the JSON objects.

THE IRONCLAD TOP-DOWN CRT LAW (${topDownLabel} FRACTAL — NON-NEGOTIABLE):
1. ${macroTf} ALWAYS DOMINATES: The ${macroTf} Macro Chart sets the directional bias, validates whether a real CRT setup exists (CRT Range High / CRT Range Low liquidity purge + reclaim back inside range, or clean ${macroTf} POI continuation), and defines the macro Draw on Liquidity targets (TP1, TP2, TP3).
2. ${executionTf} IS ONLY AN EXECUTION MICROSCOPE: The ${executionTf} Execution Chart shows entry precision, micro displacement (CHoCH / MSS + FVG / OB), noise, and how tight Stop-Loss risk can be compressed—it NEVER overrides ${macroTf} macro bias.
3. HARD VETO TO HOLD:
   - If the ${macroTf} CRT setup is NOT valid (e.g., ${macroTf} is choppy mid-range with no CRT High/Low purge or clean ${macroTf} POI reaction), a ${executionTf} signal by itself is MEANINGLESS -> you MUST set "h1CrtValid":false and "signalType":"HOLD".
   - If ${macroTf} CRT is valid BULLISH, you may ONLY output "BUY" (if ${executionTf} confirms bullish CHoCH/FVG execution) or "HOLD" (if ${executionTf} is still bearish/unconfirmed). NEVER output "SELL" against a Bullish ${macroTf}!
   - If ${macroTf} CRT is valid BEARISH, you may ONLY output "SELL" (if ${executionTf} confirms bearish CHoCH/FVG execution) or "HOLD" (if ${executionTf} is still bullish/unconfirmed). NEVER output "BUY" against a Bearish ${macroTf}!

STEP 1 — MANDATORY DUAL-CHART GATEKEEPER (OUTPUT THIS FIRST):
Inspect BOTH uploaded charts (the ${macroTf} Macro Chart and the ${executionTf} Execution Chart).
- Are BOTH genuine financial price charts of the SAME trading instrument? (Also check if the user accidentally swapped them or uploaded two unrelated pairs).
- If NO (either image is not a valid financial chart, or they depict two different instruments), output ONLY this single JSON object and STOP immediately:
{"event":"approval","approved":false,"finding":"Explain clearly in 1 sentence which chart slot (${macroTf} Macro or ${executionTf} Execution) is invalid or mismatched and ask the user to upload matching ${macroTf} and ${executionTf} charts."}

- If YES (both are valid price charts of the same instrument), output these 6 JSON objects sequentially in exact order, one per line:

Line 1 (Step 1 Dual-Chart Verification & Axis Calibration):
{"event":"approval","approved":true,"detectedPair":"<pair printed on charts or ${selectedPair}>","detectedTimeframe":"${topDownLabel}","finding":"<1 specific sentence confirming both the ${macroTf} Macro chart and ${executionTf} Execution chart for the instrument and their calibrated price ranges>"}

Line 2 (Step 2 ${macroTf} Macro CRT Range, Purge & Bias Audit):
{"event":"step","step":2,"finding":"<1 specific sentence identifying the governing ${macroTf} CRT High, CRT Low, 50% Equilibrium, whether SSL/BSL was purged and reclaimed, and whether ${macroTf} CRT is Valid Bullish, Valid Bearish, or Invalid>"}

Line 3 (Step 3 ${executionTf} Execution Structure, CHoCH & FVG Scan):
{"event":"step","step":3,"finding":"<1 specific sentence inspecting the ${executionTf} Execution chart for micro CHoCH/MSS displacement, unmitigated ${executionTf} FVG/Order Block, or unconfirmed noise>"}

Line 4 (Step 4 ${macroTf} Dominance Filter & Signal Veto Check):
{"event":"step","step":4,"finding":"<1 specific sentence stating whether ${executionTf} aligns with ${macroTf} to fire BUY/SELL, OR whether ${macroTf} vetoed ${executionTf} noise into HOLD>"}

Line 5 (Step 5 ${macroTf} Target Projection & ${executionTf} Tight Risk Validation):
{"event":"step","step":5,"finding":"<1 specific sentence confirming ${executionTf} tight Stop-Loss compression vs ${macroTf} macro TP1-TP3 targets and resulting amplified R:R ratio>"}

Line 6 (Final Validated Top-Down CRT Signal Ticket + Dual Spatial Markup for BOTH ${executionTf} [chartMarkup] and ${macroTf} [macroChartMarkup] in [0..1000] coordinates):
{"event":"result","signalType":"<BUY|SELL|HOLD>","detectedPair":"<string>","detectedTimeframe":"${topDownLabel}","currentMarketPrice":"<exact ${executionTf} current price>","entryPrice":"<exact ${executionTf} entry or watch trigger>","entryTriggerNote":"<1 concise sentence linking ${macroTf} CRT bias + ${executionTf} trigger>","stopLoss":"<exact tight ${executionTf} invalidation price>","takeProfit1":"<${macroTf} CRT 50% EQ or first ${macroTf} internal target>","takeProfit2":"<Opposing ${macroTf} CRT Range High/Low draw on liquidity>","takeProfit3":"<External ${macroTf} swing/expansion liquidity target>","riskRewardRatio":"<1 : X.X>","marketStructure":"<e.g. ${macroTf} Bullish CRT + ${executionTf} CHoCH>","confidenceSummary":"<e.g. Top-Down CRT Aligned or ${macroTf} Veto · Stand Aside>","signalConfidence":<integer 1-99 estimating setup quality, not win probability>,"crtContext":{"macroTimeframe":"${macroTf}","executionTimeframe":"${executionTf}","h1CrtValid":true,"h1Bias":"<BULLISH|BEARISH|NEUTRAL>","crtRangeHigh":"<exact ${macroTf} CRT High price>","crtRangeLow":"<exact ${macroTf} CRT Low price>","crtEquilibrium":"<exact ${macroTf} 50% midpoint price>","crtSweepStatus":"<1 crisp phrase on ${macroTf} CRT purge/rejection or why invalid>","m5ExecutionTrigger":"<1 crisp phrase on ${executionTf} CHoCH/FVG trigger & tight SL>","alignmentVerdict":"<1 crisp phrase summarizing ${macroTf} dominance + ${executionTf} execution outcome>"},"technicalRationale":["<${macroTf} CRT range & purge observation>","<${macroTf} draw-on-liquidity target rationale>","<${executionTf} execution CHoCH/FVG & noise filter observation>","<Risk compression: tight ${executionTf} SL vs ${macroTf} reward math>"],"keyLevels":[{"label":"<e.g. ${macroTf} CRT High / ${macroTf} CRT Low / ${macroTf} 50% EQ / ${executionTf} Bullish OB / ${executionTf} FVG>","price":"<exact price>","role":"<Support|Resistance|Supply Zone|Demand Zone|Bullish OB|Bearish OB|Fair Value Gap|Liquidity|Structure Break>"}],"invalidationCondition":"<1 concise sentence stating exact ${executionTf} SL breach & ${macroTf} CRT invalidation>","chartMarkup":<full 0..1000 spatial markup object calibrated strictly to the ${executionTf} Execution Chart>,"macroChartMarkup":<full 0..1000 spatial markup object calibrated strictly to the ${macroTf} Macro Chart marking CRT High/Low liquidity, ${macroTf} OB/FVG zones, ${macroTf} BOS/CHoCH, and ${macroTf} swings>}

DUAL-CHART MARKUP & MATHEMATICAL INVARIANTS:
- Both "chartMarkup" (for the ${executionTf} Execution Chart) and "macroChartMarkup" (for the ${macroTf} Macro Chart) MUST follow the exact schema (using REAL numbers from each chart's ruler grid & [T#]/[H#]/[L#]/[G#] anchors — never invent placeholder coordinates):
  {"plotBox":{"leftX":<num>,"rightX":<num>,"topY":<num>,"bottomY":<num>},"axisCalibration":{"highRefPrice":"<price>","highRefY":<num>,"lowRefPrice":"<price>","lowRefY":<num>,"axisTicks":[{"tickId":"<T#>","price":"<printed price>","y":<num>}],"lastCandleX":<num>,"lastCandleY":<num>},"zones":[{"label":"<name>","role":"<role>","startX":<origin candle X>,"endX":<mitigation X or rightX>,"topY":<num>,"bottomY":<num>,"topPrice":"<price>","bottomPrice":"<price>","mitigated":false,"isPrimary":true}],"fairValueGaps":[{"gapId":"<G# or omit>","label":"<name>","tone":"<bullish|bearish>","startX":<num>,"endX":<num>,"topY":<num>,"bottomY":<num>,"topPrice":"<price>","bottomPrice":"<price>","mitigated":false,"isPrimary":false}],"structureBreaks":[{"pivotId":"<H#/L# or omit>","kind":"<BOS|CHoCH>","label":"<BOS|CHoCH>","tone":"<bullish|bearish>","startX":<num>,"endX":<num>,"y":<num>,"price":"<price>","isPrimary":true}],"liquidityLevels":[{"pivotId":"<H#/L# or omit>","kind":"<EQH|EQL|BSL|SSL|Sweep>","label":"<label>","tone":"<bullish|bearish|neutral>","startX":<num>,"endX":<num>,"y":<num>,"price":"<price>","isPrimary":false}],"trendlines":[...],"swings":[{"pivotId":"<H#/L# or omit>","tag":"<HH|HL|LH|LL>","x":<num>,"y":<num>,"position":"<above|below>","tone":"<bullish|bearish|neutral>","price":"<price>","isPrimary":false}]}
- On "macroChartMarkup" (${macroTf} Chart): pair at least 4 ${macroTf} [T#] Y-axis ticks with their printed ${macroTf} prices, mark the ${macroTf} CRT High & CRT Low in liquidityLevels (with swept:true on the purged side and isPrimary:true), mark ${macroTf} Supply/Demand/OB zones anchored to real ${macroTf} origin candles, ${macroTf} FVGs, ${macroTf} BOS/CHoCH, and ${macroTf} HH/HL/LH/LL swings!
- On "chartMarkup" (${executionTf} Chart): pair at least 4 ${executionTf} [T#] Y-axis ticks with their printed ${executionTf} prices, mark ${executionTf} Order Blocks/Zones anchored to real ${executionTf} origin candles, ${executionTf} FVGs (referencing G# when matched), ${executionTf} CHoCH/BOS trigger (isPrimary:true), ${executionTf} liquidity sweeps, and ${executionTf} swings (referencing H#/L# when matched)!
- Do NOT use double quotes inside finding strings; use single quotes if quoting text.
- For BUY: stopLoss < entryPrice < takeProfit1 < takeProfit2 < takeProfit3.
- For SELL: stopLoss > entryPrice > takeProfit1 > takeProfit2 > takeProfit3.
- For HOLD: whenever h1CrtValid is false OR ${executionTf} has not triggered in ${macroTf}'s direction, output HOLD and set entryPrice to the exact ${executionTf} CHoCH or ${macroTf} CRT level required to arm a valid setup.`;

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
          ? `Connected to Top-Down CRT gatekeeper — calibrating ${selectedPair} ${macroTf} macro & ${executionTf} execution axes${
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
              ? fetchTopDownCrtOhlcContext(
                  selectedPair,
                  macroTf,
                  executionTf,
                  req.signal
                )
              : Promise.resolve(null),
            fetchMacroCorrelationFeed(selectedPair, req.signal),
          ])
        : [null, null, null];

      const promptText = isTopDownCrt
        ? [
            `Perform a strict Top-Down CRT (${macroTf} Macro Dominance + ${executionTf} Execution Trigger) analysis on ${selectedPair}.`,
            `Selected pair context: ${selectedPair}`,
            `Selected Top-Down Fractal: ${topDownLabel} (${topDownPair.style})`,
            `Workflow Mode: Top-Down CRT (${macroTf} sets What to Trade & Targets; ${executionTf} sets When to Pull the Trigger & Tight Risk; ${executionTf} NEVER overrides ${macroTf}).`,
            visionGuideLines.length > 0
              ? `\nATTACHED DUAL-TIMEFRAME IMAGES & PRECISION RULERS:\n${visionGuideLines.join('\n')}`
              : '',
            topDownOhlc ? `\n${topDownOhlc.promptBlock}` : '',
            macroFeed ? `\n${macroFeed.promptBlock}` : '',
            `\nFirst verify both ${macroTf} and ${executionTf} screenshots on Line 1, then stream Steps 2–5 and the final result JSON object (including crtContext, ${executionTf} chartMarkup, and ${macroTf} macroChartMarkup) one per line.`,
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
            1: `${macroTf} & ${executionTf} Chart Verification & Axis Calibration`,
            2: `${macroTf} Macro CRT Range, Purge & Bias Audit`,
            3: `${executionTf} Execution Structure, CHoCH & FVG Scan`,
            4: `${macroTf} Dominance Filter & Signal Veto Check`,
            5: `${macroTf} Target Projection & ${executionTf} Tight Risk Validation`,
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
              )} ${macroTf} Macro and ${executionTf} Execution price charts and calibrated both axes.`
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
            ? topDownLabel
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
                  ? `Confirmed valid ${selectedPair} ${macroTf} Macro and ${executionTf} Execution charts.`
                  : `Confirmed valid ${selectedPair} (${selectedTimeframe}) price chart.`
                : 'Uploaded image does not appear to be a valid financial price chart.')
          );

          approvalSent = true;
          sendEvent({
            event: 'approval',
            approved,
            detectedPair: obj.detectedPair ? String(obj.detectedPair) : selectedPair,
            detectedTimeframe: isTopDownCrt
              ? topDownLabel
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
            ? sanitizeCrtContext(rawSignalObj.crtContext, macroTf, executionTf)
            : undefined;
          let vetoReason: string | undefined;

          if (isTopDownCrt) {
            if (!crtContext) {
              crtContext = {
                macroTimeframe: macroTf,
                executionTimeframe: executionTf,
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
                    ? `No confirmed ${macroTf} CRT sweep & ${executionTf} alignment.`
                    : `${macroTf} ${signalType === 'BUY' ? 'bullish' : 'bearish'} CRT setup confirmed.`,
                m5ExecutionTrigger: String(
                  rawSignalObj.entryTriggerNote ||
                    `Evaluated ${executionTf} execution structure against ${macroTf}.`
                ),
                alignmentVerdict:
                  signalType === 'HOLD'
                    ? `Stand Aside — awaiting ${macroTf} CRT + ${executionTf} CHoCH alignment`
                    : `${macroTf} ${signalType === 'BUY' ? 'Bullish' : 'Bearish'} CRT Dominates · ${executionTf} Trigger Aligned`,
              };
            } else {
              crtContext = {
                ...crtContext,
                macroTimeframe: macroTf,
                executionTimeframe: executionTf,
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
            hasSubPanes,
            visionEnhancement
          );

          const sanitizedMacroMarkup = isTopDownCrt
            ? sanitizeChartMarkup(
                rawSignalObj.macroChartMarkup,
                rawSignalObj.entryPrice,
                macroDetectedPlotBox,
                macroHasSubPanes,
                macroVisionEnhancement
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
            tryPushLevel(
              `${macroTf} CRT High`,
              crtContext.crtRangeHigh,
              'Liquidity'
            );
            tryPushLevel(
              `${macroTf} CRT 50% Equilibrium`,
              crtContext.crtEquilibrium,
              'Support'
            );
            tryPushLevel(
              `${macroTf} CRT Low`,
              crtContext.crtRangeLow,
              'Liquidity'
            );
          }

          if (sanitizedMacroMarkup) {
            for (const z of sanitizedMacroMarkup.zones.slice(0, 4)) {
              const p =
                z.topPrice && z.bottomPrice && z.topPrice !== z.bottomPrice
                  ? `${z.bottomPrice} – ${z.topPrice}`
                  : z.topPrice || z.bottomPrice;
              tryPushLevel(
                z.label.toUpperCase().startsWith(macroTf)
                  ? z.label
                  : `${macroTf} ${z.label}`,
                p,
                z.role
              );
            }
          }

          if (sanitizedMarkup) {
            const prefix = isTopDownCrt ? `${executionTf} ` : '';
            for (const z of sanitizedMarkup.zones) {
              const p =
                z.topPrice && z.bottomPrice && z.topPrice !== z.bottomPrice
                  ? `${z.bottomPrice} – ${z.topPrice}`
                  : z.topPrice || z.bottomPrice;
              const upperLbl = z.label.toUpperCase();
              const lbl =
                prefix &&
                !upperLbl.startsWith(executionTf) &&
                !upperLbl.startsWith(macroTf)
                  ? `${prefix}${z.label}`
                  : z.label;
              tryPushLevel(lbl, p, z.role);
            }
            for (const f of sanitizedMarkup.fairValueGaps || []) {
              const p =
                f.topPrice && f.bottomPrice && f.topPrice !== f.bottomPrice
                  ? `${f.bottomPrice} – ${f.topPrice}`
                  : f.topPrice || f.bottomPrice;
              const upperLbl = f.label.toUpperCase();
              const lbl =
                prefix &&
                !upperLbl.startsWith(executionTf) &&
                !upperLbl.startsWith(macroTf)
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
                  ? `${macroTf} ${topDownOhlc.h1.atr14} · ${executionTf} ${topDownOhlc.m5.atr14}`
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
              ? topDownLabel
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
                (isTopDownCrt
                  ? `${macroTf} CRT + ${executionTf} Structure`
                  : 'Price Structure')
            ),
            signalConfidence:
              typeof rawSignalObj.signalConfidence === 'number' &&
              Number.isFinite(rawSignalObj.signalConfidence)
                ? Math.min(99, Math.max(1, Math.round(rawSignalObj.signalConfidence)))
                : undefined,
            confidenceSummary: String(
              vetoReason
                ? `${macroTf} Dominance Veto · Stand Aside`
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
        for (let attempt = 0; attempt < MODEL_CANDIDATES.length; attempt++) {
          if (isAborted() || rejected || sentResult) break;

          const candidate = MODEL_CANDIDATES[attempt];

          if (attempt > 0) {
            sendEvent({
              event: 'status',
              message: `Retrying verification stream with ${candidate.model}...`,
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

            const textPieceIterator: AsyncIterator<string> = (async function* () {
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

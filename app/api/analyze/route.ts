import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import type {
  AnalyzeStreamEvent,
  ChartMarkupData,
  ExecutionCategory,
  KeyPriceLevel,
  SignalType,
  TradingSignalResponse,
} from '@/lib/trading-data';

const VALID_SIGNALS: SignalType[] = ['BUY', 'SELL', 'HOLD'];

function normalizeSignalType(raw: unknown): SignalType {
  const upper = String(raw || 'HOLD')
    .trim()
    .toUpperCase()
    .replace(/_/g, ' ');
  if (VALID_SIGNALS.includes(upper as SignalType)) {
    return upper as SignalType;
  }
  if (upper.startsWith('BUY')) return 'BUY';
  if (upper.startsWith('SELL')) return 'SELL';
  return 'HOLD';
}

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
 * Ordered for fastest real-time Step 1 chart verification + zero-hang failover:
 * 1. gemini-3.8-flash with LOW thinking (fast primary reasoning; fails over immediately on 429/503 or timeout)
 * 2. gemini-3.1-flash-lite with native MINIMAL default (no thinkingConfig -> fastest first-token vision response & highest quota availability)
 * 3. gemini-flash-latest with thinkingBudget: 0 (prevents 30s hidden thinking delay before emitting Step 1 approval)
 */
const MODEL_CANDIDATES: ModelCandidate[] = [
  {
    model: 'gemini-3.8-flash',
    label: 'primary vision model',
    firstChunkTimeoutMs: 5500,
    stallTimeoutMs: 9000,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  },
  {
    model: 'gemini-3.1-flash-lite',
    label: 'high-speed vision model',
    firstChunkTimeoutMs: 11000,
    stallTimeoutMs: 10000,
  },
  {
    model: 'gemini-flash-latest',
    label: 'backup vision model',
    firstChunkTimeoutMs: 11000,
    stallTimeoutMs: 10000,
    thinkingConfig: { thinkingBudget: 0 },
  },
];

function deriveExecutionCategory(signal: SignalType): ExecutionCategory {
  if (signal === 'BUY' || signal === 'SELL') return 'Market Execution';
  return 'Stand Aside';
}

function sanitizeChartMarkup(raw: unknown): ChartMarkupData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const pb = (m.plotBox && typeof m.plotBox === 'object'
    ? m.plotBox
    : {}) as Record<string, unknown>;
  const ac = (m.axisCalibration && typeof m.axisCalibration === 'object'
    ? m.axisCalibration
    : {}) as Record<string, unknown>;

  return {
    plotBox: {
      leftX: Number.isFinite(Number(pb.leftX)) ? Number(pb.leftX) : 28,
      rightX: Number.isFinite(Number(pb.rightX)) ? Number(pb.rightX) : 885,
      topY: Number.isFinite(Number(pb.topY)) ? Number(pb.topY) : 55,
      bottomY: Number.isFinite(Number(pb.bottomY)) ? Number(pb.bottomY) : 880,
    },
    axisCalibration: {
      highRefPrice: ac.highRefPrice ? String(ac.highRefPrice) : undefined,
      highRefY: Number.isFinite(Number(ac.highRefY)) ? Number(ac.highRefY) : undefined,
      lowRefPrice: ac.lowRefPrice ? String(ac.lowRefPrice) : undefined,
      lowRefY: Number.isFinite(Number(ac.lowRefY)) ? Number(ac.lowRefY) : undefined,
      axisTicks: Array.isArray(ac.axisTicks)
        ? ac.axisTicks
            .slice(0, 6)
            .map((t) => {
              const tr = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
              const priceStr = tr.price ? String(tr.price).trim() : '';
              const yNum = Number(tr.y);
              if (!priceStr || !Number.isFinite(yNum)) return null;
              return { price: priceStr, y: yNum };
            })
            .filter((t): t is { price: string; y: number } => t !== null)
        : undefined,
      lastCandleX: Number.isFinite(Number(ac.lastCandleX))
        ? Number(ac.lastCandleX)
        : 760,
      lastCandleY: Number.isFinite(Number(ac.lastCandleY))
        ? Number(ac.lastCandleY)
        : 500,
    },
    zones: Array.isArray(m.zones)
      ? m.zones.slice(0, 3).map((z) => {
          const zr = (z && typeof z === 'object' ? z : {}) as Record<string, unknown>;
          const roleStr = String(zr.role || 'Support');
          const validRole = (
            ['Support', 'Resistance', 'Supply Zone', 'Demand Zone', 'Liquidity'] as const
          ).find((r) => r.toLowerCase() === roleStr.toLowerCase()) || 'Support';

          return {
            label: String(zr.label || validRole),
            role: validRole,
            startX: Number.isFinite(Number(zr.startX)) ? Number(zr.startX) : 220,
            topY: Number.isFinite(Number(zr.topY)) ? Number(zr.topY) : 460,
            bottomY: Number.isFinite(Number(zr.bottomY)) ? Number(zr.bottomY) : 500,
            topPrice: zr.topPrice ? String(zr.topPrice) : undefined,
            bottomPrice: zr.bottomPrice ? String(zr.bottomPrice) : undefined,
          };
        })
      : [],
    trendlines: Array.isArray(m.trendlines)
      ? m.trendlines.slice(0, 3).map((t) => {
          const tr = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
          const toneRaw = String(tr.tone || 'neutral').toLowerCase();
          return {
            label: String(tr.label || 'Structure'),
            x1: Number.isFinite(Number(tr.x1)) ? Number(tr.x1) : 180,
            y1: Number.isFinite(Number(tr.y1)) ? Number(tr.y1) : 540,
            x2: Number.isFinite(Number(tr.x2)) ? Number(tr.x2) : 680,
            y2: Number.isFinite(Number(tr.y2)) ? Number(tr.y2) : 440,
            style: String(tr.style || '').toLowerCase() === 'dashed' ? 'dashed' : 'solid',
            tone:
              toneRaw === 'bullish'
                ? 'bullish'
                : toneRaw === 'bearish'
                ? 'bearish'
                : 'neutral',
          };
        })
      : [],
    swings: Array.isArray(m.swings)
      ? m.swings.slice(0, 5).map((s) => {
          const sr = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
          const toneRaw = String(sr.tone || 'neutral').toLowerCase();
          return {
            tag: String(sr.tag || 'HH'),
            x: Number.isFinite(Number(sr.x)) ? Number(sr.x) : 420,
            y: Number.isFinite(Number(sr.y)) ? Number(sr.y) : 420,
            position:
              String(sr.position || 'above').toLowerCase() === 'below'
                ? 'below'
                : 'above',
            tone:
              toneRaw === 'bullish'
                ? 'bullish'
                : toneRaw === 'bearish'
                ? 'bearish'
                : 'neutral',
          };
        })
      : [],
  };
}

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

  try {
    const body = await req.json();
    imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';
    selectedPair = body.pair || 'EUR/USD';
    selectedTimeframe = body.timeframe || 'H1';
  } catch {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  if (!imageDataUrl) {
    return NextResponse.json(
      { error: 'Please upload a valid chart screenshot to analyze.' },
      { status: 400 }
    );
  }

  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return NextResponse.json(
      { error: 'Unsupported image format. Upload a PNG, JPEG, or WebP screenshot.' },
      { status: 400 }
    );
  }

  const mimeType = match[1];
  const base64Data = match[2];

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = `You are an institutional quantitative technical analyst and price-action execution strategist for TraceFX Lens.
You MUST stream your real-time chart inspection as a sequence of standalone single-line JSON objects (NDJSON), one JSON object per line, with NO markdown code fences and NO prose outside the JSON objects.

STEP 1 — MANDATORY CHART APPROVAL GATEKEEPER (OUTPUT THIS FIRST):
Inspect the uploaded image first. Is it a genuine financial trading price chart (candlesticks, OHLC bars, Heikin Ashi, or price line chart)?
- If NO (e.g. a photo, meme, error dialog screenshot, wallet balance screen, text page, or unrecognizable blur), output ONLY this single JSON object and STOP immediately:
{"event":"approval","approved":false,"finding":"Explain clearly in 1 sentence what the image shows instead of a financial price chart and ask for a clear chart screenshot."}

- If YES (it IS a valid financial trading chart), you MUST output these 6 JSON objects sequentially in exact order, one per line, as you perform each stage of analysis on the visible chart:

Line 1 (Step 1 Approval & Axis Calibration):
{"event":"approval","approved":true,"detectedPair":"<pair printed on chart or ${selectedPair}>","detectedTimeframe":"<timeframe printed on chart or ${selectedTimeframe}>","finding":"<1 specific sentence confirming chart type, detected instrument/timeframe, and the visible price scale range read from the axis>"}

Line 2 (Step 2 Market Structure Assessment):
{"event":"step","step":2,"finding":"<1 specific sentence describing the actual swing highs/lows, trend direction, BOS/CHoCH, or consolidation visible on this chart>"}

Line 3 (Step 3 Supply, Demand & Liquidity Scan):
{"event":"step","step":3,"finding":"<1 specific sentence naming the exact support, resistance, supply/demand order block, or liquidity prices visible on this chart>"}

Line 4 (Step 4 Directional Signal Classification):
{"event":"step","step":4,"finding":"<1 specific sentence explaining why BUY, SELL, or HOLD is selected at the current market price>"}

Line 5 (Step 5 Entry, Stop-Loss & TP1-TP3 Validation):
{"event":"step","step":5,"finding":"<1 specific sentence confirming exact Entry, SL, and TP1-TP3 price ordering invariants and calculated R:R ratio>"}

Line 6 (Final Validated Signal Ticket + Spatial Chart Markup Coordinates in [0..1000] image space where x:0=left..1000=right, y:0=top..1000=bottom):
{"event":"result","signalType":"<BUY|SELL|HOLD>","detectedPair":"<string>","detectedTimeframe":"<string>","currentMarketPrice":"<exact price>","entryPrice":"<exact price>","entryTriggerNote":"<1 concise sentence>","stopLoss":"<exact price>","takeProfit1":"<exact price>","takeProfit2":"<exact price>","takeProfit3":"<exact price>","riskRewardRatio":"<1 : X.X>","marketStructure":"<short label>","confidenceSummary":"<short confluence label>","technicalRationale":["<observation 1>","<observation 2>","<observation 3>"],"keyLevels":[{"label":"<zone name>","price":"<exact price>","role":"<Support|Resistance|Supply Zone|Demand Zone|Liquidity>"}],"invalidationCondition":"<1 concise invalidation sentence>","chartMarkup":{"plotBox":{"leftX":18,"rightX":825,"topY":150,"bottomY":855},"axisCalibration":{"highRefPrice":"<top visible Y-axis price>","highRefY":195,"lowRefPrice":"<bottom visible Y-axis price>","lowRefY":810,"axisTicks":[{"price":"<visible axis label 1>","y":195},{"price":"<visible axis label 2>","y":400},{"price":"<visible axis label 3>","y":605},{"price":"<visible axis label 4>","y":810}],"lastCandleX":775,"lastCandleY":548},"zones":[{"label":"<Demand/Supply name>","role":"<Demand Zone|Supply Zone|Support|Resistance|Liquidity>","startX":480,"topY":500,"bottomY":548,"topPrice":"<price>","bottomPrice":"<price>"}],"trendlines":[{"label":"<BOS|CHoCH|Trend>","x1":475,"y1":245,"x2":775,"y2":540,"style":"<solid|dashed>","tone":"<bullish|bearish|neutral>"}],"swings":[{"tag":"<HH|HL|LH|LL|Sweep>","x":618,"y":468,"position":"<above|below>","tone":"<bullish|bearish|neutral>"}]}}

SPATIAL COORDINATE & MATHEMATICAL ORDERING INVARIANTS (CRITICAL):
- ONLY output signalType as "BUY", "SELL", or "HOLD". NEVER output pending orders (never use BUY LIMIT, SELL LIMIT, BUY STOP, or SELL STOP).
- All chartMarkup coordinates use normalized 0..1000 full-image coordinates (x=0 left edge of screenshot, x=1000 right edge; y=0 top edge of screenshot, y=1000 bottom edge).
- Set plotBox to frame ONLY the main price candlestick grid: topY below mobile status/app toolbars, bottomY above time-axis dates or RSI/MACD sub-panes, and rightX at the exact vertical border before right-side Y-axis price digits begin.
- Provide 3 to 4 exact visible Y-axis price labels and their vertical y positions in axisCalibration.axisTicks so horizontal levels map onto the exact price grid.
- Set axisCalibration.lastCandleX and lastCandleY to the exact x,y of the right-most latest candlestick close, and place swings and trendline endpoints directly on visible candlestick wick tips (never floating in empty background).
- Read the visible price axis carefully so every price matches the chart's actual scale and keep SL/TP1/TP2/TP3 within realistic visible structure when appropriate.
- Do NOT use double quotes inside finding strings; use single quotes if quoting text.
- For BUY: entryPrice equals currentMarketPrice, and stopLoss < entryPrice < takeProfit1 < takeProfit2 < takeProfit3.
- For SELL: entryPrice equals currentMarketPrice, and stopLoss > entryPrice > takeProfit1 > takeProfit2 > takeProfit3.
- For HOLD: select HOLD if price is choppy, mid-range, or lacks immediate market entry confluence; set entryPrice to the key breakout/rejection level to watch.
- Calculate riskRewardRatio accurately from |takeProfit2 - entryPrice| / |entryPrice - stopLoss| formatted as "1 : X.X".`;

  const promptText = `Inspect and analyze this uploaded screenshot.
Selected pair context: ${selectedPair}
Selected timeframe context: ${selectedTimeframe}
First verify and approve whether this image is a valid trading chart on Line 1, then stream Steps 2-5 and the final result JSON object one per line.`;

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
        message: `Connected to AI gatekeeper — inspecting ${selectedPair} chart & price axis...`,
      });

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
              ? rawSignalObj.technicalRationale.map(String).slice(0, 5)
              : [],
            keyLevels: Array.isArray(rawSignalObj.keyLevels)
              ? (rawSignalObj.keyLevels as KeyPriceLevel[]).slice(0, 5)
              : [],
            invalidationCondition: String(rawSignalObj.invalidationCondition || ''),
            chartMarkup: sanitizeChartMarkup(rawSignalObj.chartMarkup),
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
            const responseStream = await Promise.race([
              ai.models.generateContentStream({
                model: candidate.model,
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType,
                        data: base64Data,
                      },
                    },
                    {
                      text: promptText,
                    },
                  ],
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

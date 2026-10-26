import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import type {
  DetectedPlotBounds,
  KeyPriceLevel,
  SignalType,
  TradingSignalResponse,
} from '@/lib/trading-data';
import {
  deriveExecutionCategory,
  enforceTopDownCrtDominance,
  normalizeKeyLevelRole,
  normalizeSignalType,
  parseNumPrice,
  sanitizeChartMarkup,
} from '@/lib/signal-sanitizer';
import { buildMacroCorrelationContext } from '@/lib/macro-correlation';
import {
  generateOpenRouterCompletion,
  hasGeminiKey,
  hasOpenRouterKey,
  type OpenRouterImageInput,
  resolveOpenRouterVisionCascade,
} from '@/lib/openrouter-server';
import {
  DEFAULT_VISION_MODEL_ID,
  isOpenRouterModelSelection,
} from '@/lib/vision-models';

function parseDataUrl(url?: string): { mimeType: string; data: string } | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function extractJsonObject(rawText: string): Record<string, unknown> | null {
  const cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  if (!cleaned) return null;

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function validatePriceOrdering(
  signalType: SignalType,
  entryRaw: string,
  slRaw: string,
  tp1Raw: string,
  tp2Raw: string,
  tp3Raw: string
): boolean {
  if (signalType === 'HOLD') return true;
  const entry = parseNumPrice(entryRaw);
  const sl = parseNumPrice(slRaw);
  const tp1 = parseNumPrice(tp1Raw);
  const tp2 = parseNumPrice(tp2Raw);
  const tp3 = parseNumPrice(tp3Raw);
  if ([entry, sl, tp1, tp2, tp3].some((v) => v === null)) return false;

  if (signalType === 'BUY') {
    return sl! < entry! && entry! < tp1! && tp1! < tp2! && tp2! < tp3!;
  }
  return sl! > entry! && entry! > tp1! && tp1! > tp2! && tp2! > tp3!;
}

/**
 * Pass 2 — Two-Pass "Visual Self-Check" Mode (Draw -> Inspect -> Correct):
 * Inspects Draft 1's actual rendered canvas markup side-by-side against the
 * coordinate-ruled chart + 2x right-edge axis crop, snapping floating zones/lines
 * onto real candle wicks and verifying Stop Loss clears liquidity sweeps.
 *
 * Non-Breaking Guarantee: Always returns a valid TradingSignalResponse (falling back
 * cleanly to `draftSignal` if upstream vision times out or returns partial output).
 */
export async function POST(req: NextRequest) {
  let draftSignal: TradingSignalResponse | null = null;
  let rulerOrCleanDataUrl = '';
  let markedDraftDataUrl = '';
  let rightEdgeZoomDataUrl = '';
  let detectedPlotBox: DetectedPlotBounds | undefined;
  let subPaneCount = 0;
  let visionModel = DEFAULT_VISION_MODEL_ID;

  try {
    const body = await req.json();
    draftSignal = (body.draftSignal as TradingSignalResponse) || null;
    rulerOrCleanDataUrl =
      typeof body.rulerOrCleanDataUrl === 'string' ? body.rulerOrCleanDataUrl : '';
    markedDraftDataUrl =
      typeof body.markedDraftDataUrl === 'string' ? body.markedDraftDataUrl : '';
    rightEdgeZoomDataUrl =
      typeof body.rightEdgeZoomDataUrl === 'string' ? body.rightEdgeZoomDataUrl : '';
    if (body.detectedPlotBox && typeof body.detectedPlotBox === 'object') {
      detectedPlotBox = body.detectedPlotBox as DetectedPlotBounds;
    }
    subPaneCount = Math.max(0, Number(body.subPaneCount ?? 0));
    if (typeof body.visionModel === 'string' && body.visionModel.trim()) {
      visionModel = body.visionModel.trim();
    }
  } catch {
    return NextResponse.json({ error: 'Invalid verify payload.' }, { status: 400 });
  }

  if (!draftSignal || !draftSignal.isValidChart) {
    return NextResponse.json({ signal: draftSignal });
  }

  const geminiReady = hasGeminiKey();
  const openRouterReady = hasOpenRouterKey();

  if (!geminiReady && !openRouterReady) {
    return NextResponse.json({ signal: draftSignal });
  }

  const refPart = parseDataUrl(rulerOrCleanDataUrl);
  const markedPart = parseDataUrl(markedDraftDataUrl);
  const zoomPart = parseDataUrl(rightEdgeZoomDataUrl);

  if (!refPart || !markedPart) {
    return NextResponse.json({ signal: draftSignal });
  }

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

  const isTopDownCrt = draftSignal.analysisMode === 'top_down_crt';
  const hasSubPanes = subPaneCount > 0;
  const verifySystemInstruction = `You are a precision quantitative chart-markup visual auditor for TraceFX Lens (Pass 2 Visual Self-Check).
You are given:
- Image 1: The original ${isTopDownCrt ? 'M5 Execution ' : ''}chart stamped with a 0..1000 Coordinate Ruler Grid (X100..X900, Y100..Y900).
- Image 2: The rendered Draft 1 technical markup drawn directly onto the chart (zones, FVGs, BOS/CHoCH, swings, Entry, SL, TP1-TP3).
${zoomPart ? '- Image 3: A 2x magnified crop of the right-most active candles and Y-axis price scale.' : ''}

Inspect Image 2 against Image 1${zoomPart ? ' and Image 3' : ''} for ANY visual or structural errors:
1. Y-Axis Calibration Drift: Do Entry (${draftSignal.entryPrice}), Current Market (${draftSignal.currentMarketPrice}), SL, and TP lines align with the true printed Y-axis numbers? If drifted, fix axisCalibration.axisTicks, highRefPrice/Y, lowRefPrice/Y, lastCandleX/Y, and currentMarketPrice/entryPrice.
2. Floating Zones / FVGs / BOS / Swings: Did any Supply/Demand/OB rectangle, FVG box, BOS/CHoCH line, or HH/HL/LH/LL tag float in empty space instead of sitting on the real candle wicks/bodies? Snap their 0..1000 coordinates (startX, endX, topY, bottomY, x, y) and prices onto the true candles read from Image 1's ruler grid.
3. Indicator Sub-Pane Intrusion: ${
    hasSubPanes && detectedPlotBox
      ? `An indicator sub-pane exists below Y=${detectedPlotBox.bottomY}. Remove or move above Y=${detectedPlotBox.bottomY} any zone, FVG, swing, or trendline that bled into the bottom indicator pane.`
      : 'Ensure plotBox frames only the main candlestick pane, excluding toolbars or sub-panes.'
  }
4. Stop-Loss Liquidity Trap Check: Verify Stop Loss is placed safely BEYOND the invalidation swing wick / Order Block / EQH-EQL liquidity sweep (never sitting inside an obvious unswept liquidity pool), and preserve strict ordering (BUY: SL < Entry < TP1 < TP2 < TP3; SELL: SL > Entry > TP1 > TP2 > TP3).${
    isTopDownCrt && draftSignal.crtContext
      ? `\n5. TOP-DOWN CRT INVARIANT: H1 dominates (${
          draftSignal.crtContext.h1CrtValid
            ? `Valid H1 ${draftSignal.crtContext.h1Bias} CRT`
            : 'Invalid H1 CRT -> MUST remain HOLD'
        }). NEVER flip signalType against H1 bias; keep TP1–TP3 anchored to H1 macro targets (${draftSignal.takeProfit1}, ${draftSignal.takeProfit2}, ${draftSignal.takeProfit3}) while tightening M5 Entry/SL precision.`
      : ''
  }${
    draftSignal.macroContext
      ? `\n${isTopDownCrt && draftSignal.crtContext ? '6' : '5'}. INTERMARKET MACRO AWARENESS: Live DXY & US10Y filter status is "${draftSignal.macroContext.alignmentLabel}" (${draftSignal.macroContext.summary}). Never flip a HOLD into a counter-macro trade, and if Stop Loss cannot safely clear liquidity under a Double Macro Headwind, prefer HOLD.`
      : ''
  }

Output ONLY a single valid JSON object (no markdown fences, no commentary) with this schema:
{
  "selfCheckSummary": "<1 concise sentence describing what was verified or tightened in Pass 2>",
  "signalType": "<BUY|SELL|HOLD>",
  "currentMarketPrice": "<exact price>",
  "entryPrice": "<exact price>",
  "stopLoss": "<exact price>",
  "takeProfit1": "<exact price>",
  "takeProfit2": "<exact price>",
  "takeProfit3": "<exact price>",
  "riskRewardRatio": "<1 : X.X>",
  "invalidationCondition": "<1 concise sentence>",
  "chartMarkup": <corrected full chartMarkup object keeping all valid zones, fairValueGaps, structureBreaks, liquidityLevels, trendlines, swings, plotBox, and axisCalibration>
}`;

  const compactDraftContext = JSON.stringify({
    signalType: draftSignal.signalType,
    detectedPair: draftSignal.detectedPair,
    detectedTimeframe: draftSignal.detectedTimeframe,
    crtContext: draftSignal.crtContext,
    macroContext: draftSignal.macroContext
      ? {
          alignmentLabel: draftSignal.macroContext.alignmentLabel,
          pairImpliedBias: draftSignal.macroContext.pairImpliedBias,
          dxy: draftSignal.macroContext.dxy?.value,
          us10y: draftSignal.macroContext.us10y?.value,
        }
      : undefined,
    currentMarketPrice: draftSignal.currentMarketPrice,
    entryPrice: draftSignal.entryPrice,
    stopLoss: draftSignal.stopLoss,
    takeProfit1: draftSignal.takeProfit1,
    takeProfit2: draftSignal.takeProfit2,
    takeProfit3: draftSignal.takeProfit3,
    riskRewardRatio: draftSignal.riskRewardRatio,
    chartMarkup: draftSignal.chartMarkup,
  });

  const parts: Array<
    { inlineData: { mimeType: string; data: string } } | { text: string }
  > = [
    { inlineData: refPart },
    { inlineData: markedPart },
  ];
  if (zoomPart) {
    parts.push({ inlineData: zoomPart });
  }
  const verifyPromptText = `Audit and refine this Draft 1 signal & chartMarkup JSON by comparing Image 2 (drawn overlays) against Image 1 (0..1000 ruler grid):\n${compactDraftContext}`;
  parts.push({
    text: verifyPromptText,
  });

  const openRouterImages: OpenRouterImageInput[] = [
    { ...refPart, essential: true },
    { ...markedPart, essential: true },
  ];
  if (zoomPart) {
    openRouterImages.push({ ...zoomPart, essential: false });
  }

  const verifyCandidates: Array<{
    provider: 'gemini' | 'openrouter';
    model: string;
    timeoutMs: number;
    thinkingConfig?: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
  }> = [];

  const wantsOpenRouter = isOpenRouterModelSelection(visionModel);
  if (wantsOpenRouter && openRouterReady) {
    const orIds = await resolveOpenRouterVisionCascade(visionModel, 3);
    for (const id of orIds) {
      verifyCandidates.push({
        provider: 'openrouter',
        model: id,
        timeoutMs: 14000,
      });
    }
    if (geminiReady) {
      verifyCandidates.push({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        timeoutMs: 11000,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      });
    }
  } else {
    if (geminiReady) {
      verifyCandidates.push({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        timeoutMs: 11000,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      });
    }
    if (openRouterReady) {
      const orIds = await resolveOpenRouterVisionCascade(null, 2);
      for (const id of orIds) {
        verifyCandidates.push({
          provider: 'openrouter',
          model: id,
          timeoutMs: 14000,
        });
      }
    }
  }

  for (const candidate of verifyCandidates) {
    if (req.signal.aborted) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), candidate.timeoutMs);
    const onParentAbort = () => controller.abort();
    req.signal.addEventListener('abort', onParentAbort, { once: true });

    try {
      let responseText = '';
      if (candidate.provider === 'openrouter') {
        responseText = await generateOpenRouterCompletion({
          model: candidate.model,
          systemInstruction: verifySystemInstruction,
          images: openRouterImages,
          promptText: verifyPromptText,
          temperature: 0.1,
          signal: controller.signal,
        });
      } else if (ai) {
        const response = await ai.models.generateContent({
          model: candidate.model,
          contents: { parts },
          config: {
            systemInstruction: verifySystemInstruction,
            temperature: 0.1,
            responseMimeType: 'application/json',
            abortSignal: controller.signal,
            ...(candidate.thinkingConfig
              ? { thinkingConfig: candidate.thinkingConfig }
              : {}),
          },
        });
        responseText = response.text || '';
      }

      const rawObj = extractJsonObject(responseText);
      if (!rawObj) continue;

      let nextSignalType = normalizeSignalType(
        rawObj.signalType ?? draftSignal.signalType
      );
      let nextCrtContext = draftSignal.crtContext;

      if (isTopDownCrt && draftSignal.crtContext) {
        const enforced = enforceTopDownCrtDominance(
          nextSignalType,
          draftSignal.crtContext
        );
        nextSignalType = enforced.signalType;
        nextCrtContext = enforced.crtContext;
        // Also never promote a Pass-1 HOLD into BUY/SELL during visual Pass-2 audit
        if (draftSignal.signalType === 'HOLD') {
          nextSignalType = 'HOLD';
        }
      }

      const nextCurrent = String(
        rawObj.currentMarketPrice || draftSignal.currentMarketPrice
      );
      const nextEntry = String(rawObj.entryPrice || draftSignal.entryPrice);
      const nextSl = String(rawObj.stopLoss || draftSignal.stopLoss);
      const nextTp1 = String(rawObj.takeProfit1 || draftSignal.takeProfit1);
      const nextTp2 = String(rawObj.takeProfit2 || draftSignal.takeProfit2);
      const nextTp3 = String(rawObj.takeProfit3 || draftSignal.takeProfit3);

      const orderingValid = validatePriceOrdering(
        nextSignalType,
        nextEntry,
        nextSl,
        nextTp1,
        nextTp2,
        nextTp3
      );

      const refinedMarkup = rawObj.chartMarkup
        ? sanitizeChartMarkup(
            rawObj.chartMarkup,
            orderingValid ? nextEntry : draftSignal.entryPrice,
            detectedPlotBox,
            hasSubPanes
          )
        : draftSignal.chartMarkup;

      // Preserve rich structure counts if Pass 2 accidentally omitted arrays
      const mergedMarkup =
        refinedMarkup && draftSignal.chartMarkup
          ? {
              ...refinedMarkup,
              zones:
                refinedMarkup.zones.length > 0
                  ? refinedMarkup.zones
                  : draftSignal.chartMarkup.zones,
              fairValueGaps:
                (refinedMarkup.fairValueGaps?.length ?? 0) > 0
                  ? refinedMarkup.fairValueGaps
                  : draftSignal.chartMarkup.fairValueGaps,
              structureBreaks:
                (refinedMarkup.structureBreaks?.length ?? 0) > 0
                  ? refinedMarkup.structureBreaks
                  : draftSignal.chartMarkup.structureBreaks,
              liquidityLevels:
                (refinedMarkup.liquidityLevels?.length ?? 0) > 0
                  ? refinedMarkup.liquidityLevels
                  : draftSignal.chartMarkup.liquidityLevels,
              trendlines:
                (refinedMarkup.trendlines?.length ?? 0) > 0
                  ? refinedMarkup.trendlines
                  : draftSignal.chartMarkup.trendlines,
              swings:
                (refinedMarkup.swings?.length ?? 0) > 0
                  ? refinedMarkup.swings
                  : draftSignal.chartMarkup.swings,
            }
          : refinedMarkup || draftSignal.chartMarkup;

      const selfCheckSummary = String(
        rawObj.selfCheckSummary ||
          'Pass 2 visual self-check verified wick alignment, axis ticks, and stop-loss buffer.'
      ).trim();

      // Rebuild keyLevels if prices tightened
      const updatedKeyLevels: KeyPriceLevel[] = [...draftSignal.keyLevels];
      if (Array.isArray(rawObj.keyLevels) && rawObj.keyLevels.length >= 3) {
        const parsedLevels = rawObj.keyLevels
          .map((item) => {
            const kr = (item && typeof item === 'object' ? item : {}) as Record<
              string,
              unknown
            >;
            const label = String(kr.label || '').trim();
            const price = String(kr.price || '').trim();
            if (!label || !price) return null;
            return {
              label,
              price,
              role: normalizeKeyLevelRole(kr.role, label),
            };
          })
          .filter((k): k is KeyPriceLevel => k !== null);
        if (parsedLevels.length >= 3) {
          updatedKeyLevels.splice(0, updatedKeyLevels.length, ...parsedLevels.slice(0, 14));
        }
      }

      const updatedAudit = [...(draftSignal.auditTrail || [])];
      if (updatedAudit.length > 0) {
        const lastIdx = updatedAudit.length - 1;
        updatedAudit[lastIdx] = {
          ...updatedAudit[lastIdx],
          finding: `${updatedAudit[lastIdx].finding} · Pass 2 Self-Check: ${selfCheckSummary}`,
        };
      }

      const finalSignalType = orderingValid ? nextSignalType : draftSignal.signalType;
      const updatedMacroContext = draftSignal.macroContext
        ? finalSignalType === draftSignal.signalType
          ? draftSignal.macroContext
          : buildMacroCorrelationContext(
              draftSignal.macroContext.dxy,
              draftSignal.macroContext.us10y,
              draftSignal.detectedPair,
              finalSignalType
            )
        : undefined;

      const verifiedSignal: TradingSignalResponse = {
        ...draftSignal,
        crtContext: nextCrtContext,
        macroContext: updatedMacroContext,
        signalType: finalSignalType,
        executionCategory: deriveExecutionCategory(finalSignalType),
        currentMarketPrice: orderingValid ? nextCurrent : draftSignal.currentMarketPrice,
        entryPrice: orderingValid ? nextEntry : draftSignal.entryPrice,
        stopLoss: orderingValid ? nextSl : draftSignal.stopLoss,
        takeProfit1: orderingValid ? nextTp1 : draftSignal.takeProfit1,
        takeProfit2: orderingValid ? nextTp2 : draftSignal.takeProfit2,
        takeProfit3: orderingValid ? nextTp3 : draftSignal.takeProfit3,
        riskRewardRatio: orderingValid
          ? String(rawObj.riskRewardRatio || draftSignal.riskRewardRatio)
          : draftSignal.riskRewardRatio,
        invalidationCondition: String(
          rawObj.invalidationCondition || draftSignal.invalidationCondition
        ),
        keyLevels: updatedKeyLevels,
        chartMarkup: mergedMarkup,
        auditTrail: updatedAudit,
        visionVerification: {
          ...draftSignal.visionVerification,
          selfChecked: true,
          selfCheckSummary,
        },
      };

      return NextResponse.json({ signal: verifiedSignal });
    } catch {
      // Fall through to backup candidate or graceful draft fallback
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener('abort', onParentAbort);
    }
  }

  return NextResponse.json({ signal: draftSignal });
}

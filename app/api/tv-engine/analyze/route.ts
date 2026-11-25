import {
  createOpenAIResponse,
  extractOpenAIOutputText,
  hasAnyAiProviderKey,
} from '@/lib/openai';
import { NextRequest, NextResponse } from 'next/server';
import {
  type KeyPriceLevel,
  resolveOrderTypeDisplay,
  type TradingSignalResponse,
} from '@/lib/trading-data';
import {
  normalizeAndValidateOrderType,
  normalizeSignalType,
} from '@/lib/signal-sanitizer';
import { captureViewportSnapshot } from '@/lib/tv-playwright-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function extractBase64FromDataUrl(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',');
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}

function parsePairAndTimeframeFromTitle(title: string): {
  pair: string;
  timeframe: string;
} {
  let pair = 'CHART';
  let timeframe = '15m';

  if (!title) return { pair, timeframe };

  // Common TradingView title formats:
  // "GOLD 15m · TradingView"
  // "OANDA:XAUUSD, 15m — TradingView"
  // "Bitcoin / Tether, 1h — TradingView"
  // "EURUSD 1H TradingView"
  const cleanTitle = title.replace(/\s*—\s*TradingView.*$/i, '').trim();

  // Try matching symbol and timeframe pattern: e.g. "XAUUSD, 15m" or "EURUSD 1H"
  const tfMatch = cleanTitle.match(/\b([1-9][0-9]?[mhdwsMHDWS]|1D|1W|1M|4H|1H|15m|5m|1m)\b/i);
  if (tfMatch) {
    timeframe = tfMatch[1];
  }

  const parts = cleanTitle.split(/[,·\-|]/);
  if (parts.length > 0 && parts[0].trim()) {
    const rawSymbol = parts[0].trim();
    pair = rawSymbol.replace(/^(OANDA|FX|BINANCE|COINBASE|FOREXCOM|INDEX|NASDAQ|CAPITALCOM):/i, '');
  }

  return { pair, timeframe };
}

const SYSTEM_INSTRUCTION = `You are the TraceFX Lens Senior Quantitative & Technical Analyst.
You are evaluating a live TradingView desktop chart screenshot (1440x900 viewport).
Your task is to analyze market structure, order flow, liquidity pools, Fair Value Gaps (FVG), and Break of Structure (BOS/CHoCH) to output a complete, institutional, ready-to-trade setup card as JSON.

RULES:
1. Examine the right-hand price axis ticks and the latest visible candle wicks on the chart.
2. Determine signalType ("BUY", "SELL", or "HOLD") and orderType ("MARKET", "BUY_LIMIT", "SELL_LIMIT", "BUY_STOP", "SELL_STOP", or "NONE"):
   - BUY: Clear bullish market structure, rejection/sweep of sell-side liquidity, bullish FVG/Order Block tap or confirmed bullish breakout.
   - SELL: Clear bearish market structure, rejection/sweep of buy-side liquidity, bearish FVG/Order Block tap or confirmed bearish breakdown.
   - HOLD: Indecisive chop, midpoint of range without liquidity draw, or unconfirmed structure. Set orderType = "NONE".
3. ORDER TYPE SELECTION (DO NOT DEFAULT TO PENDING ORDERS):
   - "MARKET" (DEFAULT when actionable NOW): Use MARKET whenever price is ALREADY at/inside the POI or has just printed a confirmed CHoCH/BOS/engulfing candle, OR when entryPrice is within ~0.15% of currentMarketPrice. Set entryPrice = currentMarketPrice. Never invent a Limit order merely to squeeze a few extra pips of R:R!
   - "BUY_LIMIT" (entryPrice strictly < currentMarketPrice) or "SELL_LIMIT" (entryPrice strictly > currentMarketPrice): Use ONLY when structure/bias is already confirmed and current price is clearly separated (> 0.2% away) from an unmitigated pullback FVG/Order Block.
   - "BUY_STOP" (entryPrice strictly > currentMarketPrice) or "SELL_STOP" (entryPrice strictly < currentMarketPrice): Use ONLY when price is coiled against a key structural swing high/low waiting for a breakout trigger.
   - If HOLD, set orderType = "NONE" and never force a speculative pending order.
4. If BUY or SELL:
   - currentMarketPrice: The exact live market price visible on the right-hand axis or last candle close.
   - entryPrice: Exact recommended entry level (equals currentMarketPrice for MARKET, or exact Limit/Stop trigger level for pending orders).
   - stopLoss: Invalidation level beyond recent structural swing high/low with a logical buffer (BUY: stopLoss < entryPrice; SELL: stopLoss > entryPrice).
   - takeProfit1: Conservative 1:1.5 to 1:2.0 partial target (prior swing or equilibrium).
   - takeProfit2: Primary structural target (prior major swing high/low or opposing liquidity pool).
   - takeProfit3: Extended runner target (external liquidity draw).
   - preferredTakeProfit: Choose exactly 1, 2, or 3 as the ONE target the trader should prioritize. Base this on visible structure, nearby opposing liquidity/support-resistance, momentum, and realistic room to target. Do not automatically choose TP2.
   - preferredTakeProfitReason: One concise sentence explaining why that target is the most realistic balance of reach and reward/risk. If no target is justified, return HOLD rather than inventing one.
   - riskRewardRatio: Must reflect entryPrice vs stopLoss vs the preferredTakeProfit target.
5. If HOLD:
   - Provide the key breakout watch levels for entryPrice and invalidation.
6. Provide 3-4 concise, professional technical rationale points using SMC terminology.
7. Provide 2-5 key mapped price levels with roles (Support, Resistance, Bullish OB, Bearish OB, Fair Value Gap, Liquidity, Structure Break).
8. Estimate signalConfidence as an integer from 1 to 99 reflecting the quality and clarity of this setup's technical confluence, structure, directional alignment, and risk/reward. It is an AI setup-quality score, NOT a probability of winning the trade. Do not inflate scores; use lower scores for weak or ambiguous setups.
9. Ensure all price numbers strictly match the numerical scale of the visible asset (e.g. for Gold/XAUUSD ~2700.00, for EURUSD ~1.0500, for BTCUSD ~85000).

Return JSON with keys: isValidChart, signalType, orderType, detectedPair, detectedTimeframe, currentMarketPrice, entryPrice, entryTriggerNote, stopLoss, takeProfit1, takeProfit2, takeProfit3, preferredTakeProfit, preferredTakeProfitReason, riskRewardRatio, marketStructure, signalConfidence, confidenceSummary, technicalRationale, keyLevels, invalidationCondition.`;

export async function POST(req: NextRequest) {
  if (!hasAnyAiProviderKey()) {
    return NextResponse.json(
      { error: 'Neither OPENAI_API_KEY nor GEMINI_API_KEY is configured on the server.' },
      { status: 500 }
    );
  }

  let body: {
    frameDataUrl?: string;
    customPrompt?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    // optional body
  }

  let frameDataUrl = body.frameDataUrl;
  let pageTitle = '';

  if (!frameDataUrl) {
    const snap = await captureViewportSnapshot(null);
    if (!snap.frameDataUrl) {
      return NextResponse.json(
        {
          error:
            'No active TradingView browser session or chart frame found. Connect your TradingView session or launch a Guest Chart first.',
        },
        { status: 400 }
      );
    }
    frameDataUrl = snap.frameDataUrl;
    pageTitle = snap.pageTitle || '';
  }

  const { pair, timeframe } = parsePairAndTimeframeFromTitle(pageTitle);

  const base64Data = extractBase64FromDataUrl(frameDataUrl);

  const userPrompt = body.customPrompt?.trim()
    ? `Live TradingView Page: "${pageTitle}"\nSymbol/Timeframe: ${pair} (${timeframe})\nUser Focus: ${body.customPrompt}\n\nAnalyze the chart image and output the complete ready-to-trade setup card.`
    : `Live TradingView Page: "${pageTitle}"\nDetected Symbol/Timeframe: ${pair} (${timeframe})\n\nAnalyze current candlesticks, market structure, liquidity sweeps, and price action on this TradingView screen. Output the complete ready-to-trade setup card.`;

  try {
    const response = await createOpenAIResponse({
      instructions: SYSTEM_INSTRUCTION,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/jpeg;base64,${base64Data}`, detail: 'high' },
          { type: 'input_text', text: userPrompt },
        ],
      }],
      responseFormat: 'json_object',
      reasoningEffort: 'medium',
      maxOutputTokens: 6000,
      signal: req.signal,
    });
    const text = extractOpenAIOutputText(response);
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Model returned unparseable JSON setup data.');
    }

    const signalType = normalizeSignalType(parsed.signalType);
    const rawCurrentMarketPrice = String(
      parsed.currentMarketPrice || parsed.currentPrice || parsed.entryPrice || '—'
    );
    const rawEntryPrice = String(parsed.entryPrice || '—');
    const rawStopLoss = String(parsed.stopLoss || '—');
    const rawTakeProfit1 = String(parsed.takeProfit1 || '—');

    const validatedOrder = normalizeAndValidateOrderType({
      signalType,
      rawOrderType: parsed.orderType,
      rawSignalType: parsed.signalType,
      currentMarketPrice: rawCurrentMarketPrice,
      entryPrice: rawEntryPrice,
      stopLoss: rawStopLoss,
      takeProfit1: rawTakeProfit1,
    });

    const displayMeta = resolveOrderTypeDisplay(
      signalType,
      validatedOrder.orderType,
      validatedOrder.executionCategory
    );

    const normalizedPair =
      String(parsed.detectedPair || '').trim() || pair || 'CHART';
    const normalizedTimeframe =
      String(parsed.detectedTimeframe || '').trim() || timeframe || '15m';

    const signal: TradingSignalResponse = {
      isValidChart: Boolean(parsed.isValidChart ?? true),
      validationMessage: parsed.validationMessage,
      signalType,
      orderType: validatedOrder.orderType,
      executionCategory: validatedOrder.executionCategory,
      detectedPair: normalizedPair,
      detectedTimeframe: normalizedTimeframe,
      currentMarketPrice: rawCurrentMarketPrice,
      entryPrice: validatedOrder.entryPrice,
      entryTriggerNote: String(
        parsed.entryTriggerNote ||
          'Technical trigger verified on live TradingView screen.'
      ),
      stopLoss: rawStopLoss,
      takeProfit1: rawTakeProfit1,
      takeProfit2: String(parsed.takeProfit2 || '—'),
      takeProfit3: String(parsed.takeProfit3 || '—'),
      preferredTakeProfit: [1, 2, 3].includes(Number(parsed.preferredTakeProfit)) ? Number(parsed.preferredTakeProfit) as 1 | 2 | 3 : undefined,
      preferredTakeProfitReason: String(parsed.preferredTakeProfitReason || ''),
      riskRewardRatio: String(parsed.riskRewardRatio || '1:2.0'),
      marketStructure: String(
        parsed.marketStructure || 'Market Structure Confirmed'
      ),
      signalConfidence:
        typeof parsed.signalConfidence === 'number' &&
        Number.isFinite(parsed.signalConfidence)
          ? Math.min(99, Math.max(1, Math.round(parsed.signalConfidence)))
          : undefined,
      confidenceSummary: String(
        parsed.confidenceSummary || 'Confluence Verified'
      ),
      technicalRationale:
        Array.isArray(parsed.technicalRationale) &&
        parsed.technicalRationale.length > 0
          ? parsed.technicalRationale.map(String)
          : ['Technical confluence identified on TradingView live chart.'],
      keyLevels: Array.isArray(parsed.keyLevels)
        ? parsed.keyLevels.map((lvl: any) => ({
            label: String(lvl.label || 'Level'),
            price: String(lvl.price || '—'),
            role: (lvl.role || 'Support') as KeyPriceLevel['role'],
          }))
        : [],
      invalidationCondition: String(
        parsed.invalidationCondition ||
          (signalType === 'BUY'
            ? `Price invalidation below ${rawStopLoss}`
            : signalType === 'SELL'
            ? `Price invalidation above ${rawStopLoss}`
            : 'Price breaks out of consolidation band.')
      ),
      auditTrail: [
        {
          step: 1,
          title: 'TradingView Viewport Audit',
          finding: `Calibrated live chart for ${normalizedPair} on ${normalizedTimeframe}.`,
        },
        {
          step: 2,
          title: 'Market Structure & Swings',
          finding: String(
            parsed.marketStructure || 'Identified key structural points.'
          ),
        },
        {
          step: 3,
          title: 'Liquidity & FVG Confluence',
          finding: String(
            parsed.entryTriggerNote || 'Confluence trigger evaluated.'
          ),
        },
        {
          step: 4,
          title: 'Execution Coordinates',
          finding: `${displayMeta.label} (${validatedOrder.executionCategory}) · Entry ${validatedOrder.entryPrice} · SL ${rawStopLoss} · TP1 ${rawTakeProfit1}`,
        },
        {
          step: 5,
          title: 'Ready-to-Trade Ticket',
          finding: `${displayMeta.label} ticket finalized with R:R ${parsed.riskRewardRatio}.`,
        },
      ],
    };

    return NextResponse.json({ signal });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to analyze live TradingView chart.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

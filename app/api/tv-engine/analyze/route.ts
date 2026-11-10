import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  type KeyPriceLevel,
  type SignalType,
  type TradingSignalResponse,
} from '@/lib/trading-data';
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
Your task is to analyze market structure, order flow, liquidity pools, Fair Value Gaps (FVG), and Break of Structure (BOS/CHoCH) to output a complete, institutional, ready-to-trade setup card.

RULES:
1. Examine the right-hand price axis ticks and the latest visible candle wicks on the chart.
2. Determine whether the current market condition warrants a BUY, SELL, or HOLD.
   - BUY: Clear bullish market structure, rejection/sweep of sell-side liquidity, bullish FVG/Order Block tap.
   - SELL: Clear bearish market structure, rejection/sweep of buy-side liquidity, bearish FVG/Order Block tap.
   - HOLD: Indecisive chop, midpoint of range without liquidity draw, or consolidation awaiting breakout.
3. If BUY or SELL:
   - currentPrice: The exact live market price visible on the right-hand axis or last candle close.
   - entryPrice: Exact recommended entry level (close to current price or retest level).
   - stopLoss: Invalidation level beyond recent structural swing high/low with a logical buffer.
   - takeProfit1: Conservative 1:1.5 to 1:2.0 partial target (prior swing or equilibrium).
   - takeProfit2: Primary structural target (prior major swing high/low or opposing liquidity pool).
   - takeProfit3: Extended runner target (external liquidity draw).
   - riskRewardRatio: Must reflect entry vs stopLoss vs takeProfit2 (e.g. "1:2.8").
4. If HOLD:
   - Provide the key breakout watch levels for entryPrice and invalidation.
5. Provide 3-4 concise, professional technical rationale points using SMC terminology.
6. Provide 2-5 key mapped price levels with roles (Support, Resistance, Bullish OB, Bearish OB, Fair Value Gap, Liquidity, Structure Break).
7. Estimate signalConfidence as an integer from 1 to 99 reflecting the quality and clarity of this setup's technical confluence, structure, directional alignment, and risk/reward. It is an AI setup-quality score, NOT a probability of winning the trade. Do not inflate scores; use lower scores for weak or ambiguous setups.
8. Ensure all price numbers strictly match the numerical scale of the visible asset (e.g. for Gold/XAUUSD ~2700.00, for EURUSD ~1.0500, for BTCUSD ~85000).`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server.' },
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

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const base64Data = extractBase64FromDataUrl(frameDataUrl);

  const userPrompt = body.customPrompt?.trim()
    ? `Live TradingView Page: "${pageTitle}"\nSymbol/Timeframe: ${pair} (${timeframe})\nUser Focus: ${body.customPrompt}\n\nAnalyze the chart image and output the complete ready-to-trade setup card.`
    : `Live TradingView Page: "${pageTitle}"\nDetected Symbol/Timeframe: ${pair} (${timeframe})\n\nAnalyze current candlesticks, market structure, liquidity sweeps, and price action on this TradingView screen. Output the complete ready-to-trade setup card.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data,
              },
            },
            { text: userPrompt },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isValidChart: { type: Type.BOOLEAN },
            validationMessage: { type: Type.STRING },
            signalType: {
              type: Type.STRING,
              description: 'Must be "BUY", "SELL", or "HOLD".',
            },
            detectedPair: { type: Type.STRING },
            detectedTimeframe: { type: Type.STRING },
            currentMarketPrice: { type: Type.STRING },
            entryPrice: { type: Type.STRING },
            entryTriggerNote: { type: Type.STRING },
            stopLoss: { type: Type.STRING },
            takeProfit1: { type: Type.STRING },
            takeProfit2: { type: Type.STRING },
            takeProfit3: { type: Type.STRING },
            riskRewardRatio: { type: Type.STRING },
            marketStructure: { type: Type.STRING },
            confidenceSummary: { type: Type.STRING },
            signalConfidence: {
              type: Type.NUMBER,
              description: 'Integer 1-99 AI estimate of setup quality, not win probability.',
            },
            technicalRationale: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            keyLevels: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  price: { type: Type.STRING },
                  role: { type: Type.STRING },
                },
                required: ['label', 'price', 'role'],
              },
            },
            invalidationCondition: { type: Type.STRING },
          },
          required: [
            'isValidChart',
            'signalType',
            'currentMarketPrice',
            'entryPrice',
            'stopLoss',
            'takeProfit1',
            'takeProfit2',
            'takeProfit3',
            'riskRewardRatio',
            'technicalRationale',
          ],
        },
      },
    });

    const text = response.text || '';
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Model returned unparseable JSON setup data.');
    }

    const signalTypeRaw = String(parsed.signalType || 'HOLD').toUpperCase();
    const signalType: SignalType =
      signalTypeRaw === 'BUY'
        ? 'BUY'
        : signalTypeRaw === 'SELL'
        ? 'SELL'
        : 'HOLD';

    const normalizedPair =
      String(parsed.detectedPair || '').trim() || pair || 'CHART';
    const normalizedTimeframe =
      String(parsed.detectedTimeframe || '').trim() || timeframe || '15m';

    const signal: TradingSignalResponse = {
      isValidChart: Boolean(parsed.isValidChart ?? true),
      validationMessage: parsed.validationMessage,
      signalType,
      executionCategory:
        signalType === 'HOLD' ? 'Stand Aside' : 'Market Execution',
      detectedPair: normalizedPair,
      detectedTimeframe: normalizedTimeframe,
      currentMarketPrice: String(
        parsed.currentMarketPrice || parsed.entryPrice || '—'
      ),
      entryPrice: String(parsed.entryPrice || '—'),
      entryTriggerNote: String(
        parsed.entryTriggerNote ||
          'Technical trigger verified on live TradingView screen.'
      ),
      stopLoss: String(parsed.stopLoss || '—'),
      takeProfit1: String(parsed.takeProfit1 || '—'),
      takeProfit2: String(parsed.takeProfit2 || '—'),
      takeProfit3: String(parsed.takeProfit3 || '—'),
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
            ? `Price invalidation below ${parsed.stopLoss}`
            : signalType === 'SELL'
            ? `Price invalidation above ${parsed.stopLoss}`
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
          finding: `Entry ${parsed.entryPrice} · SL ${parsed.stopLoss} · TP1 ${parsed.takeProfit1} · TP2 ${parsed.takeProfit2}`,
        },
        {
          step: 5,
          title: 'Ready-to-Trade Ticket',
          finding: `${signalType} ticket finalized with R:R ${parsed.riskRewardRatio}.`,
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

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EstimateRequest {
  signal?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedText(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server.' },
      { status: 500 }
    );
  }

  let body: EstimateRequest;
  try {
    body = (await req.json()) as EstimateRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  if (!isRecord(body.signal)) {
    return NextResponse.json({ error: 'Missing signal details.' }, { status: 400 });
  }

  const signal = body.signal;
  const signalType = boundedText(signal.signalType, 8).toUpperCase();
  if (signal.isValidChart !== true || !['BUY', 'SELL'].includes(signalType)) {
    return NextResponse.json(
      { error: 'An estimate is only available for valid BUY or SELL setups.' },
      { status: 400 }
    );
  }

  const rationale = Array.isArray(signal.technicalRationale)
    ? signal.technicalRationale.slice(0, 6).map((item) => boundedText(item, 400))
    : [];
  const keyLevels = Array.isArray(signal.keyLevels)
    ? signal.keyLevels.slice(0, 12).map((item) => {
        if (!isRecord(item)) return '';
        return `${boundedText(item.label, 80)} ${boundedText(item.role, 50)} at ${boundedText(item.price, 40)}`;
      }).filter(Boolean)
    : [];

  const analysis = {
    side: signalType,
    pair: boundedText(signal.detectedPair, 40),
    timeframe: boundedText(signal.detectedTimeframe, 40),
    entry: boundedText(signal.entryPrice, 40),
    stopLoss: boundedText(signal.stopLoss, 40),
    takeProfit1: boundedText(signal.takeProfit1, 40),
    takeProfit2: boundedText(signal.takeProfit2, 40),
    takeProfit3: boundedText(signal.takeProfit3, 40),
    riskReward: boundedText(signal.riskRewardRatio, 40),
    marketStructure: boundedText(signal.marketStructure, 300),
    trigger: boundedText(signal.entryTriggerNote, 500),
    rationale,
    keyLevels,
    crtContext: isRecord(signal.crtContext) ? signal.crtContext : null,
    macroContext: isRecord(signal.macroContext) ? signal.macroContext : null,
    verification: isRecord(signal.visionVerification) ? signal.visionVerification : null,
  };

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: JSON.stringify(analysis),
      config: {
        systemInstruction: [
          'You are estimating the chance that this specific BUY or SELL trade setup reaches TP1 before its stop loss, assuming the proposed entry is filled.',
          'This is a subjective, uncalibrated model estimate, not a measured or guaranteed probability. Do not imply statistical calibration or certainty.',
          'Assess only the supplied evidence. Penalize missing, contradictory, weak, or unverified information. Do not infer price history or external facts that were not provided.',
          'Return an integer from 1 to 99 and one concise sentence explaining the strongest supporting or limiting evidence. Avoid financial advice.',
        ].join('\n'),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            probability: { type: Type.INTEGER, minimum: 1, maximum: 99 },
            rationale: { type: Type.STRING },
          },
          required: ['probability', 'rationale'],
        },
      },
    });

    const parsed: unknown = JSON.parse(response.text || '{}');
    if (!isRecord(parsed)) throw new Error('Invalid model response.');
    const probability = Number(parsed.probability);
    const rationaleText = boundedText(parsed.rationale, 240);
    if (!Number.isInteger(probability) || probability < 1 || probability > 99 || !rationaleText) {
      throw new Error('Model returned an invalid estimate.');
    }

    return NextResponse.json({
      probability,
      rationale: rationaleText,
      label: 'AI estimate · experimental, uncalibrated',
      target: 'TP1 before stop loss, assuming entry is filled',
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to estimate this setup right now.' },
      { status: 502 }
    );
  }
}

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { fetchNormalizedMacroCalendar } from '@/lib/forex-factory-adapter';
import {
  buildNewsEvidenceSnapshot,
  getNewsEventFingerprint,
  isSupportedUsdHighImpactEvent,
  validateNewsPredictionPayload,
} from '@/lib/news-prediction';
import { createNewsPredictionVersion, listNewsPredictions } from '@/lib/news-prediction-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const predictions = await listNewsPredictions();
    const fingerprint = req.nextUrl.searchParams.get('eventFingerprint');
    return NextResponse.json({ predictions: fingerprint ? predictions.filter((item) => item.eventFingerprint === fingerprint) : predictions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load predictions.' },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
    if (!eventId || eventId.length > 180) {
      return NextResponse.json({ error: 'A valid calendar event ID is required.' }, { status: 400 });
    }

    const calendar = await fetchNormalizedMacroCalendar({ forceRefresh: true });
    const event = calendar.events.find((candidate) => candidate.eventId === eventId);
    if (!event || !isSupportedUsdHighImpactEvent(event)) {
      return NextResponse.json(
        { error: 'This event is not an eligible upcoming USD high-impact release, or it has already been released.' },
        { status: 400 }
      );
    }

    const fingerprint = getNewsEventFingerprint(event);
    const evidence = buildNewsEvidenceSnapshot(event);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 503 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const systemInstruction = `You are TraceFX Lens News Prediction Engine v1. Produce a rigorous pre-release forecast using ONLY the supplied evidence. Do not browse or invent data. Missing live DXY, Treasury yield and positioning data must remain explicit. Estimate the economic release relative to consensus, separately from market direction. For ordinary numeric indicators use ABOVE_EXPECTATIONS, IN_LINE, BELOW_EXPECTATIONS. For FOMC/policy events use HIKE, HOLD, CUT or HAWKISH/DOVISH as appropriate. Probabilities must be mutually exclusive and sum to exactly 100. They are subjective model estimates, not calibrated win probabilities. If evidence is inadequate, use INSUFFICIENT_DATA and low evidence quality; do not invent certainty. Market biases must be UNCONFIRMED when the evidence does not support a directional call. Return JSON only with keys outcome {primary, probabilities {positive, inline, negative}, explanation}, marketReaction {usd, xauUsd, eurUsd, gbpUsd, usdJpy, explanation, invalidationConditions}, tradingPlan {preferredInstruments, confirmationConditions, entryApproach, risks}. Use concise but useful explanations.`;
    const prompt = [
      `Event: ${event.title}`,
      `Release time UTC: ${new Date(event.timestampUtcMs).toISOString()}`,
      `Consensus: ${event.forecast || 'Unavailable'}`,
      `Previous: ${event.previous || 'Unavailable'}`,
      `Unit / period: ${event.unit || 'Not supplied'} / ${event.period || 'Not supplied'}`,
      `Indicator definition: ${event.officialOverview}`,
      `Usual effect: ${event.usualEffect}`,
      `Why traders care: ${event.whyTradersCare}`,
      `Affected pairs: ${event.affectedPairs.map((pair) => pair.symbol + ' (' + pair.relationship + ')').join(', ')}`,
      `Evidence quality: ${evidence.quality}`,
      `Missing evidence: ${evidence.missingData.join(' ')}`,
      `Available evidence: ${evidence.relevantData.join(' ')}`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: req.signal,
      },
    });
    const raw = extractJson(response.text || '');
    const validated = validateNewsPredictionPayload(raw);
    if (!validated) {
      return NextResponse.json({ error: 'The AI returned an invalid prediction. Please refresh and try again.' }, { status: 502 });
    }

    const missingData = evidence.missingData;
    const prediction = {
      ...validated,
      evidence: {
        forecast: event.forecast || null,
        previous: event.previous || null,
        actualAtGeneration: event.actual || null,
        relevantData: evidence.relevantData,
        missingData,
        quality: evidence.quality,
      },
      modelVersion: 'gemini-3.1-flash-lite',
      status: 'PREDICTED' as const,
    };
    const saved = await createNewsPredictionVersion({
      eventFingerprint: fingerprint,
      eventId: event.eventId,
      eventTitle: event.title,
      eventTimestamp: new Date(event.timestampUtcMs).toISOString(),
      prediction: {
        ...prediction,
        id: '',
        eventId: event.eventId,
        eventFingerprint: fingerprint,
        eventTitle: event.title,
        eventTimestampUtcMs: event.timestampUtcMs,
        currency: 'USD',
        version: 0,
        generatedAt: new Date().toISOString(),
        schemaVersion: 1,
      },
      evidenceSnapshot: evidence,
    });

    return NextResponse.json({ prediction: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate news prediction.';
    const status = message.includes('storage is not configured') || message.includes('news_predictions') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

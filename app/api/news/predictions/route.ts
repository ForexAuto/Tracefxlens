import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { fetchNormalizedMacroCalendar } from '@/lib/forex-factory-adapter';
import {
  buildNewsEvidenceSnapshot,
  getNewsEventFingerprint,
  isSupportedNewsHighImpactEvent,
  validateNewsPredictionPayload,
} from '@/lib/news-prediction';
import { createNewsPredictionVersion, listNewsPredictions } from '@/lib/news-prediction-store';
import { evaluateNewsPrediction } from '@/lib/news-prediction-evaluation';
import { listNewsPredictionEvaluations, saveNewsPredictionEvaluation } from '@/lib/news-prediction-evaluation-store';

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
    const filtered = fingerprint ? predictions.filter((item) => item.eventFingerprint === fingerprint) : predictions;
    const evaluations = await listNewsPredictionEvaluations(filtered.map((item) => item.id));
    return NextResponse.json({ predictions: filtered, evaluations });
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
    if (!event || !/^[A-Z]{3}$/.test(event.currency.toUpperCase()) || event.impact !== 'High' || event.isAllDayOrTentative) {
      return NextResponse.json({ error: 'This is not a supported high-impact currency event.' }, { status: 400 });
    }

    if (body?.action === 'evaluate') {
      if (!event.actual?.trim() || !event.forecast?.trim()) {
        return NextResponse.json({ error: 'The calendar feed does not yet contain both the actual release and consensus forecast.' }, { status: 409 });
      }
      const fingerprint = getNewsEventFingerprint(event);
      const records = (await listNewsPredictions(100)).filter((item) => item.eventFingerprint === fingerprint);
      if (!records.length) {
        return NextResponse.json({ error: 'No saved AI prediction exists for this event.' }, { status: 404 });
      }
      const evaluations = [];
      for (const record of records) {
        const evaluation = evaluateNewsPrediction(record, event);
        if (!evaluation) continue;
        const saved = await saveNewsPredictionEvaluation(evaluation);
        evaluations.push(saved);
      }
      if (!evaluations.length) {
        return NextResponse.json({ error: 'The actual and forecast values could not be compared safely. Check that their units and numeric formats match.' }, { status: 422 });
      }
      return NextResponse.json({ evaluations, evaluatedCount: evaluations.length });
    }

    if (!isSupportedNewsHighImpactEvent(event)) {
      return NextResponse.json(
        { error: 'This event is not an eligible upcoming high-impact release for a supported currency, or it has already been released.' },
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
    const systemInstruction = `You are TraceFX Lens Global News Prediction Engine v2. Produce a rigorous pre-release forecast for any supplied major-currency high-impact event using ONLY the supplied evidence. Do not browse or invent data. Identify the event currency and explain the likely currency-supportive, neutral and currency-negative outcomes. Estimate the economic release relative to consensus separately from the direction of every affected trading pair. For ordinary numeric indicators use ABOVE_EXPECTATIONS, IN_LINE or BELOW_EXPECTATIONS; for policy decisions and central-bank communication use HIKE, HOLD, CUT, HAWKISH or DOVISH as appropriate. Interpret positive/inline/negative probabilities as the chance of a currency-supportive, neutral or currency-negative outcome, adjusted for inverse indicators such as unemployment and jobless claims. Probabilities must sum to exactly 100 and are subjective model estimates, not calibrated win probabilities. If evidence is inadequate, use INSUFFICIENT_DATA and UNCONFIRMED biases; do not invent certainty. Return JSON only with keys outcome {primary, probabilities {positive, inline, negative}, explanation}, marketReaction {currencyBias, pairBiases:[{symbol,bias}], explanation, invalidationConditions}, tradingPlan {preferredInstruments, confirmationConditions, entryApproach, risks}. Include exactly one pairBiases item for every supplied affected pair symbol and no other symbols. Biases are relative to the quoted pair price (BULLISH means the pair is expected to rise).`;
    const prompt = [
      `Event currency: ${event.currency}`,
      `Event: ${event.title}`,
      `Release time UTC: ${new Date(event.timestampUtcMs).toISOString()}`,
      `Consensus: ${event.forecast || 'Unavailable'}`,
      `Previous: ${event.previous || 'Unavailable'}`,
      `Unit / period: ${event.unit || 'Not supplied'} / ${event.period || 'Not supplied'}`,
      `Indicator definition: ${event.officialOverview}`,
      `Usual effect: ${event.usualEffect}`,
      `Why traders care: ${event.whyTradersCare}`,
      `Affected pairs (provide a separate directional bias for every symbol): ${event.affectedPairs.map((pair) => pair.symbol + ' (' + pair.relationship + '; stronger ${event.currency} effect points ' + pair.bullishCurrencyEffect + ')').join(', ')}`,
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
    const validated = validateNewsPredictionPayload(raw, event);
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
        currency: event.currency.toUpperCase(),
        version: 0,
        generatedAt: new Date().toISOString(),
        schemaVersion: 2,
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

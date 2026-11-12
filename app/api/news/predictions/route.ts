import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { fetchNormalizedMacroCalendar } from '@/lib/forex-factory-adapter';
import {
  buildNewsEvidenceSnapshot,
  getNewsEventFingerprint,
  isSupportedNewsHighImpactEvent,
  type NewsMarketBias,
  type NewsOutcomeDirection,
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
    const pair = req.nextUrl.searchParams.get('pair');
    const scopedFingerprint = fingerprint && pair ? `${fingerprint}:${pair}` : fingerprint;
    const filtered = scopedFingerprint
      ? predictions.filter((item) => item.eventFingerprint === scopedFingerprint)
      : predictions;
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
    const selectedPair = typeof body?.pair === 'string' ? body.pair.trim() : '';
    const requestedCurrency = typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    const requestedTitle = typeof body?.title === 'string' ? body.title.trim() : '';
    const requestedTimestamp = Number(body?.timestampUtcMs);
    if ((!eventId || eventId.length > 180) && (!requestedCurrency || !requestedTitle || !Number.isFinite(requestedTimestamp))) {
      return NextResponse.json({ error: 'A valid calendar event reference is required.' }, { status: 400 });
    }

    const calendar = await fetchNormalizedMacroCalendar({ forceRefresh: true });
    const normalizeTitle = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const event = calendar.events.find((candidate) => candidate.eventId === eventId)
      || calendar.events.find((candidate) =>
        requestedCurrency &&
        candidate.currency.trim().toUpperCase() === requestedCurrency &&
        requestedTitle &&
        normalizeTitle(candidate.title) === normalizeTitle(requestedTitle) &&
        Number.isFinite(requestedTimestamp) &&
        Math.abs(candidate.timestampUtcMs - requestedTimestamp) <= 30 * 60_000
      );
    if (!event || !/^[A-Z]{3}$/.test(event.currency.trim().toUpperCase()) || event.impact !== 'High' || event.isAllDayOrTentative) {
      return NextResponse.json({ error: 'The selected event could not be matched to an eligible high-impact calendar release. Refresh the calendar and try again.' }, { status: 400 });
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
        evaluations.push(await saveNewsPredictionEvaluation(evaluation));
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

    const selectedMapping = event.affectedPairs.find((pair) => pair.symbol === selectedPair);
    if (!selectedMapping) {
      return NextResponse.json({ error: 'Choose an instrument from this event’s affected-pair list.' }, { status: 400 });
    }

    const fingerprint = `${getNewsEventFingerprint(event)}:${selectedPair}`;
    const evidence = buildNewsEvidenceSnapshot(event);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 503 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const systemInstruction = `You are TraceFX Lens. Analyse ONLY the selected instrument for the supplied high-impact news event. Return ONLY compact JSON with these keys: signal, confidence, reason, confirmation, invalidation. signal must be BUY, SELL or NO_TRADE. confidence must be an integer from 0 to 100 representing your subjective confidence in this directional assessment, not a statistical win probability. reason, confirmation and invalidation should each be one short sentence. Do not include other instruments, probabilities, long explanations, markdown or extra keys. If evidence is mixed or insufficient, choose NO_TRADE and a low confidence score.`;
    const prompt = [
      `Currency: ${event.currency}`,
      `Event: ${event.title}`,
      `Scheduled release: ${new Date(event.timestampUtcMs).toISOString()}`,
      `Consensus forecast: ${event.forecast || 'Unavailable'}`,
      `Previous: ${event.previous || 'Unavailable'}`,
      `Selected instrument: ${selectedMapping.symbol}`,
      `Instrument relationship: ${selectedMapping.relationship}`,
      `If the event currency strengthens, the instrument price direction is: ${selectedMapping.bullishCurrencyEffect}`,
      `Indicator context: ${event.officialOverview}`,
      `Usual effect: ${event.usualEffect}`,
      'Assess the likely directional reaction for this instrument only. Avoid certainty when evidence is weak.',
    ].join('\\n');

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
    const signalValue = raw?.signal;
    const confidence = Number(raw?.confidence);
    if (!raw || (signalValue !== 'BUY' && signalValue !== 'SELL' && signalValue !== 'NO_TRADE') ||
        !Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
      return NextResponse.json({ error: 'The AI returned an invalid signal. Please try again.' }, { status: 502 });
    }

    const signal: 'BUY' | 'SELL' | 'NO_TRADE' = signalValue;
    const shortText = (value: unknown, fallback: string) =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : fallback;
    const bias: NewsMarketBias = signal === 'BUY' ? 'BULLISH' : signal === 'SELL' ? 'BEARISH' : 'UNCONFIRMED';
    const reason = shortText(raw.reason, 'No clear directional advantage identified.');
    const confirmation = shortText(raw.confirmation, 'Wait for price action to confirm after release.');
    const invalidation = shortText(raw.invalidation, 'Reassess if price action contradicts the expected direction.');
    const outcomePrimary: NewsOutcomeDirection = signal === 'BUY'
      ? 'ABOVE_EXPECTATIONS'
      : signal === 'SELL' ? 'BELOW_EXPECTATIONS' : 'INSUFFICIENT_DATA';
    const prediction = {
      outcome: {
        primary: outcomePrimary,
        probabilities: { positive: 34, inline: 33, negative: 33 },
        explanation: reason,
      },
      marketReaction: {
        currencyBias: 'UNCONFIRMED' as const,
        pairBiases: [{ symbol: selectedPair, bias }],
        explanation: reason,
        invalidationConditions: [invalidation],
      },
      tradingPlan: {
        preferredInstruments: signal === 'NO_TRADE' ? [] : [selectedPair],
        confirmationConditions: [confirmation],
        entryApproach: 'Wait for confirmation; do not trade the forecast alone.',
        risks: ['News volatility and spread expansion can cause slippage.'],
      },
      selectedInstrument: selectedPair,
      signal,
      confidencePercent: confidence,
      signalReason: reason,
      confirmation,
      invalidation,
      evidence: {
        forecast: event.forecast || null,
        previous: event.previous || null,
        actualAtGeneration: event.actual || null,
        relevantData: evidence.relevantData,
        missingData: evidence.missingData,
        quality: evidence.quality,
      },
      modelVersion: 'gemini-3.1-flash-lite-single-instrument',
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
        schemaVersion: 3,
      },
      evidenceSnapshot: { ...evidence, selectedInstrument: selectedPair },
    });

    return NextResponse.json({ prediction: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate news prediction.';
    const status = message.includes('storage is not configured') || message.includes('news_predictions') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

import { createOpenAIResponse, extractOpenAIOutputText } from '@/lib/openai';
import { NextRequest, NextResponse } from 'next/server';
import { fetchNormalizedMacroCalendar } from '@/lib/forex-factory-adapter';
import { fetchMacroCorrelationFeed } from '@/lib/macro-correlation';
import { fetchHybridOhlcContext } from '@/lib/live-ohlc';
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
import { getHistoricalNewsReleaseContext, recordHistoricalNewsRelease } from '@/lib/historical-news-releases';

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

    // Calendar providers often describe the same release differently
    // (for example, "Core PPI m/m" vs "Core PPI MoM"). Normalize common
    // economic-calendar aliases before matching the stable event details.
    const normalizeEventTitle = (value: string) => value
      .toLowerCase()
      .replace(/\bmonth\s*[- ]?over\s*[- ]?month\b/g, ' mom ')
      .replace(/\bm\s*\/\s*m\b/g, ' mom ')
      .replace(/\byear\s*[- ]?over\s*[- ]?year\b/g, ' yoy ')
      .replace(/\by\s*\/\s*y\b/g, ' yoy ')
      .replace(/\bquarter\s*[- ]?over\s*[- ]?quarter\b/g, ' qoq ')
      .replace(/\bq\s*\/\s*q\b/g, ' qoq ')
      .replace(/\bproducer\s+price\s+index\b/g, ' ppi ')
      .replace(/\bconsumer\s+price\s+index\b/g, ' cpi ')
      .replace(/\bpersonal\s+consumption\s+expenditures?\b/g, ' pce ')
      .replace(/\bnon[ -]?farm\s+payrolls?\b/g, ' nonfarm payrolls ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

    const hasStableReference = Boolean(
      requestedCurrency && requestedTitle && Number.isFinite(requestedTimestamp)
    );
    const matchedByDetails = hasStableReference
      ? calendar.events.find((candidate) =>
          candidate.currency.trim().toUpperCase() === requestedCurrency &&
          normalizeEventTitle(candidate.title) === normalizeEventTitle(requestedTitle) &&
          Math.abs(candidate.timestampUtcMs - requestedTimestamp) <= 30 * 60_000
        )
      : undefined;
    // Prefer the stable currency/title/time match. Event IDs can be regenerated
    // when feed ordering changes, so use an ID only for older clients that do
    // not send the stable event details.
    const event = matchedByDetails || (!hasStableReference
      ? calendar.events.find((candidate) => candidate.eventId === eventId)
      : undefined);
    if (!event || !/^[A-Z]{3}$/.test(event.currency.trim().toUpperCase()) || event.impact !== 'High' || event.isAllDayOrTentative) {
      return NextResponse.json({ error: 'The selected event could not be matched to an eligible high-impact calendar release. Refresh the calendar and try again.' }, { status: 400 });
    }

    if (body?.action === 'evaluate') {
      if (!event.actual?.trim() || !event.forecast?.trim()) {
        return NextResponse.json({ error: 'The calendar feed does not yet contain both the actual release and consensus forecast.' }, { status: 409 });
      }
      const fingerprint = getNewsEventFingerprint(event);
      const records = (await listNewsPredictions(100)).filter((item) =>
        item.eventFingerprint === fingerprint || item.eventFingerprint.startsWith(`${fingerprint}:`)
      );
      if (!records.length) {
        return NextResponse.json({ error: 'No saved AI prediction exists for this event.' }, { status: 404 });
      }
      await recordHistoricalNewsRelease(event);
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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured.' }, { status: 503 });
    }

    // Reuse the app's existing live macro and instrument OHLC feeds. All fetches
    // are bounded and run in parallel so manual prediction remains responsive.
    const [macroFeed, h1Market, m5Market, historicalReleases] = await Promise.all([
      fetchMacroCorrelationFeed(selectedPair, req.signal),
      fetchHybridOhlcContext(selectedPair, 'H1', req.signal),
      fetchHybridOhlcContext(selectedPair, 'M5', req.signal),
      getHistoricalNewsReleaseContext(event.currency, event.title, event.timestampUtcMs),
    ]);
    const historicalBlock = historicalReleases?.promptBlock || '';
    const evidenceBase = buildNewsEvidenceSnapshot(event);
    const marketContextBlocks = [
      macroFeed?.promptBlock,
      h1Market?.promptBlock,
      m5Market?.promptBlock,
    ].filter((value): value is string => Boolean(value));
    const missingMarketData = [
      !macroFeed ? 'Live DXY / US10Y context was unavailable for this request.' : '',
      !h1Market ? 'Selected-instrument H1 OHLC context was unavailable.' : '',
      !m5Market ? 'Selected-instrument M5 OHLC context was unavailable.' : '',
    ].filter(Boolean);
    const evidence = {
      ...evidenceBase,
      relevantData: [...evidenceBase.relevantData, ...marketContextBlocks, ...(historicalBlock ? [historicalBlock] : [])],
      missingData: [
        ...evidenceBase.missingData.filter((item) => !item.includes('Live DXY')),
        ...missingMarketData,
      ],
      quality: marketContextBlocks.length >= 2 && evidenceBase.quality !== 'LOW'
        ? 'HIGH' as const
        : marketContextBlocks.length > 0
          ? 'MEDIUM' as const
          : evidenceBase.quality,
    };
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
      'ADDITIONAL LIVE MARKET EVIDENCE (use the data as context, not as rigid filters):',
      ...marketContextBlocks,
      historicalBlock ? 'HISTORICAL ECONOMIC RELEASE EVIDENCE (descriptive context, not a trading rule):' : 'No matching historical release observations are archived yet; do not invent historical statistics.',
      ...(historicalBlock ? [historicalBlock] : []),
      marketContextBlocks.length ? '' : 'Live market telemetry was unavailable; do not invent market prices, trends or levels.',
      'Weigh the economic event, recent macro context and selected-instrument H1/M5 price behaviour together. Explain material agreement or disagreement. Do not treat a technical snapshot as proof of the future reaction.',
      'Assess the likely directional reaction for this instrument only. Avoid certainty when evidence is weak.',
    ].join('\n');

    const response = await createOpenAIResponse({
      instructions: systemInstruction,
      input: prompt,
      responseFormat: 'json_object',
      reasoningEffort: 'medium',
      maxOutputTokens: 1800,
      signal: req.signal,
    });
    const raw = extractJson(extractOpenAIOutputText(response));
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
        historicalReleaseCount: historicalReleases?.count ?? 0,
      },
      modelVersion: 'gpt-6.1-sol-single-instrument',
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
      evidenceSnapshot: {
        ...evidence,
        selectedInstrument: selectedPair,
        marketContext: {
          macro: macroFeed?.rawSnapshots ?? null,
          h1: h1Market ? {
            source: h1Market.source,
            lastBarAgeSeconds: h1Market.lastBarAgeSeconds,
            spotAgeSeconds: h1Market.spotAgeSeconds ?? null,
            basisFiltered: h1Market.basisFiltered,
            latestClose: h1Market.latestClose,
            atr14: h1Market.atr14,
            recentRangeHigh: h1Market.recentRangeHigh,
            recentRangeLow: h1Market.recentRangeLow,
            swingHighs: h1Market.swingHighs,
            swingLows: h1Market.swingLows,
          } : null,
          m5: m5Market ? {
            source: m5Market.source,
            lastBarAgeSeconds: m5Market.lastBarAgeSeconds,
            spotAgeSeconds: m5Market.spotAgeSeconds ?? null,
            basisFiltered: m5Market.basisFiltered,
            latestClose: m5Market.latestClose,
            atr14: m5Market.atr14,
            recentRangeHigh: m5Market.recentRangeHigh,
            recentRangeLow: m5Market.recentRangeLow,
            swingHighs: m5Market.swingHighs,
            swingLows: m5Market.swingLows,
          } : null,
        },
      },
    });

    return NextResponse.json({ prediction: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate news prediction.';
    const status = message.includes('storage is not configured') || message.includes('news_predictions') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

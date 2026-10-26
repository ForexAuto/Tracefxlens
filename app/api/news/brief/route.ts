import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import type { EventAiMacroBrief, MacroCalendarEvent } from '@/lib/macro-news';
import {
  generateOpenRouterCompletion,
  hasGeminiKey,
  hasOpenRouterKey,
  resolveOpenRouterVisionCascade,
} from '@/lib/openrouter-server';

const briefCache = new Map<string, EventAiMacroBrief>();

function buildDeterministicBrief(ev: MacroCalendarEvent): EventAiMacroBrief {
  const topPairs = ev.affectedPairs.slice(0, 3).map((p) => p.symbol);
  const pairList = topPairs.join(', ');
  const bullishPairs = ev.affectedPairs
    .slice(0, 2)
    .map(
      (p) =>
        `${p.symbol} (${p.bullishCurrencyEffect === 'UP' ? 'upside' : 'downside'} pressure)`
    )
    .join(' and ');
  const bearishPairs = ev.affectedPairs
    .slice(0, 2)
    .map(
      (p) =>
        `${p.symbol} (${p.bullishCurrencyEffect === 'UP' ? 'downside' : 'upside'} pressure)`
    )
    .join(' and ');

  const hasActual = Boolean(ev.actual && ev.actual.trim());
  const headlineVerdict =
    ev.impact === 'Holiday'
      ? `${ev.currency} interbank liquidity is thinned by ${ev.title}; prioritize London/NY overlap sessions on ${pairList}.`
      : hasActual
      ? `${ev.currency} ${ev.title} printed ${ev.actual} vs ${
          ev.forecast || 'unscheduled'
        } consensus (${ev.surpriseLabel})—focus on post-release structure across ${pairList}.`
      : `Upcoming ${ev.impact.toLowerCase()}-impact ${ev.currency} catalyst (${
          ev.forecast ? `Forecast ${ev.forecast} vs Previous ${ev.previous || '—'}` : 'Scheduled release'
        }) governing near-term rate expectations across ${pairList}.`;

  return {
    eventId: ev.eventId,
    headlineVerdict,
    preReleaseKillzoneNote: ev.killzoneGuidance,
    bullishPrintPlaybook: `A hawkish/stronger ${ev.currency} outcome drives ${bullishPairs} as yields reprice higher.`,
    bearishPrintPlaybook: `A dovish/softer ${ev.currency} outcome drives ${bearishPairs} as rate-cut expectations expand.`,
    crtExecutionTip: `Never chase the initial 1-minute release spike on ${
      topPairs[0] || ev.currency
    }; wait 5–15 minutes for the news wick to purge H1 CRT liquidity and confirm an M5 CHoCH + Fair Value Gap before pulling the trigger.`,
    generatedBy: 'deterministic',
    generatedAtIso: new Date().toISOString(),
  };
}

function extractFirstJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let event: MacroCalendarEvent | null = null;
  let forceRefresh = false;

  try {
    const body = await req.json();
    event = (body?.event as MacroCalendarEvent) || null;
    forceRefresh = Boolean(body?.forceRefresh);
  } catch {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  if (!event || !event.eventId || !event.title) {
    return NextResponse.json({ error: 'Missing event payload.' }, { status: 400 });
  }

  const cacheKey = `${event.eventId}|${event.actual || 'pending'}`;
  if (!forceRefresh && briefCache.has(cacheKey)) {
    return NextResponse.json({ brief: briefCache.get(cacheKey)! });
  }

  const geminiReady = hasGeminiKey();
  const openRouterReady = hasOpenRouterKey();

  if (!geminiReady && !openRouterReady) {
    const fallback = buildDeterministicBrief(event);
    return NextResponse.json({ brief: fallback });
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

  const pairsDesc = event.affectedPairs
    .map(
      (p) =>
        `${p.symbol} (${p.relationship}; stronger ${event.currency} -> ${p.symbol} ${p.bullishCurrencyEffect})`
    )
    .join(', ');

  const systemInstruction = `You are a senior institutional FX & Gold macroeconomic desk strategist for TraceFX Lens.
Given an economic calendar event, return ONLY a single valid JSON object (no markdown fences) with concise, actionable Smart Money Concepts (SMC) & Candle Range Theory (CRT) guidance:
{
  "headlineVerdict": "<1 crisp sentence summarizing macro stakes or actual-vs-forecast market implication>",
  "preReleaseKillzoneNote": "<1 crisp sentence on spread/whipsaw timing around release and stop protection>",
  "bullishPrintPlaybook": "<1 specific sentence stating what threshold/surprise strengthens ${event.currency} and exact directional effect on top pairs>",
  "bearishPrintPlaybook": "<1 specific sentence stating what threshold/surprise weakens ${event.currency} and exact directional effect on top pairs>",
  "crtExecutionTip": "<1 specific sentence explaining how to wait for the news liquidity purge on H1 CRT High/Low and execute via M5 CHoCH/FVG>"
}`;

  const prompt = [
    `Event: ${event.currency} — ${event.title}${event.period ? ` (${event.period})` : ''}`,
    `Impact Tier: ${event.impact}`,
    `Numbers: Actual=${event.actual || 'Pending'} | Forecast=${event.forecast || 'N/A'} | Previous=${event.previous || 'N/A'}`,
    `Surprise Status: ${event.surpriseLabel} (${event.surpriseDeltaText})`,
    `Official Indicator Definition: ${event.officialOverview}`,
    `Usual Effect: ${event.usualEffect}`,
    `Affected TraceFX Pairs: ${pairsDesc}`,
  ].join('\n');

  const candidates: Array<{
    provider: 'gemini' | 'openrouter';
    model: string;
    timeoutMs: number;
    thinkingLevel?: ThinkingLevel;
  }> = [];

  if (geminiReady) {
    candidates.push({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      timeoutMs: 8000,
      thinkingLevel: ThinkingLevel.LOW,
    });
  }
  if (openRouterReady) {
    const orIds = await resolveOpenRouterVisionCascade(null, 2);
    for (const id of orIds) {
      candidates.push({
        provider: 'openrouter',
        model: id,
        timeoutMs: 10000,
      });
    }
  }

  for (const cand of candidates) {
    if (req.signal.aborted) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cand.timeoutMs);
    const onAbort = () => controller.abort();
    req.signal.addEventListener('abort', onAbort, { once: true });

    try {
      let rawText = '';
      if (cand.provider === 'openrouter') {
        rawText = await generateOpenRouterCompletion({
          model: cand.model,
          systemInstruction,
          promptText: prompt,
          temperature: 0.2,
          signal: controller.signal,
        });
      } else if (ai) {
        const response = await ai.models.generateContent({
          model: cand.model,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.2,
            responseMimeType: 'application/json',
            abortSignal: controller.signal,
            ...(cand.thinkingLevel
              ? { thinkingConfig: { thinkingLevel: cand.thinkingLevel } }
              : {}),
          },
        });
        rawText = response.text || '';
      }

      const parsed = extractFirstJson(rawText);
      if (parsed && parsed.headlineVerdict) {
        const fallback = buildDeterministicBrief(event);
        const brief: EventAiMacroBrief = {
          eventId: event.eventId,
          headlineVerdict: String(parsed.headlineVerdict || fallback.headlineVerdict).trim(),
          preReleaseKillzoneNote: String(
            parsed.preReleaseKillzoneNote || fallback.preReleaseKillzoneNote
          ).trim(),
          bullishPrintPlaybook: String(
            parsed.bullishPrintPlaybook || fallback.bullishPrintPlaybook
          ).trim(),
          bearishPrintPlaybook: String(
            parsed.bearishPrintPlaybook || fallback.bearishPrintPlaybook
          ).trim(),
          crtExecutionTip: String(
            parsed.crtExecutionTip || fallback.crtExecutionTip
          ).trim(),
          generatedBy: 'gemini',
          generatedAtIso: new Date().toISOString(),
        };

        if (briefCache.size > 250) {
          const firstKey = briefCache.keys().next().value;
          if (firstKey) briefCache.delete(firstKey);
        }
        briefCache.set(cacheKey, brief);
        return NextResponse.json({ brief });
      }
    } catch {
      // Try backup model or deterministic institutional fallback
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener('abort', onAbort);
    }
  }

  const fallbackBrief = buildDeterministicBrief(event);
  return NextResponse.json({ brief: fallbackBrief });
}

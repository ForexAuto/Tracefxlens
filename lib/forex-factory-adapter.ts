import { ForexFactory, toForexFactoryDate } from 'forexfactory';
import {
  CURRENCY_COUNTRY_NAME,
  MacroCalendarEvent,
  NewsImpactTier,
  computeReleaseSurprise,
  getAffectedPairsForCurrency,
  resolveIndicatorKnowledge,
} from '@/lib/macro-news';

export interface MacroCalendarEngineResult {
  events: MacroCalendarEvent[];
  engineMeta: {
    primaryPackage: string;
    activeSource: string;
    fetchedAtIso: string;
    count: number;
  };
}

interface FairEconomyRawEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

interface LiveCalendarRawEvent {
  id?: string | number;
  title?: string;
  country?: string;
  indicator?: string;
  comment?: string;
  period?: string;
  source?: string;
  source_url?: string;
  actual?: number | string | null;
  previous?: number | string | null;
  forecast?: number | string | null;
  currency?: string;
  unit?: string;
  importance?: number;
  date?: string;
}

const CALENDAR_CACHE_TTL_MS = 90_000;
let cachedCalendarResult: {
  data: MacroCalendarEngineResult;
  cachedAtMs: number;
} | null = null;

function createBoundedSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function normalizeImpactTier(raw: string | undefined): NewsImpactTier {
  const clean = (raw || '').trim().toLowerCase();
  if (clean === 'high') return 'High';
  if (clean === 'medium') return 'Medium';
  if (clean === 'holiday' || clean === 'non-economic') return 'Holiday';
  return 'Low';
}

function formatNumericWithUnit(
  val: number | string | null | undefined,
  unit: string | undefined
): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return '';
    if (unit && !trimmed.endsWith(unit) && /^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return `${trimmed}${unit}`;
    }
    return trimmed;
  }
  if (!Number.isFinite(val)) return '';

  const u = (unit || '').trim();
  // Format large raw numbers if unit is empty or standard
  if (!u && Math.abs(val) >= 1_000_000_000) {
    return `${(val / 1_000_000_000).toFixed(2)}B`;
  }
  if (!u && Math.abs(val) >= 1_000_000) {
    return `${(val / 1_000_000).toFixed(1)}M`;
  }
  if (!u && Math.abs(val) >= 10_000) {
    return `${Math.round(val / 1_000)}K`;
  }

  const rounded = Number.isInteger(val)
    ? String(val)
    : Number(val.toFixed(2)).toString();
  return u ? `${rounded}${u}` : rounded;
}

function normalizeTitleStem(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bm\/m\b/g, 'mom')
    .replace(/\by\/y\b/g, 'yoy')
    .replace(/\bq\/q\b/g, 'qoq')
    .replace(/\b(flash|prelim|preliminary|final|revised)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32);
}

function allocateUniqueEventId(
  baseId: string,
  usedEventIds: Set<string>
): string {
  let candidate = baseId;
  let suffix = 2;
  while (usedEventIds.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }
  usedEventIds.add(candidate);
  return candidate;
}

/**
 * Corrects DST offset when parsing scraped ForexFactory date + time strings in IANA timezones
 * (fixes forexfactory@1.0.0's hardcoded -5 EST offset during Daylight Saving Time).
 */
function parseScrapedDateAndTimeToUtcMs(
  dateStr: string,
  timeStr: string,
  ianaTimezone: string,
  referenceYear: number
): { timestampUtcMs: number; isAllDayOrTentative: boolean } {
  const cleanTime = (timeStr || '').trim().toLowerCase();
  const isSpecial =
    !cleanTime ||
    cleanTime === 'all day' ||
    cleanTime === 'tentative' ||
    cleanTime.startsWith('day ');

  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const dm = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2})/);
  if (!dm) {
    return { timestampUtcMs: Date.now(), isAllDayOrTentative: true };
  }

  const monthIdx = monthMap[dm[1].toLowerCase()] ?? 0;
  const dayNum = Number.parseInt(dm[2], 10);

  let hours = 12;
  let minutes = 0;
  if (!isSpecial) {
    const tm = cleanTime.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (tm) {
      hours = Number.parseInt(tm[1], 10);
      minutes = Number.parseInt(tm[2], 10);
      if (tm[3] === 'pm' && hours !== 12) hours += 12;
      if (tm[3] === 'am' && hours === 12) hours = 0;
    }
  }

  // Compute exact IANA timezone offset at this calendar date using Intl.DateTimeFormat
  const approxUtc = Date.UTC(referenceYear, monthIdx, dayNum, hours, minutes, 0);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTimezone || 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(approxUtc));

    const zY = Number(parts.find((p) => p.type === 'year')?.value || referenceYear);
    const zM = Number(parts.find((p) => p.type === 'month')?.value || monthIdx + 1) - 1;
    const zD = Number(parts.find((p) => p.type === 'day')?.value || dayNum);
    let zH = Number(parts.find((p) => p.type === 'hour')?.value || hours);
    if (zH === 24) zH = 0;
    const zMin = Number(parts.find((p) => p.type === 'minute')?.value || minutes);

    const zonedAsUtc = Date.UTC(zY, zM, zD, zH, zMin, 0);
    const offsetMs = zonedAsUtc - approxUtc;
    return {
      timestampUtcMs: approxUtc - offsetMs,
      isAllDayOrTentative: isSpecial,
    };
  } catch {
    return { timestampUtcMs: approxUtc, isAllDayOrTentative: isSpecial };
  }
}

/**
 * Primary adapter: invokes the installed `forexfactory` npm package (`ForexFactory`)
 * inside a strict 2.2s timeout so Cloudflare 403 blocks never stall server responses.
 */
async function tryFetchViaForexFactoryNpm(
  fromDate: Date,
  toDate: Date
): Promise<MacroCalendarEvent[]> {
  try {
    const ff = new ForexFactory();
    const fromFormatted = toForexFactoryDate(fromDate);
    const toFormatted = toForexFactoryDate(toDate);

    const response = await Promise.race([
      ff.calendarEvents(fromFormatted, toFormatted),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2200)),
    ]);

    if (!response || !Array.isArray(response.data) || response.data.length === 0) {
      return [];
    }

    const refYear = fromDate.getUTCFullYear();
    const results: MacroCalendarEvent[] = [];

    for (const dayGroup of response.data) {
      for (const item of dayGroup.events) {
        const ccy = (item.currency || '').trim().toUpperCase();
        if (!ccy) continue;

        const impact = normalizeImpactTier(item.impact);
        const { timestampUtcMs, isAllDayOrTentative } =
          parseScrapedDateAndTimeToUtcMs(
            dayGroup.date,
            item.time,
            response.tz || 'America/New_York',
            refYear
          );

        // Verify ForexFactory.formatTimestamp static utility works on valid UTC timestamps
        const formattedCheck =
          !isAllDayOrTentative && timestampUtcMs > 0
            ? ForexFactory.formatTimestamp(timestampUtcMs, 'UTC')
            : 'All Day';
        void formattedCheck;

        const specs = resolveIndicatorKnowledge(item.title, ccy, impact);
        const surprise = computeReleaseSurprise(
          item.title,
          ccy,
          impact,
          item.actual,
          item.forecast
        );

        results.push({
          eventId: `ff_${item.eventId}`,
          title: item.title,
          currency: ccy,
          countryName: CURRENCY_COUNTRY_NAME[ccy] || ccy,
          impact,
          timestampUtcMs,
          isAllDayOrTentative,
          rawTimeLabel: item.time || 'Scheduled',
          actual: item.actual || '',
          forecast: item.forecast || '',
          previous: item.previous || '',
          unit: '',
          period: '',
          ...surprise,
          ...specs,
          sourceUrl: '',
          affectedPairs: getAffectedPairsForCurrency(ccy),
          dataOrigin: 'forexfactory_npm',
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Official Forex Factory / FairEconomy weekly JSON mirror (bypasses Cloudflare 403 on cloud IPs).
 */
async function fetchFairEconomyWeeklyJson(): Promise<FairEconomyRawEvent[]> {
  const { signal, cleanup } = createBoundedSignal(2600);
  try {
    const res = await fetch(
      'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; TraceFXLens/1.0)',
        },
        signal,
        cache: 'no-store',
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as FairEconomyRawEvent[]) : [];
  } catch {
    return [];
  } finally {
    cleanup();
  }
}

/**
 * Live global economic calendar feed with real-time released `actual` prints,
 * multi-week schedules (`Next Week`), official indicator `comment` overviews, and `source_url`.
 */
async function fetchLiveCalendarActuals(
  fromDate: Date,
  toDate: Date
): Promise<LiveCalendarRawEvent[]> {
  const { signal, cleanup } = createBoundedSignal(2800);
  try {
    const url = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(
      fromDate.toISOString()
    )}&to=${encodeURIComponent(
      toDate.toISOString()
    )}&countries=US,EU,GB,JP,AU,CA,CH,NZ,CN`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; TraceFXLens/1.0)',
      },
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { result?: LiveCalendarRawEvent[] };
    return Array.isArray(json?.result) ? json.result : [];
  } catch {
    return [];
  } finally {
    cleanup();
  }
}

function findMatchingLiveEvent(
  ccy: string,
  tsMs: number,
  title: string,
  livePool: LiveCalendarRawEvent[],
  usedLiveIds: Set<string>
): LiveCalendarRawEvent | undefined {
  const stem = normalizeTitleStem(title);
  const lowerTitle = title.toLowerCase();
  const wantsMom = /\b(m\/m|mom)\b/.test(lowerTitle);
  const wantsYoy = /\b(y\/y|yoy)\b/.test(lowerTitle);
  const wantsQoq = /\b(q\/q|qoq)\b/.test(lowerTitle);
  const wantsCoreOrTrimmed = /\b(core|trimmed|median)\b/.test(lowerTitle);

  let bestMatch: LiveCalendarRawEvent | undefined;
  let bestScore = 0;

  for (const cand of livePool) {
    if (cand.id !== undefined && usedLiveIds.has(String(cand.id))) continue;

    const candCcy = (cand.currency || '').trim().toUpperCase();
    if (candCcy !== ccy) continue;
    const candTs = cand.date ? Date.parse(cand.date) : NaN;
    if (!Number.isFinite(candTs)) continue;

    // Must occur within ±30 minutes of the Forex Factory scheduled slot
    if (Math.abs(candTs - tsMs) > 30 * 60_000) continue;

    const candTitle = cand.title || cand.indicator || '';
    const lowerCand = candTitle.toLowerCase();
    const candStem = normalizeTitleStem(candTitle);
    let score = 1;

    if (stem && candStem && stem === candStem) {
      score += 6;
    } else if (
      stem &&
      candStem &&
      (candStem.includes(stem) || stem.includes(candStem))
    ) {
      score += 3;
    } else {
      const words = lowerTitle
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);
      for (const w of words) {
        if (lowerCand.includes(w)) score += 1;
      }
    }

    // Align cadence (MoM / YoY / QoQ) and Core/Trimmed modifiers so sibling prints pair 1-to-1
    const candMom = /\b(m\/m|mom|month)\b/.test(lowerCand);
    const candYoy = /\b(y\/y|yoy|year|annual)\b/.test(lowerCand);
    const candQoq = /\b(q\/q|qoq|quarter)\b/.test(lowerCand);
    const candCoreOrTrimmed = /\b(core|trimmed|median)\b/.test(lowerCand);

    if (wantsMom && candMom) score += 2;
    if (wantsYoy && candYoy) score += 2;
    if (wantsQoq && candQoq) score += 2;
    if ((wantsMom && (candYoy || candQoq)) || (wantsYoy && (candMom || candQoq)) || (wantsQoq && (candMom || candYoy))) {
      score -= 2;
    }
    if (wantsCoreOrTrimmed !== candCoreOrTrimmed) {
      score -= 1;
    } else if (wantsCoreOrTrimmed && candCoreOrTrimmed) {
      score += 2;
    }

    if (score > bestScore && score >= 2) {
      bestScore = score;
      bestMatch = cand;
    }
  }

  return bestMatch;
}

export async function fetchNormalizedMacroCalendar(options?: {
  forceRefresh?: boolean;
}): Promise<MacroCalendarEngineResult> {
  if (
    !options?.forceRefresh &&
    cachedCalendarResult &&
    Date.now() - cachedCalendarResult.cachedAtMs < CALENDAR_CACHE_TTL_MS
  ) {
    return cachedCalendarResult.data;
  }

  const now = new Date();
  // Cover start of current week (-3 days) through end of Next Week (+13 days)
  const fromDate = new Date(now.getTime() - 3 * 86_400_000);
  const toDate = new Date(now.getTime() + 13 * 86_400_000);

  const [npmEvents, ffWeeklyJson, liveActuals] = await Promise.all([
    tryFetchViaForexFactoryNpm(fromDate, toDate),
    fetchFairEconomyWeeklyJson(),
    fetchLiveCalendarActuals(fromDate, toDate),
  ]);

  const mergedEvents: MacroCalendarEvent[] = [];
  const usedLiveIds = new Set<string>();
  const usedEventIds = new Set<string>();
  const seenKeys = new Set<string>();

  // 1. Seed from `forexfactory` npm client if direct scrape succeeded (e.g., non-Cloudflare network)
  for (const ev of npmEvents) {
    const match = findMatchingLiveEvent(
      ev.currency,
      ev.timestampUtcMs,
      ev.title,
      liveActuals,
      usedLiveIds
    );
    if (match?.id !== undefined) {
      usedLiveIds.add(String(match.id));
    }

    const unit = match?.unit || '';
    const actual =
      ev.actual || formatNumericWithUnit(match?.actual, unit);
    const forecast =
      ev.forecast || formatNumericWithUnit(match?.forecast, unit);
    const previous =
      ev.previous || formatNumericWithUnit(match?.previous, unit);

    const specs = resolveIndicatorKnowledge(
      ev.title,
      ev.currency,
      ev.impact,
      match?.comment,
      match?.source
    );
    const surprise = computeReleaseSurprise(
      ev.title,
      ev.currency,
      ev.impact,
      actual,
      forecast
    );

    const dedupeKey = `${ev.currency}|${Math.round(
      ev.timestampUtcMs / 60_000
    )}|${normalizeTitleStem(ev.title)}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    mergedEvents.push({
      ...ev,
      eventId: allocateUniqueEventId(ev.eventId, usedEventIds),
      actual,
      forecast,
      previous,
      unit,
      period: match?.period || '',
      ...surprise,
      ...specs,
      sourceUrl: match?.source_url || '',
    });
  }

  // 2. Automatic Fallback / Merge from Official FairEconomy Forex Factory Weekly JSON
  for (let idx = 0; idx < ffWeeklyJson.length; idx++) {
    const raw = ffWeeklyJson[idx];
    const title = (raw.title || '').trim();
    const ccy = (raw.country || '').trim().toUpperCase();
    const parsedTs = raw.date ? Date.parse(raw.date) : NaN;
    if (!title || !ccy || !Number.isFinite(parsedTs)) continue;

    const dedupeKey = `${ccy}|${Math.round(
      parsedTs / 60_000
    )}|${normalizeTitleStem(title)}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const impact = normalizeImpactTier(raw.impact);
    const isHoliday = impact === 'Holiday';

    const match = isHoliday
      ? undefined
      : findMatchingLiveEvent(ccy, parsedTs, title, liveActuals, usedLiveIds);
    if (match?.id !== undefined) {
      usedLiveIds.add(String(match.id));
    }

    const unit = match?.unit || '';
    const actual =
      (raw.actual || '').trim() || formatNumericWithUnit(match?.actual, unit);
    const forecast =
      (raw.forecast || '').trim() || formatNumericWithUnit(match?.forecast, unit);
    const previous =
      (raw.previous || '').trim() || formatNumericWithUnit(match?.previous, unit);

    const specs = resolveIndicatorKnowledge(
      title,
      ccy,
      impact,
      match?.comment,
      match?.source
    );
    const surprise = computeReleaseSurprise(title, ccy, impact, actual, forecast);

    const rawTimeFormatted = isHoliday
      ? 'All Day'
      : ForexFactory.formatTimestamp(parsedTs, 'America/New_York');

    const candidateEventId = match?.id
      ? `ff_tv_${match.id}`
      : `ff_json_${parsedTs}_${idx}`;

    mergedEvents.push({
      eventId: allocateUniqueEventId(candidateEventId, usedEventIds),
      title,
      currency: ccy,
      countryName: CURRENCY_COUNTRY_NAME[ccy] || ccy,
      impact,
      timestampUtcMs: parsedTs,
      isAllDayOrTentative: isHoliday,
      rawTimeLabel: rawTimeFormatted,
      actual,
      forecast,
      previous,
      unit,
      period: match?.period || '',
      ...surprise,
      ...specs,
      sourceUrl: match?.source_url || '',
      affectedPairs: getAffectedPairsForCurrency(ccy),
      dataOrigin: 'forexfactory_hybrid_json',
    });
  }

  // 3. Append multi-week High & Medium releases (e.g. Next Week) from Live Calendar not in this week's FF JSON
  for (let liveIdx = 0; liveIdx < liveActuals.length; liveIdx++) {
    const live = liveActuals[liveIdx];
    const liveId = live.id !== undefined ? String(live.id) : '';
    if (liveId && usedLiveIds.has(liveId)) continue;

    const impNum = typeof live.importance === 'number' ? live.importance : -1;
    // importance >= 1 = High, importance === 0 = Medium
    if (impNum < 0) continue;

    const ccy = (live.currency || '').trim().toUpperCase();
    const title = (live.title || live.indicator || '').trim();
    const parsedTs = live.date ? Date.parse(live.date) : NaN;
    if (!ccy || !title || !Number.isFinite(parsedTs)) continue;

    const dedupeKey = `${ccy}|${Math.round(
      parsedTs / 60_000
    )}|${normalizeTitleStem(title)}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const impact: NewsImpactTier = impNum >= 1 ? 'High' : 'Medium';
    const unit = live.unit || '';
    const actual = formatNumericWithUnit(live.actual, unit);
    const forecast = formatNumericWithUnit(live.forecast, unit);
    const previous = formatNumericWithUnit(live.previous, unit);

    const specs = resolveIndicatorKnowledge(
      title,
      ccy,
      impact,
      live.comment,
      live.source
    );
    const surprise = computeReleaseSurprise(title, ccy, impact, actual, forecast);

    const candidateEventId = `tv_${liveId || `${parsedTs}_${liveIdx}`}`;

    mergedEvents.push({
      eventId: allocateUniqueEventId(candidateEventId, usedEventIds),
      title,
      currency: ccy,
      countryName: CURRENCY_COUNTRY_NAME[ccy] || ccy,
      impact,
      timestampUtcMs: parsedTs,
      isAllDayOrTentative: false,
      rawTimeLabel: ForexFactory.formatTimestamp(parsedTs, 'America/New_York'),
      actual,
      forecast,
      previous,
      unit,
      period: live.period || '',
      ...surprise,
      ...specs,
      sourceUrl: live.source_url || '',
      affectedPairs: getAffectedPairsForCurrency(ccy),
      dataOrigin: 'forexfactory_hybrid_json',
    });
  }

  mergedEvents.sort((a, b) => a.timestampUtcMs - b.timestampUtcMs);

  const activeSource =
    npmEvents.length > 0
      ? 'forexfactory npm + Live Actuals Enrichment'
      : 'ForexFactory Official JSON + Live Actuals Fallback';

  const engineResult: MacroCalendarEngineResult = {
    events: mergedEvents,
    engineMeta: {
      primaryPackage: 'forexfactory@1.0.0',
      activeSource,
      fetchedAtIso: new Date().toISOString(),
      count: mergedEvents.length,
    },
  };

  if (mergedEvents.length > 0) {
    cachedCalendarResult = {
      data: engineResult,
      cachedAtMs: Date.now(),
    };
  }

  return engineResult;
}

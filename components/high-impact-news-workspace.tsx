'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RotateCcw,
  Search,
  X,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { AppHeaderWithSidebar } from '@/components/navigation-sidebar';
import { NewsEventOverview } from '@/components/news-event-overview';
import {
  EventAiMacroBrief,
  MAJOR_NEWS_CURRENCIES,
  MacroCalendarEvent,
  NewsHorizon,
  TIMEZONE_PRESETS,
  formatDayHeadingInZone,
  formatEventDateKeyInZone,
  formatEventTimeInZone,
  formatRelativeCountdown,
  formatShortWeekdayDateInZone,
  resolveEffectiveTimezone,
} from '@/lib/macro-news';

const NEWS_TZ_STORAGE_KEY = 'tracefx_news_tz_v1';

interface CalendarApiResponse {
  events: MacroCalendarEvent[];
  engineMeta?: {
    primaryPackage: string;
    activeSource: string;
    fetchedAtIso: string;
    count: number;
  };
  error?: string;
}

function getHorizonBoundsInZone(
  horizon: NewsHorizon,
  nowMs: number,
  tzOption: string
): { startDateKey: string; endDateKey: string } {
  const zone = resolveEffectiveTimezone(tzOption);
  const dayMs = 86_400_000;

  if (horizon === 'today') {
    const k = formatEventDateKeyInZone(nowMs, zone);
    return { startDateKey: k, endDateKey: k };
  }

  if (horizon === 'tomorrow') {
    const k = formatEventDateKeyInZone(nowMs + dayMs, zone);
    return { startDateKey: k, endDateKey: k };
  }

  // Determine weekday index (0=Sun..6=Sat) in selected timezone
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
  }).format(new Date(nowMs));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = map[weekdayShort] ?? new Date(nowMs).getDay();

  if (horizon === 'this_week') {
    const weekStartMs = nowMs - dow * dayMs;
    const weekEndMs = weekStartMs + 6 * dayMs;
    return {
      startDateKey: formatEventDateKeyInZone(weekStartMs, zone),
      endDateKey: formatEventDateKeyInZone(weekEndMs, zone),
    };
  }

  // next_week
  const nextWeekStartMs = nowMs + (7 - dow) * dayMs;
  const nextWeekEndMs = nextWeekStartMs + 6 * dayMs;
  return {
    startDateKey: formatEventDateKeyInZone(nextWeekStartMs, zone),
    endDateKey: formatEventDateKeyInZone(nextWeekEndMs, zone),
  };
}

export function HighImpactNewsWorkspace() {
  const [events, setEvents] = useState<MacroCalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters: High Impact ON by default, with Medium & Holiday toggles
  const [horizon, setHorizon] = useState<NewsHorizon>('this_week');
  const [showHigh, setShowHigh] = useState<boolean>(true);
  const [showMedium, setShowMedium] = useState<boolean>(false);
  const [showHolidays, setShowHolidays] = useState<boolean>(false);
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [timezone, setTimezone] = useState<string>('LOCAL');

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mobileOverviewOpen, setMobileOverviewOpen] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Cached AI Macro Playbooks keyed by `${eventId}|${actual}`
  const [briefMap, setBriefMap] = useState<Record<string, EventAiMacroBrief>>({});
  const [loadingBriefKey, setLoadingBriefKey] = useState<string | null>(null);
  const briefAbortRef = useRef<AbortController | null>(null);
  const eventsRef = useRef<MacroCalendarEvent[]>([]);
  const briefMapRef = useRef<Record<string, EventAiMacroBrief>>({});

  const loadCalendar = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await fetch(
        `/api/news${forceRefresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' }
      );
      const data = (await res.json()) as CalendarApiResponse;
      if (!res.ok || data.error) {
        throw new Error(
          data.error || 'Unable to load Forex Factory calendar events.'
        );
      }

      const rawFetched = Array.isArray(data.events) ? data.events : [];
      const seenIds = new Set<string>();
      const fetched = rawFetched.map((item, idx) => {
        let id = item.eventId || `ev_${idx}`;
        if (seenIds.has(id)) {
          id = `${id}_${idx}`;
        }
        seenIds.add(id);
        return id === item.eventId ? item : { ...item, eventId: id };
      });
      eventsRef.current = fetched;
      setEvents(fetched);

      // Auto-select the next upcoming USD High-Impact event first (falling back to global High-Impact)
      setSelectedEventId((prev) => {
        if (prev && fetched.some((e) => e.eventId === prev)) return prev;
        const currentTs = Date.now();
        const nextHigh =
          fetched.find(
            (e) =>
              e.currency === 'USD' &&
              e.impact === 'High' &&
              e.timestampUtcMs >= currentTs - 900_000
          ) ||
          fetched.find((e) => e.currency === 'USD' && e.impact === 'High') ||
          fetched.find(
            (e) => e.impact === 'High' && e.timestampUtcMs >= currentTs - 900_000
          ) ||
          fetched.find((e) => e.impact === 'High') ||
          fetched[0];
        return nextHigh ? nextHigh.eventId : null;
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Network error while fetching macroeconomic calendar.'
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Boot timezone preference and initial calendar load asynchronously
  useEffect(() => {
    const bootTimer = window.setTimeout(() => {
      try {
        const savedTz = window.localStorage.getItem(NEWS_TZ_STORAGE_KEY);
        if (savedTz) {
          setTimezone(savedTz);
        }
      } catch {
        // Ignore storage access restrictions
      }
      void loadCalendar(false);
    }, 0);

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15_000);

    return () => {
      window.clearTimeout(bootTimer);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!mobileOverviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOverviewOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOverviewOpen]);

  const handleTimezoneChange = (nextTz: string) => {
    setTimezone(nextTz);
    try {
      window.localStorage.setItem(NEWS_TZ_STORAGE_KEY, nextTz);
    } catch {
      // Ignore storage restrictions
    }
  };

  // Next imminent Red-Folder catalyst across the entire loaded feed
  const nextRedFolderCatalyst = useMemo(() => {
    return (
      events.find(
        (ev) => ev.impact === 'High' && ev.timestampUtcMs >= nowMs - 60_000
      ) || null
    );
  }, [events, nowMs]);

  const todayKey = useMemo(
    () => formatEventDateKeyInZone(nowMs, timezone),
    [nowMs, timezone]
  );

  const todayHighStats = useMemo(() => {
    const todaysHigh = events.filter(
      (ev) =>
        ev.impact === 'High' &&
        formatEventDateKeyInZone(ev.timestampUtcMs, timezone) === todayKey
    );
    const released = todaysHigh.filter(
      (ev) => Boolean(ev.actual) || ev.timestampUtcMs < nowMs
    ).length;
    return {
      total: todaysHigh.length,
      upcoming: Math.max(0, todaysHigh.length - released),
      released,
    };
  }, [events, todayKey, timezone, nowMs]);

  const filteredEvents = useMemo(() => {
    const { startDateKey, endDateKey } = getHorizonBoundsInZone(
      horizon,
      nowMs,
      timezone
    );
    const q = searchQuery.trim().toLowerCase();

    return events.filter((ev) => {
      // 1. Impact tier filter
      if (ev.impact === 'High' && !showHigh) return false;
      if (ev.impact === 'Medium' && !showMedium) return false;
      if (ev.impact === 'Holiday' && !showHolidays) return false;
      if (ev.impact === 'Low') return false;

      // 2. Horizon date range filter
      const evDateKey = formatEventDateKeyInZone(ev.timestampUtcMs, timezone);
      if (evDateKey < startDateKey || evDateKey > endDateKey) return false;

      // 3. Currency filter
      if (currencyFilter !== 'ALL' && ev.currency !== currencyFilter) {
        return false;
      }

      // 4. Search query
      if (q) {
        const hay = `${ev.title} ${ev.currency} ${ev.countryName} ${ev.sourceAgency}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    events,
    horizon,
    nowMs,
    timezone,
    showHigh,
    showMedium,
    showHolidays,
    currencyFilter,
    searchQuery,
  ]);

  const groupedDays = useMemo(() => {
    const groups: Array<{
      dateKey: string;
      heading: string;
      isToday: boolean;
      isUsdPinned?: boolean;
      showInlineDate?: boolean;
      items: MacroCalendarEvent[];
    }> = [];

    const sourceForDayGroups =
      currencyFilter === 'ALL'
        ? filteredEvents.filter((ev) => ev.currency !== 'USD')
        : filteredEvents;

    if (currencyFilter === 'ALL') {
      const usdItems = filteredEvents.filter((ev) => ev.currency === 'USD');
      if (usdItems.length > 0) {
        groups.push({
          dateKey: 'usd-priority-top',
          heading: 'USD · United States Releases',
          isToday: false,
          isUsdPinned: true,
          showInlineDate: horizon === 'this_week' || horizon === 'next_week',
          items: usdItems,
        });
      }
    }

    for (const ev of sourceForDayGroups) {
      const dateKey = formatEventDateKeyInZone(ev.timestampUtcMs, timezone);
      let existing = groups.find((g) => g.dateKey === dateKey);
      if (!existing) {
        existing = {
          dateKey,
          heading: formatDayHeadingInZone(ev.timestampUtcMs, timezone),
          isToday: dateKey === todayKey,
          items: [],
        };
        groups.push(existing);
      }
      existing.items.push(ev);
    }

    return groups;
  }, [filteredEvents, currencyFilter, horizon, timezone, todayKey]);

  const selectedEvent = useMemo(() => {
    const topVisible = groupedDays[0]?.items[0] || filteredEvents[0] || null;
    if (!selectedEventId) return topVisible || events[0] || null;
    return (
      filteredEvents.find((e) => e.eventId === selectedEventId) ||
      events.find((e) => e.eventId === selectedEventId) ||
      topVisible
    );
  }, [events, filteredEvents, groupedDays, selectedEventId]);

  const fetchAiBriefForEvent = useCallback(
    async (ev: MacroCalendarEvent, forceRefresh = false) => {
      const cacheKey = `${ev.eventId}|${ev.actual || 'pending'}`;
      if (!forceRefresh && briefMapRef.current[cacheKey]) return;

      if (briefAbortRef.current) {
        briefAbortRef.current.abort();
      }
      const controller = new AbortController();
      briefAbortRef.current = controller;
      setLoadingBriefKey(cacheKey);

      try {
        const res = await fetch('/api/news/brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: ev, forceRefresh }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { brief?: EventAiMacroBrief };
        if (json?.brief && !controller.signal.aborted) {
          briefMapRef.current[cacheKey] = json.brief;
          setBriefMap((prev) => ({
            ...prev,
            [cacheKey]: json.brief!,
          }));
        }
      } catch {
        // Ignore aborted or transient fetch errors
      } finally {
        if (!controller.signal.aborted) {
          setLoadingBriefKey((prev) => (prev === cacheKey ? null : prev));
        }
      }
    },
    []
  );

  // Trigger AI Macro Playbook asynchronously when selected event changes
  const selectedEventIdVal = selectedEvent?.eventId || '';
  const selectedEventActualVal = selectedEvent?.actual || '';
  const loadedCount = events.length;
  useEffect(() => {
    if (!selectedEventIdVal || loadedCount === 0) return;
    const timer = window.setTimeout(() => {
      const match = eventsRef.current.find(
        (e) => e.eventId === selectedEventIdVal
      );
      if (match) {
        void fetchAiBriefForEvent(match, false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventIdVal, selectedEventActualVal, loadedCount]);

  useEffect(() => {
    return () => {
      briefAbortRef.current?.abort();
    };
  }, []);

  const activeBriefKey = selectedEvent
    ? `${selectedEvent.eventId}|${selectedEvent.actual || 'pending'}`
    : '';
  const activeAiBrief = activeBriefKey ? briefMap[activeBriefKey] || null : null;
  const isBriefLoading =
    Boolean(activeBriefKey) && loadingBriefKey === activeBriefKey;

  const handleSelectRow = (ev: MacroCalendarEvent) => {
    setSelectedEventId(ev.eventId);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileOverviewOpen(true);
    }
  };

  const handleResetFilters = () => {
    setHorizon('this_week');
    setShowHigh(true);
    setShowMedium(true);
    setShowHolidays(true);
    setCurrencyFilter('ALL');
    setSearchQuery('');
  };

  const nextCatalystCountdown = nextRedFolderCatalyst
    ? formatRelativeCountdown(
        nextRedFolderCatalyst.timestampUtcMs,
        nowMs,
        nextRedFolderCatalyst.isAllDayOrTentative
      )
    : null;

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100">
      <AppHeaderWithSidebar
        activeRoute="news"
        rightAction={
          <button
            type="button"
            disabled={isLoading || isRefreshing}
            onClick={() => void loadCalendar(true)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111726] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw
              className={`h-3.5 w-3.5 text-sky-400 ${
                isRefreshing ? 'animate-spin' : ''
              }`}
            />
            <span>{isRefreshing ? 'Syncing...' : 'Refresh Feed'}</span>
          </button>
        }
      />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">

        {/* Page Heading */}
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
            High Impact Macroeconomic Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Red-folder market catalysts with live release prints, inverse-aware surprise scoring, and full per-event execution playbooks.
          </p>
        </div>

        {/* Full-Width 4-Column Macro KPI & Timezone Strip */}
        <section
          aria-label="Macroeconomic summary strip"
          className="grid grid-cols-1 divide-y divide-slate-800/80 rounded-2xl border border-slate-800/90 bg-[#111726] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x"
        >
          {/* KPI 1: Next Red-Folder Catalyst */}
          <button
            type="button"
            disabled={!nextRedFolderCatalyst}
            onClick={() => {
              if (nextRedFolderCatalyst) {
                handleSelectRow(nextRedFolderCatalyst);
              }
            }}
            className="p-4 sm:p-5 text-left transition-colors hover:bg-slate-800/25 disabled:cursor-default"
          >
            <div className="text-xs text-slate-400">Next High-Impact Catalyst</div>
            {nextRedFolderCatalyst && nextCatalystCountdown ? (
              <>
                <div className="mt-1 flex items-baseline gap-2 font-[family-name:var(--font-mono)] tabular-nums">
                  <span
                    className={`text-lg font-semibold ${
                      nextCatalystCountdown.isImminent
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {nextCatalystCountdown.text}
                  </span>
                  <span className="text-xs font-semibold text-white">
                    {nextRedFolderCatalyst.currency}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-300">
                  {nextRedFolderCatalyst.title}
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 font-[family-name:var(--font-mono)] text-lg font-semibold text-slate-300 tabular-nums">
                  Clear Window
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  No pending Red-Folder events
                </div>
              </>
            )}
          </button>

          {/* KPI 2: Today's Red-Folder Density */}
          <div className="p-4 sm:p-5 sm:border-l sm:border-slate-800/80 lg:border-l-0">
            <div className="text-xs text-slate-400">Today&apos;s Red-Folder Events</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-lg font-semibold text-white tabular-nums">
              {todayHighStats.total}{' '}
              <span className="text-xs font-normal text-slate-400">
                Scheduled
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-400 tabular-nums">
              {todayHighStats.upcoming} Upcoming · {todayHighStats.released} Released
            </div>
          </div>

          {/* KPI 3: Active Horizon Match Count */}
          <div className="p-4 sm:p-5 sm:border-t sm:border-slate-800/80 lg:border-t-0">
            <div className="text-xs text-slate-400">Visible Releases</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-lg font-semibold text-sky-400 tabular-nums">
              {filteredEvents.length}{' '}
              <span className="text-xs font-normal text-slate-400">
                Events
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {[
                showHigh ? 'High' : null,
                showMedium ? 'Medium' : null,
                showHolidays ? 'Holidays' : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No Impact Tier Selected'}
            </div>
          </div>

          {/* KPI 4: Display Timezone Selector */}
          <div className="p-4 sm:p-5 sm:border-t sm:border-l sm:border-slate-800/80 lg:border-t-0 lg:border-l-0">
            <label
              htmlFor="news-timezone-select"
              className="block text-xs text-slate-400"
            >
              Display Timezone
            </label>
            <select
              id="news-timezone-select"
              value={timezone}
              onChange={(e) => handleTimezoneChange(e.target.value)}
              className="mt-1.5 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#0D1320] px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-xs font-medium text-slate-100 focus:border-sky-500 focus:outline-none tabular-nums"
            >
              {TIMEZONE_PRESETS.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Interactive Filter & Search Bar */}
        <section
          aria-label="Calendar filters"
          className="rounded-2xl border border-slate-800/90 bg-[#111726] p-4 space-y-3.5"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Mobile Date Horizon Dropdown (< sm) */}
            <div className="relative sm:hidden">
              <label htmlFor="news-horizon-mobile" className="sr-only">
                Date horizon
              </label>
              <select
                id="news-horizon-mobile"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as NewsHorizon)}
                className="min-h-[44px] w-full appearance-none rounded-xl border border-slate-800 bg-[#0D1320] pl-3.5 pr-9 py-2 text-xs font-semibold text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="this_week">This Week</option>
                <option value="next_week">Next Week</option>
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
            </div>

            {/* Desktop / Tablet Horizon Segmented Buttons (>= sm) */}
            <div
              role="group"
              aria-label="Date horizon"
              className="hidden sm:inline-flex items-center gap-1 self-start rounded-xl border border-slate-800 bg-[#0D1320] p-1"
            >
              {(
                [
                  { id: 'today', label: 'Today' },
                  { id: 'tomorrow', label: 'Tomorrow' },
                  { id: 'this_week', label: 'This Week' },
                  { id: 'next_week', label: 'Next Week' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHorizon(tab.id)}
                  className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    horizon === tab.id
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Impact Tier Filter Buttons (High Default + Medium + Holidays) */}
            <div
              role="group"
              aria-label="Impact tier filter"
              className="flex flex-wrap items-center gap-1.5"
            >
              <button
                type="button"
                aria-pressed={showHigh}
                onClick={() => setShowHigh((v) => !v)}
                className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  showHigh
                    ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
                    : 'border-slate-800 bg-[#0D1320] text-slate-400 hover:text-slate-200'
                }`}
              >
                High Impact
              </button>

              <button
                type="button"
                aria-pressed={showMedium}
                onClick={() => setShowMedium((v) => !v)}
                className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  showMedium
                    ? 'border-amber-500/45 bg-amber-500/15 text-amber-300'
                    : 'border-slate-800 bg-[#0D1320] text-slate-400 hover:text-slate-200'
                }`}
              >
                + Medium
              </button>

              <button
                type="button"
                aria-pressed={showHolidays}
                onClick={() => setShowHolidays((v) => !v)}
                className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  showHolidays
                    ? 'border-slate-600 bg-slate-800 text-slate-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-400 hover:text-slate-200'
                }`}
              >
                + Bank Holidays
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {/* Currency Filter Buttons */}
            <div
              role="group"
              aria-label="Currency filter"
              className="flex flex-wrap items-center gap-1"
            >
              {MAJOR_NEWS_CURRENCIES.map((ccy) => (
                <button
                  key={ccy}
                  type="button"
                  onClick={() => setCurrencyFilter(ccy)}
                  className={`min-h-[34px] rounded-lg px-2.5 py-1 font-[family-name:var(--font-mono)] text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                    currencyFilter === ccy
                      ? 'bg-slate-200 text-slate-950 font-semibold'
                      : 'bg-[#0D1320] text-slate-400 hover:text-slate-200 border border-slate-800/80'
                  }`}
                >
                  {ccy}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-64 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search CPI, NFP, FOMC, PMI..."
                aria-label="Search macroeconomic events"
                className="min-h-[36px] w-full rounded-lg border border-slate-800 bg-[#0D1320] pl-8 pr-8 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search query"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Main 12-Column Asymmetric Master-Detail Workspace */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left 7 Columns: Day-Grouped Chronological News Ledger */}
          <section
            aria-label="Economic calendar events"
            className="lg:col-span-7 space-y-4"
          >
            {isLoading ? (
              <div
                aria-busy="true"
                className="rounded-2xl border border-slate-800/90 bg-[#111726] divide-y divide-slate-800/80"
              >
                {Array.from({ length: 7 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-4 p-4"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="h-3.5 w-28 rounded bg-slate-800/80 animate-pulse" />
                      <div className="h-4 w-3/4 rounded bg-slate-800/70 animate-pulse" />
                    </div>
                    <div className="h-4 w-20 rounded bg-slate-800/70 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div
                role="alert"
                className="rounded-2xl border border-rose-500/30 bg-[#111726] p-6"
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-white">
                      Unable to Load Economic Calendar
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">{error}</p>
                    <button
                      type="button"
                      onClick={() => void loadCalendar(true)}
                      className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Retry Feed Sync</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : groupedDays.length === 0 ? (
              <div className="rounded-2xl border border-slate-800/90 bg-[#111726] p-8 text-center">
                <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-white">
                  No Releases Match Current Filter
                </h2>
                <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
                  No macroeconomic catalysts matched your selected horizon, impact tier, and currency combination. Expand to the full week or include Medium-impact releases.
                </p>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="mt-4 inline-flex min-h-[40px] items-center justify-center rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap"
                >
                  Show Full Week (High &amp; Medium)
                </button>
              </div>
            ) : (
              groupedDays.map((day) => (
                <div
                  key={day.dateKey}
                  className="rounded-2xl border border-slate-800/90 bg-[#111726] overflow-hidden"
                >
                  {/* Day / USD Priority Section Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0D1320] px-4 py-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          day.isUsdPinned
                            ? 'font-semibold text-sky-300'
                            : 'font-semibold text-slate-200'
                        }
                      >
                        {day.heading}
                      </span>
                      {day.isUsdPinned && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-400">Pinned Top</span>
                        </>
                      )}
                      {day.isToday && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-semibold text-sky-400">
                            Today
                          </span>
                        </>
                      )}
                    </div>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-slate-500 tabular-nums">
                      {day.items.length}{' '}
                      {day.items.length === 1 ? 'Event' : 'Events'}
                    </span>
                  </div>

                  {/* Chronological Event Rows */}
                  <div className="divide-y divide-slate-800/75">
                    {day.items.map((ev) => {
                      const isSelected = selectedEvent?.eventId === ev.eventId;
                      const formattedTime = formatEventTimeInZone(
                        ev.timestampUtcMs,
                        ev.isAllDayOrTentative,
                        ev.rawTimeLabel,
                        timezone
                      );
                      const inlineShortDate = day.showInlineDate
                        ? formatShortWeekdayDateInZone(
                            ev.timestampUtcMs,
                            timezone
                          )
                        : '';
                      const rel = formatRelativeCountdown(
                        ev.timestampUtcMs,
                        nowMs,
                        ev.isAllDayOrTentative
                      );

                      return (
                        <button
                          key={ev.eventId}
                          type="button"
                          onClick={() => handleSelectRow(ev)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ${
                            isSelected
                              ? 'bg-sky-500/10'
                              : 'hover:bg-slate-800/35'
                          }`}
                        >
                          {/* Left: Time + Currency + Event Title */}
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div className="w-[74px] shrink-0 font-[family-name:var(--font-mono)] tabular-nums">
                              <div className="text-xs font-medium text-slate-200 whitespace-nowrap">
                                {formattedTime}
                              </div>
                              <div
                                className={`mt-0.5 text-[11px] whitespace-nowrap ${
                                  rel.isImminent
                                    ? 'text-amber-400 font-medium'
                                    : rel.isPast
                                    ? 'text-slate-500'
                                    : 'text-sky-400/90'
                                }`}
                              >
                                {rel.text}
                              </div>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums">
                                <span className="font-[family-name:var(--font-mono)] font-semibold text-white">
                                  {ev.currency}
                                </span>
                                <span className="text-slate-600" aria-hidden="true">
                                  ·
                                </span>
                                <span
                                  className={
                                    ev.impact === 'High'
                                      ? 'font-semibold text-rose-400'
                                      : ev.impact === 'Medium'
                                      ? 'font-medium text-amber-400'
                                      : 'text-slate-400'
                                  }
                                >
                                  {ev.impact === 'Holiday'
                                    ? 'Holiday'
                                    : ev.impact}
                                </span>
                                {inlineShortDate && (
                                  <>
                                    <span
                                      className="text-slate-600"
                                      aria-hidden="true"
                                    >
                                      ·
                                    </span>
                                    <span className="font-[family-name:var(--font-mono)] text-slate-300">
                                      {inlineShortDate}
                                    </span>
                                  </>
                                )}
                                {ev.period && (
                                  <>
                                    <span
                                      className="text-slate-600"
                                      aria-hidden="true"
                                    >
                                      ·
                                    </span>
                                    <span className="font-[family-name:var(--font-mono)] text-slate-400">
                                      {ev.period}
                                    </span>
                                  </>
                                )}
                              </div>

                              <div
                                className={`mt-0.5 text-sm font-medium leading-snug ${
                                  isSelected ? 'text-sky-200' : 'text-slate-100'
                                }`}
                              >
                                {ev.title}
                              </div>
                            </div>
                          </div>

                          {/* Right: Tabular Actual / Forecast / Previous + Chevron */}
                          <div className="flex items-center gap-2.5 shrink-0">
                            {ev.impact !== 'Holiday' ? (
                              <div className="text-right font-[family-name:var(--font-mono)] tabular-nums">
                                <div className="text-xs font-semibold">
                                  {ev.actual ? (
                                    <span
                                      className={
                                        ev.surpriseDirection === 'bullish'
                                          ? 'text-emerald-400'
                                          : ev.surpriseDirection === 'bearish'
                                          ? 'text-rose-400'
                                          : 'text-white'
                                      }
                                    >
                                      {ev.actual}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">
                                      {ev.forecast
                                        ? `Fcst ${ev.forecast}`
                                        : 'Scheduled'}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-500 whitespace-nowrap">
                                  {ev.actual
                                    ? `Fcst ${ev.forecast || '—'}`
                                    : `Prev ${ev.previous || '—'}`}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500 whitespace-nowrap">
                                Bank Closed
                              </span>
                            )}

                            <ChevronRight
                              className={`h-4 w-4 shrink-0 transition-colors ${
                                isSelected ? 'text-sky-400' : 'text-slate-600'
                              }`}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Right 5 Columns: Sticky Desktop Full Event Overview Inspector */}
          <aside
            aria-label="Selected event full overview"
            className="hidden lg:block lg:col-span-5 lg:sticky lg:top-20"
          >
            <NewsEventOverview
              event={selectedEvent}
              timezone={timezone}
              nowMs={nowMs}
              aiBrief={activeAiBrief}
              isBriefLoading={isBriefLoading}
              onRefreshBrief={(ev) => void fetchAiBriefForEvent(ev, true)}
            />
          </aside>
        </div>
      </main>

      {/* Mobile / Tablet Slide-Over Sheet for Full Event Overview (< lg) */}
      {mobileOverviewOpen && selectedEvent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Full overview for ${selectedEvent.title}`}
          className="fixed inset-0 z-50 flex justify-end lg:hidden"
        >
          <div
            onClick={() => setMobileOverviewOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            aria-hidden="true"
          />
          <div className="relative z-10 h-full w-full max-w-lg overflow-y-auto bg-[#090D16] p-4 sm:p-6 shadow-2xl">
            <NewsEventOverview
              event={selectedEvent}
              timezone={timezone}
              nowMs={nowMs}
              aiBrief={activeAiBrief}
              isBriefLoading={isBriefLoading}
              onRefreshBrief={(ev) => void fetchAiBriefForEvent(ev, true)}
              onCloseMobile={() => setMobileOverviewOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

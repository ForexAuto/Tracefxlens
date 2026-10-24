export type SessionClockZone = 'LOCAL' | 'UTC';

export type SessionId = 'sydney' | 'tokyo' | 'london' | 'new_york';

export interface TradingSessionStatus {
  id: SessionId;
  name: string;
  hubCode: string;
  timeZone: string;
  isOpen: boolean;
  elapsedPct: number;
  minutesRemaining: number;
  minutesUntilOpen: number;
  windowLabel: string;
}

export interface GlobalSessionSnapshot {
  headline: string;
  subheadline: string;
  stateKind: 'overlap' | 'active' | 'weekend' | 'rollover';
  primaryCountdownLabel: string;
  clockLabel: string;
  zoneLabel: string;
  sessions: TradingSessionStatus[];
}

interface SessionDefinition {
  id: SessionId;
  name: string;
  hubCode: string;
  timeZone: string;
  openMin: number;
  closeMin: number;
}

const SESSION_DEFINITIONS: SessionDefinition[] = [
  {
    id: 'sydney',
    name: 'Sydney',
    hubCode: 'SYD',
    timeZone: 'Australia/Sydney',
    openMin: 7 * 60, // 07:00 local Sydney
    closeMin: 16 * 60, // 16:00 local Sydney
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    hubCode: 'TYO',
    timeZone: 'Asia/Tokyo',
    openMin: 9 * 60, // 09:00 JST
    closeMin: 18 * 60, // 18:00 JST
  },
  {
    id: 'london',
    name: 'London',
    hubCode: 'LDN',
    timeZone: 'Europe/London',
    openMin: 8 * 60, // 08:00 GMT/BST
    closeMin: 17 * 60, // 17:00 GMT/BST
  },
  {
    id: 'new_york',
    name: 'New York',
    hubCode: 'NYC',
    timeZone: 'America/New_York',
    openMin: 8 * 60, // 08:00 EST/EDT
    closeMin: 17 * 60, // 17:00 EST/EDT
  },
];

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getExchangeLocalParts(now: Date, timeZone: string): {
  weekday: number;
  minutesOfDay: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  let weekday = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    if (part.type === 'weekday') {
      weekday = WEEKDAY_MAP[part.value] ?? 1;
    } else if (part.type === 'hour') {
      hour = Number(part.value) % 24;
    } else if (part.type === 'minute') {
      minute = Number(part.value);
    } else if (part.type === 'second') {
      second = Number(part.value);
    }
  }

  return {
    weekday,
    minutesOfDay: hour * 60 + minute + second / 60,
  };
}

function formatHourMinute(epochMs: number, clockZone: SessionClockZone): string {
  return new Intl.DateTimeFormat('en-GB', {
    ...(clockZone === 'UTC' ? { timeZone: 'UTC' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epochMs));
}

function getLocalZoneShortName(now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
    }).formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value || 'Local';
  } catch {
    return 'Local';
  }
}

export function formatDurationCompact(totalMinutes: number): string {
  const safe = Math.max(1, Math.round(totalMinutes));
  const days = Math.floor(safe / 1440);
  const hours = Math.floor((safe % 1440) / 60);
  const mins = safe % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
  }
  return `${mins}m`;
}

export function computeGlobalSessionSnapshot(
  nowMs: number,
  clockZone: SessionClockZone,
  selectedPair?: string
): GlobalSessionSnapshot {
  const now = new Date(nowMs);
  const isCryptoPair = Boolean(
    selectedPair &&
      /^(BTC|ETH|SOL|XRP|BNB|ADA|DOGE)\//i.test(selectedPair.trim())
  );

  const sessions: TradingSessionStatus[] = SESSION_DEFINITIONS.map((def) => {
    const { weekday, minutesOfDay } = getExchangeLocalParts(now, def.timeZone);
    const duration = def.closeMin - def.openMin;

    const isWeekday = weekday >= 1 && weekday <= 5;
    const isOpen =
      isWeekday && minutesOfDay >= def.openMin && minutesOfDay < def.closeMin;

    let elapsedPct = 0;
    let minutesRemaining = 0;
    let minutesUntilOpen = 0;
    let openEpochMs = nowMs;
    let closeEpochMs = nowMs + duration * 60_000;

    if (isOpen) {
      const elapsed = minutesOfDay - def.openMin;
      elapsedPct = Math.min(100, Math.max(0, (elapsed / duration) * 100));
      minutesRemaining = Math.max(0, def.closeMin - minutesOfDay);
      openEpochMs = nowMs - elapsed * 60_000;
      closeEpochMs = nowMs + minutesRemaining * 60_000;
    } else {
      if (isWeekday && minutesOfDay < def.openMin) {
        minutesUntilOpen = def.openMin - minutesOfDay;
      } else if (weekday >= 1 && weekday <= 4 && minutesOfDay >= def.closeMin) {
        minutesUntilOpen = 1440 - minutesOfDay + def.openMin;
      } else if (weekday === 5 && minutesOfDay >= def.closeMin) {
        minutesUntilOpen = 1440 - minutesOfDay + 2 * 1440 + def.openMin;
      } else if (weekday === 6) {
        minutesUntilOpen = 1440 - minutesOfDay + 1440 + def.openMin;
      } else {
        // Sunday (weekday === 0)
        minutesUntilOpen = 1440 - minutesOfDay + def.openMin;
      }

      openEpochMs = nowMs + minutesUntilOpen * 60_000;
      closeEpochMs = openEpochMs + duration * 60_000;
    }

    const windowLabel = `${formatHourMinute(openEpochMs, clockZone)}–${formatHourMinute(
      closeEpochMs,
      clockZone
    )}`;

    return {
      id: def.id,
      name: def.name,
      hubCode: def.hubCode,
      timeZone: def.timeZone,
      isOpen,
      elapsedPct,
      minutesRemaining,
      minutesUntilOpen,
      windowLabel,
    };
  });

  const openSessions = sessions.filter((s) => s.isOpen);
  const nextOpening = [...sessions]
    .filter((s) => !s.isOpen)
    .sort((a, b) => a.minutesUntilOpen - b.minutesUntilOpen)[0];

  const zoneLabel = clockZone === 'UTC' ? 'UTC' : getLocalZoneShortName(now);
  const clockLabel = new Intl.DateTimeFormat('en-GB', {
    ...(clockZone === 'UTC' ? { timeZone: 'UTC' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(now);

  // Determine global FX weekend state (when next open is > 4 hours away and no FX session is open)
  if (openSessions.length === 0) {
    const isWeekend = (nextOpening?.minutesUntilOpen ?? 0) > 180;
    if (isWeekend) {
      return {
        headline: isCryptoPair
          ? 'Crypto 24/7 Active · FX Weekend'
          : 'FX Market Closed · Weekend',
        subheadline: isCryptoPair
          ? `${selectedPair} spot liquidity active · Sydney FX opens in ${formatDurationCompact(
              nextOpening.minutesUntilOpen
            )}`
          : `Spot Crypto open 24/7 · ${nextOpening.name} opens in ${formatDurationCompact(
              nextOpening.minutesUntilOpen
            )}`,
        stateKind: 'weekend',
        primaryCountdownLabel: `${nextOpening.name} in ${formatDurationCompact(
          nextOpening.minutesUntilOpen
        )}`,
        clockLabel,
        zoneLabel,
        sessions,
      };
    }

    return {
      headline: 'Interbank Daily Rollover',
      subheadline: `Low liquidity spread window · ${nextOpening.name} opens in ${formatDurationCompact(
        nextOpening.minutesUntilOpen
      )}`,
      stateKind: 'rollover',
      primaryCountdownLabel: `${nextOpening.name} in ${formatDurationCompact(
        nextOpening.minutesUntilOpen
      )}`,
      clockLabel,
      zoneLabel,
      sessions,
    };
  }

  // Overlap of 2 active sessions
  if (openSessions.length >= 2) {
    const first = openSessions[0];
    const second = openSessions[1];
    const overlapRemaining = Math.min(
      first.minutesRemaining,
      second.minutesRemaining
    );

    const isLondonNy =
      openSessions.some((s) => s.id === 'london') &&
      openSessions.some((s) => s.id === 'new_york');
    const isTokyoLondon =
      openSessions.some((s) => s.id === 'tokyo') &&
      openSessions.some((s) => s.id === 'london');

    const headline = isLondonNy
      ? 'London · New York Overlap'
      : isTokyoLondon
      ? 'Tokyo · London Overlap'
      : `${first.name} · ${second.name} Overlap`;

    const liquidityNote = isLondonNy
      ? 'Peak global volume & volatility'
      : isTokyoLondon
      ? 'Asian-to-European session handover'
      : 'Dual-desk Asian liquidity';

    return {
      headline,
      subheadline: `${liquidityNote} · Overlap ends in ${formatDurationCompact(
        overlapRemaining
      )}`,
      stateKind: 'overlap',
      primaryCountdownLabel: `Ends in ${formatDurationCompact(
        overlapRemaining
      )}`,
      clockLabel,
      zoneLabel,
      sessions,
    };
  }

  // Single active session
  const active = openSessions[0];
  const sessionNote =
    active.id === 'london'
      ? 'European directional liquidity'
      : active.id === 'new_york'
      ? 'North American session volume'
      : active.id === 'tokyo'
      ? 'Asian session liquidity'
      : 'Pacific opening liquidity';

  const nextHint =
    nextOpening && nextOpening.minutesUntilOpen < active.minutesRemaining
      ? `${nextOpening.name} overlap in ${formatDurationCompact(
          nextOpening.minutesUntilOpen
        )}`
      : `Closes in ${formatDurationCompact(active.minutesRemaining)}`;

  return {
    headline: `${active.name} Session`,
    subheadline: `${sessionNote} · ${nextHint}`,
    stateKind: 'active',
    primaryCountdownLabel: `Closes in ${formatDurationCompact(
      active.minutesRemaining
    )}`,
    clockLabel,
    zoneLabel,
    sessions,
  };
}

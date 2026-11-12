import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function normalizeSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase().replace(/^(OANDA|FX|FOREXCOM):/, '').replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{6}$/.test(symbol)) return null;
  return symbol;
}

export async function GET(request: NextRequest) {
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get('pair') || '');
  if (!symbol) {
    return NextResponse.json({ error: 'A supported six-character market symbol is required.' }, { status: 400 });
  }

  try {
    const response = await fetch(`https://biquote.io/api/${encodeURIComponent(symbol)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload?.message || 'The public quote provider could not return this instrument.' }, { status: response.status === 404 ? 404 : 502 });
    }

    const bid = Number(payload?.bid);
    const ask = Number(payload?.ask);
    const timestamp = typeof payload?.time === 'string' ? payload.time : '';
    const quoteTime = Date.parse(timestamp);
    if (
      String(payload?.symbol || '').toUpperCase() !== symbol ||
      !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 ||
      !Number.isFinite(quoteTime)
    ) {
      return NextResponse.json({ error: 'The public provider returned an incomplete or invalid Bid/Ask quote.' }, { status: 502 });
    }

    const ageSeconds = Math.max(0, Math.floor((Date.now() - quoteTime) / 1000));
    return NextResponse.json({
      symbol,
      bid: String(payload.bid),
      ask: String(payload.ask),
      timestamp,
      source: String(payload.source || 'MT5 feed'),
      ageSeconds,
      stale: ageSeconds > 60,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'Unable to retrieve a live quote from the public provider right now.' }, { status: 502 });
  }
}

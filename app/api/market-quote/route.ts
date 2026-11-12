import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function toOandaInstrument(raw: string): string | null {
  const symbol = raw.trim().toUpperCase().replace(/^(OANDA|FX|FOREXCOM):/, '').replace(/[^A-Z]/g, '');
  if (symbol.length !== 6) return null;
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);
  const supported = new Set(['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD','SGD','HKD','NOK','SEK','DKK','PLN','CZK','HUF','TRY','MXN','ZAR','THB']);
  if (base === 'XAU' || base === 'XAG') return `${base}_${quote}`;
  if (!supported.has(base) || !supported.has(quote)) return null;
  return `${base}_${quote}`;
}

export async function GET(request: NextRequest) {
  const rawPair = request.nextUrl.searchParams.get('pair') || '';
  const instrument = toOandaInstrument(rawPair);
  if (!instrument) return NextResponse.json({ error: 'This instrument is not supported by the configured live quote feed.' }, { status: 400 });

  const token = (process.env.OANDA_API_TOKEN || '').trim();
  const accountId = (process.env.OANDA_ACCOUNT_ID || '').trim();
  if (!token || !accountId) {
    return NextResponse.json({ error: 'Live Bid/Ask is not configured. Add OANDA_API_TOKEN and OANDA_ACCOUNT_ID in Vercel environment variables.' }, { status: 503 });
  }

  const environment = (process.env.OANDA_ENVIRONMENT || 'practice').toLowerCase();
  const host = environment === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  try {
    const url = new URL(`${host}/v3/accounts/${encodeURIComponent(accountId)}/pricing`);
    url.searchParams.set('instruments', instrument);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload?.errorMessage || 'The live quote provider rejected the request.' }, { status: response.status === 401 ? 502 : response.status });
    }
    const price = payload?.prices?.[0];
    const bid = Number(price?.bids?.[0]?.price);
    const ask = Number(price?.asks?.[0]?.price);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
      return NextResponse.json({ error: 'The provider returned no usable Bid/Ask quote for this instrument.' }, { status: 502 });
    }
    return NextResponse.json({
      instrument,
      bid: String(price.bids[0].price),
      ask: String(price.asks[0].price),
      timestamp: price.time || new Date().toISOString(),
      tradeable: price.tradeable !== false,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'Unable to retrieve a live quote right now.' }, { status: 502 });
  }
}

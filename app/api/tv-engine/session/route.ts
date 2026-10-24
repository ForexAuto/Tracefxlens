import { NextRequest, NextResponse } from 'next/server';
import type { TvConnectPayload } from '@/lib/tv-engine-types';
import {
  connectTvSession,
  disconnectTvSession,
  getTvSessionInfo,
} from '@/lib/tv-playwright-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get('refresh') === '1';
    const info = await getTvSessionInfo(refresh);
    return NextResponse.json(info);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to inspect TradingView session.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<TvConnectPayload>;
    const mode =
      body.mode === 'json' || body.mode === 'guest' ? body.mode : 'cookies';

    const info = await connectTvSession({
      mode,
      sessionId: body.sessionId,
      sessionIdSign: body.sessionIdSign,
      deviceT: body.deviceT,
      cookieJson: body.cookieJson,
      chartUrl: body.chartUrl,
    });

    if (info.status === 'error') {
      return NextResponse.json(
        { ...info, error: info.errorMessage || 'Failed to launch session.' },
        { status: 400 }
      );
    }

    return NextResponse.json(info);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Could not connect TradingView session.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    await disconnectTvSession();
    const info = await getTvSessionInfo(false);
    return NextResponse.json(info);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to disconnect TradingView session.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

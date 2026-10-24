import { NextRequest, NextResponse } from 'next/server';
import type { TvManualInputPayload } from '@/lib/tv-engine-types';
import { performManualTvInput } from '@/lib/tv-playwright-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TvManualInputPayload;
    if (!body || typeof body !== 'object' || !('type' in body)) {
      return NextResponse.json(
        { error: 'Invalid manual interaction payload.' },
        { status: 400 }
      );
    }
    const info = await performManualTvInput(body);
    return NextResponse.json(info);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to forward interaction to TradingView.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

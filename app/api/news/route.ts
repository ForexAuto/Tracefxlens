import { NextRequest, NextResponse } from 'next/server';
import { fetchNormalizedMacroCalendar } from '@/lib/forex-factory-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get('refresh') === '1';
    const result = await fetchNormalizedMacroCalendar({ forceRefresh: refresh });
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: 'Unable to load macroeconomic calendar right now. Please retry.',
      },
      { status: 500 }
    );
  }
}

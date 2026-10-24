import { NextRequest, NextResponse } from 'next/server';
import type { TradeOutcome } from '@/lib/trading-data';
import {
  deleteServerHistoryRecord,
  lockServerHistoryOutcome,
} from '@/lib/supabase-history-store';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const cleanId = String(id || '').trim();
    if (!cleanId) {
      return NextResponse.json({ error: 'Missing history ID.' }, { status: 400 });
    }

    const body = await req.json();
    const rawOutcome = String(body?.outcome || '').trim().toUpperCase();
    if (rawOutcome !== 'WON' && rawOutcome !== 'LOST') {
      return NextResponse.json(
        { error: 'Outcome must be WON or LOST.' },
        { status: 400 }
      );
    }

    const outcome: TradeOutcome = rawOutcome;
    const result = await lockServerHistoryOutcome(cleanId, outcome);

    if (result.alreadyLocked) {
      return NextResponse.json(
        {
          error: 'Signal outcome is permanently locked and cannot be changed.',
          alreadyLocked: true,
          record: result.record,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      alreadyLocked: false,
      record: result.record,
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to lock trade outcome.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const cleanId = String(id || '').trim();
    if (!cleanId) {
      return NextResponse.json({ error: 'Missing history ID.' }, { status: 400 });
    }

    await deleteServerHistoryRecord(cleanId);
    return NextResponse.json({ deletedId: cleanId });
  } catch {
    return NextResponse.json(
      { error: 'Unable to delete signal history record.' },
      { status: 500 }
    );
  }
}


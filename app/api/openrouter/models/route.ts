import { NextResponse } from 'next/server';
import {
  getFullVisionModelCatalog,
  hasGeminiKey,
  hasOpenRouterKey,
} from '@/lib/openrouter-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const models = await getFullVisionModelCatalog();
  return NextResponse.json({
    openRouterConfigured: hasOpenRouterKey(),
    geminiConfigured: hasGeminiKey(),
    models,
  });
}

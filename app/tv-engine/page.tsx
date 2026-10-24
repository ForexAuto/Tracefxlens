import type { Metadata } from 'next';
import { TvEngineWorkspace } from '@/components/tv-engine-workspace';

export const metadata: Metadata = {
  title: 'TradingView Engine — TraceFX Lens',
  description:
    'Autonomous cloud Playwright TradingView control engine powered by multimodal vision and natural language commands.',
};

export default function TvEnginePage() {
  return <TvEngineWorkspace />;
}

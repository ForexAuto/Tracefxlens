import type { Metadata } from 'next';
import { HighImpactNewsWorkspace } from '@/components/high-impact-news-workspace';

export const metadata: Metadata = {
  title: 'High Impact News — TraceFX Lens',
  description:
    'Real-time Red-Folder macroeconomic calendar with Actual vs. Forecast surprise scoring, official indicator specifications, affected FX & Gold pairs, and AI execution playbooks.',
};

export default function HighImpactNewsPage() {
  return <HighImpactNewsWorkspace />;
}

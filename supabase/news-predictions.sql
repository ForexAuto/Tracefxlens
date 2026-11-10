-- TraceFX Lens — durable, versioned USD news predictions.
-- Run this migration in the Supabase SQL Editor before using AI predictions.

begin;

create table if not exists public.news_predictions (
  id uuid primary key,
  event_fingerprint text not null,
  event_id text not null,
  event_title text not null,
  event_timestamp timestamptz not null,
  version integer not null check (version > 0),
  prediction_json jsonb not null check (jsonb_typeof(prediction_json) = 'object'),
  evidence_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_snapshot) = 'object'),
  generated_at timestamptz not null default now(),
  locked_at timestamptz,
  status text not null default 'PREDICTED'
    check (status in ('PREDICTED', 'RELEASED', 'EVALUATED')),
  constraint news_predictions_event_version_unique unique (event_fingerprint, version)
);

create index if not exists idx_news_predictions_event_time
  on public.news_predictions (event_timestamp asc);
create index if not exists idx_news_predictions_generated
  on public.news_predictions (generated_at desc);
create index if not exists idx_news_predictions_fingerprint
  on public.news_predictions (event_fingerprint, version desc);

alter table public.news_predictions enable row level security;

drop policy if exists "news_predictions_select_policy" on public.news_predictions;
create policy "news_predictions_select_policy"
  on public.news_predictions for select to anon, authenticated, service_role using (true);

drop policy if exists "news_predictions_insert_policy" on public.news_predictions;
create policy "news_predictions_insert_policy"
  on public.news_predictions for insert to anon, authenticated, service_role with check (true);

drop policy if exists "news_predictions_update_policy" on public.news_predictions;
create policy "news_predictions_update_policy"
  on public.news_predictions for update to anon, authenticated, service_role using (true) with check (true);

grant select, insert, update on public.news_predictions to anon, authenticated, service_role;

comment on table public.news_predictions is
  'Append-only versioned pre-release economic forecasts. Each refresh creates a new version; prior prediction JSON remains unchanged.';

commit;

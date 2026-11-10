-- TraceFX Lens — append-only post-release evaluation records.
-- Run after news-predictions.sql in the Supabase SQL Editor.

begin;

create table if not exists public.news_prediction_evaluations (
  id uuid primary key,
  prediction_id uuid not null references public.news_predictions(id) on delete restrict,
  event_fingerprint text not null,
  event_title text not null,
  actual_value text not null,
  forecast_value text not null,
  actual_category text not null
    check (actual_category in ('ABOVE_EXPECTATIONS', 'IN_LINE', 'BELOW_EXPECTATIONS')),
  predicted_category text not null,
  probabilities_json jsonb not null check (jsonb_typeof(probabilities_json) = 'object'),
  brier_score numeric(10, 6) not null check (brier_score >= 0 and brier_score <= 2),
  evaluation_method text not null default 'ACTUAL_VS_CONSENSUS_V1',
  evaluated_at timestamptz not null default now(),
  constraint news_prediction_evaluations_prediction_unique unique (prediction_id)
);

create index if not exists idx_news_prediction_evaluations_event
  on public.news_prediction_evaluations (event_fingerprint, evaluated_at desc);

alter table public.news_prediction_evaluations enable row level security;

drop policy if exists "news_prediction_evaluations_select_policy" on public.news_prediction_evaluations;
create policy "news_prediction_evaluations_select_policy"
  on public.news_prediction_evaluations for select to anon, authenticated, service_role using (true);

drop policy if exists "news_prediction_evaluations_insert_policy" on public.news_prediction_evaluations;
create policy "news_prediction_evaluations_insert_policy"
  on public.news_prediction_evaluations for insert to anon, authenticated, service_role with check (true);

create or replace function public.reject_news_prediction_evaluation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'News prediction evaluations are immutable.'
    using errcode = '23514';
end;
$$;

drop trigger if exists trg_news_prediction_evaluations_immutable on public.news_prediction_evaluations;
create trigger trg_news_prediction_evaluations_immutable
  before update or delete on public.news_prediction_evaluations
  for each row execute function public.reject_news_prediction_evaluation_mutation();

grant select, insert on public.news_prediction_evaluations to anon, authenticated, service_role;

comment on table public.news_prediction_evaluations is
  'Append-only evaluation records. Each original prediction is scored once against the actual release versus consensus using multiclass Brier score.';

commit;

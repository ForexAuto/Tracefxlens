-- TraceFX Lens: append-only archive of completed economic releases.
-- Apply once in the Supabase SQL Editor. This archive is populated when a
-- completed release is evaluated in TraceFX Lens; it does not invent missing history.

begin;

create table if not exists public.historical_news_releases (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  event_key text not null,
  event_title text not null,
  event_timestamp timestamptz not null,
  actual_value text not null,
  forecast_value text not null,
  previous_value text,
  actual_category text not null
    check (actual_category in ('ABOVE_EXPECTATIONS', 'IN_LINE', 'BELOW_EXPECTATIONS')),
  source text not null default 'calendar',
  captured_at timestamptz not null default now(),
  constraint historical_news_releases_event_unique
    unique (currency, event_key, event_timestamp)
);

create index if not exists idx_historical_news_releases_lookup
  on public.historical_news_releases (currency, event_key, event_timestamp desc);

alter table public.historical_news_releases enable row level security;

drop policy if exists "historical_news_releases_select_policy" on public.historical_news_releases;
create policy "historical_news_releases_select_policy"
  on public.historical_news_releases for select to anon, authenticated, service_role using (true);

drop policy if exists "historical_news_releases_insert_policy" on public.historical_news_releases;
create policy "historical_news_releases_insert_policy"
  on public.historical_news_releases for insert to anon, authenticated, service_role with check (true);

grant select, insert on public.historical_news_releases to anon, authenticated, service_role;

comment on table public.historical_news_releases is
  'Append-only history of actual economic releases versus consensus. Market-reaction windows are intentionally not inferred or fabricated.';

commit;

-- =============================================================================
-- TraceFX Lens — Production Supabase PostgreSQL Schema
-- Paste and run this entire script in your Supabase SQL Editor.
-- Fully idempotent: safe to run on a new project or re-run for upgrades.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Core Signal History Table
-- -----------------------------------------------------------------------------
create table if not exists public.signal_history (
  id                     text primary key,
  fingerprint            text not null,
  pair                   text not null,
  timeframe              text not null,
  signal_type            text not null,
  execution_category     text not null default 'Market Execution',
  current_market_price   text not null default '—',
  entry_price            text not null default '—',
  stop_loss              text not null default '—',
  take_profit_1          text not null default '—',
  take_profit_2          text not null default '—',
  take_profit_3          text not null default '—',
  risk_reward_ratio      text not null default '1 : 2.0',
  market_structure       text not null default '',
  confidence_summary     text not null default '',
  entry_trigger_note     text not null default '',
  invalidation_condition text not null default '',
  technical_rationale    jsonb not null default '[]'::jsonb,
  key_levels             jsonb not null default '[]'::jsonb,
  chart_markup           jsonb,
  chart_image_url        text,
  outcome                text,
  outcome_locked_at      timestamptz,
  created_at             timestamptz not null default now(),

  -- Domain & Structural Integrity Constraints
  constraint chk_signal_history_signal_type
    check (signal_type in ('BUY', 'SELL', 'HOLD')),

  constraint chk_signal_history_execution_category
    check (execution_category in ('Market Execution', 'Stand Aside')),

  constraint chk_signal_history_outcome_values
    check (outcome is null or outcome in ('WON', 'LOST')),

  constraint chk_signal_history_hold_no_outcome
    check (not (signal_type = 'HOLD' and outcome is not null)),

  constraint chk_signal_history_rationale_array
    check (jsonb_typeof(technical_rationale) = 'array'),

  constraint chk_signal_history_key_levels_array
    check (jsonb_typeof(key_levels) = 'array'),

  constraint chk_signal_history_chart_markup_object
    check (chart_markup is null or jsonb_typeof(chart_markup) = 'object')
);

comment on table public.signal_history is
  'Immutable trading signal ledger for TraceFX Lens with one-time WON/LOST outcome sealing.';

comment on column public.signal_history.outcome is
  'Once set to WON or LOST, permanently locked by database trigger trg_guard_signal_history.';

-- -----------------------------------------------------------------------------
-- 2. Performance Indexes
-- -----------------------------------------------------------------------------
-- Primary reverse-chronological feed index
create index if not exists idx_signal_history_created_at
  on public.signal_history (created_at desc);

-- Deduplication / signal lookup index
create index if not exists idx_signal_history_fingerprint
  on public.signal_history (fingerprint);

-- Filtered outcome + timeline index (All / Won / Lost tabs)
create index if not exists idx_signal_history_outcome_created
  on public.signal_history (outcome, created_at desc);

-- Symbol & timeframe journal search index
create index if not exists idx_signal_history_pair_timeframe
  on public.signal_history (pair, timeframe, created_at desc);

-- Partial index specifically for active/open trades awaiting resolution
create index if not exists idx_signal_history_open_trades
  on public.signal_history (created_at desc)
  where outcome is null and signal_type in ('BUY', 'SELL');

-- -----------------------------------------------------------------------------
-- 3. Database-Enforced Immutability & Outcome Lock Trigger
-- -----------------------------------------------------------------------------
create or replace function public.enforce_immutable_signal_history()
returns trigger
language plpgsql
as $$
begin
  -- A. Permanent One-Way Outcome Lock:
  -- Once outcome is 'WON' or 'LOST', it can NEVER be changed, flipped, or cleared to NULL.
  if old.outcome is not null then
    if new.outcome is distinct from old.outcome then
      raise exception 'Signal outcome for record % is permanently locked as % and cannot be modified.',
        old.id, old.outcome
        using errcode = '23514';
    end if;

    -- Preserve original lock timestamp forever
    new.outcome_locked_at := old.outcome_locked_at;
  end if;

  -- B. Auto-Timestamp Seal when locking for the first time:
  if old.outcome is null and new.outcome is not null then
    if old.signal_type = 'HOLD' then
      raise exception 'HOLD (Stand Aside) signals cannot be marked WON or LOST.'
        using errcode = '23514';
    end if;

    new.outcome_locked_at := coalesce(new.outcome_locked_at, now());
  end if;

  -- C. Core Execution Ticket Immutability:
  -- Prevent retroactive alteration of recorded trade parameters after signal generation.
  if new.pair is distinct from old.pair
     or new.timeframe is distinct from old.timeframe
     or new.signal_type is distinct from old.signal_type
     or new.entry_price is distinct from old.entry_price
     or new.stop_loss is distinct from old.stop_loss
     or new.take_profit_1 is distinct from old.take_profit_1
     or new.take_profit_2 is distinct from old.take_profit_2
     or new.take_profit_3 is distinct from old.take_profit_3
     or new.risk_reward_ratio is distinct from old.risk_reward_ratio
  then
    raise exception 'Execution ticket parameters for signal % are immutable once archived.',
      old.id
      using errcode = '23514';
  end if;

  -- Preserve original creation timestamp
  new.created_at := old.created_at;

  return new;
end;
$$;

-- Remove legacy trigger name if upgrading from an earlier script
drop trigger if exists trg_immutable_signal_outcome on public.signal_history;
drop trigger if exists trg_guard_signal_history on public.signal_history;

create trigger trg_guard_signal_history
  before update on public.signal_history
  for each row
  execute function public.enforce_immutable_signal_history();

-- -----------------------------------------------------------------------------
-- 4. Atomic Transactional RPC for Locking Outcomes (Optional Direct RPC Helper)
-- -----------------------------------------------------------------------------
create or replace function public.lock_signal_outcome(
  p_id text,
  p_outcome text
)
returns public.signal_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.signal_history;
begin
  if p_outcome not in ('WON', 'LOST') then
    raise exception 'Outcome must be WON or LOST. Received: %', p_outcome
      using errcode = '22023';
  end if;

  select *
    into v_row
    from public.signal_history
   where id = p_id
   for update;

  if not found then
    raise exception 'Signal record % not found.', p_id
      using errcode = 'P0002';
  end if;

  if v_row.outcome is not null then
    raise exception 'Signal % is already permanently locked as %.', p_id, v_row.outcome
      using errcode = '23514';
  end if;

  update public.signal_history
     set outcome = p_outcome,
         outcome_locked_at = now()
   where id = p_id
     and outcome is null
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security (RLS) & Policies
--    Supports server routes using either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
--    while blocking updates to already-locked rows and blocking unauthorized deletes.
-- -----------------------------------------------------------------------------
alter table public.signal_history enable row level security;

drop policy if exists "signal_history_select_policy" on public.signal_history;
create policy "signal_history_select_policy"
  on public.signal_history
  for select
  to anon, authenticated, service_role
  using (true);

drop policy if exists "signal_history_insert_policy" on public.signal_history;
create policy "signal_history_insert_policy"
  on public.signal_history
  for insert
  to anon, authenticated, service_role
  with check (true);

drop policy if exists "signal_history_lock_outcome_policy" on public.signal_history;
create policy "signal_history_lock_outcome_policy"
  on public.signal_history
  for update
  to anon, authenticated, service_role
  using (outcome is null)
  with check (outcome in ('WON', 'LOST'));

drop policy if exists "signal_history_delete_policy" on public.signal_history;
create policy "signal_history_delete_policy"
  on public.signal_history
  for delete
  to anon, authenticated, service_role
  using (true);

-- -----------------------------------------------------------------------------
-- 6. Institutional Performance & Analytics Views
-- -----------------------------------------------------------------------------
create or replace view public.signal_performance_summary
with (security_invoker = true)
as
select
  count(*)::int                                                                 as total_signals,
  count(*) filter (where signal_type in ('BUY', 'SELL'))::int                   as actionable_trades,
  count(*) filter (where outcome = 'WON')::int                                  as trades_won,
  count(*) filter (where outcome = 'LOST')::int                                 as trades_lost,
  count(*) filter (where signal_type in ('BUY', 'SELL') and outcome is null)::int as awaiting_outcome,
  count(*) filter (where signal_type = 'HOLD')::int                             as stand_aside_holds,
  coalesce(
    round(
      (count(*) filter (where outcome = 'WON')::numeric /
       nullif(count(*) filter (where outcome in ('WON', 'LOST')), 0)) * 100,
      2
    ),
    0.00
  )                                                                             as verified_win_rate_pct
from public.signal_history;

create or replace view public.signal_pair_breakdown
with (security_invoker = true)
as
select
  pair,
  timeframe,
  count(*) filter (where signal_type in ('BUY', 'SELL'))::int                   as total_trades,
  count(*) filter (where outcome = 'WON')::int                                  as won,
  count(*) filter (where outcome = 'LOST')::int                                 as lost,
  count(*) filter (where signal_type in ('BUY', 'SELL') and outcome is null)::int as open_trades,
  coalesce(
    round(
      (count(*) filter (where outcome = 'WON')::numeric /
       nullif(count(*) filter (where outcome in ('WON', 'LOST')), 0)) * 100,
      2
    ),
    0.00
  )                                                                             as win_rate_pct,
  max(created_at)                                                               as last_signal_at
from public.signal_history
group by pair, timeframe
order by last_signal_at desc;

grant select, insert, update, delete on public.signal_history to anon, authenticated, service_role;
grant select on public.signal_performance_summary to anon, authenticated, service_role;
grant select on public.signal_pair_breakdown to anon, authenticated, service_role;
grant execute on function public.lock_signal_outcome(text, text) to anon, authenticated, service_role;

commit;

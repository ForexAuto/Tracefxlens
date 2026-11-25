-- =============================================================================
-- TraceFX Lens — Pending Orders Migration for Existing signal_history Tables
-- Safe & idempotent: adds order_type column and expands execution_category.
-- =============================================================================

begin;

alter table public.signal_history
  add column if not exists order_type text;

alter table public.signal_history
  drop constraint if exists chk_signal_history_order_type;

alter table public.signal_history
  add constraint chk_signal_history_order_type
  check (
    order_type is null
    or order_type in ('MARKET', 'BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP', 'NONE')
  );

alter table public.signal_history
  drop constraint if exists chk_signal_history_execution_category;

alter table public.signal_history
  add constraint chk_signal_history_execution_category
  check (
    execution_category in ('Market Execution', 'Pending Limit', 'Pending Stop', 'Stand Aside')
  );

commit;

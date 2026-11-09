-- Optional Supabase migration for the experimental AI setup estimate.
-- Apply in the Supabase SQL editor. Existing rows remain NULL and continue to load.

alter table public.signal_history
  add column if not exists ai_win_probability smallint;

alter table public.signal_history
  drop constraint if exists chk_signal_history_ai_win_probability;

alter table public.signal_history
  add constraint chk_signal_history_ai_win_probability
  check (
    ai_win_probability is null
    or ai_win_probability between 1 and 99
  );

comment on column public.signal_history.ai_win_probability is
  'Experimental, uncalibrated model estimate for TP1-before-stop outcome; not a verified probability.';

ALTER TABLE public.signal_history
  ADD COLUMN IF NOT EXISTS preferred_take_profit smallint,
  ADD COLUMN IF NOT EXISTS preferred_take_profit_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signal_history_preferred_take_profit_check'
      AND conrelid = 'public.signal_history'::regclass
  ) THEN
    ALTER TABLE public.signal_history
      ADD CONSTRAINT signal_history_preferred_take_profit_check
      CHECK (preferred_take_profit IS NULL OR preferred_take_profit IN (1, 2, 3));
  END IF;
END
$$;
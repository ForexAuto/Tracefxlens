alter table public.signal_history
  add column if not exists model_route text;

alter table public.signal_history
  drop constraint if exists chk_signal_history_model_route;

alter table public.signal_history
  add constraint chk_signal_history_model_route
  check (model_route is null or model_route in ('PR', 'FB'));

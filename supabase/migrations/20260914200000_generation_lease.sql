alter table public.notebooks
  add column active_attempt_id uuid,
  add column active_attempt_started_at timestamptz;

alter table public.messages
  add column attempt_id uuid;

alter table public.messages drop constraint messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('pending', 'complete', 'refused', 'failed'));

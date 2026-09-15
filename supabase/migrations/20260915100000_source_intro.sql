alter table public.sources
  add column intro_summary text,
  add column intro_generated_at timestamptz;

alter table public.messages
  add column source_id uuid references public.sources (id) on delete set null;

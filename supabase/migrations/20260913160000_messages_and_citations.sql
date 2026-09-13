create table public.messages (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  status text not null default 'complete' check (status in ('complete', 'refused', 'failed')),
  selected_source_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.message_citations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  label integer not null,
  source_id uuid not null references public.sources (id) on delete cascade,
  chunk_id uuid references public.source_chunks (id) on delete set null,
  source_title text not null,
  chunk_index integer,
  page_number integer,
  section text,
  content_snapshot text not null,
  created_at timestamptz not null default now(),
  unique (message_id, label)
);

alter table public.messages enable row level security;
alter table public.message_citations enable row level security;

create policy "owner can manage own messages"
on public.messages for all
using (exists (select 1 from public.notebooks n where n.id = messages.notebook_id and n.owner_id = auth.uid()))
with check (exists (select 1 from public.notebooks n where n.id = messages.notebook_id and n.owner_id = auth.uid()));

create policy "owner can manage own message citations"
on public.message_citations for all
using (
  exists (
    select 1 from public.messages m join public.notebooks n on n.id = m.notebook_id
    where m.id = message_citations.message_id and n.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.messages m join public.notebooks n on n.id = m.notebook_id
    where m.id = message_citations.message_id and n.owner_id = auth.uid()
  )
);

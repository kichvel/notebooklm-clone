-- Extensions
create extension if not exists vector with schema extensions;

-- Tables
create table public.notebooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Untitled notebook',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  type text not null check (type in ('pdf', 'docx', 'txt', 'pasted_text', 'website')),
  title text not null,
  storage_path text,
  origin_url text,
  content_hash text,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed')),
  failure_reason text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.processing_steps (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  step text not null check (step in ('parse', 'normalize', 'chunk', 'embed', 'finalize')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'succeeded', 'failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, step)
);

create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  page_number integer,
  section text,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

-- RLS
alter table public.notebooks enable row level security;
alter table public.sources enable row level security;
alter table public.processing_steps enable row level security;
alter table public.source_chunks enable row level security;

create policy "owner can manage own notebooks"
on public.notebooks for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "owner can manage own sources"
on public.sources for all
using (
  exists (select 1 from public.notebooks n where n.id = sources.notebook_id and n.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.notebooks n where n.id = sources.notebook_id and n.owner_id = auth.uid())
);

create policy "owner can manage own processing steps"
on public.processing_steps for all
using (
  exists (
    select 1 from public.sources s join public.notebooks n on n.id = s.notebook_id
    where s.id = processing_steps.source_id and n.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.sources s join public.notebooks n on n.id = s.notebook_id
    where s.id = processing_steps.source_id and n.owner_id = auth.uid()
  )
);

create policy "owner can manage own source chunks"
on public.source_chunks for all
using (
  exists (
    select 1 from public.sources s join public.notebooks n on n.id = s.notebook_id
    where s.id = source_chunks.source_id and n.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.sources s join public.notebooks n on n.id = s.notebook_id
    where s.id = source_chunks.source_id and n.owner_id = auth.uid()
  )
);

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('sources', 'sources', false)
on conflict (id) do nothing;

create policy "owner can manage own source files"
on storage.objects for all
using (
  bucket_id = 'sources'
  and exists (
    select 1 from public.notebooks n
    where n.id::text = (storage.foldername(name))[1] and n.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'sources'
  and exists (
    select 1 from public.notebooks n
    where n.id::text = (storage.foldername(name))[1] and n.owner_id = auth.uid()
  )
);

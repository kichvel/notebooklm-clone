create or replace function public.match_source_chunks(
  query_embedding extensions.vector(1536),
  match_notebook_id uuid,
  match_source_ids uuid[] default null,
  match_count int default 8
)
returns table (
  chunk_id uuid,
  source_id uuid,
  content text,
  chunk_index int,
  page_number int,
  section text,
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  select
    sc.id as chunk_id,
    sc.source_id,
    sc.content,
    sc.chunk_index,
    sc.page_number,
    sc.section,
    1 - (sc.embedding <=> query_embedding) as similarity
  from public.source_chunks sc
  join public.sources s on s.id = sc.source_id
  where s.notebook_id = match_notebook_id
    and s.status = 'ready'
    and s.deleted_at is null
    and (match_source_ids is null or s.id = any(match_source_ids))
  order by sc.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_source_chunks(extensions.vector, uuid, uuid[], int) to anon, authenticated;

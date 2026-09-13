# Retrieval Query (pgvector Search) — Implementation Plan

**Goal:** Close the embed/store/retrieve loop with a real, filtered pgvector similarity search over `source_chunks`.
**Branch:** worktree-retrieval-query
**Stack:** Supabase Postgres/pgvector (remote project `btwvjtlvcbumxbfsqaal`), Vitest

---

## Context specific to this plan

- Builds directly on the foundational-plumbing work already on `main`: `notebooks`/`sources`/`processing_steps`/`source_chunks` tables with RLS, and a real `embed()` in `src/lib/providers/openai.ts`.
- Same environment notes as before: Supabase CLI is not linked in this sandbox — apply the migration via `mcp__supabase__apply_migration` (project_id `btwvjtlvcbumxbfsqaal`), and still commit the equivalent `.sql` file under `supabase/migrations/`. A real `.env` already exists at the project root (gitignored); `vitest.setup.ts` already loads it via `dotenv`.
- `sources.status` default is `'uploaded'`; the test must explicitly set `status: 'ready'` / `status: 'processing'` on insert.

## Files

| Action | Path                                                      | Purpose                                                  |
| ------ | --------------------------------------------------------- | -------------------------------------------------------- |
| Create | `supabase/migrations/<timestamp>_match_source_chunks.sql` | `match_source_chunks` SQL function + grants              |
| Modify | `src/lib/retrieval/index.ts`                              | `search()` implementation wrapping the RPC call          |
| Test   | `src/lib/retrieval/search.integration.test.ts`            | Real end-to-end semantic search + status-filtering proof |

---

## Task 1: `match_source_chunks` Postgres function

**Files:** `supabase/migrations/<timestamp>_match_source_chunks.sql`

- [ ] Run `npx supabase migration new match_source_chunks` to create the timestamped file, then fill it with:
  ```sql
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
  ```
- [ ] Apply it to the real remote project via `mcp__supabase__apply_migration` (`project_id: "btwvjtlvcbumxbfsqaal"`, `name: "match_source_chunks"`, `query`: the exact SQL above).
- [ ] Verify: `mcp__supabase__execute_sql` running `select proname from pg_proc where proname = 'match_source_chunks';` returns one row.
- [ ] Commit: `git add supabase && git commit -m "feat: add match_source_chunks pgvector search function"`

## Task 2: `search()` function and end-to-end proof

**Files:** `src/lib/retrieval/index.ts`, `src/lib/retrieval/search.integration.test.ts`

- [ ] Write `src/lib/retrieval/index.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';

  export interface SearchParams {
    notebookId: string;
    sourceIds?: string[];
    queryEmbedding: number[];
    matchCount?: number;
  }

  export interface SearchResult {
    chunkId: string;
    sourceId: string;
    content: string;
    chunkIndex: number;
    pageNumber: number | null;
    section: string | null;
    similarity: number;
  }

  interface MatchSourceChunksRow {
    chunk_id: string;
    source_id: string;
    content: string;
    chunk_index: number;
    page_number: number | null;
    section: string | null;
    similarity: number;
  }

  export async function search(
    client: SupabaseClient,
    { notebookId, sourceIds, queryEmbedding, matchCount = 8 }: SearchParams,
  ): Promise<SearchResult[]> {
    const { data, error } = await client.rpc('match_source_chunks', {
      query_embedding: queryEmbedding,
      match_notebook_id: notebookId,
      match_source_ids: sourceIds ?? null,
      match_count: matchCount,
    });

    if (error) throw error;

    return ((data ?? []) as MatchSourceChunksRow[]).map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      content: row.content,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      section: row.section,
      similarity: row.similarity,
    }));
  }
  ```
- [ ] Write `src/lib/retrieval/search.integration.test.ts`:
  ```ts
  import { afterAll, describe, expect, it } from 'vitest';
  import { createClient } from '@supabase/supabase-js';
  import { createServiceClient } from '@/lib/supabase/server';
  import { embed } from '@/lib/providers/openai';
  import { search } from './index';

  const hasRealSupabaseEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  describe.skipIf(!hasRealSupabaseEnv)('search', () => {
    const createdNotebookIds: string[] = [];

    function createAnonClient() {
      return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    }

    afterAll(async () => {
      if (createdNotebookIds.length === 0) return;
      const service = createServiceClient();
      await service.from('notebooks').delete().in('id', createdNotebookIds);
    });

    it('ranks the semantically closest chunk first and excludes non-ready sources', async () => {
      const user = createAnonClient();
      expect((await user.auth.signInAnonymously()).error).toBeNull();

      const { data: notebook, error: notebookError } = await user
        .from('notebooks')
        .insert({ title: 'Retrieval test notebook' })
        .select()
        .single();
      expect(notebookError).toBeNull();
      createdNotebookIds.push(notebook!.id);

      const { data: readySource, error: readyError } = await user
        .from('sources')
        .insert({
          notebook_id: notebook!.id,
          type: 'pasted_text',
          title: 'Ready source',
          status: 'ready',
        })
        .select()
        .single();
      expect(readyError).toBeNull();

      const { data: processingSource, error: processingError } = await user
        .from('sources')
        .insert({
          notebook_id: notebook!.id,
          type: 'pasted_text',
          title: 'Processing source',
          status: 'processing',
        })
        .select()
        .single();
      expect(processingError).toBeNull();

      const catText = 'Domestic cats are small, typically furry, carnivorous mammals kept as pets.';
      const airplaneText = 'The Boeing 747 is a wide-body commercial jet airliner.';
      const processingCatText = 'House cats often sleep for twelve to sixteen hours a day.';

      const [catEmbedding, airplaneEmbedding, processingCatEmbedding] = await Promise.all([
        embed(catText),
        embed(airplaneText),
        embed(processingCatText),
      ]);

      const { error: chunksError } = await user.from('source_chunks').insert([
        { source_id: readySource!.id, chunk_index: 0, content: catText, embedding: catEmbedding },
        {
          source_id: readySource!.id,
          chunk_index: 1,
          content: airplaneText,
          embedding: airplaneEmbedding,
        },
        {
          source_id: processingSource!.id,
          chunk_index: 0,
          content: processingCatText,
          embedding: processingCatEmbedding,
        },
      ]);
      expect(chunksError).toBeNull();

      const queryEmbedding = await embed('Tell me about pet cats.');
      const results = await search(user, { notebookId: notebook!.id, queryEmbedding });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.sourceId !== processingSource!.id)).toBe(true);
      expect(results[0].content).toBe(catText);
      expect(results[1].content).toBe(airplaneText);
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    }, 30000);
  });
  ```
- [ ] Run `npm run test` — confirm the new `search` test is **not** skipped and passes
- [ ] Commit: `git commit -m "feat: add search() retrieval function with end-to-end test"`

---

## Self-review

1. **Task count:** 2 — well under the 7-task limit.
2. **Coverage:** Every design-brief bullet is covered — the SQL function with its filters (Task 1), `search()` and its RLS-enforcing client parameter, and the real end-to-end proof of ranking + status filtering (Task 2).
3. **Placeholders:** None — SQL and TypeScript are concrete and complete.
4. **Type consistency:** `SearchParams`/`SearchResult` in `search()` match the test's usage (`notebookId`, `queryEmbedding`, `.sourceId`, `.content`, `.similarity`). `MatchSourceChunksRow` field names match the SQL function's `returns table` column list exactly.
5. **CI impact:** The new test self-skips when `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are absent, same as the existing tests — no CI changes needed.

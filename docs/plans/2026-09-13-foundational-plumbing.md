# Foundational Plumbing (Schema, RLS, Storage, Providers) — Implementation Plan

**Goal:** Stand up the real database schema, RLS isolation, storage bucket, and a working OpenAI `embed()` call against the real Supabase project, verified by automated tests.
**Branch:** worktree-foundational-plumbing
**Stack:** Supabase Postgres/pgvector/Storage (remote project `btwvjtlvcbumxbfsqaal`, org `sourcebook`), OpenAI SDK, Vitest

---

## Context specific to this plan

- The remote Supabase project already exists (`btwvjtlvcbumxbfsqaal`), anonymous sign-ins are already enabled, and real credentials are already in `.env` (gitignored) at the repo root.
- The Supabase CLI is **not** linked/logged in in this environment (`supabase login` is interactive). The Supabase MCP tools (`mcp__supabase__*`) are already connected to this same project and organization — use `mcp__supabase__apply_migration` to actually apply the migration to the remote database, while still committing the equivalent `.sql` file under `supabase/migrations/` as the versioned source of truth per `docs/ARCHITECTURE.md` §13.
- `public` schema on the remote project is currently empty (verified via `mcp__supabase__list_tables`).

## Files

| Action | Path                                                      | Purpose                                                                       |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Create | `supabase/migrations/<timestamp>_foundational_schema.sql` | Tables, RLS policies, `sources` storage bucket + policies, `vector` extension |
| Modify | `supabase/config.toml`                                    | Fix stale `project_id = "project-scaffold"` → `"sourcebook"`                  |
| Modify | `package.json`                                            | Add `openai` dependency, `dotenv` dev dependency                              |
| Modify | `vitest.setup.ts`                                         | Load `.env` via `dotenv` so local tests see real credentials                  |
| Create | `src/lib/providers/openai.ts`                             | Real `embed()` implementation using OpenAI SDK                                |
| Modify | `src/lib/providers/index.ts`                              | Re-export `embed`                                                             |
| Test   | `src/lib/providers/openai.test.ts`                        | Real embedding call, skips without `OPENAI_API_KEY`                           |
| Test   | `src/lib/supabase/rls.integration.test.ts`                | Two-anonymous-session ownership isolation proof, self-cleaning                |

---

## Task 1: Foundational schema, RLS, and storage bucket

**Files:** `supabase/migrations/<timestamp>_foundational_schema.sql`, `supabase/config.toml`

- [ ] Fix `supabase/config.toml`: change `project_id = "project-scaffold"` to `project_id = "sourcebook"`
- [ ] Run `npx supabase migration new foundational_schema` to create the timestamped migration file, then fill it with:
  ```sql
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
  ```
- [ ] Apply it to the real remote project via the Supabase MCP tool (not `supabase db push`, since the CLI isn't linked in this environment): call `mcp__supabase__apply_migration` with `project_id: "btwvjtlvcbumxbfsqaal"`, `name: "foundational_schema"`, and `query` set to the exact SQL written to the migration file.
- [ ] Verify: `mcp__supabase__list_tables` (project_id `btwvjtlvcbumxbfsqaal`, schema `public`) shows `notebooks`, `sources`, `processing_steps`, `source_chunks`.
- [ ] Verify: `mcp__supabase__execute_sql` querying `select tablename, policyname from pg_policies where schemaname in ('public','storage')` shows 5 policies (4 tables + storage).
- [ ] Verify: `mcp__supabase__execute_sql` querying `select id, public from storage.buckets where id = 'sources'` returns one row with `public = false`.
- [ ] Commit: `git add supabase && git commit -m "feat: add foundational schema, RLS policies, and sources storage bucket"`

## Task 2: Real OpenAI embed() provider

**Files:** `package.json`, `vitest.setup.ts`, `src/lib/providers/openai.ts`, `src/lib/providers/index.ts`, `src/lib/providers/openai.test.ts`

- [ ] `npm install openai`
- [ ] `npm install -D dotenv`
- [ ] Update `vitest.setup.ts`:
  ```ts
  import { config } from 'dotenv';
  import path from 'node:path';

  config({ path: path.resolve(__dirname, '.env') });

  import '@testing-library/jest-dom/vitest';
  ```
- [ ] Create `src/lib/providers/openai.ts`:
  ```ts
  import 'server-only';
  import OpenAI from 'openai';

  const EMBEDDING_MODEL = 'text-embedding-3-small';

  let client: OpenAI | null = null;

  function getClient(): OpenAI {
    if (!client) {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return client;
  }

  export async function embed(text: string): Promise<number[]> {
    const response = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.data[0].embedding;
  }
  ```
- [ ] Update `src/lib/providers/index.ts`:
  ```ts
  export { embed } from './openai';
  ```
- [ ] Create `src/lib/providers/openai.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { embed } from './openai';

  describe.skipIf(!process.env.OPENAI_API_KEY)('embed', () => {
    it('returns a 1536-dimension embedding vector', async () => {
      const vector = await embed('Sourcebook is a source-grounded AI knowledge workspace.');
      expect(vector).toHaveLength(1536);
      expect(vector.every((n) => typeof n === 'number')).toBe(true);
    }, 15000);
  });
  ```
- [ ] Run `npm run test` — confirm the `embed` test is **not** skipped (real `.env` key present) and passes
- [ ] Commit: `git commit -m "feat: add real OpenAI embed() provider with test"`

## Task 3: RLS ownership isolation integration test

**Files:** `src/lib/supabase/rls.integration.test.ts`

- [ ] Create `src/lib/supabase/rls.integration.test.ts`:
  ```ts
  import { afterAll, describe, expect, it } from 'vitest';
  import { createClient } from '@supabase/supabase-js';
  import { createServiceClient } from './server';

  const hasRealSupabaseEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  describe.skipIf(!hasRealSupabaseEnv)('notebook RLS isolation', () => {
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

    it("prevents one anonymous user from reading or modifying another user's notebook", async () => {
      const userA = createAnonClient();
      const userB = createAnonClient();

      expect((await userA.auth.signInAnonymously()).error).toBeNull();
      expect((await userB.auth.signInAnonymously()).error).toBeNull();

      const { data: notebookA, error: insertError } = await userA
        .from('notebooks')
        .insert({ title: 'User A notebook' })
        .select()
        .single();
      expect(insertError).toBeNull();
      createdNotebookIds.push(notebookA!.id);

      const { data: readAsB } = await userB.from('notebooks').select().eq('id', notebookA!.id);
      expect(readAsB).toEqual([]);

      const { data: updateAsB } = await userB
        .from('notebooks')
        .update({ title: 'hijacked' })
        .eq('id', notebookA!.id)
        .select();
      expect(updateAsB).toEqual([]);

      const { data: deleteAsB } = await userB
        .from('notebooks')
        .delete()
        .eq('id', notebookA!.id)
        .select();
      expect(deleteAsB).toEqual([]);

      const { data: stillExists } = await userA.from('notebooks').select().eq('id', notebookA!.id);
      expect(stillExists).toHaveLength(1);
    }, 20000);
  });
  ```
- [ ] Run `npm run test` — confirm the RLS test is **not** skipped and passes
- [ ] Commit: `git commit -m "test: add RLS ownership isolation integration test"`

---

## Self-review

1. **Task count:** 3 — well under the 7-task limit.
2. **Coverage:** Every design-brief bullet has a task — schema/RLS/storage (Task 1), `config.toml` fix (Task 1), `embed()` + its test + `dotenv` wiring (Task 2), RLS integration test + cleanup (Task 3). `generate()`, the deferred tables, Inngest functions, and UI are explicitly not tasked, matching "Out of scope."
3. **Placeholders:** None — all SQL and TypeScript is concrete and complete.
4. **Type consistency:** `embed(text: string): Promise<number[]>` is used identically in its implementation, its test, and the barrel re-export. `createServiceClient`/`createClient` (browser) signatures match existing `src/lib/supabase/*.ts` files, unchanged by this plan.
5. **CI impact:** Both new tests self-skip when `NEXT_PUBLIC_SUPABASE_URL` / `OPENAI_API_KEY` are absent, which is the case in the CI `test` step today (only the `build` step gets placeholder Supabase envs) — no CI changes needed, and CI stays green.

# Inngest Ingestion Workflow Shape — Implementation Plan

**Goal:** A real Inngest function running the five-step ingestion pipeline for a `pasted_text` source, with real DB/Storage/OpenAI side effects, verified by `@inngest/test`.
**Branch:** worktree-inngest-workflow-shape
**Stack:** Inngest, `@inngest/test`, Supabase Postgres/Storage (remote project `btwvjtlvcbumxbfsqaal`), OpenAI, Vitest

---

## Context specific to this plan

- `@inngest/test`'s own README states retries are not modelled ("any step or function that fails once will fail permanently") — this plan does **not** attempt to prove Inngest's retry mechanism. It proves one real, successful run through all five named steps (parse, normalize, chunk, embed, finalize), each with genuine side effects.
- Builds on tables/RLS/storage from `supabase/migrations/20260913114251_foundational_schema.sql` and the real `embed()` in `src/lib/providers/openai.ts`, both already on `main`.
- `sources.owner_id`... actually `notebooks.owner_id` defaults to `auth.uid()`, which is `null` under a service-role connection — the test must sign in anonymously first (for a valid `auth.users` row to satisfy the FK) and pass that user's ID explicitly when inserting via the service client.
- The OpenAI SDK throws under Vitest's default `jsdom` environment ("running in a browser-like environment") — the same issue hit in the foundational-plumbing and retrieval-query slices. The test file needs `// @vitest-environment node` at the top.
- Storage path convention (established in the foundational-plumbing migration): `notebook_id/source_id/filename`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/ingestion/index.ts` | The `ingestSource` Inngest function |
| Modify | `src/app/api/inngest/route.ts` | Register `ingestSource` in the `functions` array |
| Modify | `package.json` | `@inngest/test` dev dependency (already installed in this worktree) |
| Test   | `src/lib/ingestion/ingestSource.test.ts` | Real end-to-end run through all 5 steps |

---

## Task 1: `ingestSource` Inngest function

**Files:** `src/lib/ingestion/index.ts`, `src/app/api/inngest/route.ts`

- [ ] Write `src/lib/ingestion/index.ts`:
  ```ts
  import 'server-only';
  import { NonRetriableError } from 'inngest';
  import { inngest } from '@/lib/inngest/client';
  import { createServiceClient } from '@/lib/supabase/server';
  import { embed } from '@/lib/providers/openai';

  type ProcessingStep = 'parse' | 'normalize' | 'chunk' | 'embed' | 'finalize';
  type ProcessingStatus = 'in_progress' | 'succeeded' | 'failed';

  async function upsertProcessingStep(
    supabase: ReturnType<typeof createServiceClient>,
    sourceId: string,
    step: ProcessingStep,
    status: ProcessingStatus,
  ) {
    const { data: existing } = await supabase
      .from('processing_steps')
      .select('attempts')
      .eq('source_id', sourceId)
      .eq('step', step)
      .maybeSingle();

    await supabase.from('processing_steps').upsert(
      { source_id: sourceId, step, status, attempts: (existing?.attempts ?? 0) + 1 },
      { onConflict: 'source_id,step' },
    );
  }

  export const ingestSource = inngest.createFunction(
    { id: 'ingest-source' },
    { event: 'sourcebook/source.ingest.requested' },
    async ({ event, step }) => {
      const supabase = createServiceClient();
      const sourceId = event.data.sourceId as string;

      const rawText = await step.run('parse', async () => {
        await upsertProcessingStep(supabase, sourceId, 'parse', 'in_progress');

        const { data: source, error: sourceError } = await supabase
          .from('sources')
          .select('storage_path')
          .eq('id', sourceId)
          .single();
        if (sourceError || !source?.storage_path) {
          await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
          throw new NonRetriableError(`Source ${sourceId} not found or missing storage_path`);
        }

        await supabase.from('sources').update({ status: 'processing' }).eq('id', sourceId);

        const { data: blob, error: downloadError } = await supabase.storage
          .from('sources')
          .download(source.storage_path);
        if (downloadError || !blob) {
          await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
          throw downloadError ?? new Error('Missing storage object');
        }

        const text = await blob.text();
        await upsertProcessingStep(supabase, sourceId, 'parse', 'succeeded');
        return text;
      });

      const normalizedText = await step.run('normalize', async () => {
        await upsertProcessingStep(supabase, sourceId, 'normalize', 'in_progress');
        const normalized = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
        await upsertProcessingStep(supabase, sourceId, 'normalize', 'succeeded');
        return normalized;
      });

      const chunks = await step.run('chunk', async () => {
        await upsertProcessingStep(supabase, sourceId, 'chunk', 'in_progress');
        const parts = normalizedText
          .split(/\n\s*\n/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        await upsertProcessingStep(supabase, sourceId, 'chunk', 'succeeded');
        return parts;
      });

      await step.run('embed', async () => {
        await upsertProcessingStep(supabase, sourceId, 'embed', 'in_progress');
        for (let i = 0; i < chunks.length; i++) {
          const embedding = await embed(chunks[i]);
          const { error } = await supabase
            .from('source_chunks')
            .upsert(
              { source_id: sourceId, chunk_index: i, content: chunks[i], embedding },
              { onConflict: 'source_id,chunk_index' },
            );
          if (error) {
            await upsertProcessingStep(supabase, sourceId, 'embed', 'failed');
            throw error;
          }
        }
        await upsertProcessingStep(supabase, sourceId, 'embed', 'succeeded');
      });

      await step.run('finalize', async () => {
        await upsertProcessingStep(supabase, sourceId, 'finalize', 'in_progress');
        const { count } = await supabase
          .from('source_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('source_id', sourceId);
        if (!count || count !== chunks.length) {
          await upsertProcessingStep(supabase, sourceId, 'finalize', 'failed');
          throw new Error('Chunk count mismatch during finalize');
        }
        await supabase.from('sources').update({ status: 'ready' }).eq('id', sourceId);
        await upsertProcessingStep(supabase, sourceId, 'finalize', 'succeeded');
      });

      return { sourceId, chunkCount: chunks.length };
    },
  );
  ```
- [ ] Update `src/app/api/inngest/route.ts`:
  ```ts
  import { serve } from 'inngest/next';
  import { inngest } from '@/lib/inngest/client';
  import { ingestSource } from '@/lib/ingestion';

  export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [ingestSource],
  });
  ```
- [ ] Run `npm run typecheck` — confirm it passes
- [ ] Commit: `git add src/lib/ingestion src/app/api/inngest && git commit -m "feat: add ingestSource Inngest function for pasted-text ingestion"`

## Task 2: End-to-end test

**Files:** `src/lib/ingestion/ingestSource.test.ts`

- [ ] Write `src/lib/ingestion/ingestSource.test.ts`:
  ```ts
  // @vitest-environment node
  import { afterAll, describe, expect, it } from 'vitest';
  import { createClient } from '@supabase/supabase-js';
  import { InngestTestEngine } from '@inngest/test';
  import { createServiceClient } from '@/lib/supabase/server';
  import { ingestSource } from './index';

  const hasRealEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.OPENAI_API_KEY,
  );

  describe.skipIf(!hasRealEnv)('ingestSource', () => {
    const createdNotebookIds: string[] = [];

    afterAll(async () => {
      if (createdNotebookIds.length === 0) return;
      const service = createServiceClient();
      await service.from('notebooks').delete().in('id', createdNotebookIds);
    });

    it(
      'runs parse, normalize, chunk, embed, and finalize for a pasted-text source',
      async () => {
        const anon = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: authData, error: authError } = await anon.auth.signInAnonymously();
        expect(authError).toBeNull();

        const service = createServiceClient();

        const { data: notebook, error: notebookError } = await service
          .from('notebooks')
          .insert({ owner_id: authData!.user!.id, title: 'Ingestion test notebook' })
          .select()
          .single();
        expect(notebookError).toBeNull();
        createdNotebookIds.push(notebook!.id);

        const { data: source, error: sourceError } = await service
          .from('sources')
          .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Ingestion test source' })
          .select()
          .single();
        expect(sourceError).toBeNull();

        const pastedText = [
          'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
          'The Boeing 747 is a wide-body commercial jet airliner.',
        ].join('\n\n');

        const storagePath = `${notebook!.id}/${source!.id}/original.txt`;
        const { error: uploadError } = await service.storage
          .from('sources')
          .upload(storagePath, pastedText, { contentType: 'text/plain' });
        expect(uploadError).toBeNull();

        const { error: pathUpdateError } = await service
          .from('sources')
          .update({ storage_path: storagePath })
          .eq('id', source!.id);
        expect(pathUpdateError).toBeNull();

        const t = new InngestTestEngine({ function: ingestSource });
        const { result } = await t.execute({
          events: [{ name: 'sourcebook/source.ingest.requested', data: { sourceId: source!.id } }],
        });

        expect(result).toEqual({ sourceId: source!.id, chunkCount: 2 });

        const { data: finalSource } = await service
          .from('sources')
          .select('status')
          .eq('id', source!.id)
          .single();
        expect(finalSource?.status).toBe('ready');

        const { data: chunks } = await service
          .from('source_chunks')
          .select('chunk_index, content, embedding')
          .eq('source_id', source!.id)
          .order('chunk_index');
        expect(chunks).toHaveLength(2);
        expect(chunks![0].content).toContain('Domestic cats');
        expect(chunks![1].content).toContain('Boeing 747');
        expect(chunks![0].embedding).not.toBeNull();

        const { data: steps } = await service
          .from('processing_steps')
          .select('step, status, attempts')
          .eq('source_id', source!.id);
        expect(steps).toHaveLength(5);
        expect(steps!.every((s) => s.status === 'succeeded' && s.attempts === 1)).toBe(true);
      },
      30000,
    );
  });
  ```
- [ ] Run `npm run test` — confirm the new `ingestSource` test is **not** skipped and passes
- [ ] Commit: `git commit -m "test: add end-to-end test for ingestSource"`

---

## Self-review

1. **Task count:** 2 — well under the 7-task limit.
2. **Coverage:** Every design-brief bullet is covered — all 5 named steps with real side effects (Task 1), the descoped single-successful-run verification (Task 2). The retry-loop proof is explicitly out of scope per the `@inngest/test` limitation discovered during brainstorming.
3. **Placeholders:** None — code is concrete and complete.
4. **Type consistency:** `ProcessingStep`/`ProcessingStatus` unions match the `processing_steps` table's `check` constraints exactly. The function's return shape (`{ sourceId, chunkCount }`) matches the test's assertion.
5. **CI impact:** The new test self-skips when Supabase/OpenAI env vars are absent, same as existing tests — no CI changes needed.

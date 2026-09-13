# Notebook Intro (Auto-Title + First Chat Summary) — Implementation Plan

**Goal:** Once the sources a user first adds to a notebook finish ingesting, automatically rename the notebook and post an assistant chat message summarizing what's in it.
**Branch:** `worktree-notebook-intro`
**Stack:** Next.js App Router, TypeScript, Supabase (Postgres), Inngest, OpenAI (`gpt-4o-mini` via existing `generate()`), Vitest/RTL

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/ingestion/index.ts` | Add `markSourceIngestionFailed()`, an `onFailure` handler on `ingestSource`, and a trailing `notebook-intro` step on the success path |
| Modify | `src/lib/ingestion/ingestSource.test.ts` | Cover the failure-status fix and the end-to-end intro trigger |
| Create | `supabase/migrations/20260913180000_notebook_intro.sql` | Add `notebooks.intro_generated_at timestamptz` |
| Create | `src/lib/generation/notebookIntro.ts` | `maybeGenerateNotebookIntro()` — the core trigger/generate/write logic |
| Create | `src/lib/generation/notebookIntro.integration.test.ts` | Cover the no-op conditions, the happy path, and idempotency |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | Extend polling to also refresh notebook title + messages while waiting for the intro |
| Create | `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx` | Cover the extended polling condition |

---

## Task 1: Fix the source failure-status gap

No code path today ever sets `sources.status = 'failed'` — a source that throws mid-ingestion is stuck at `processing` forever, even though `failed`, `failure_reason`, and the retry endpoint all assume it's reachable. This blocks Task 2/3's "all sources terminal" check, so it's fixed first.

**Files:** `src/lib/ingestion/index.ts`, `src/lib/ingestion/ingestSource.test.ts`

- [ ] Write the failing test in `ingestSource.test.ts` (new `describe` block, same file, same `hasRealEnv` skip guard):
  ```ts
  import { markSourceIngestionFailed } from './index';

  it('marks a source failed with a reason', async () => {
    const service = createServiceClient();
    const { data: notebook } = await service
      .from('notebooks')
      .insert({ title: 'Failure test notebook' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);
    const { data: source } = await service
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Will fail', status: 'processing' })
      .select()
      .single();

    await markSourceIngestionFailed(service, source!.id, 'Something broke');

    const { data: after } = await service
      .from('sources')
      .select('status, failure_reason')
      .eq('id', source!.id)
      .single();
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toBe('Something broke');
  });
  ```
- [ ] Run it — confirm it fails (function doesn't exist yet)
- [ ] In `src/lib/ingestion/index.ts`, add and export:
  ```ts
  export async function markSourceIngestionFailed(
    supabase: ReturnType<typeof createServiceClient>,
    sourceId: string,
    reason: string,
  ) {
    await supabase.from('sources').update({ status: 'failed', failure_reason: reason }).eq('id', sourceId);
  }
  ```
- [ ] Add an `onFailure` handler to the `ingestSource` function options (fired once Inngest exhausts retries for a run):
  ```ts
  export const ingestSource = inngest.createFunction(
    {
      id: 'ingest-source',
      triggers: { event: 'sourcebook/source.ingest.requested' },
      onFailure: async ({ event, error, step }) => {
        const supabase = createServiceClient();
        const sourceId = event.data.event.data.sourceId as string;
        await step.run('mark-failed', () =>
          markSourceIngestionFailed(supabase, sourceId, error.message || 'Ingestion failed'),
        );
      },
    },
    async ({ event, step }) => {
      // ...unchanged existing body...
    },
  );
  ```
  Note: `InngestTestEngine` executes only the primary trigger, not the SDK's separate failure-event dispatch, so `onFailure` itself isn't exercised by the test above — only the extracted `markSourceIngestionFailed` is. The wiring is thin enough to trust the SDK for the dispatch mechanics.
- [ ] Run `npm run test` — confirm passing
- [ ] Commit: `git commit -m "fix: mark sources failed when ingestion exhausts retries"`

## Task 2: Notebook intro generation logic

**Files:** `supabase/migrations/20260913180000_notebook_intro.sql`, `src/lib/generation/notebookIntro.ts`, `src/lib/generation/notebookIntro.integration.test.ts`

- [ ] Create the migration:
  ```sql
  alter table public.notebooks
    add column intro_generated_at timestamptz;
  ```
- [ ] Write the failing tests in `notebookIntro.integration.test.ts` (same `hasRealEnv` skip pattern as `askQuestion.integration.test.ts`):
  ```ts
  // @vitest-environment node
  import { afterAll, describe, expect, it } from 'vitest';
  import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
  import { createServiceClient } from '@/lib/supabase/server';
  import { maybeGenerateNotebookIntro } from './notebookIntro';

  const hasRealEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.OPENAI_API_KEY,
  );

  describe.skipIf(!hasRealEnv)('maybeGenerateNotebookIntro', () => {
    const createdNotebookIds: string[] = [];
    afterAll(async () => {
      if (createdNotebookIds.length === 0) return;
      await createServiceClient().from('notebooks').delete().in('id', createdNotebookIds);
    });

    async function makeNotebook(user: Awaited<ReturnType<typeof createPrimaryTestClient>>) {
      const { data: notebook } = await user
        .from('notebooks')
        .insert({ title: 'Untitled notebook' })
        .select()
        .single();
      createdNotebookIds.push(notebook!.id);
      return notebook!;
    }

    it('does nothing while a source is still processing', async () => {
      const user = await createPrimaryTestClient();
      const notebook = await makeNotebook(user);
      await user.from('sources').insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'A', status: 'processing' });

      await maybeGenerateNotebookIntro(user, notebook.id);

      const { data: after } = await user.from('notebooks').select('title, intro_generated_at').eq('id', notebook.id).single();
      expect(after?.title).toBe('Untitled notebook');
      expect(after?.intro_generated_at).toBeNull();
    });

    it('does nothing when every source failed', async () => {
      const user = await createPrimaryTestClient();
      const notebook = await makeNotebook(user);
      await user.from('sources').insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'A', status: 'failed' });

      await maybeGenerateNotebookIntro(user, notebook.id);

      const { data: after } = await user.from('notebooks').select('intro_generated_at').eq('id', notebook.id).single();
      expect(after?.intro_generated_at).toBeNull();
    });

    it('generates a title and posts one summary message once a ready source exists, and never repeats', async () => {
      const user = await createPrimaryTestClient();
      const notebook = await makeNotebook(user);
      const { data: source } = await user
        .from('sources')
        .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'Cat facts', status: 'ready' })
        .select()
        .single();
      await user.from('source_chunks').insert({
        source_id: source!.id,
        chunk_index: 0,
        content: 'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
      });

      await maybeGenerateNotebookIntro(user, notebook.id);

      const { data: afterFirst } = await user
        .from('notebooks')
        .select('title, intro_generated_at')
        .eq('id', notebook.id)
        .single();
      expect(afterFirst?.title).not.toBe('Untitled notebook');
      expect(afterFirst?.intro_generated_at).not.toBeNull();

      const { data: messages } = await user.from('messages').select('role, status').eq('notebook_id', notebook.id);
      expect(messages).toHaveLength(1);
      expect(messages![0].role).toBe('assistant');
      expect(messages![0].status).toBe('complete');

      await maybeGenerateNotebookIntro(user, notebook.id);
      const { data: messagesAfterSecondCall } = await user
        .from('messages')
        .select('id')
        .eq('notebook_id', notebook.id);
      expect(messagesAfterSecondCall).toHaveLength(1);
    }, 30000);
  });
  ```
- [ ] Run it — confirm it fails (module doesn't exist yet)
- [ ] Implement `src/lib/generation/notebookIntro.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { generate } from '@/lib/providers/openai';

  const MAX_CHUNKS_PER_SOURCE = 3;
  const MAX_SAMPLE_CHARS = 6000;

  export async function maybeGenerateNotebookIntro(
    supabase: SupabaseClient,
    notebookId: string,
  ): Promise<void> {
    const { data: notebook } = await supabase
      .from('notebooks')
      .select('intro_generated_at')
      .eq('id', notebookId)
      .single();
    if (!notebook || notebook.intro_generated_at) return;

    const { data: sources } = await supabase
      .from('sources')
      .select('id, status')
      .eq('notebook_id', notebookId)
      .is('deleted_at', null);
    if (!sources || sources.length === 0) return;

    const allTerminal = sources.every((s) => s.status === 'ready' || s.status === 'failed');
    const readySourceIds = sources.filter((s) => s.status === 'ready').map((s) => s.id);
    if (!allTerminal || readySourceIds.length === 0) return;

    const samples: string[] = [];
    for (const sourceId of readySourceIds) {
      const { data: chunks } = await supabase
        .from('source_chunks')
        .select('content')
        .eq('source_id', sourceId)
        .order('chunk_index')
        .limit(MAX_CHUNKS_PER_SOURCE);
      if (chunks && chunks.length > 0) samples.push(chunks.map((c) => c.content).join('\n'));
    }
    const sample = samples.join('\n\n').slice(0, MAX_SAMPLE_CHARS);
    if (!sample.trim()) return;

    let title: string;
    let summary: string;
    try {
      title = (
        await generate({
          system:
            'You write short, descriptive titles (5-10 words, no quotes, no trailing period) for a research notebook, based on samples from its sources. Respond with only the title.',
          prompt: sample,
        })
      ).trim();
      summary = (
        await generate({
          system:
            'You write a short 2-4 sentence introduction summarizing what a set of notebook sources cover, based only on the passages given. Do not add information beyond what the passages show. Respond with only the summary.',
          prompt: sample,
        })
      ).trim();
    } catch {
      return;
    }
    if (!title || !summary) return;

    const { data: claimed } = await supabase
      .from('notebooks')
      .update({ title, intro_generated_at: new Date().toISOString() })
      .eq('id', notebookId)
      .is('intro_generated_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) return;

    await supabase.from('messages').insert({
      notebook_id: notebookId,
      role: 'assistant',
      content: summary,
      status: 'complete',
    });
  }
  ```
- [ ] Run `npm run test` — confirm passing
- [ ] Commit: `git commit -m "feat: generate a notebook title and intro summary once sources are ready"`

## Task 3: Wire intro generation into the ingestion pipeline

**Files:** `src/lib/ingestion/index.ts`, `src/lib/ingestion/ingestSource.test.ts`

- [ ] Extend the existing "runs parse, normalize, chunk, embed, and finalize" test in `ingestSource.test.ts` with assertions after the current ones:
  ```ts
  const { data: notebookAfter } = await service
    .from('notebooks')
    .select('title, intro_generated_at')
    .eq('id', notebook!.id)
    .single();
  expect(notebookAfter?.title).not.toBe('Ingestion test notebook');
  expect(notebookAfter?.intro_generated_at).not.toBeNull();

  const { data: messages } = await service
    .from('messages')
    .select('role, status')
    .eq('notebook_id', notebook!.id);
  expect(messages).toHaveLength(1);
  expect(messages![0].role).toBe('assistant');
  ```
- [ ] Run it — confirm it fails (notebook title/messages untouched today)
- [ ] In `src/lib/ingestion/index.ts`, import `maybeGenerateNotebookIntro` and add a trailing step after the existing `finalize` step, before the function's `return`:
  ```ts
  import { maybeGenerateNotebookIntro } from '@/lib/generation/notebookIntro';
  // ...
  await step.run('notebook-intro', async () => {
    const { data: source } = await supabase
      .from('sources')
      .select('notebook_id')
      .eq('id', sourceId)
      .single();
    if (source) await maybeGenerateNotebookIntro(supabase, source.notebook_id);
  });
  ```
- [ ] Also call it from the `onFailure` handler added in Task 1, after marking the source failed, so a batch where the last straggling source fails (rather than succeeds) still gets checked:
  ```ts
  onFailure: async ({ event, error, step }) => {
    const supabase = createServiceClient();
    const sourceId = event.data.event.data.sourceId as string;
    await step.run('mark-failed', () =>
      markSourceIngestionFailed(supabase, sourceId, error.message || 'Ingestion failed'),
    );
    await step.run('notebook-intro', async () => {
      const { data: source } = await supabase
        .from('sources')
        .select('notebook_id')
        .eq('id', sourceId)
        .single();
      if (source) await maybeGenerateNotebookIntro(supabase, source.notebook_id);
    });
  },
  ```
- [ ] Run `npm run test` — confirm passing
- [ ] Commit: `git commit -m "feat: trigger notebook intro generation from the ingestion pipeline"`

## Task 4: Live-poll the generated title and summary into the UI

**Files:** `src/app/notebooks/[notebookId]/notebook-workspace.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx`

Today `refreshNotebook`/`refreshMessages` only run once on mount, and the 2s polling loop only exists while a source is `uploaded`/`processing`. Once the last source flips straight to `ready` with no other active sources, polling stops immediately — before the ingestion pipeline's `notebook-intro` step (running slightly later, in the same Inngest function) has had a chance to write the title/message. Polling needs to continue a little longer for that case.

- [ ] Write the failing test:
  ```tsx
  import { render, waitFor } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { NotebookWorkspace } from './notebook-workspace';

  function jsonResponse(body: unknown) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  }

  describe('NotebookWorkspace', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('keeps polling notebook title and messages while a ready source has not produced its intro yet', async () => {
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/sources')) {
          return jsonResponse([
            { id: 's1', title: 'Doc', type: 'pdf', status: 'ready', failure_reason: null, created_at: '' },
          ]);
        }
        if (url.endsWith('/messages')) return jsonResponse([]);
        return jsonResponse({ id: 'n1', title: 'Untitled notebook' });
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<NotebookWorkspace notebookId="n1" />);
      await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
      const callsAfterMount = fetchMock.mock.calls.length;

      await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount), {
        timeout: 3000,
      });
    });
  });
  ```
- [ ] Run it — confirm it fails (no further fetches happen once the only source is `ready`)
- [ ] In `notebook-workspace.tsx`, change the polling effect:
  ```ts
  useEffect(() => {
    const hasActiveSource = sources.some((source) => ACTIVE_STATUSES.has(source.status));
    const awaitingIntro =
      !hasActiveSource &&
      sources.some((source) => source.status === 'ready') &&
      messages.length === 0 &&
      notebookTitle === 'Untitled notebook';
    if (!hasActiveSource && !awaitingIntro) return;
    const interval = setInterval(() => {
      refreshSources();
      refreshNotebook();
      refreshMessages();
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, messages, notebookTitle]);
  ```
- [ ] Run `npm run test` — confirm passing
- [ ] Run `npm run lint && npm run typecheck && npm run build` as the final full-suite check
- [ ] Commit: `git commit -m "feat: live-poll the generated notebook title and intro message"`

---

## Self-review

1. **Task count** — 4 tasks, well within the ≤7 guideline.
2. **Coverage** — failure-status bug fix (T1), core generation/idempotency/race-guard logic (T2), pipeline wiring for both success and failure paths (T3), UI live-update (T4). Every success criterion in the design brief maps to a task.
3. **Placeholders** — none; every step has concrete code.
4. **Type consistency** — `maybeGenerateNotebookIntro(supabase: SupabaseClient, notebookId: string): Promise<void>` is the same signature used in Task 2's tests, Task 3's ingestion wiring, and its import; `markSourceIngestionFailed(supabase, sourceId, reason)` likewise consistent between T1 and T3.

**Known risk to flag during execution:** Task 1's `onFailure` handler is not exercised by an automated test (see the note in Task 1) — `InngestTestEngine` only drives the primary trigger. If that turns out to matter, it can be verified manually via the Inngest dev server, but the plan doesn't gate on it.

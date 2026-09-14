# Generation Lease & Retryable Incomplete Answers — Implementation Plan

**Goal:** Only one answer can generate per notebook at a time, and an interrupted answer (dropped connection, crash, provider error, or serverless timeout) is persisted as a visible, retryable message instead of vanishing.

**Branch:** `worktree-docs-overview-and-generation-lease` (current worktree branch)

**Stack:** Next.js App Router (route handlers), Supabase Postgres (RLS, atomic conditional `UPDATE` as compare-and-swap), Vitest + Testing Library

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/20260914200000_generation_lease.sql` | Lease columns on `notebooks`; `attempt_id` + `pending` status on `messages` |
| Create | `src/lib/generation/lease.ts` | `claimGenerationLease` / `releaseGenerationLease` / `NotebookBusyError` |
| Test   | `src/lib/generation/lease.integration.test.ts` | Claim/release compare-and-swap, stale reclaim, busy rejection |
| Modify | `src/lib/generation/index.ts` | Split `streamAnswer` into lease-claim + early `pending` insert + shared `runGeneration`; finalize via attempt-scoped `UPDATE` instead of `INSERT`; add `retryAnswer` |
| Modify | `src/lib/generation/streamAnswer.integration.test.ts` | Update assertions for update-in-place persistence; add pending-row and lease-busy cases |
| Test   | `src/lib/generation/retryAnswer.integration.test.ts` | Retry re-runs in place, rejects retrying a non-failed message |
| Modify | `src/app/api/notebooks/[notebookId]/messages/route.ts` | Return 409 on `NotebookBusyError`; map stale `pending` → `failed` on GET |
| Create | `src/app/api/notebooks/[notebookId]/messages/[messageId]/retry/route.ts` | POST endpoint streaming `retryAnswer` the same way `messages/route.ts` streams `streamAnswer` |
| Modify | `src/components/chat/chat-panel.tsx` | Render `failed` messages with a Retry button; support in-place streaming for a retrying message |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | Extract shared ndjson-stream consumption; wire `handleRetry` |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx` | Test: failed message shows Retry, clicking it re-streams and replaces content in place |

---

## Task 1: Migration + generation lease helper

**Files:** `supabase/migrations/20260914200000_generation_lease.sql`, `src/lib/generation/lease.ts`, `src/lib/generation/lease.integration.test.ts`

- [ ] Write the migration:
  ```sql
  alter table public.notebooks
    add column active_attempt_id uuid,
    add column active_attempt_started_at timestamptz;

  alter table public.messages
    add column attempt_id uuid;

  alter table public.messages drop constraint messages_status_check;
  alter table public.messages add constraint messages_status_check
    check (status in ('pending', 'complete', 'refused', 'failed'));
  ```
- [ ] Write `src/lib/generation/lease.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';

  export const LEASE_TIMEOUT_SECONDS = 90;

  export class NotebookBusyError extends Error {
    constructor() {
      super('A generation is already in progress for this notebook.');
      this.name = 'NotebookBusyError';
    }
  }

  export async function claimGenerationLease(
    supabase: SupabaseClient,
    notebookId: string,
  ): Promise<string> {
    const attemptId = crypto.randomUUID();
    const staleBefore = new Date(Date.now() - LEASE_TIMEOUT_SECONDS * 1000).toISOString();
    const { data, error } = await supabase
      .from('notebooks')
      .update({
        active_attempt_id: attemptId,
        active_attempt_started_at: new Date().toISOString(),
      })
      .eq('id', notebookId)
      .or(`active_attempt_id.is.null,active_attempt_started_at.lt.${staleBefore}`)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new NotebookBusyError();
    return attemptId;
  }

  export async function releaseGenerationLease(
    supabase: SupabaseClient,
    notebookId: string,
    attemptId: string,
  ): Promise<void> {
    await supabase
      .from('notebooks')
      .update({ active_attempt_id: null, active_attempt_started_at: null })
      .eq('id', notebookId)
      .eq('active_attempt_id', attemptId);
  }
  ```
- [ ] Write `src/lib/generation/lease.integration.test.ts` (follow the `hasRealEnv`-gated pattern from `streamAnswer.integration.test.ts`, using `createPrimaryTestClient`):
  ```ts
  it('claims an idle lease, rejects a second claim, and allows a stale one to be reclaimed', async () => {
    const attempt1 = await claimGenerationLease(user, notebook.id);
    await expect(claimGenerationLease(user, notebook.id)).rejects.toThrow(NotebookBusyError);

    // simulate an old, abandoned lease
    await user
      .from('notebooks')
      .update({ active_attempt_started_at: new Date(Date.now() - 200_000).toISOString() })
      .eq('id', notebook.id);
    const attempt2 = await claimGenerationLease(user, notebook.id);
    expect(attempt2).not.toBe(attempt1);

    await releaseGenerationLease(user, notebook.id, attempt2);
    const { data } = await user.from('notebooks').select('active_attempt_id').eq('id', notebook.id).single();
    expect(data?.active_attempt_id).toBeNull();
  });
  ```
- [ ] Run `npx supabase db push` (or confirm migration applies in whatever way this repo verifies migrations — check `supabase/config.toml` / CI for the expected flow) and `npx vitest run src/lib/generation/lease.integration.test.ts`
- [ ] Commit: `git commit -m "feat: add per-notebook generation lease"`

## Task 2: Restructure `streamAnswer` around the lease and an early pending row

**Files:** `src/lib/generation/index.ts`, `src/lib/generation/streamAnswer.integration.test.ts`

- [ ] Refactor `src/lib/generation/index.ts`:
  - Rename the current body of `streamAnswer` (from after the user-message insert through the final `yield { type: 'done', ... }`) into a private `async function* runGeneration(supabase, { notebookId, question, sourceIds, messageId, attemptId })`.
  - Replace the two `persistRefusal`/completion `INSERT`s inside it with `UPDATE`s scoped to `.eq('id', messageId).eq('attempt_id', attemptId)`, returning the same `AskQuestionResult` shape (rename `persistRefusal` to `finalizeAsRefused` and add `finalizeAsComplete`).
  - Wrap the body of `runGeneration` in `try { ... } catch (err) { ... }`: on catch, `UPDATE messages SET status='failed', content=$generated, reasoning=$reasoning WHERE id=$messageId AND attempt_id=$attemptId`, then `yield { type: 'error', message: 'Failed to generate an answer' }` (do not rethrow — the caller's `finally` still needs to run).
  - New `streamAnswer`:
    ```ts
    export async function* streamAnswer(
      supabase: SupabaseClient,
      { notebookId, question, sourceIds }: AskQuestionParams,
    ): AsyncGenerator<AskQuestionEvent> {
      const attemptId = await claimGenerationLease(supabase, notebookId);
      try {
        const { error: userMessageError } = await supabase
          .from('messages')
          .insert({ notebook_id: notebookId, role: 'user', content: question, status: 'complete' });
        if (userMessageError) throw userMessageError;

        const { data: pending, error: pendingError } = await supabase
          .from('messages')
          .insert({
            notebook_id: notebookId,
            role: 'assistant',
            content: '',
            status: 'pending',
            attempt_id: attemptId,
            selected_source_ids: sourceIds ?? [],
          })
          .select('id')
          .single();
        if (pendingError) throw pendingError;

        yield* runGeneration(supabase, { notebookId, question, sourceIds, messageId: pending.id, attemptId });
      } finally {
        await releaseGenerationLease(supabase, notebookId, attemptId);
      }
    }
    ```
  - Note: `selected_source_ids` is now stored on the pending row at creation time (not just on the final complete row) so retry can read it back even from a `failed` row.
- [ ] Update `streamAnswer.integration.test.ts`: the existing assertions on `done.result` and the persisted row's `status`/`reasoning` should still pass unchanged since `AskQuestionResult` shape is preserved. Add two new cases in the same file:
  - After starting a `streamAnswer` iteration and consuming only up to the `'passages'` event (don't drain fully), query `messages` for the notebook and assert a row with `status: 'pending'` exists.
  - Call `streamAnswer` and, before draining it, call it a second time for the same notebook and assert the second call's first `.next()` rejects/throws `NotebookBusyError` (drain the first to completion afterward so the lease is released and `afterAll` cleanup isn't blocked).
- [ ] Run `npx vitest run src/lib/generation/streamAnswer.integration.test.ts` (requires real env vars; if unavailable in this environment, at minimum run `npm run typecheck` and `npm run test` to confirm nothing else broke and the skip-gate still applies)
- [ ] Commit: `git commit -m "feat: persist chat answers as a pending row from the start of generation"`

## Task 3: Retry an incomplete answer

**Files:** `src/lib/generation/index.ts`, `src/app/api/notebooks/[notebookId]/messages/[messageId]/retry/route.ts`, `src/lib/generation/retryAnswer.integration.test.ts`

- [ ] Add `retryAnswer` to `src/lib/generation/index.ts`:
  ```ts
  export async function* retryAnswer(
    supabase: SupabaseClient,
    { notebookId, messageId }: { notebookId: string; messageId: string },
  ): AsyncGenerator<AskQuestionEvent> {
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, status, selected_source_ids, created_at')
      .eq('id', messageId)
      .eq('notebook_id', notebookId)
      .eq('role', 'assistant')
      .single();
    if (messageError) throw messageError;
    if (message.status !== 'failed') {
      throw new Error('Only a failed message can be retried');
    }

    const { data: questionMessage, error: questionError } = await supabase
      .from('messages')
      .select('content')
      .eq('notebook_id', notebookId)
      .eq('role', 'user')
      .lt('created_at', message.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (questionError) throw questionError;

    const attemptId = await claimGenerationLease(supabase, notebookId);
    try {
      const { error: resetError } = await supabase
        .from('messages')
        .update({ status: 'pending', content: '', reasoning: '', attempt_id: attemptId, follow_up_questions: null })
        .eq('id', messageId);
      if (resetError) throw resetError;

      yield* runGeneration(supabase, {
        notebookId,
        question: questionMessage.content,
        sourceIds: message.selected_source_ids?.length ? message.selected_source_ids : undefined,
        messageId,
        attemptId,
      });
    } finally {
      await releaseGenerationLease(supabase, notebookId, attemptId);
    }
  }
  ```
- [ ] Write `src/app/api/notebooks/[notebookId]/messages/[messageId]/retry/route.ts`, mirroring `messages/route.ts`'s `POST` (auth check, ndjson stream, `retryAnswer` instead of `streamAnswer`, catch `NotebookBusyError` → 409):
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { createClient } from '@/lib/supabase/server';
  import { retryAnswer, type AskQuestionEvent } from '@/lib/generation';
  import { NotebookBusyError } from '@/lib/generation/lease';

  export const maxDuration = 60;

  export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ notebookId: string; messageId: string }> },
  ) {
    const { notebookId, messageId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let generator: AsyncGenerator<AskQuestionEvent>;
    try {
      generator = retryAnswer(supabase, { notebookId, messageId });
    } catch (error) {
      if (error instanceof NotebookBusyError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        function send(event: AskQuestionEvent) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        }
        try {
          for await (const event of generator) send(event);
        } catch (error) {
          if (error instanceof NotebookBusyError) {
            send({ type: 'error', message: error.message });
          } else {
            console.error('retryAnswer failed', { notebookId, messageId, error });
            send({ type: 'error', message: 'Failed to generate an answer' });
          }
        } finally {
          controller.close();
        }
      },
    });
    return new NextResponse(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  ```
  - Note: `retryAnswer` is an async generator, so calling it doesn't execute anything (or throw `NotebookBusyError`) until the first `.next()` — the `try/catch` around the direct call above won't actually catch the busy error. Move the busy-error handling into the `for await` catch block only (drop the outer try/catch around the generator construction) and rely on the `finally`/catch inside the stream `start()`.
- [ ] Write `src/lib/generation/retryAnswer.integration.test.ts` (same `hasRealEnv` gating and notebook/source/chunks setup as `streamAnswer.integration.test.ts`):
  - Manually insert a `messages` row with `role: 'assistant', status: 'failed', selected_source_ids: []` preceded by a `role: 'user'` row with a real question, then call `retryAnswer` and assert it drains to a `'done'` event with `status: 'complete'` and that the **same** `messageId` was updated (no new row created).
  - Assert calling `retryAnswer` on a `status: 'complete'` message throws.
- [ ] Run `npx vitest run src/lib/generation/retryAnswer.integration.test.ts` and `npm run typecheck`
- [ ] Commit: `git commit -m "feat: add retry endpoint for failed chat answers"`

## Task 4: Surface lease-busy and stale-pending on the messages route

**Files:** `src/app/api/notebooks/[notebookId]/messages/route.ts`

- [ ] In `POST`, catch `NotebookBusyError` the same way as the retry route (busy error can currently only surface once `streamAnswer` starts executing inside the `for await`, since it's a generator — same note as Task 3 applies here too). Update the existing `catch (error)` block:
  ```ts
  } catch (error) {
    if (error instanceof NotebookBusyError) {
      send({ type: 'error', message: error.message });
    } else {
      console.error('streamAnswer failed', { notebookId, error });
      send({ type: 'error', message: 'Failed to generate an answer' });
    }
  }
  ```
- [ ] In `GET`, after fetching `messages`, map any row with `status === 'pending'` to `status: 'failed'` in the response payload (a fresh page load can never be watching an actively-streaming generation, so a `pending` row it sees is necessarily abandoned):
  ```ts
  const withCitations = await Promise.all(
    (messages ?? []).map(async (message) => ({
      ...message,
      status: message.status === 'pending' ? 'failed' : message.status,
      citations: message.role === 'assistant' ? await resolveCitations(supabase, message.id) : [],
      reasoning: message.role === 'assistant' ? message.reasoning : null,
    })),
  );
  ```
- [ ] Run `npm run typecheck`
- [ ] Commit: `git commit -m "fix: surface generation-lease conflicts and stale pending answers over the messages API"`

## Task 5: Retry UI

**Files:** `src/components/chat/chat-panel.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx`

- [ ] In `chat-panel.tsx`, add props `retryingMessageId: string | null` and `onRetry: (messageId: string) => void`. In the assistant message branch: when `message.status === 'failed'`, render whatever `content`/`reasoning` is present plus a `data-testid="retry-answer"` `Button` calling `onRetry(message.id)`; when `retryingMessageId === message.id`, render `streaming.reasoning`/`streaming.answer` in place of the stored content (same `ThoughtsPanel`/`AnswerText` used for the bottom "asking" indicator) instead of the failed state. Only show the bottom "asking" indicator li when `asking && !retryingMessageId`.
- [ ] In `notebook-workspace.tsx`:
  - Extract the ndjson-reading `while (true) { ... }` loop out of `submitQuestion` into a shared `async function consumeAnswerStream(response: Response): Promise<boolean>` returning whether an error event was seen, updating `streaming` via the existing `setStreaming` calls (unchanged logic, just factored out).
  - Add `const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);`
  - Add `async function handleRetry(messageId: string)`: guards on `asking`, sets `asking(true)`, `setRetryingMessageId(messageId)`, `setStreaming({ reasoning: '', answer: '', citations: [] })`, `fetch` `POST /api/notebooks/${notebookId}/messages/${messageId}/retry`, run `consumeAnswerStream`, then `await refreshMessages()` in all cases (success or error, so the row's final persisted status — `complete`/`refused`/`failed` — is reflected), `finally` resets `asking`/`streaming`/`retryingMessageId`.
  - Pass `retryingMessageId` and `handleRetry` down to both `ChatPanel` instances (desktop pane + mobile tab).
- [ ] Add a test to `notebook-workspace.test.tsx`: seed `GET /messages` with one `failed` assistant message, assert a "Retry" button renders, click it, assert a `POST .../retry` request fires and (via a `streamResponse` fixture ending in a `'done'` event with `status: 'complete'`) the message re-renders without the Retry button after `refreshMessages` re-fetches.
- [ ] Run `npx vitest run src/app/notebooks/[notebookId]/notebook-workspace.test.tsx src/components/chat/chat-panel.test.tsx` (create `chat-panel.test.tsx` only if one doesn't already exist and a quick check shows it's warranted; otherwise cover the behavior via the workspace test) and `npm run test`
- [ ] Commit: `git commit -m "feat: show retry action for interrupted chat answers"`

---

## Self-review

- **Task count:** 5 — within limit.
- **Coverage:** lease (Task 1) → pending-row + attempt-scoped finalize (Task 2) → retry (Task 3) → API surfacing of busy/stale (Task 4) → UI (Task 5). Matches every item in the design brief's success criteria.
- **Placeholders:** none left as TBD; the one open judgment call (busy-error can only be observed once the generator's `for await` starts, not at construction) is called out explicitly with the fix in both Task 3 and Task 4 rather than left ambiguous.
- **Type consistency:** `AskQuestionEvent`/`AskQuestionResult` unchanged across `streamAnswer` and `retryAnswer`; `runGeneration`'s signature (`{ notebookId, question, sourceIds, messageId, attemptId }`) is used identically by both callers.

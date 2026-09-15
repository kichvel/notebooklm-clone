# Design Brief — Generation Lease & Retryable Incomplete Answers

**Goal:** An interrupted chat answer (dropped connection, server crash, provider error, or serverless timeout) leaves a visible, retryable message instead of silently vanishing, and only one answer can generate per notebook at a time.

**Date:** 2026-09-14

## Shared understanding

Right now `streamAnswer` only writes the assistant message row after generation fully finishes, so any interruption leaves no trace — the client just deletes its optimistic bubble and shows a generic error. We're changing this so a `pending` message row is created immediately when generation starts (before retrieval), and is updated in place to `complete`, `refused`, or `failed` depending on outcome, with partial answer/reasoning text preserved on `failed`. A server-side lease on the notebook (not just the client's `asking` flag) ensures only one generation runs at a time, reclaimable after a timeout so a crashed attempt can't lock the notebook forever. Failed messages get a Retry button that re-runs generation in place, protected against late/stale attempts overwriting newer results.

This is scenario-driven primarily by lost answers (interruption), with concurrency-locking as a secondary but real requirement — not an exhaustive race-condition audit.

## Key decisions

- Lease lives on `notebooks`: `active_attempt_id uuid`, `active_attempt_started_at timestamptz`, claimed via an atomic conditional `UPDATE ... WHERE active_attempt_id IS NULL OR active_attempt_started_at < now() - interval` (reclaim window covers `maxDuration=60s` plus buffer, e.g. 90s).
- `messages` gets `attempt_id uuid` and a new `pending` status value (reusing the already-declared-but-unused `failed` status for the interrupted/incomplete state — it's already in the DB check constraint and the client `Message` type, just never produced).
- The assistant row is inserted as `pending` immediately after the user's question is persisted, before rewrite/embed/search/generate — so any failure in retrieval or generation is captured, not just generation-stream failures.
- Final write is an attempt-scoped `UPDATE ... WHERE id = $messageId AND attempt_id = $currentAttempt` (compare-and-swap), never an insert — this is what prevents a late-finishing stale attempt from clobbering a newer completed/failed/retried result.
- Lease is released in a `finally` block on every code path (success, refusal, thrown error).
- A concurrent request while a fresh (non-stale) lease is held is rejected with a clear error (409-style); the client surfaces this inline.
- No background reconciliation job: a `pending` row read back on a fresh page load is treated as `failed` for display purposes only (nothing is actively streaming to a freshly-loaded client, so `pending` in that context can only mean an abandoned attempt).
- Retry re-runs generation against the *existing* row (same message id), not a new message — found via the preceding user message and the row's stored `selected_source_ids`.

## Constraints

- No changes to Langfuse, usage limits, or DEVELOPMENT.md — deferred to their own work.
- No changes to the notebook-overview one-shot behavior (already settled separately).
- Keep the existing refusal path (`status: 'refused'`) semantically unchanged — it's a successful grounded outcome, not a failure.

## Out of scope

- Any retry/backoff automation (no auto-retry-on-failure loop) — retry is a manual, explicit user action.
- A background job to reconcile stuck `pending` rows in the database; staleness is only resolved at lease-claim time and at read/display time.
- Multi-notebook or global rate limiting (that's the deferred "usage limits" work).
- A dedicated `question_message_id` FK — retry locates the paired question via ordering (`role='user'` immediately preceding the assistant row), relying on the lease already serializing generations per notebook.

## Success criteria

- Killing the server (or throwing) mid-stream leaves a `messages` row with status `failed` and whatever partial `content`/`reasoning` had accumulated — not nothing.
- A second `POST .../messages` call while a fresh lease is held is rejected without starting a duplicate generation.
- A lease from a crashed attempt (past the timeout window) can be reclaimed by a subsequent request.
- Clicking Retry on a `failed` message re-streams into the same message id and ends in `complete`, `refused`, or `failed` again — never a duplicate message.
- A stale, superseded attempt's late completion can never overwrite a message that a retry has already moved past `pending`.
- `chat-panel.tsx` visibly distinguishes `failed` messages and offers a working Retry action.

## Expected files touched

- `supabase/migrations/<new>_generation_lease_and_incomplete_messages.sql` — lease columns on `notebooks`, `attempt_id` + `pending` status on `messages`
- `src/lib/generation/index.ts` — lease claim/release, early `pending` insert, attempt-scoped final update, partial-content capture on error
- `src/lib/notebooks/index.ts` (or new `src/lib/generation/lease.ts`) — lease claim/release helpers
- `src/app/api/notebooks/[notebookId]/messages/route.ts` — surface lease-busy rejection, map stale `pending` to `failed` on GET
- `src/app/api/notebooks/[notebookId]/messages/[messageId]/retry/route.ts` (new) — retry endpoint
- `src/components/chat/chat-panel.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — render `failed` state + Retry button, wire retry streaming

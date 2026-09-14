# Design Brief — Streamed Answers with Reasoning ("Thoughts") Panel

**Goal:** Chat answers stream live (per ADR-008) with a persisted, collapsible "Thoughts" reasoning transcript, and follow-up questions correctly use recent conversation context.

**Date:** 2026-09-14

## Shared understanding

Today `/api/notebooks/[notebookId]/messages` is one blocking request: embed → vector search →
single non-streaming `gpt-4.1` completion → persist. This caused the original Gateway Timeout bug
and gives no feedback while the user waits. We're moving to a real NDJSON stream from a
reasoning-capable model that emits both reasoning-summary text and answer text as it generates.
The reasoning transcript is shown as a plain streamed prose block (no fabricated NotebookLM-style
titled step cards — that would require a multi-step agent loop, which is explicitly out of scope),
collapses once the answer completes, and is persisted so it's still visible after a page reload.
Separately, a bounded window of recent chat history is used to rewrite dependent follow-up
questions ("what about the other one?") into standalone retrieval queries before embedding.

## Key decisions

- Transport is hand-rolled NDJSON (one JSON object per line) over a streamed `Response`, not SSE —
  no `EventSource` (can't send our POST body anyway) and no new parsing dependency.
- Reasoning model runs via OpenAI's Responses API (`stream: true`, `reasoning: { summary: 'auto' }`),
  added as a new function in `src/lib/providers/openai.ts` alongside the existing `generate()` (kept
  for `notebookIntro.ts`'s short title/summary generation, which doesn't need reasoning or streaming).
  Concrete reasoning model id is picked/verified against current OpenAI docs at implementation time.
- Citation candidates (`passages`) are sent as the first NDJSON line, right after retrieval and
  before generation starts — the valid passage set is fixed at that point, so `[n]` citation buttons
  can go live the instant a matching number streams by, without waiting for stream completion.
- End-of-stream validation/persistence (refusal detection, citation resolution, message + citation
  row inserts) reuses the same logic `askQuestion()` has today, just triggered on stream completion
  instead of after one blocking call.
- Query rewriting uses the existing fast/cheap model (`GENERATION_MODEL`, not the reasoning model),
  is skipped entirely on a notebook's first question, and never appears in the Thoughts panel — it's
  an internal retrieval-only step.
- No server-side generation lease/concurrency guard in this round (explicitly cut — see Out of scope).

## Constraints

- Every answer gets slower and costs more per call (reasoning model, always on) — accepted, because
  streaming means it won't be *perceived* as slow.
- Stay behind the existing small provider interface in `src/lib/providers/openai.ts` per ADR-006 —
  no direct OpenAI SDK calls from route or generation code.
- Keep `src/lib/generation/`, `src/lib/retrieval/`, `src/lib/providers/` as separate small modules per
  the existing architecture boundary — don't collapse streaming/rewriting logic into the route file.

## Out of scope

- Multi-step agentic tool-use loop / code execution / discrete titled reasoning steps (NotebookLM's
  literal screenshot UX) — Thoughts is one continuous streamed prose block.
- Server-side single-generation lease/lease-expiry/stale-reclaim protocol for concurrent generation
  guarding — cut for this round; usage pattern (single anonymous identity, effectively one active tab)
  makes the race low-probability, and it's separable follow-up hardening, not user-visible UX.
- Any change to `notebookIntro.ts`'s title/summary generation — stays on the existing non-streaming
  `generate()` path.

## Success criteria

- Asking a question streams live reasoning prose into an open collapsible box, which auto-collapses
  once the answer is fully streamed and validated.
- Reloading the page after an answer completes still shows its Thoughts transcript (collapsed).
- Citation buttons (`[n]`) become clickable the moment a valid reference number streams in, not only
  after the full answer finishes.
- The answer is only marked `complete` (and citations persisted) after full-response validation;
  an interrupted/invalid stream stays visibly incomplete and is retryable, per ADR-008.
- A dependent follow-up question (e.g. after asking about one source, "what about the other one?")
  retrieves using a standalone query rewritten from recent conversation context, not the literal
  dependent phrasing.
- Existing non-streaming behaviors (refusal text, follow-up chip suggestions, source selection
  filtering) are unchanged in outcome, just delivered via the stream.

## Expected files touched

- `src/lib/providers/openai.ts` — new streaming reasoning-generation function; existing `generate()`
  untouched for `notebookIntro.ts`.
- `src/lib/generation/index.ts` — `askQuestion()` restructured to drive/consume the stream and persist
  at the end; new `rewriteFollowUpQuery()` (new file, e.g. `src/lib/generation/rewriteQuery.ts`).
- `src/app/api/notebooks/[notebookId]/messages/route.ts` — POST returns an NDJSON stream instead of
  one JSON response; GET now also returns `reasoning` for assistant messages.
- `supabase/migrations/` — new migration: `messages.reasoning text null`.
- `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — `submitQuestion` parses the NDJSON stream
  and drives transient streaming state.
- `src/components/chat/chat-panel.tsx` — renders the transient streaming state; wires in `ThoughtsPanel`.
- `src/components/chat/thoughts-panel.tsx` (new) — collapsible reasoning transcript, used both live and
  for historical replay from `message.reasoning`.
- Existing tests updated: `chat-panel.test.tsx`; new tests for the NDJSON route, streaming provider
  function, and query rewriting.

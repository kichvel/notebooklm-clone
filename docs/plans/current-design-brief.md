# Design Brief — Per-source intro generation, chat UX, and Studio framing

**Goal:** Replace the one-shot, never-updating, whole-notebook intro with a per-source intro paragraph generated whenever a source finishes ingesting (including long after notebook creation), and reuse each source's summary as framing context for Studio's flashcard/quiz generation.
**Date:** 2026-09-15

## Shared understanding
Today, `src/lib/generation/notebookIntro.ts` generates one title + one summary for the *whole notebook*, exactly once, gated by `notebooks.intro_generated_at` — later source additions never regenerate or extend it. It samples only the first 3 chunks per source (capped at 6000 chars total across the notebook), which produces summaries too shallow to give Studio's chunk-level flashcard/quiz generation any real document context (root cause of awkward questions like "Which programming languages are mentioned in the passage?"). We're splitting this into two independent one-shot-per-source and one-shot-per-notebook mechanisms: (1) every time a source reaches `ready`, generate a self-contained intro paragraph for *that source*, built from an evenly-spread sample across its *entire* chunk range (not just the start) so it actually represents the whole document, capped at a per-source character budget — a cheap representative sample, not full-document map-reduce coverage. That intro is inserted into the notebook's chat as its own message as soon as it's ready. Sources added/finishing together generate their intros in parallel and each lands in chat independently as it completes; the chat input stays blocked with a visible "generating…" indicator until every intro currently in flight is done. (2) Notebook title generation is fully decoupled — it stays the existing one-shot mechanism, gated by `notebooks.intro_generated_at`, firing once when the notebook's original first batch of sources all reach a terminal state, but no longer produces a summary or message. (3) Each source's persisted summary becomes framing context in Studio's flashcard/quiz prompts (`src/lib/generation/studio.ts`) — context only, never citable; every generated item still must cite a real passage, mirroring how conversation history is already treated in chat (ADR-005-style: aids interpretation, never a fact source).

## Key decisions
- New migration: `sources.intro_summary text`, `sources.intro_generated_at timestamptz` (per-source one-shot guard, same claim pattern as the existing notebook-level column: atomic `.update(...).is('intro_generated_at', null)`), and `messages.source_id uuid references sources(id) on delete set null` (nullable — regular chat messages have none; `set null` so an intro message survives its source being deleted later, matching the existing "deleting a source preserves prior answers" rule).
- `notebookIntro.ts` stripped to title-only generation; no message insert, no summary, no follow-ups. Trigger condition (all of the *original* batch reaching terminal state) is unchanged.
- New `src/lib/generation/sourceIntro.ts`: `maybeGenerateSourceIntro(supabase, sourceId)` — only for sources that reach `ready` (a `failed` source gets no intro, matching ADR-007's existing "no retry path" trade-off). Samples chunks at evenly-spaced indices across the source's full `chunk_index` range (not just the first N), joined up to a fixed per-source character budget, then one summary call ("clearly explain what this document is about") + `generateFollowUps` (reused as-is) + a `messages` insert with `source_id` set.
- Triggered from `src/lib/ingestion/index.ts`'s per-source finalize step (alongside the existing, now title-only, notebook call) — not from the `onFailure` path, since only `ready` sources get intros.
- Client polling (`notebook-workspace.tsx`) widens its "keep polling" condition to also cover "a ready source has no `intro_generated_at` yet," fixing a latent bug where polling could stop right before an in-flight intro lands, and doubling as the signal that drives the new blocking indicator.
- Chat input blocking reuses the existing `asking`/"Thinking…" pattern in `chat-panel.tsx` structurally, but as a distinct state/label (e.g. "Summarizing new sources…") so the two are visually distinguishable; it does not block on ingestion itself, only on "ready but intro not yet generated."
- `studio.ts`'s `selectNextPassage` fetches the passage's owning source's `intro_summary` alongside its existing title/type/origin_url lookup and threads it into the flashcard/quiz generation prompt as explicitly non-citable framing text; a missing/null summary (not yet generated, or generation failed) degrades gracefully — Studio generation is never blocked waiting on it.

## Constraints
- Summaries are framing context only, never citable evidence (mirrors ADR-005 and the existing conversation-history-is-context-not-evidence rule).
- OpenAI calls only through `src/lib/providers/` (ADR-006).
- An intro message must survive its source's later deletion, consistent with the existing citation/answer-preservation rule for source deletion.

## Out of scope
- Full-document map-reduce summarization for arbitrarily long sources (capped representative sample instead).
- Regenerating/updating an intro after it's first generated for a source.
- Any change to chat's own answer-generation grounding or citation mechanics beyond the new blocking state.

## Success criteria
- Adding a source to a notebook — the first ever, or the Nth after lots of prior chat — produces its own intro chat message once ingestion finishes, built from a sample spanning the whole document.
- Adding multiple sources together produces multiple intros landing independently as each completes; chat input stays disabled with a visible indicator until all are done.
- Notebook title is generated exactly once, from the original first batch, independent of per-source intro timing/content.
- Flashcard/quiz prompts include the owning source's summary as context; every generated item still carries a real passage citation, never the summary.
- Deleting a source leaves its intro message intact in chat history.

## Expected files touched
- `supabase/migrations/<new>.sql` — `sources.intro_summary`, `sources.intro_generated_at`, `messages.source_id`
- `src/lib/generation/notebookIntro.ts` — strip to title-only
- `src/lib/generation/sourceIntro.ts` (new) — per-source intro generation
- `src/lib/ingestion/index.ts` — call the new per-source intro generation from the finalize step
- `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — widen polling condition; compute/pass a "generating intros" blocking state
- `src/components/chat/chat-panel.tsx` — distinct blocking indicator for intro generation vs. answer generation
- `src/lib/generation/studio.ts` — thread `intro_summary` into flashcard/quiz prompts as framing context
- Relevant API routes/types that surface `sources` rows to the client — expose `intro_generated_at` (or a derived pending flag)

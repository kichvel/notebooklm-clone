# Design Brief — Notebook Intro (Auto-Title + First Chat Summary)

**Goal:** Once the sources a user first adds to a notebook finish ingesting, automatically rename the notebook and post an assistant chat message summarizing what's in it — so the user has something useful to see instead of a blank chat.

**Date:** 2026-09-13

## Shared understanding

Today a new notebook stays "Untitled notebook" and the chat is empty until the user manually asks a question. This feature makes the notebook name itself and post a short synthesized summary as the first chat message, once — right after the initial batch of sources a user adds finishes processing (reaches `ready` or `failed`), and only if at least one of them is `ready`. This is a lightweight, one-shot synthesis (reusing the same "sample chunks, one `generate()` call" pattern as the existing per-source title step), not the larger unbuilt ARCHITECTURE.md §7 overview (no per-source cached summaries, no topics/suggested-questions, no revision tracking). It never fires again after the first time, even as more sources are added or removed later.

**Blocking bug found and fixed as part of this work:** no code path today ever sets `sources.status = 'failed'` — a source that throws mid-ingestion gets stuck at `processing` forever, even though the `failed` status, `failure_reason` column, and the retry endpoint all already assume it's reachable. Since this feature's trigger depends on every source reaching a terminal state, an `onFailure` handler is added to the `ingestSource` Inngest function to set `status = 'failed'` once retries are exhausted.

## Key decisions

- New `notebooks.intro_generated_at timestamptz` column: null until the one-time intro is generated. Doubles as the "already done" flag and the write-once race guard.
- New `maybeGenerateNotebookIntro(supabase, notebookId)` in `src/lib/generation/notebookIntro.ts`: no-ops unless `intro_generated_at` is null, every non-deleted source is terminal (`ready`/`failed`), and at least one is `ready`. Samples a few chunks from each ready source, makes two `generate()` calls (title, then a short 2–4 sentence summary) via the existing OpenAI provider (per ADR-006), then does an atomic `UPDATE notebooks SET title=…, intro_generated_at=now() WHERE id=… AND intro_generated_at IS NULL` — a 0-row result means another concurrent run already won, so the result is discarded; a win inserts one `assistant` message (no citations) with the summary.
- Called as a final step from `ingestSource` (`src/lib/ingestion/index.ts`) on both the normal success path and from the new `onFailure` handler, so it's re-checked whenever any source in the notebook settles.
- Errors from generation are caught and swallowed (never fail the triggering source's own ingestion), matching the existing per-source title step's non-fatal pattern.
- Frontend (`notebook-workspace.tsx`) currently fetches notebook title and messages once on mount only. Extend the existing 2s polling effect to also refresh notebook title and messages while sources are processing, and for a short grace window after (while there are ready sources but no messages yet and the title is still the default), so the generated name/summary appear live.

## Constraints

- No new summary/overview tables or revision tracking — stays scoped to a single title + single chat message, generated once.
- Generation must go through the existing provider abstraction (`src/lib/providers/openai.ts`), never call the OpenAI SDK directly.
- Must not change per-source ingestion semantics other than adding the trailing check and fixing the failure-status gap.

## Out of scope

- The full ARCHITECTURE.md §7 notebook overview (per-source cached summaries, topics with suggested questions, staleness/revision handling, regeneration on later source add/delete).
- Re-titling or re-summarizing after the first successful batch, ever.
- A dedicated "summary failed" chat message when every initial source fails — the notebook just stays untitled/empty and becomes eligible again once a later source succeeds.

## Success criteria

- Adding one or more sources to a brand-new notebook and waiting for them to finish ingesting results in: the notebook title changing from "Untitled notebook" to a generated name, and one assistant message appearing in the chat summarizing the sources — without a manual page reload.
- If every source in that first batch fails, the notebook stays untitled and the chat stays empty; if a later source succeeds, the intro is generated then instead.
- Adding more sources after the intro has already been generated once never renames the notebook or posts another summary message again.
- A source that throws during ingestion now reaches `status = 'failed'` with a `failure_reason` (previously it stayed stuck at `processing` indefinitely).
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass.

## Expected files touched

- `supabase/migrations/` (new) — add `notebooks.intro_generated_at timestamptz`
- `src/lib/generation/notebookIntro.ts` (new) — `maybeGenerateNotebookIntro()`
- `src/lib/ingestion/index.ts` — add `onFailure` handler (sets `status='failed'`) and a trailing `notebook-intro` step
- `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — extend polling to refresh title + messages

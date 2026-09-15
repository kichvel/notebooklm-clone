# Design Brief — Studio: remove Study Guide, make Flashcards & Quiz real

**Goal:** Drop the redundant Study Guide feature; make Flashcards and Quiz generate real, grounded, cited content on demand instead of static fixture data.
**Date:** 2026-09-15

## Shared understanding
All three Studio features (`src/components/studio/generation-output.tsx`) are currently pure UI stubs: hardcoded fixture data behind a fake 1s loading spinner, no generation logic, no API route, no Inngest job, no DB schema (confirmed via full-repo survey — `docs/PRODUCT.md` itself says generation logic is "planned but not yet implemented"). Study Guide duplicates the existing notebook overview and isn't worth building; it's removed outright. Flashcards and Quiz become a real feature: clicking the card starts streaming the first item, generated from the notebook's currently-selected ready sources (same selection semantics chat already uses), grounded in retrieved passages with a citation back to source. The user pulls "next" to generate further items indefinitely, one at a time, on demand — not a pre-batched set. The server tracks which source passages have already been used in the session and excludes them from subsequent retrieval, so items don't repeat concepts; when no new groundable passages remain, generation stops and says so explicitly rather than fabricating or repeating. Quiz is multiple-choice only, with instant right/wrong feedback per question and the source passage shown when the user answers wrong. Nothing is persisted — every session is generated fresh in memory/client state, unlike the notebook overview's cached/revisioned model.

## Key decisions
- Study Guide is deleted: `StudyGuideOutput`, its `FeatureCard` entry, and the `'study_guide'` member of the `StudioFeature` type.
- New generation module alongside `src/lib/generation/` (e.g. `src/lib/generation/studio.ts`) reusing `src/lib/retrieval` for passage search and the existing provider interface (`src/lib/providers/`, per ADR-006 — never call the OpenAI SDK directly) for grounded content generation. No new domain module folder — this is a generation flavor, not a new entity type.
- No new database tables/migrations — results are ephemeral, matching the "regenerate on demand, don't persist" decision.
- New streaming API routes (mirroring `src/app/api/notebooks/[notebookId]/messages/route.ts`'s NDJSON streaming pattern), one per feature or one parameterized route, e.g. `src/app/api/notebooks/[notebookId]/studio/flashcards/route.ts` and `.../studio/quiz/route.ts`. Each "next" pull is a fresh request; request body carries the selected source IDs and the list of already-used passage/chunk IDs from the client session so the server can exclude them from retrieval.
- Retrieval must support excluding a given set of chunk IDs from search results (small addition to `src/lib/retrieval` or filtering in the new studio module).
- Grounding rule (ADR-005) applies: if retrieval turns up no new ungrounded-yet passages, the route returns an explicit "exhausted" event/state instead of generating anything — client renders a stop message, not an error.
- Quiz generation produces one question, 3-4 options, and the correct option index, plus the citation for the correct answer; client shows the citation only after the user answers incorrectly.
- Session state (used passage IDs, current card/question) lives in client-side React state within the Studio panel components, scoped per feature (flashcards and quiz track separately) and reset when the notebook, selected sources, or active feature changes.

## Constraints
- Grounding rule (ADR-005): content only from retrieved passages of selected, ready sources; explicit stop instead of fabricating when material is exhausted.
- OpenAI calls only through `src/lib/providers/` (ADR-006).
- Existing `src/lib/generation/`, `src/lib/retrieval/`, `src/lib/citations/` module boundaries preserved — reuse, don't duplicate, their patterns.
- Source selection semantics must match chat's existing "selected + ready" concept exactly.

## Out of scope
- Any persistence/history of generated flashcard or quiz sessions.
- Configurable batch size, difficulty, or non-multiple-choice quiz formats.
- Changes to the notebook overview or chat generation themselves (only their patterns are reused).

## Success criteria
- Study Guide card, component, and type member no longer exist anywhere in the codebase.
- Clicking Flashcards or Quiz streams a real, source-grounded first item with a working citation — no fixture data remains in `generation-output.tsx`.
- Pulling "next" repeatedly generates further distinct items without repeating already-used source passages, until material is exhausted, at which point the UI shows an explicit stop message.
- Quiz gives instant per-question right/wrong feedback and shows the source passage when the answer is wrong.
- Deselecting a source or switching notebooks changes what subsequent generations draw from, consistent with chat's existing selection behavior.

## Expected files touched
- `src/components/studio/generation-output.tsx` — remove Study Guide + fixture data; replace Flashcards/Quiz with real streaming, pull-based, session-tracked UI
- `src/components/studio/studio-panel.tsx` — remove Study Guide `FeatureCard`; wire session reset on source-selection/notebook change
- `src/components/studio/studio-panel.test.tsx` — rewrite stub-based tests for real behavior
- `src/lib/generation/studio.ts` (new) — grounded flashcard/quiz item generation, passage-exclusion-aware
- `src/lib/retrieval/` — support excluding already-used chunk IDs from search
- `src/app/api/notebooks/[notebookId]/studio/flashcards/route.ts` (new) — streaming pull-based flashcard generation endpoint
- `src/app/api/notebooks/[notebookId]/studio/quiz/route.ts` (new) — streaming pull-based quiz generation endpoint

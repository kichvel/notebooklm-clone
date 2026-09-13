# Design Brief — Inngest Ingestion Workflow Shape

**Goal:** Prove the Inngest ingestion pipeline's mechanics (steps, checkpoints, real side effects) for real, scoped to the simplest source type, so the Day 1–3 vertical slice has a working ingestion workflow shape to extend with real parsers.
**Date:** 2026-09-13

## Shared understanding

A real Inngest function (`ingest-source`, triggered by `sourcebook/source.ingest.requested` with just a `sourceId`) implements the five-step pipeline from `ARCHITECTURE.md` §6 — parse, normalize, chunk, embed, finalize — scoped to `pasted_text` sources only. "Parse" downloads a real text blob from the `sources` Storage bucket (the test does a minimal real upload first). "Embed" makes real `embed()` calls before inserting real `source_chunks` rows. Each step also writes a real `processing_steps` row (upsert, incrementing `attempts`). The function re-derives everything from the source row via the service client rather than trusting the event payload beyond the ID, matching the "background handlers use privileged access but verify state themselves" principle (ARCHITECTURE §5).

**Revised after checking the actual `@inngest/test` package:** its own README states retries are not modelled — "any step or function that fails once will fail permanently" — so a cross-attempt retry proof (mock a step to fail once, succeed on a second call, assert memoized steps don't re-run) is not achievable with this library. Descoped accordingly: this slice proves the step *shape* — one real, successful `execute()` run through all five steps with genuine DB/Storage/OpenAI side effects, ending with `sources.status = 'ready'` and real `source_chunks` rows. It does not attempt to prove Inngest's own retry mechanism (that's the platform's job, not this codebase's); the one thing within our control — throwing plain (retriable) errors rather than `NonRetriableError` for transient step failures — is what the code should get right, per `docs/ARCHITECTURE.md` §6 and Inngest's `NonRetriableError`/default-retry conventions.

## Key decisions

- `src/lib/ingestion/index.ts` exports `ingestSource = inngest.createFunction({ id: 'ingest-source' }, { event: 'sourcebook/source.ingest.requested' }, ...)` with five `step.run()` calls: parse, normalize, chunk, embed, finalize
- Registered in `src/app/api/inngest/route.ts`'s `functions` array
- Each step upserts a `processing_steps` row (`source_id`, `step`, `status`, incrementing `attempts`) via the service client — background jobs have no user session, so service-role access is correct here, but the function must independently verify the source exists before acting
- "Chunk" is a naive split (paragraph or fixed-size), in-memory only — no real chunking algorithm work
- Verification uses `@inngest/test`'s `InngestTestEngine.execute()` for a single successful end-to-end run through all five steps, asserting the real DB/Storage/embedding side effects landed correctly
- No retry-loop test — out of scope per the finding above

## Constraints

- No local Postgres/Docker, no live Next.js/Inngest Dev Server processes — `@inngest/test` runs the function in-process
- Real Supabase/OpenAI calls throughout, consistent with prior prep slices

## Out of scope

- PDF/DOCX/website parsing (real adapters)
- Proving Inngest's own retry/checkpoint mechanism (not achievable with `@inngest/test`; trusted as a platform guarantee)
- The permanent-failure path (exhausted retries → `sources.status = 'failed'`)
- Actually running this over a live Next.js server + Inngest Dev Server
- Notebook overview regeneration
- Any UI
- The vertical slice itself

## Success criteria

- `ingestSource` runs to completion via `@inngest/test`'s `execute()`, ending with `sources.status = 'ready'` and the expected `source_chunks` rows present, each `processing_steps` row `status = 'succeeded'`
- Test cleans up its own rows (notebook cascade)
- `npm run typecheck`, `npm run lint` still pass

## Expected files touched

- `src/lib/ingestion/index.ts` — the Inngest function
- `src/app/api/inngest/route.ts` — register the function
- `package.json` — add `@inngest/test` dev dependency (already installed in this worktree)
- `src/lib/ingestion/ingestSource.test.ts` — real end-to-end test of one successful run

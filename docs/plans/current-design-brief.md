# Design Brief — Retrieval Query (pgvector Search)

**Goal:** Close the embed/store/retrieve loop with a real, filtered pgvector similarity search over `source_chunks`, so the Day 1–3 vertical slice has a working retrieval primitive to build chat on top of.
**Date:** 2026-09-13

## Shared understanding

Following the foundational-plumbing prep (schema, RLS, storage, real `embed()`), this slice proves out the other half of the retrieval pipeline: a `search()` function that runs a real pgvector cosine-similarity query over `source_chunks`, filtered to a given notebook, an optional set of selected source IDs, and only sources with `status = 'ready'` — matching the "embeddings excluded from retrieval until finalization succeeds" rule from `ARCHITECTURE.md` §6/§8. It's implemented as a Postgres SQL function (PostgREST can't order by a vector-distance expression directly) called through an RLS-enforcing client, so ownership isolation holds even if calling code has a bug. It's verified end-to-end for real: embed a few genuinely distinct text chunks via the already-built `embed()` function, run a real semantic query, and confirm the right chunk ranks first while a non-ready source's chunks never appear.

## Key decisions

- New Postgres function `match_source_chunks(query_embedding, match_notebook_id, match_source_ids, match_count)` — joins `source_chunks` → `sources`, filters `status = 'ready'` and `deleted_at is null`, optionally restricts to given source IDs, orders by `embedding <=> query_embedding` (cosine distance)
- Function is plain SQL (not `security definer`), so it runs with the caller's privileges and existing RLS on `source_chunks`/`sources` still applies
- Applied via `mcp__supabase__apply_migration` against project `btwvjtlvcbumxbfsqaal` (CLI still not linked in this environment), with the matching `.sql` file committed under `supabase/migrations/`
- `src/lib/retrieval/index.ts` exports `search(client, { notebookId, sourceIds?, queryEmbedding, matchCount? })`, wrapping `client.rpc('match_source_chunks', ...)` — takes the Supabase client as a parameter so callers control auth context (always an RLS-enforcing client, never service-role, per ARCHITECTURE §5)
- Verification is a real integration test: sign in anonymously, create a notebook with one `ready` source and one `processing` source, embed a few semantically distinct chunks for real via `embed()`, run a real query through `search()`, assert correct semantic ranking and that the `processing` source's chunk never appears, clean up via the service client in `afterAll` (same pattern as the existing RLS isolation test)

## Constraints

- No local Postgres/Docker — verified against the real remote Supabase project, same as the prior prep slice
- RLS must remain the enforcement mechanism; the retrieval function must not bypass it

## Out of scope

- Query embedding/rewriting logic (turning a chat question into a retrieval query)
- The Inngest ingestion pipeline
- Any UI or chat/generation logic
- The vertical slice itself

## Success criteria

- `match_source_chunks` applies cleanly to the real remote project
- Integration test passes: the semantically closest real chunk ranks first, the `processing` source's chunk is excluded, and the test cleans up its own rows
- `npm run typecheck`, `npm run lint` still pass

## Expected files touched

- `supabase/migrations/<timestamp>_match_source_chunks.sql` — the SQL function + grants
- `src/lib/retrieval/index.ts` — `search()` implementation
- `src/lib/retrieval/search.integration.test.ts` — real end-to-end test

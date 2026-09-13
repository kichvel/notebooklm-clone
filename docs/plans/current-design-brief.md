# Design Brief — Foundational Plumbing (Schema, RLS, Storage, Providers)

**Goal:** Stand up the real database schema, RLS isolation, storage bucket, and a working OpenAI embeddings call, so the Day 1–3 vertical slice has real infrastructure to build on instead of empty placeholders.
**Date:** 2026-09-13

## Shared understanding

Before attempting the full Days 1–3 vertical slice (notebook → upload → process → ask → cite), we're preparing its foundational plumbing in isolation: the subset of the data model the slice actually needs (`notebooks`, `sources`, `processing_steps`, `source_chunks`), Row-Level Security policies enforcing per-anonymous-user ownership, a private Storage bucket for uploaded files, and a real (not stubbed) OpenAI `embed()` function. This runs against the user's already-provisioned remote Supabase project (anonymous sign-ins already enabled, real keys already in `.env`) — there is no local Postgres/Docker stack. Everything is verified with automated tests before moving on to the vertical slice itself.

## Key decisions

- Migration creates exactly 4 tables: `notebooks`, `sources`, `processing_steps`, `source_chunks` — the other 4 entities in ARCHITECTURE.md §4 (`source_summary`, `notebook_overview`, `message`, `message_citation`) are deferred until the features that need them are built
- `source_chunks.embedding` is `vector(1536)` — locking in `text-embedding-3-small` now since changing embedding dimensions later requires re-embedding/migration
- RLS on all 4 tables scopes access to the owning anonymous `auth.uid()` (directly on `notebooks.owner_id`, transitively via notebook ownership for child tables)
- Storage: one private bucket named `sources`, objects pathed `notebook_id/source_id/filename`, with storage RLS mirroring table ownership
- `src/lib/providers/openai.ts` gets a real, working `embed(text: string): Promise<number[]>` using the OpenAI SDK — `generate()`/chat completions stays deferred to the vertical slice
- All schema/storage changes go through versioned `supabase/migrations/*.sql` applied via `supabase db push` against the real remote project (no local dev DB)
- Fix the stale `project_id = "project-scaffold"` leftover in `supabase/config.toml` while touching Supabase config
- Two automated tests verify this work:
  - `src/lib/providers/openai.test.ts` — calls real `embed()`, skipped via `describe.skipIf` when `OPENAI_API_KEY` is absent (so CI's placeholder env doesn't fail)
  - An RLS integration test — creates two anonymous Supabase sessions, has each create a notebook, asserts neither can read/update/delete the other's, cleans up both notebooks in `afterAll`
- Add `dotenv` as a dev dependency and load `.env` in `vitest.setup.ts` so these two tests get real credentials locally (Vitest doesn't auto-load `.env` the way Next.js does)

## Constraints

- No local Postgres/Docker — all schema and RLS work is verified against the real remote Supabase project
- Embedding dimension (1536, `text-embedding-3-small`) is being locked in now; changing it later is a migration, not a config change

## Out of scope

- `generate()` / chat completions
- `source_summary`, `notebook_overview`, `message`, `message_citation` tables
- Inngest workflow functions (ingestion pipeline logic)
- Any UI
- PDF parsing/chunking logic
- The vertical slice itself (notebook creation UI, upload flow, chat, citations)

## Success criteria

- `supabase db push` applies cleanly against the real remote project, creating `notebooks`, `sources`, `processing_steps`, `source_chunks` with `pgvector` enabled
- RLS integration test passes: two anonymous sessions are isolated from each other's notebooks, and the test cleans up its own rows
- `openai.test.ts` calls real OpenAI and gets back a 1536-length vector when `OPENAI_API_KEY` is set; skips cleanly in CI where it isn't
- `npm run typecheck`, `npm run lint`, `npm run build` all still pass
- `supabase/config.toml` no longer references `project-scaffold`

## Expected files touched

- `supabase/migrations/<timestamp>_foundational_schema.sql` — tables, RLS policies, storage bucket + policies, `vector` extension
- `supabase/config.toml` — fix stale `project_id`
- `src/lib/providers/openai.ts` — real `embed()` implementation
- `src/lib/providers/openai.test.ts` — real-call test, skips without API key
- `src/lib/supabase/rls.integration.test.ts` (or similar) — ownership isolation test
- `vitest.setup.ts` — load `.env` via `dotenv`
- `package.json` — add `dotenv` dev dependency

# Design Brief — Vertical Slice (Days 1–3)

**Goal:** An anonymous visitor creates a notebook, adds a pasted-text source, watches it process via the real Inngest pipeline, asks a question, and gets a grounded answer with a clickable citation that opens the supporting passage — running locally against real Supabase/OpenAI, with ownership isolation.
**Date:** 2026-09-13

## Shared understanding

This is the first end-to-end vertical slice, built on top of three already-merged prep slices: the schema/RLS/storage/provider plumbing, the RLS-enforcing retrieval query, and the real Inngest ingestion workflow (pasted_text only). This slice wires those pieces together with two new domain modules (`generation`, `citations`), two new tables (`messages`, `message_citations`), a handful of API routes, and minimal UI. Everything uses real Supabase/OpenAI calls, consistent with every prep slice so far.

Deliberate scope cuts from the full architecture spec (`docs/ARCHITECTURE.md` §8), confirmed with the user:
- No PDF parsing yet — pasted_text only (PDF adapter is a fast-follow).
- No deployment — local (`npm run dev`) only.
- No real token streaming — synchronous request/response; answer + citations render once complete.
- No "one generation per notebook" concurrency guard — deferred; no concurrent-generation risk with a single manual tester yet.
- No conversation-history query rewriting — each question is embedded and answered independently, not rewritten against prior turns.
- No source-selection UI — retrieval automatically uses all of the notebook's `ready` sources.
- No notebook overview/synthesis (that's Days 4–5), no source deletion, no usage limits.

## Key decisions

- New migration: `messages` (notebook_id, role, content, status, selected_source_ids, attempt_id, timestamps, error/model metadata) and `message_citations` (message_id, source_id, chunk_id, display metadata, passage locator, availability status), RLS mirroring the existing ownership-via-notebook-join pattern.
- `src/lib/providers/openai.ts` gains `generate()` — a chat completion call behind the existing provider interface (ADR-006), model `gpt-4o-mini`.
- `src/lib/generation/index.ts` — `askQuestion(supabase, { notebookId, question })`: embeds the question, retrieves via the existing `retrieval.search()` scoped to the notebook's `ready` sources, calls `generate()` with a strict grounding prompt restricted to retrieved passages only, validates any model citation references against the actual retrieved chunk ID set, persists the message + citations, and returns a structured result (answer text + citations, or an explicit insufficient-evidence refusal). Takes the RLS-enforcing client as a parameter, same principle as `retrieval.search()`.
- `src/lib/citations/index.ts` — resolves a persisted `message_citations` row to its passage text and locator (source title + chunk index/section, per the DOCX/TXT/pasted-text row of the ARCHITECTURE §9 table) for the side panel.
- API routes (Next.js App Router, real Supabase session-based auth, ownership checked server-side — client-provided IDs are never trusted):
  - `POST /api/notebooks` — create notebook for the current owner.
  - `POST /api/notebooks/[notebookId]/sources` — upload pasted text to Storage, insert `sources` row, send the real `sourcebook/source.ingest.requested` Inngest event.
  - `GET /api/notebooks/[notebookId]/sources` — list sources with status, for polling.
  - `POST /api/notebooks/[notebookId]/messages` — ask a question via `generation.askQuestion()`.
  - `GET /api/notebooks/[notebookId]/messages` — list chat history with citations.
- UI: a "new notebook" landing action; a notebook workspace page with a paste-text form and a polling source-status list; a chat panel (ask/answer) with a citation side panel showing the resolved passage. Verify whether anonymous-auth bootstrap already exists in the scaffold before adding it.
- Manual end-to-end verification of the full flow requires `npx inngest-cli dev` running alongside `npm run dev` (ingestion's own correctness is already proven by the prep-slice-3 automated test); automated tests for this slice do not depend on a running Inngest Dev Server.

## Constraints

- Real Supabase/OpenAI calls throughout, consistent with prior prep slices; tests clean up after themselves.
- RLS-enforcing clients for all user-facing operations; service-role only where background/privileged access is architecturally required.
- No local Postgres/Docker; migrations applied via Supabase MCP tools.

## Out of scope

- PDF/DOCX/website adapters, Vercel deployment, real token streaming, the generation concurrency guard, conversation-aware query rewriting, source-selection checkboxes, notebook overview/synthesis, source deletion, usage limits, DOCX/TXT/URL ingestion.

## Success criteria

- A real, running local flow: create notebook → add pasted-text source → source reaches `ready` (via `npx inngest-cli dev`) → ask a question → receive a grounded answer with at least one valid, clickable citation → citation panel shows the correct supporting passage.
- An unrelated/unanswerable question produces an explicit refusal, not a fabricated answer.
- Ownership isolation holds: a second anonymous identity cannot read another's notebook, sources, messages, or citations (automated integration test, cleans up after itself).
- `npm run typecheck`, `npm run lint`, `npm run test` all pass.

## Expected files touched

- `supabase/migrations/<ts>_messages_and_citations.sql` — new tables + RLS
- `src/lib/providers/openai.ts` — add `generate()`
- `src/lib/generation/index.ts`, `src/lib/generation/*.test.ts`
- `src/lib/citations/index.ts`, `src/lib/citations/*.test.ts`
- `src/app/api/notebooks/route.ts`
- `src/app/api/notebooks/[notebookId]/sources/route.ts`
- `src/app/api/notebooks/[notebookId]/messages/route.ts`
- `src/app/notebooks/[notebookId]/page.tsx` and supporting client components
- `src/app/page.tsx` (or existing landing) — new-notebook action

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

Sourcebook is a source-grounded AI knowledge workspace (a NotebookLM-style product): users upload sources (PDF, DOCX, TXT, pasted text, one public URL) into a notebook, get an auto-generated overview, and ask questions that are answered strictly from retrieved passages with inspectable citations — never from general model knowledge.

The full product/architecture spec lives in `docs/`:

- `docs/PRODUCT.md` — product definition, user journey, MVP scope, non-goals
- `docs/ARCHITECTURE.md` — system design, data model, ingestion/retrieval/citation pipelines
- `docs/DECISIONS.md` — ADRs explaining _why_ (grounding rules, streaming, revisioning, etc.)
- `docs/ROADMAP.md` — delivery plan

**Current state: the MVP is implemented.** All `src/lib/*` domain modules (`notebooks/`, `sources/`, `ingestion/`, `retrieval/`, `generation/`, `citations/`, `providers/`, `abuse-prevention/`) have working implementations wired to the real Supabase/Inngest/OpenAI stack, not placeholders. The one exception is `src/lib/observability/`, which is an intentional empty stub — Langfuse is cut from this submission (see below); the module boundary is kept in place for future wiring. Read `docs/ARCHITECTURE.md` for the design rationale before changing a module's behavior.

## Commands

```bash
npm install            # install dependencies
npm run dev             # start dev server (http://localhost:3000)
npm run build           # production build
npm run lint            # ESLint
npm run format          # Prettier — write
npm run format:check    # Prettier — check only
npm run typecheck       # runs `next typegen` then `tsc --noEmit`
npm run test            # Vitest, unit/integration
npm run test:e2e        # Playwright, end-to-end
```

Run a single test:

```bash
npx vitest run src/app/page.test.tsx   # single Vitest file
npx vitest run -t "test name"           # by test name
npx playwright test e2e/smoke.spec.ts    # single Playwright file
```

`npm run typecheck` must run `next typegen` before `tsc` — Next.js's App Router generates types (e.g. `LayoutProps`) into the gitignored `.next/types/`, and a bare `tsc --noEmit` fails on a fresh checkout without them. Do not simplify this script back to plain `tsc --noEmit`.

Supabase CLI (migrations only; the JS client always points at the remote project — there is no local dev database):

```bash
npx supabase login
npx supabase link
npx supabase migration new <name>
npx supabase db push
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on push/PR with placeholder Supabase env vars, since no real service calls happen at build time.

## Architecture

**Stack and responsibilities** (see `docs/ARCHITECTURE.md` §2 for full detail):

- Next.js (App Router) + TypeScript on Vercel — UI, API routes, streaming chat, Inngest handlers
- Supabase Auth — persistent anonymous browser identity
- Supabase Postgres + pgvector — authoritative data, job progress, embeddings, citations
- Private Supabase Storage — original files and extracted snapshots
- Inngest — durable background ingestion workflows (one per source, retriable steps)
- OpenAI — embeddings, generation, summaries (behind a small provider interface, per ADR-006 — never call the OpenAI SDK directly from application code)
- Langfuse — AI observability; **cut from this submission** (metadata-first design retained in `docs/DECISIONS.md` ADR-010 for future implementation)

**Domain module boundaries** (`src/lib/`): notebook/source operations, ingestion, retrieval, generation, and citation resolution are kept as separate small server-side modules (`notebooks/`, `sources/`, `ingestion/`, `retrieval/`, `generation/`, `citations/`, plus `providers/` for the OpenAI interface and `observability/` reserved for Langfuse, currently an empty stub). UI components should consume this application state rather than re-implementing retrieval or permission logic. This separation is a deliberate architectural boundary (`docs/ARCHITECTURE.md` §3), not incidental structure — keep new code inside the module matching its responsibility.

**Non-negotiable product rules to preserve when implementing features** (see `docs/DECISIONS.md` for rationale):

- Answers must be grounded only in retrieved passages from selected, ready sources; insufficient evidence means an explicit refusal, never a fallback to general model knowledge (ADR-005).
- Deselecting a source affects future questions only; existing answers keep the source context they were generated with. Deleting a source excludes it from retrieval but preserves prior answers, marking affected citations unavailable (`docs/PRODUCT.md`, `docs/ARCHITECTURE.md` §9–10).
- Row-level security and server-side ownership checks isolate all notebook/source/storage data per anonymous identity; client-provided IDs are never treated as proof of access (`docs/ARCHITECTURE.md` §5).
- Ingestion is one durable, independently retriable Inngest workflow per source with observable steps (parse → normalize → chunk → embed → finalize); embeddings are excluded from retrieval until finalization succeeds (`docs/ARCHITECTURE.md` §6).
- The notebook overview regenerates on source add/delete (not on checkbox selection changes) and uses revision checks to avoid publishing stale results; a failed overview update preserves the previous one (`docs/ARCHITECTURE.md` §7, ADR-007).
- Streamed answers are only marked complete after their citations are validated against the retrieved passage set; interrupted/invalid responses stay visibly incomplete and retryable (`docs/ARCHITECTURE.md` §8, ADR-008).

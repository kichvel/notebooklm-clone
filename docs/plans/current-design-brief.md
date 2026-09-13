# Design Brief — Project Scaffold

**Goal:** Stand up a compiling, running, fully-wired-but-empty Sourcebook project skeleton so real feature work has a home.
**Date:** 2026-09-13

## Shared understanding

A bare-but-fully-wired Sourcebook project skeleton — Next.js (App Router) + TypeScript on npm, styled with Tailwind, with the Supabase JS client pointed at a remote project (no local DB), the Supabase CLI wired in just for migration management, an Inngest client/serve route registered with zero functions yet, and empty placeholder folders for OpenAI/Langfuse wiring. All external services are configured via a documented `.env.example` with placeholders — nothing connects until real keys are added later. Domain module boundaries from ARCHITECTURE.md are pre-created now as empty entry points; their logic is deferred.

## Key decisions

- npm as package manager; Next.js App Router; Tailwind CSS; `src/` directory layout
- Supabase: JS client only, pointed at a remote project via env vars; no local Docker/Postgres
- Supabase CLI included solely for migration scaffolding (`supabase/migrations/`), not local dev DB
- Inngest: client + `/api/inngest` serve route registered with an empty functions array
- OpenAI and Langfuse: empty placeholder directories only, no real client wiring
- Domain folders pre-created as empty placeholder entry points: `lib/notebooks/`, `lib/sources/`, `lib/ingestion/`, `lib/retrieval/`, `lib/generation/`, `lib/citations/`, `lib/providers/`, `lib/observability/`
- Testing set up now with trivial smoke tests: Vitest (unit/integration), Playwright (e2e)
- ESLint + Prettier configured; npm scripts for lint/typecheck/test/test:e2e/format
- GitHub Actions CI: install, lint, typecheck, unit test, build — runs on push/PR without real secrets

## Constraints

- Everything must compile and run: `npm run dev` shows a working default page; lint, typecheck, unit tests, and build all pass in CI using only placeholder env values
- No real feature logic, no real provider implementations, no real database schema content

## Out of scope

- Any actual feature code (notebooks, sources, chat, citations logic)
- Database schema / migration content (structure only, no tables yet)
- Provider interface design (EmbeddingProvider/GenerationProvider types etc.)
- Local Supabase Docker/dev stack
- The Day 1–3 vertical slice itself

## Success criteria

- `npm run dev` serves a default Next.js + Tailwind page with no errors
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all succeed
- `npx playwright test` runs a trivial smoke test successfully
- `.env.example` documents every required variable for Supabase, OpenAI, Inngest, and Langfuse
- All domain/provider placeholder folders exist with a minimal entry file each
- GitHub Actions CI workflow runs lint + typecheck + unit test + build on push/PR and passes
- `supabase/` CLI config and empty `migrations/` folder exist

## Expected files touched

- `package.json`, `tsconfig.json`, `next.config.*`, `tailwind.config.*`, `postcss.config.*` — project init
- `src/app/**` — default Next.js App Router pages/layout
- `src/lib/supabase/`, `src/lib/inngest/`, `src/lib/providers/`, `src/lib/observability/` — service wiring/placeholders
- `src/lib/notebooks/`, `src/lib/sources/`, `src/lib/ingestion/`, `src/lib/retrieval/`, `src/lib/generation/`, `src/lib/citations/` — domain placeholders
- `src/app/api/inngest/route.ts` — Inngest serve route
- `.env.example` — documented placeholder env vars
- `supabase/config.toml`, `supabase/migrations/` — CLI scaffold
- `vitest.config.ts`, `playwright.config.ts`, smoke tests — test infra
- `.eslintrc*`, `.prettierrc` — lint/format config
- `.github/workflows/ci.yml` — CI pipeline
- `README.md` — setup instructions

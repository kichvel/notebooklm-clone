# Sourcebook

A source-grounded AI knowledge workspace. See `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/DECISIONS.md` for the product definition, architecture, delivery plan, and design decisions.

## Getting started

**Prerequisites:** Node.js 24+ and npm.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template and fill in real credentials (Supabase, OpenAI, Inngest, Langfuse):
   ```bash
   cp .env.example .env.local
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command                                   | Purpose                                 |
| ----------------------------------------- | --------------------------------------- |
| `npm run dev`                             | Start the Next.js dev server            |
| `npm run build`                           | Production build                        |
| `npm run lint`                            | Lint with ESLint                        |
| `npm run format` / `npm run format:check` | Format / check formatting with Prettier |
| `npm run typecheck`                       | Type-check with `tsc --noEmit`          |
| `npm run test`                            | Run unit/integration tests (Vitest)     |
| `npm run test:e2e`                        | Run end-to-end tests (Playwright)       |

## Project structure

- `src/app/` — Next.js App Router pages and API routes (including the Inngest handler at `src/app/api/inngest/`)
- `src/lib/supabase/` — Supabase client wiring (browser + server)
- `src/lib/inngest/` — Inngest client
- `src/lib/providers/`, `src/lib/observability/` — placeholders for the OpenAI and Langfuse integrations
- `src/lib/notebooks/`, `src/lib/sources/`, `src/lib/ingestion/`, `src/lib/retrieval/`, `src/lib/generation/`, `src/lib/citations/` — domain module placeholders per `docs/ARCHITECTURE.md`
- `supabase/` — Supabase CLI config and migrations (`supabase/migrations/`)
- `e2e/` — Playwright end-to-end tests

This is currently a scaffold: the structure and wiring exist, but no feature logic has been implemented yet.

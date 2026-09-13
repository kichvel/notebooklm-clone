# Project Scaffold — Implementation Plan

**Goal:** Stand up a compiling, running, fully-wired-but-empty Sourcebook project skeleton (Next.js/TS/Tailwind, Supabase, Inngest, provider placeholders, testing, lint/format, CI) with no real feature logic.
**Branch:** worktree-project-scaffold
**Stack:** Next.js 15 (App Router) + TypeScript, Tailwind CSS, npm, Supabase (`@supabase/supabase-js` + CLI), Inngest, Vitest, Playwright, ESLint + Prettier, GitHub Actions

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs` | Project init via create-next-app |
| Create | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` | Default App Router shell |
| Modify | `.eslintrc.json` / `eslint.config.mjs` | Add Prettier integration |
| Create | `.prettierrc.json`, `.prettierignore` | Formatting config |
| Create | `vitest.config.ts`, `src/app/page.test.tsx` | Unit/integration test infra + smoke test |
| Create | `playwright.config.ts`, `e2e/smoke.spec.ts` | E2E test infra + smoke test |
| Create | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts` | Supabase JS client wiring (browser + server) |
| Create | `supabase/config.toml`, `supabase/migrations/.gitkeep` | Supabase CLI scaffold for migrations |
| Create | `src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts` | Inngest client + serve route, no functions |
| Create | `src/lib/providers/index.ts` | Empty OpenAI provider placeholder |
| Create | `src/lib/observability/index.ts` | Empty Langfuse placeholder |
| Create | `src/lib/notebooks/index.ts`, `src/lib/sources/index.ts`, `src/lib/ingestion/index.ts`, `src/lib/retrieval/index.ts`, `src/lib/generation/index.ts`, `src/lib/citations/index.ts` | Domain module placeholders |
| Create | `.env.example` | Documented placeholder env vars for all services |
| Create | `.github/workflows/ci.yml` | CI: install, lint, typecheck, unit test, build |
| Modify | `README.md` | Setup instructions |

---

## Tasks

### Task 1: Initialize Next.js app

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/*`, `.gitignore`

- [ ] Run `create-next-app` into the current directory with the agreed options:
  ```bash
  npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
  ```
  (Answer prompts to install into the non-empty current directory if asked.)
- [ ] Verify dev server boots: `npm run build` succeeds with no errors
- [ ] Verify `.gitignore` from create-next-app is merged with the existing one (keep `node_modules`, `.next`, `.env*.local`, etc.) — reconcile manually if create-next-app overwrote the existing `.gitignore`
- [ ] Commit: `git commit -m "chore: initialize Next.js app with TypeScript and Tailwind"`

### Task 2: Lint and format tooling

**Files:** `.eslintrc.json` (or `eslint.config.mjs`), `.prettierrc.json`, `.prettierignore`, `package.json`

- [ ] Install Prettier and the ESLint/Prettier bridge:
  ```bash
  npm install -D prettier eslint-config-prettier
  ```
- [ ] Create `.prettierrc.json`:
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 100
  }
  ```
- [ ] Create `.prettierignore`:
  ```
  node_modules
  .next
  coverage
  playwright-report
  test-results
  ```
- [ ] Extend the ESLint config with `"prettier"` last in the `extends` array so formatting rules don't conflict
- [ ] Add npm scripts to `package.json`:
  ```json
  "scripts": {
    "lint": "next lint",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit"
  }
  ```
- [ ] Verify: `npm run lint` and `npm run format:check` and `npm run typecheck` all pass
- [ ] Commit: `git commit -m "chore: add Prettier and lint/typecheck scripts"`

### Task 3: Testing infrastructure (Vitest + Playwright)

**Files:** `vitest.config.ts`, `src/app/page.test.tsx`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `package.json`

- [ ] Install Vitest and React Testing Library:
  ```bash
  npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
  ```
- [ ] Create `vitest.config.ts`:
  ```ts
  import { defineConfig } from 'vitest/config';
  import react from '@vitejs/plugin-react';
  import path from 'node:path';

  export default defineConfig({
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    test: { environment: 'jsdom', globals: true },
  });
  ```
- [ ] Write a trivial smoke test `src/app/page.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react';
  import { describe, expect, it } from 'vitest';
  import Page from './page';

  describe('Home page', () => {
    it('renders without crashing', () => {
      render(<Page />);
      expect(screen.getByRole('main')).toBeInTheDocument();
    });
  });
  ```
  (Adjust the assertion to match whatever root element create-next-app's default page actually renders.)
- [ ] Add `"test": "vitest run"` to `package.json` scripts
- [ ] Run it — confirm it passes: `npm run test`
- [ ] Install Playwright: `npm install -D @playwright/test && npx playwright install --with-deps chromium`
- [ ] Create `playwright.config.ts`:
  ```ts
  import { defineConfig } from '@playwright/test';

  export default defineConfig({
    testDir: './e2e',
    webServer: {
      command: 'npm run build && npm run start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    use: { baseURL: 'http://localhost:3000' },
  });
  ```
- [ ] Write a trivial smoke test `e2e/smoke.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';

  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });
  ```
- [ ] Add `"test:e2e": "playwright test"` to `package.json` scripts
- [ ] Run it — confirm it passes: `npm run test:e2e`
- [ ] Commit: `git commit -m "test: add Vitest unit and Playwright e2e infrastructure"`

### Task 4: Supabase wiring (client + CLI migrations)

**Files:** `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `supabase/config.toml`, `supabase/migrations/.gitkeep`, `.env.example` (started here, completed in Task 5)

- [ ] Install the Supabase JS client and CLI:
  ```bash
  npm install @supabase/supabase-js
  npm install -D supabase
  ```
- [ ] Create `src/lib/supabase/client.ts` (browser client):
  ```ts
  import { createBrowserClient } from '@supabase/ssr';

  export function createClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  ```
  (Add `@supabase/ssr` to the install command above alongside `@supabase/supabase-js`.)
- [ ] Create `src/lib/supabase/server.ts` (server client using the service role key, server-only):
  ```ts
  import 'server-only';
  import { createClient as createSupabaseClient } from '@supabase/supabase-js';

  export function createServiceClient() {
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  ```
- [ ] Run `npx supabase init` to scaffold `supabase/config.toml`; create an empty `supabase/migrations/.gitkeep` so the folder is tracked
- [ ] Start `.env.example` with the Supabase vars:
  ```
  NEXT_PUBLIC_SUPABASE_URL=your-project-url
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  ```
- [ ] Verify: `npm run build` and `npm run typecheck` still pass with placeholder env vars (no real Supabase call happens at build time)
- [ ] Commit: `git commit -m "chore: wire up Supabase client and CLI migration scaffold"`

### Task 5: Inngest client/route + provider placeholders

**Files:** `src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts`, `src/lib/providers/index.ts`, `src/lib/observability/index.ts`, `.env.example`

- [ ] Install Inngest: `npm install inngest`
- [ ] Create `src/lib/inngest/client.ts`:
  ```ts
  import { Inngest } from 'inngest';

  export const inngest = new Inngest({ id: 'sourcebook' });
  ```
- [ ] Create `src/app/api/inngest/route.ts`:
  ```ts
  import { serve } from 'inngest/next';
  import { inngest } from '@/lib/inngest/client';

  export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [],
  });
  ```
- [ ] Create `src/lib/providers/index.ts` (empty placeholder, no real OpenAI wiring):
  ```ts
  // Provider interfaces (embedding/generation) are designed when ingestion/generation are built.
  export {};
  ```
- [ ] Create `src/lib/observability/index.ts` (empty placeholder, no real Langfuse wiring):
  ```ts
  // Langfuse tracing is wired when generation calls exist to observe.
  export {};
  ```
- [ ] Append the remaining vars to `.env.example`:
  ```
  OPENAI_API_KEY=your-openai-api-key
  INNGEST_EVENT_KEY=your-inngest-event-key
  INNGEST_SIGNING_KEY=your-inngest-signing-key
  LANGFUSE_PUBLIC_KEY=your-langfuse-public-key
  LANGFUSE_SECRET_KEY=your-langfuse-secret-key
  LANGFUSE_BASE_URL=https://cloud.langfuse.com
  ```
- [ ] Verify: `npm run build` and `npm run typecheck` pass
- [ ] Commit: `git commit -m "chore: wire up Inngest client/route and provider placeholders"`

### Task 6: Domain placeholders, CI, and README

**Files:** `src/lib/notebooks/index.ts`, `src/lib/sources/index.ts`, `src/lib/ingestion/index.ts`, `src/lib/retrieval/index.ts`, `src/lib/generation/index.ts`, `src/lib/citations/index.ts`, `.github/workflows/ci.yml`, `README.md`

- [ ] Create each domain placeholder with the same minimal shape, e.g. `src/lib/notebooks/index.ts`:
  ```ts
  // Notebook CRUD and ownership logic lives here once the schema is designed.
  export {};
  ```
  Repeat for `sources`, `ingestion`, `retrieval`, `generation`, `citations` with a domain-appropriate one-line comment each.
- [ ] Create `.github/workflows/ci.yml`:
  ```yaml
  name: CI

  on:
    push:
      branches: [main]
    pull_request:

  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci
        - run: npm run lint
        - run: npm run typecheck
        - run: npm run test
        - run: npm run build
          env:
            NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
            NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-anon-key
            SUPABASE_SERVICE_ROLE_KEY: placeholder-service-key
  ```
- [ ] Update `README.md` with a "Getting started" section: prerequisites (Node 20, npm), `cp .env.example .env.local` + fill in real keys, `npm install`, `npm run dev`, and how to run `npm run lint` / `npm run test` / `npm run test:e2e`
- [ ] Verify locally: `npm run lint && npm run typecheck && npm run test && npm run build` all succeed end-to-end
- [ ] Commit: `git commit -m "chore: add domain placeholders, CI workflow, and setup docs"`

---

## Self-review

1. **Task count:** 6 tasks — within the ≤7 limit.
2. **Coverage:** every success criterion in the design brief maps to a task — Next.js/Tailwind boot (Task 1), lint/typecheck (Task 2), Vitest + Playwright (Task 3), Supabase client + CLI migrations folder (Task 4), Inngest route + provider/observability placeholders + full `.env.example` (Task 5), domain placeholders + CI + README (Task 6).
3. **Placeholders:** no "TBD"/"similar to task N" — every task has concrete code or commands. The one open call-out (adjusting the Vitest smoke assertion to match create-next-app's actual default markup) is flagged explicitly as a to-verify step, not left vague.
4. **Type consistency:** `@/lib/inngest/client` import path matches the `@/*` alias configured in Task 1; Supabase env var names are consistent between `src/lib/supabase/*.ts`, `.env.example`, and the CI workflow's placeholder build env.

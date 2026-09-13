# Vertical Slice (Days 1–3) — Implementation Plan

**Goal:** An anonymous visitor creates a notebook, adds a pasted-text source, watches it reach `ready` via the real Inngest pipeline, asks a question, and gets a grounded answer with a clickable citation that opens the supporting passage — running locally against real Supabase/OpenAI, with ownership isolation.
**Branch:** `worktree-vertical-slice`
**Stack:** Next.js App Router, TypeScript, Supabase (Postgres/pgvector/Auth/Storage), Inngest, OpenAI, Vitest

Scope cuts confirmed with the user (see `docs/plans/current-design-brief.md`): pasted-text only, local only (no Vercel), synchronous (non-streamed) answers, no generation concurrency guard, no conversation-history query rewriting, no source-selection UI (retrieval uses all `ready` sources automatically).

**Testing note:** Following the existing pattern (`rls.integration.test.ts`, `search.integration.test.ts`, `ingestSource.test.ts`), automated tests exercise the `src/lib/*` domain modules directly with a real, signed-in anonymous Supabase client — not the Next.js HTTP route handlers. Route handlers use cookie-based SSR auth (`next/headers`) that isn't meaningfully testable under Vitest without heavier e2e infrastructure (out of scope for this slice, per `docs/ARCHITECTURE.md` §13's "End-to-end" tier being separate from "Integration"). Routes are thin wiring over the tested modules, verified by typecheck/lint plus manual browser testing in Phase 3.

---

## Files

| Action | Path                                                            | Purpose                                                                          |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Create | `supabase/migrations/20260913160000_messages_and_citations.sql` | `messages` + `message_citations` tables, RLS                                     |
| Test   | `src/lib/supabase/messages-rls.integration.test.ts`             | Ownership isolation for messages/citations                                       |
| Modify | `src/lib/providers/openai.ts`                                   | Add `generate()`                                                                 |
| Modify | `src/lib/providers/index.ts`                                    | Export `generate`                                                                |
| Modify | `src/lib/generation/index.ts`                                   | `askQuestion()` — retrieve, generate, validate citations, persist                |
| Modify | `src/lib/citations/index.ts`                                    | `resolveCitations()`                                                             |
| Test   | `src/lib/generation/askQuestion.integration.test.ts`            | Real grounded-answer + refusal paths                                             |
| Modify | `src/lib/supabase/server.ts`                                    | Add SSR-aware `createClient()` (RLS-enforcing, cookie-based)                     |
| Modify | `src/lib/notebooks/index.ts`                                    | `createNotebook()`                                                               |
| Modify | `src/lib/sources/index.ts`                                      | `createPastedTextSource()`                                                       |
| Test   | `src/lib/sources/createPastedTextSource.integration.test.ts`    | Creates source, runs it through `ingestSource` via `@inngest/test`, ends `ready` |
| Create | `src/app/api/notebooks/route.ts`                                | `POST` create notebook                                                           |
| Create | `src/app/api/notebooks/[notebookId]/sources/route.ts`           | `POST` add pasted-text source, `GET` list sources                                |
| Create | `src/app/api/notebooks/[notebookId]/messages/route.ts`          | `POST` ask question, `GET` chat history                                          |
| Create | `src/app/session-provider.tsx`                                  | Client component: anonymous sign-in bootstrap                                    |
| Modify | `src/app/layout.tsx`                                            | Wrap children in `SessionProvider`                                               |
| Modify | `src/app/page.tsx`                                              | "New notebook" landing action                                                    |
| Create | `src/app/notebooks/[notebookId]/page.tsx`                       | Thin server page                                                                 |
| Create | `src/app/notebooks/[notebookId]/notebook-workspace.tsx`         | Client component: source upload/status + chat + citation panel                   |

---

## Task 1: Chat data model

**Files:** `supabase/migrations/20260913160000_messages_and_citations.sql`, `src/lib/supabase/messages-rls.integration.test.ts`

- [ ] Apply migration via `mcp__supabase__apply_migration`:
  ```sql
  create table public.messages (
    id uuid primary key default gen_random_uuid(),
    notebook_id uuid not null references public.notebooks (id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    status text not null default 'complete' check (status in ('complete', 'refused', 'failed')),
    selected_source_ids uuid[] not null default '{}',
    created_at timestamptz not null default now()
  );

  create table public.message_citations (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references public.messages (id) on delete cascade,
    label integer not null,
    source_id uuid not null references public.sources (id) on delete cascade,
    chunk_id uuid references public.source_chunks (id) on delete set null,
    source_title text not null,
    chunk_index integer,
    page_number integer,
    section text,
    content_snapshot text not null,
    created_at timestamptz not null default now(),
    unique (message_id, label)
  );

  alter table public.messages enable row level security;
  alter table public.message_citations enable row level security;

  create policy "owner can manage own messages"
  on public.messages for all
  using (exists (select 1 from public.notebooks n where n.id = messages.notebook_id and n.owner_id = auth.uid()))
  with check (exists (select 1 from public.notebooks n where n.id = messages.notebook_id and n.owner_id = auth.uid()));

  create policy "owner can manage own message citations"
  on public.message_citations for all
  using (
    exists (
      select 1 from public.messages m join public.notebooks n on n.id = m.notebook_id
      where m.id = message_citations.message_id and n.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.messages m join public.notebooks n on n.id = m.notebook_id
      where m.id = message_citations.message_id and n.owner_id = auth.uid()
    )
  );
  ```
- [ ] Write `messages-rls.integration.test.ts` modeled directly on `rls.integration.test.ts`: user A creates a notebook + a message + a citation on it; assert user B cannot select/update/delete any of them via RLS; assert user A still sees them. Clean up via service client in `afterAll`.
- [ ] Run it — confirm it passes against the real project (schema-only task, no app code to fail first)
- [ ] `npm run typecheck && npm run lint`
- [ ] Commit: `git commit -m "feat: add messages and message_citations schema with RLS"`

## Task 2: Generation + citations modules

**Files:** `src/lib/providers/openai.ts`, `src/lib/providers/index.ts`, `src/lib/generation/index.ts`, `src/lib/citations/index.ts`, `src/lib/generation/askQuestion.integration.test.ts`

- [ ] Add to `src/lib/providers/openai.ts`:
  ```ts
  const GENERATION_MODEL = 'gpt-4o-mini';

  export async function generate({
    system,
    prompt,
  }: {
    system: string;
    prompt: string;
  }): Promise<string> {
    const response = await getClient().chat.completions.create({
      model: GENERATION_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });
    return response.choices[0]?.message?.content ?? '';
  }
  ```
- [ ] Export it from `src/lib/providers/index.ts`: `export { embed, generate } from './openai';`
- [ ] Implement `src/lib/citations/index.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';

  export interface ResolvedCitation {
    label: number;
    sourceId: string;
    sourceTitle: string;
    chunkIndex: number | null;
    pageNumber: number | null;
    section: string | null;
    content: string;
  }

  export async function resolveCitations(
    supabase: SupabaseClient,
    messageId: string,
  ): Promise<ResolvedCitation[]> {
    const { data, error } = await supabase
      .from('message_citations')
      .select('label, source_id, source_title, chunk_index, page_number, section, content_snapshot')
      .eq('message_id', messageId)
      .order('label');
    if (error) throw error;
    return (data ?? []).map((row) => ({
      label: row.label,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      section: row.section,
      content: row.content_snapshot,
    }));
  }
  ```
- [ ] Implement `src/lib/generation/index.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { embed, generate } from '@/lib/providers/openai';
  import { search } from '@/lib/retrieval';

  export const REFUSAL_TEXT =
    "I don't have enough information in the selected sources to answer that.";

  export interface AskQuestionParams {
    notebookId: string;
    question: string;
  }

  export interface Citation {
    label: number;
    sourceId: string;
    sourceTitle: string;
    chunkIndex: number | null;
    pageNumber: number | null;
    section: string | null;
    content: string;
  }

  export interface AskQuestionResult {
    messageId: string;
    status: 'complete' | 'refused';
    answer: string;
    citations: Citation[];
  }

  function buildSystemPrompt(passageCount: number): string {
    return [
      `You answer questions using ONLY the numbered passages below as evidence. Passages are numbered [1] through [${passageCount}].`,
      'Cite every factual claim with the passage number(s) it is drawn from, in square brackets, e.g. "Cats are mammals [1]."',
      'Never use knowledge outside the passages.',
      `If the passages do not contain enough information to answer, respond with exactly this text and nothing else: "${REFUSAL_TEXT}"`,
    ].join('\n');
  }

  async function persistRefusal(
    supabase: SupabaseClient,
    notebookId: string,
  ): Promise<AskQuestionResult> {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        notebook_id: notebookId,
        role: 'assistant',
        content: REFUSAL_TEXT,
        status: 'refused',
      })
      .select()
      .single();
    if (error) throw error;
    return { messageId: data.id, status: 'refused', answer: REFUSAL_TEXT, citations: [] };
  }

  export async function askQuestion(
    supabase: SupabaseClient,
    { notebookId, question }: AskQuestionParams,
  ): Promise<AskQuestionResult> {
    const { error: userMessageError } = await supabase
      .from('messages')
      .insert({ notebook_id: notebookId, role: 'user', content: question, status: 'complete' });
    if (userMessageError) throw userMessageError;

    const queryEmbedding = await embed(question);
    const results = await search(supabase, { notebookId, queryEmbedding, matchCount: 8 });
    if (results.length === 0) return persistRefusal(supabase, notebookId);

    const system = buildSystemPrompt(results.length);
    const passagesBlock = results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');
    const rawAnswer = (
      await generate({ system, prompt: `Passages:\n${passagesBlock}\n\nQuestion: ${question}` })
    ).trim();

    const validLabels = new Map<number, (typeof results)[number]>();
    for (const match of rawAnswer.matchAll(/\[(\d+)\]/g)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= results.length) validLabels.set(n, results[n - 1]);
    }
    if (rawAnswer === REFUSAL_TEXT || validLabels.size === 0)
      return persistRefusal(supabase, notebookId);

    const sourceIds = [...new Set([...validLabels.values()].map((r) => r.sourceId))];
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('id, title')
      .in('id', sourceIds);
    if (sourcesError) throw sourcesError;
    const titleById = new Map((sources ?? []).map((s) => [s.id as string, s.title as string]));

    const selectedSourceIds = [...new Set(results.map((r) => r.sourceId))];
    const { data: assistantMessage, error: messageError } = await supabase
      .from('messages')
      .insert({
        notebook_id: notebookId,
        role: 'assistant',
        content: rawAnswer,
        status: 'complete',
        selected_source_ids: selectedSourceIds,
      })
      .select()
      .single();
    if (messageError) throw messageError;

    const citationRows = [...validLabels.entries()].map(([label, r]) => ({
      message_id: assistantMessage.id,
      label,
      source_id: r.sourceId,
      chunk_id: r.chunkId,
      source_title: titleById.get(r.sourceId) ?? 'Untitled source',
      chunk_index: r.chunkIndex,
      page_number: r.pageNumber,
      section: r.section,
      content_snapshot: r.content,
    }));
    const { error: citationsError } = await supabase.from('message_citations').insert(citationRows);
    if (citationsError) throw citationsError;

    return {
      messageId: assistantMessage.id,
      status: 'complete',
      answer: rawAnswer,
      citations: citationRows.map((row) => ({
        label: row.label,
        sourceId: row.source_id,
        sourceTitle: row.source_title,
        chunkIndex: row.chunk_index,
        pageNumber: row.page_number,
        section: row.section,
        content: row.content_snapshot,
      })),
    };
  }
  ```
- [ ] Write `askQuestion.integration.test.ts` (`// @vitest-environment node`), following `search.integration.test.ts`'s pattern: signed-in anon user creates a notebook, a `ready` source, and real-embedded chunks about cats and airplanes directly (bypassing ingestion — retrieval correctness is already proven). Two real calls:
  - `askQuestion(user, { notebookId, question: 'What kind of animal is a domestic cat?' })` → assert `status === 'complete'`, `citations.length >= 1`, a citation's `content` contains `'cat'`, and a `messages`/`message_citations` row exists in the DB.
  - `askQuestion(user, { notebookId, question: 'What is the capital of France?' })` → assert `status === 'refused'`, `answer === REFUSAL_TEXT`, `citations` is empty.
    Clean up notebook (cascades) via service client in `afterAll`.
- [ ] Run it — confirm it fails first (functions are placeholders), then implement, then confirm it passes
- [ ] `npm run typecheck && npm run lint`
- [ ] Commit: `git commit -m "feat: add grounded generation and citation resolution"`

## Task 3: Notebook + source creation

**Files:** `src/lib/supabase/server.ts`, `src/lib/notebooks/index.ts`, `src/lib/sources/index.ts`, `src/lib/sources/createPastedTextSource.integration.test.ts`

- [ ] Add SSR-aware client to `src/lib/supabase/server.ts` (keep existing `createServiceClient` unchanged):
  ```ts
  import { createServerClient } from '@supabase/ssr';
  import { cookies } from 'next/headers';

  export async function createClient() {
    const cookieStore = await cookies();
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              );
            } catch {
              // called from a Server Component render; middleware refreshes sessions instead
            }
          },
        },
      },
    );
  }
  ```
- [ ] Implement `src/lib/notebooks/index.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';

  export async function createNotebook(supabase: SupabaseClient, title?: string) {
    const { data, error } = await supabase
      .from('notebooks')
      .insert(title ? { title } : {})
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  ```
- [ ] Implement `src/lib/sources/index.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { inngest } from '@/lib/inngest/client';

  export interface CreatePastedTextSourceParams {
    notebookId: string;
    title: string;
    text: string;
  }

  export async function createPastedTextSource(
    supabase: SupabaseClient,
    { notebookId, title, text }: CreatePastedTextSourceParams,
  ) {
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert({ notebook_id: notebookId, type: 'pasted_text', title })
      .select()
      .single();
    if (sourceError) throw sourceError;

    const storagePath = `${notebookId}/${source.id}/original.txt`;
    const { error: uploadError } = await supabase.storage
      .from('sources')
      .upload(storagePath, text, { contentType: 'text/plain' });
    if (uploadError) throw uploadError;

    const { data: updated, error: updateError } = await supabase
      .from('sources')
      .update({ storage_path: storagePath })
      .eq('id', source.id)
      .select()
      .single();
    if (updateError) throw updateError;

    await inngest.send({
      name: 'sourcebook/source.ingest.requested',
      data: { sourceId: source.id },
    });

    return updated;
  }
  ```
- [ ] Write `createPastedTextSource.integration.test.ts` (`// @vitest-environment node`), following `ingestSource.test.ts`'s pattern: signed-in anon user creates a notebook, calls `createPastedTextSource`, asserts the returned row has `status: 'uploaded'` and a `storage_path`; then runs `new InngestTestEngine({ function: ingestSource }).execute(...)` with that `sourceId` (same as prep-slice-3's test) to prove the full real path — module creates the source correctly enough for ingestion to actually succeed — ending in `status: 'ready'`. Clean up the notebook (cascade) and the uploaded storage object in `afterAll`.
- [ ] Run it — confirm it fails first, implement, confirm it passes
- [ ] `npm run typecheck && npm run lint`
- [ ] Commit: `git commit -m "feat: add notebook and pasted-text source creation"`

## Task 4: API routes

**Files:** `src/app/api/notebooks/route.ts`, `src/app/api/notebooks/[notebookId]/sources/route.ts`, `src/app/api/notebooks/[notebookId]/messages/route.ts`

- [ ] `src/app/api/notebooks/route.ts`:
  ```ts
  import { NextResponse } from 'next/server';
  import { createClient } from '@/lib/supabase/server';
  import { createNotebook } from '@/lib/notebooks';

  export async function POST() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const notebook = await createNotebook(supabase);
    return NextResponse.json(notebook, { status: 201 });
  }
  ```
- [ ] `src/app/api/notebooks/[notebookId]/sources/route.ts` — `POST` (validate `title`/`text` body, call `createPastedTextSource`) and `GET` (select `id, title, type, status, failure_reason, created_at` where `notebook_id` matches and `deleted_at is null`, ordered by `created_at`), both behind the same `auth.getUser()` 401 check as above.
- [ ] `src/app/api/notebooks/[notebookId]/messages/route.ts` — `POST` (validate `question` body, call `askQuestion`) and `GET` (select messages ordered by `created_at`, attach `resolveCitations()` for each assistant message), both behind the same 401 check.
- [ ] `npm run typecheck && npm run lint`
- [ ] Commit: `git commit -m "feat: add notebook, source, and message API routes"`

## Task 5: Auth bootstrap + notebook workspace UI

**Files:** `src/app/session-provider.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/notebooks/[notebookId]/page.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`

- [ ] `src/app/session-provider.tsx`:
  ```tsx
  'use client';
  import { useEffect } from 'react';
  import { createClient } from '@/lib/supabase/client';

  export function SessionProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
      const supabase = createClient();
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) supabase.auth.signInAnonymously();
      });
    }, []);
    return <>{children}</>;
  }
  ```
- [ ] Wrap `{children}` in `src/app/layout.tsx`'s `<body>` with `<SessionProvider>`
- [ ] Replace `src/app/page.tsx`'s starter content with a "New notebook" button that `POST`s `/api/notebooks` and `router.push`es to `/notebooks/[id]`
- [ ] `src/app/notebooks/[notebookId]/page.tsx` — thin server component reading `params.notebookId`, rendering `<NotebookWorkspace notebookId={notebookId} />`
- [ ] `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — client component: a textarea + title field + "Add source" button that `POST`s to `/sources`; a source list polling `GET /sources` every ~2s while any source is `uploaded`/`processing`, showing status badges
- [ ] `npm run typecheck && npm run lint`
- [ ] Manually verify in browser: `npm run dev` + `npx inngest-cli dev` in parallel, create a notebook, paste text, watch status reach `ready`
- [ ] Commit: `git commit -m "feat: add notebook creation and source upload UI"`

## Task 6: Chat UI

**Files:** `src/app/notebooks/[notebookId]/notebook-workspace.tsx` (extend)

- [ ] Extend `notebook-workspace.tsx` with: a message list (polling or refetching `GET /messages` after each send), an input + "Ask" button `POST`ing to `/messages`, rendering assistant answers with `[n]` markers replaced by clickable citation buttons (only for `n` present in that message's `citations`), and a side panel that opens on citation click showing `sourceTitle`, the locator (`chunk_index`/`page_number`/`section`), and `content`
- [ ] `npm run typecheck && npm run lint`
- [ ] Manually verify in browser: ask a question answerable from the pasted source, confirm a grounded answer with a working citation click-through; ask an unrelated question, confirm the explicit refusal renders (not a fabricated answer)
- [ ] Commit: `git commit -m "feat: add chat UI with citation side panel"`

---

## Self-review

1. **Task count:** 6 — within the ≤7 limit.
2. **Coverage:** schema (1), generation/citation logic (2), source creation (3), API wiring (4), notebook/upload UI (5), chat UI (6) — every item from the design brief's key decisions has a task.
3. **Placeholders:** none — every step has concrete code or a fully specified assertion.
4. **Type consistency:** `AskQuestionResult`/`Citation` (generation) and `ResolvedCitation` (citations) share the same field shape (`label`, `sourceId`, `sourceTitle`, `chunkIndex`, `pageNumber`, `section`, `content`) so the API routes and UI can treat them uniformly; `SearchResult` (retrieval, already built) supplies `chunkId`/`sourceId`/`chunkIndex`/`pageNumber`/`section`/`content` consumed directly by `askQuestion`.

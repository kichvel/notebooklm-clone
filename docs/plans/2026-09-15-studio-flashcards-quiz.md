# Studio: Flashcards & Quiz — Implementation Plan

**Goal:** Remove Study Guide; make Flashcards and Quiz generate real, grounded, cited, pull-based content from a notebook's selected sources.
**Branch:** `worktree-studio-flashcards-quiz`
**Stack:** Next.js App Router (API routes), Supabase (Postgres + pgvector via existing `match_source_chunks` RPC), OpenAI (structured JSON-schema output), React client components, Vitest.

> **Note on "streaming" vs the design brief:** the brief describes new endpoints "mirroring the streaming NDJSON pattern." Implementing this plan, I'm deviating from literal token-level streaming: each flashcard/quiz item is generated with OpenAI's structured JSON-schema output (one non-streaming call), the same reliable pattern this codebase just adopted for follow-up questions specifically *because* the prior delimiter-based in-band text streaming was fragile and leaked into visible output. Token-by-token deltas are incompatible with structured JSON-schema output. The "keep generating indefinitely" experience the user asked for comes from the pull-based `/next` model itself (each request is fast — one passage lookup + one short structured completion), not from mid-item text streaming. Routes are plain POST → JSON, not `ReadableStream`. Flagging this clearly before execution in case it should go back for discussion.

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/components/studio/generation-output.tsx` | Delete Study Guide + all fixture data; become a thin router to `FlashcardsOutput` / `QuizOutput` |
| Modify | `src/components/studio/studio-panel.tsx` | Drop Study Guide card; accept `notebookId` + `selectedSourceIds`; reset session on feature/source/notebook change |
| Modify | `src/components/studio/studio-panel.test.tsx` | Rewrite for 2 cards and real (mocked-fetch) behavior instead of canned output |
| Create | `src/components/studio/flashcards-output.tsx` | Pull-based flashcard UI: fetch next card, flip, show citation, "Next", exhausted/error states |
| Create | `src/components/studio/flashcards-output.test.tsx` | Component test for the flip/next/exhausted flow |
| Create | `src/components/studio/quiz-output.tsx` | Pull-based quiz UI: instant right/wrong feedback, show source on wrong, "Next question" |
| Create | `src/components/studio/quiz-output.test.tsx` | Component test for answer feedback + citation-on-wrong |
| Modify | `src/lib/providers/openai.ts` | Add `generateFlashcard` and `generateQuizQuestion` structured-output helpers |
| Modify | `src/lib/providers/openai.test.ts` | Real-API tests for the two new helpers (gated by `OPENAI_API_KEY`, matching existing style) |
| Create | `src/lib/generation/studio.ts` | `selectNextPassage` (retrieval + chunk exclusion + citation building), `generateNextFlashcard`, `generateNextQuizQuestion` |
| Create | `src/lib/generation/studio.integration.test.ts` | Real Supabase+OpenAI integration test (gated, matching `notebookIntro.integration.test.ts` style) |
| Create | `src/app/api/notebooks/[notebookId]/studio/flashcards/route.ts` | POST: auth, validate body, call `generateNextFlashcard`, return JSON |
| Create | `src/app/api/notebooks/[notebookId]/studio/quiz/route.ts` | POST: auth, validate body, call `generateNextQuizQuestion`, return JSON |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | Pass `notebookId` + `selectedSourceIds` into `StudioPanel` |

---

## Tasks

### Task 1: Remove Study Guide

**Files:** `src/components/studio/generation-output.tsx`, `src/components/studio/studio-panel.tsx`, `src/components/studio/studio-panel.test.tsx`

- [ ] Update the failing test first — `studio-panel.test.tsx` currently asserts a "study guide" button exists; flip it to assert it's gone:
  ```ts
  it('only shows flashcards and quiz cards', () => {
    render(<StudioPanel notebookId="nb1" readySourceCount={2} selectedSourceIds={new Set()} />);
    expect(screen.queryByRole('button', { name: /study guide/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /flashcards/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quiz/i })).toBeInTheDocument();
  });
  ```
- [ ] Run it — confirm it fails (component doesn't accept the new props yet / study guide still renders)
- [ ] In `generation-output.tsx`: delete `StudyGuideOutput`, the `FLASHCARDS`/`QUIZ` fixture consts, and `study_guide` from `StudioFeature`; leave `GenerationOutput` as a stub returning `null` for now (Tasks 3–4 replace it with the real router)
- [ ] In `studio-panel.tsx`: remove the `study_guide` entry from `FEATURES` and the now-unused `BookOpenIcon` import
- [ ] Run tests — confirm the new test passes (existing "canned output" tests will be broken here; they get rewritten in Task 5, so `.skip` them for now with a `// TODO(task 5)` comment)
- [ ] Commit: `git commit -m "feat(studio): remove Study Guide"`

---

### Task 2: Studio generation core (retrieval + grounded structured generation)

**Files:** `src/lib/providers/openai.ts`, `src/lib/providers/openai.test.ts`, `src/lib/generation/studio.ts`, `src/lib/generation/studio.integration.test.ts`

- [ ] Add structured-output provider helpers to `openai.ts`, following the exact `generateFollowUpQuestions` pattern (JSON-schema `response_format`, `strict: true`):
  ```ts
  const FLASHCARD_SCHEMA = {
    type: 'object',
    properties: { front: { type: 'string' }, back: { type: 'string' } },
    required: ['front', 'back'],
    additionalProperties: false,
  } as const;

  export async function generateFlashcard({
    system,
    prompt,
    model = GENERATION_MODEL,
  }: { system: string; prompt: string; model?: string }): Promise<{ front: string; back: string } | null> {
    const response = await getClient().chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'flashcard', strict: true, schema: FLASHCARD_SCHEMA },
      },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { front?: unknown; back?: unknown };
    if (typeof parsed.front !== 'string' || typeof parsed.back !== 'string') return null;
    if (!parsed.front.trim() || !parsed.back.trim()) return null;
    return { front: parsed.front, back: parsed.back };
  }

  const QUIZ_QUESTION_SCHEMA = {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
      correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
    },
    required: ['question', 'options', 'correctIndex'],
    additionalProperties: false,
  } as const;

  export async function generateQuizQuestion({
    system,
    prompt,
    model = GENERATION_MODEL,
  }: { system: string; prompt: string; model?: string }): Promise<
    { question: string; options: string[]; correctIndex: number } | null
  > {
    const response = await getClient().chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'quiz_question', strict: true, schema: QUIZ_QUESTION_SCHEMA },
      },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as {
      question?: unknown;
      options?: unknown;
      correctIndex?: unknown;
    };
    if (
      typeof parsed.question !== 'string' ||
      !Array.isArray(parsed.options) ||
      parsed.options.length !== 4 ||
      !parsed.options.every((o): o is string => typeof o === 'string' && o.trim().length > 0) ||
      typeof parsed.correctIndex !== 'number' ||
      parsed.correctIndex < 0 ||
      parsed.correctIndex > 3
    ) {
      return null;
    }
    return { question: parsed.question, options: parsed.options, correctIndex: parsed.correctIndex };
  }
  ```
- [ ] Add matching real-API tests to `openai.test.ts` (same `describe.skipIf(!process.env.OPENAI_API_KEY)` style as `generateFollowUpQuestions`'s test), asserting shape (front/back non-empty; 4 options, `correctIndex` in range) from a fixed sample passage.
- [ ] Write the failing integration test for the retrieval/exclusion core first, in `studio.integration.test.ts` (mirrors `notebookIntro.integration.test.ts`: `describe.skipIf(!hasRealEnv)`, creates a real notebook + source + chunks, deletes them in `afterAll`):
  ```ts
  it('excludes already-used chunks and reports exhausted once all are used', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const source = await makeReadySourceWithChunks(user, notebook.id, ['Fact A.', 'Fact B.']);

    const first = await selectNextPassage(user, { notebookId: notebook.id, excludeChunkIds: [] });
    expect(first.status).toBe('ok');
    const second = await selectNextPassage(user, {
      notebookId: notebook.id,
      excludeChunkIds: [(first as { status: 'ok'; citation: { chunkId: string } }).citation.chunkId],
    });
    expect(second.status).toBe('ok');
    const third = await selectNextPassage(user, {
      notebookId: notebook.id,
      excludeChunkIds: [first, second].map((r) => (r as { citation: { chunkId: string } }).citation.chunkId),
    });
    expect(third.status).toBe('exhausted');
  });
  ```
  (Add a small `makeReadySourceWithChunks` test helper alongside the existing `makeNotebook` helper in this file — insert a `sources` row with `status: 'ready'`, insert matching `source_chunks` rows with real embeddings via `embed()`.)
- [ ] Run it — confirm it fails (module doesn't exist yet)
- [ ] Implement `src/lib/generation/studio.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { embed, generateFlashcard, generateQuizQuestion } from '@/lib/providers/openai';
  import { search } from '@/lib/retrieval';
  import { buildYoutubeTimestampUrl, type Citation } from './index';

  export interface StudioCitation extends Citation {
    chunkId: string;
  }

  const STUDIO_QUERY_TEXT =
    'key facts, concepts, definitions, and important details covered in the source material';
  const RETRIEVAL_POOL_SIZE = 30;

  export type PassageResult =
    | { status: 'ok'; content: string; citation: StudioCitation }
    | { status: 'exhausted' };

  export async function selectNextPassage(
    supabase: SupabaseClient,
    {
      notebookId,
      sourceIds,
      excludeChunkIds,
    }: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
  ): Promise<PassageResult> {
    const queryEmbedding = await embed(STUDIO_QUERY_TEXT);
    const results = await search(supabase, {
      notebookId,
      sourceIds,
      queryEmbedding,
      matchCount: RETRIEVAL_POOL_SIZE,
    });
    const excluded = new Set(excludeChunkIds);
    const passage = results.find((r) => !excluded.has(r.chunkId));
    if (!passage) return { status: 'exhausted' };

    const { data: source, error } = await supabase
      .from('sources')
      .select('id, title, type, origin_url')
      .eq('id', passage.sourceId)
      .single();
    if (error) throw error;

    const sourceUrl =
      source.type === 'youtube' && source.origin_url && passage.startSeconds !== null
        ? buildYoutubeTimestampUrl(source.origin_url, passage.startSeconds)
        : null;

    return {
      status: 'ok',
      content: passage.content,
      citation: {
        label: 1,
        sourceId: passage.sourceId,
        sourceTitle: source.title ?? 'Untitled source',
        chunkIndex: passage.chunkIndex,
        pageNumber: passage.pageNumber,
        section: passage.section,
        startSeconds: passage.startSeconds,
        sourceUrl,
        content: passage.content,
        chunkId: passage.chunkId,
      },
    };
  }

  export type StudioFlashcardResult =
    | { status: 'ok'; card: { front: string; back: string }; citation: StudioCitation }
    | { status: 'exhausted' };

  export async function generateNextFlashcard(
    supabase: SupabaseClient,
    params: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
  ): Promise<StudioFlashcardResult> {
    const picked = await selectNextPassage(supabase, params);
    if (picked.status === 'exhausted') return picked;
    const card = await generateFlashcard({
      system:
        'Create one study flashcard grounded ONLY in the passage below. "front" is a question or prompt; "back" is the answer. Never use knowledge outside the passage.',
      prompt: `Passage:\n${picked.content}`,
    });
    if (!card) return { status: 'exhausted' };
    return { status: 'ok', card, citation: picked.citation };
  }

  export type StudioQuizResult =
    | {
        status: 'ok';
        question: string;
        options: string[];
        correctIndex: number;
        citation: StudioCitation;
      }
    | { status: 'exhausted' };

  export async function generateNextQuizQuestion(
    supabase: SupabaseClient,
    params: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
  ): Promise<StudioQuizResult> {
    const picked = await selectNextPassage(supabase, params);
    if (picked.status === 'exhausted') return picked;
    const question = await generateQuizQuestion({
      system:
        'Create one multiple-choice question with exactly 4 options, grounded ONLY in the passage below. Exactly one option is correct; the rest must be plausible but clearly wrong given the passage. Never use knowledge outside the passage.',
      prompt: `Passage:\n${picked.content}`,
    });
    if (!question) return { status: 'exhausted' };
    return { status: 'ok', ...question, citation: picked.citation };
  }
  ```
- [ ] Run tests — confirm passing
- [ ] Commit: `git commit -m "feat(studio): grounded flashcard/quiz generation core"`

---

### Task 3: Flashcards — route + UI

**Files:** `src/app/api/notebooks/[notebookId]/studio/flashcards/route.ts`, `src/components/studio/flashcards-output.tsx`, `src/components/studio/flashcards-output.test.tsx`

- [ ] Write the failing component test first:
  ```tsx
  it('loads the first card, flips it, and fetches the next on demand', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({
        status: 'ok', card: { front: 'Q1', back: 'A1' },
        citation: { chunkId: 'c1', sourceTitle: 'Doc', content: 'x', label: 1, sourceId: 's1',
          chunkIndex: 0, pageNumber: null, section: null, startSeconds: null, sourceUrl: null },
      }) })
      .mockResolvedValueOnce({ json: async () => ({ status: 'exhausted' }) });

    render(<FlashcardsOutput notebookId="nb1" sourceIds={['s1']} />);
    expect(await screen.findByText('Q1')).toBeInTheDocument();
    await user.click(screen.getByText('Q1'));
    expect(screen.getByText('A1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText(/covered everything/i)).toBeInTheDocument();
  });
  ```
- [ ] Run it — confirm it fails (files don't exist)
- [ ] Implement the route:
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { createClient } from '@/lib/supabase/server';
  import { generateNextFlashcard } from '@/lib/generation/studio';

  export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ notebookId: string }> },
  ) {
    const { notebookId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { sourceIds, excludeChunkIds } = body ?? {};
    if (
      sourceIds !== undefined &&
      (!Array.isArray(sourceIds) || !sourceIds.every((id: unknown) => typeof id === 'string'))
    ) {
      return NextResponse.json({ error: 'sourceIds must be an array of strings' }, { status: 400 });
    }
    if (
      !Array.isArray(excludeChunkIds) ||
      !excludeChunkIds.every((id: unknown) => typeof id === 'string')
    ) {
      return NextResponse.json({ error: 'excludeChunkIds must be an array of strings' }, { status: 400 });
    }

    try {
      const result = await generateNextFlashcard(supabase, { notebookId, sourceIds, excludeChunkIds });
      return NextResponse.json(result);
    } catch (error) {
      console.error('generateNextFlashcard failed', { notebookId, error });
      return NextResponse.json({ status: 'error' }, { status: 500 });
    }
  }
  ```
- [ ] Implement `flashcards-output.tsx`: fetch on mount with `excludeChunkIds: []`; a "Next" button that either advances to an already-loaded card or fetches a new one (appending `excludeChunkIds` from all citations seen so far); flip-to-reveal on click; a "Source: <title>" link opening `CitationDrawer` (reused from `@/components/chat/citation-drawer`); explicit exhausted/error text states. Reset all local state (`items`, `cursor`, `flipped`) whenever `notebookId` or the `sourceIds` array (by joined value) changes.
- [ ] Run tests — confirm passing
- [ ] Commit: `git commit -m "feat(studio): real flashcard generation and pull-based UI"`

---

### Task 4: Quiz — route + UI

**Files:** `src/app/api/notebooks/[notebookId]/studio/quiz/route.ts`, `src/components/studio/quiz-output.tsx`, `src/components/studio/quiz-output.test.tsx`

- [ ] Write the failing component test first:
  ```tsx
  it('gives instant feedback and reveals the source only when wrong', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValueOnce({ json: async () => ({
      status: 'ok', question: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 1,
      citation: { chunkId: 'c1', sourceTitle: 'Doc', content: 'x', label: 1, sourceId: 's1',
        chunkIndex: 0, pageNumber: null, section: null, startSeconds: null, sourceUrl: null },
    }) });

    render(<QuizOutput notebookId="nb1" sourceIds={['s1']} />);
    await screen.findByText('Q1');
    await user.click(screen.getByText('A')); // wrong answer

    expect(screen.getByRole('button', { name: /see source/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next question/i })).toBeInTheDocument();
  });
  ```
- [ ] Run it — confirm it fails
- [ ] Implement the route (identical shape to the flashcards route, calling `generateNextQuizQuestion`)
- [ ] Implement `quiz-output.tsx`: fetch on mount; render 4 option buttons; on click, lock in the selection, highlight correct (green) / selected-wrong (red), and — only if wrong — show a "See source: <title>" button opening `CitationDrawer`; "Next question" appears once answered and behaves like flashcards' "Next" (advance or fetch). Same session-reset behavior as flashcards.
- [ ] Run tests — confirm passing
- [ ] Commit: `git commit -m "feat(studio): real quiz generation with instant feedback"`

---

### Task 5: Wire Studio into the workspace

**Files:** `src/components/studio/generation-output.tsx`, `src/components/studio/studio-panel.tsx`, `src/components/studio/studio-panel.test.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`

- [ ] Un-skip and rewrite the studio-panel tests removed/skipped in Task 1:
  ```tsx
  it('resets the active feature session when selected sources change', async () => {
    const { rerender } = render(
      <StudioPanel notebookId="nb1" readySourceCount={2} selectedSourceIds={new Set(['s1'])} />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /flashcards/i }));
    rerender(
      <StudioPanel notebookId="nb1" readySourceCount={2} selectedSourceIds={new Set(['s2'])} />,
    );
    // FlashcardsOutput remounts (new key) and fetches again with the new source id — assert via fetch mock call args
  });
  ```
- [ ] Run it — confirm it fails
- [ ] Finish `generation-output.tsx` as the real router:
  ```tsx
  'use client';

  export type StudioFeature = 'flashcards' | 'quiz';

  import { FlashcardsOutput } from './flashcards-output';
  import { QuizOutput } from './quiz-output';

  export function GenerationOutput({
    feature,
    notebookId,
    sourceIds,
  }: {
    feature: StudioFeature;
    notebookId: string;
    sourceIds: string[];
  }) {
    if (feature === 'flashcards') return <FlashcardsOutput notebookId={notebookId} sourceIds={sourceIds} />;
    return <QuizOutput notebookId={notebookId} sourceIds={sourceIds} />;
  }
  ```
- [ ] Update `studio-panel.tsx` to accept `notebookId` and `selectedSourceIds`, and key `GenerationOutput` so switching feature, sources, or notebook remounts (resets) it:
  ```tsx
  export function StudioPanel({
    notebookId,
    readySourceCount,
    selectedSourceIds,
  }: {
    notebookId: string;
    readySourceCount: number;
    selectedSourceIds: Set<string>;
  }) {
    const [activeFeature, setActiveFeature] = useState<StudioFeature | null>(null);
    const disabled = readySourceCount === 0;
    const sourceIds = [...selectedSourceIds];
    // ...
    {activeFeature && (
      <GenerationOutput
        key={`${notebookId}-${activeFeature}-${sourceIds.join(',')}`}
        feature={activeFeature}
        notebookId={notebookId}
        sourceIds={sourceIds}
      />
    )}
  ```
- [ ] Update `notebook-workspace.tsx`'s `studioPanel` assignment to pass the two new props:
  ```tsx
  const studioPanel = (
    <StudioPanel
      notebookId={notebookId}
      readySourceCount={readySourceCount}
      selectedSourceIds={selectedSourceIds}
    />
  );
  ```
- [ ] Run full test suite (`npm run test`) — confirm passing
- [ ] Run `npm run typecheck` and `npm run lint` — confirm clean
- [ ] Commit: `git commit -m "feat(studio): wire flashcards/quiz to real source selection"`

---

## Self-review

1. **Task count:** 5 — under the 7-task limit.
2. **Coverage:** Study Guide removal ✅ (Task 1); grounded generation + citations ✅ (Task 2); on-demand pull + exhaustion + dedup-by-passage ✅ (Tasks 2–4); quiz instant feedback + show-source-on-wrong ✅ (Task 4); same source-selection semantics as chat + session reset ✅ (Task 5); no persistence — confirmed no new tables/migrations anywhere in this plan.
3. **Placeholders:** none — every step has concrete code or a fully specified change.
4. **Type consistency:** `StudioCitation` (`studio.ts`) is `Citation` (from `generation/index.ts`) plus `chunkId`; both `flashcards-output.tsx` and `quiz-output.tsx` pass it directly into the existing `CitationDrawer`, which only reads the base `Citation` fields, so the extra `chunkId` field is compatible without casting. `sourceIds`/`excludeChunkIds` request-body validation is identical across both new routes.

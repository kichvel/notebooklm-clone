# Per-source intro generation, chat blocking UX, and Studio framing — Implementation Plan

**Goal:** Replace the one-shot, never-updating, whole-notebook intro with a per-source intro paragraph generated whenever a source finishes ingesting, and reuse each source's summary as framing context for Studio's flashcard/quiz generation.
**Branch:** `per-source-intro`
**Stack:** Next.js App Router, Supabase Postgres (new migration), Inngest ingestion workflow, OpenAI via `src/lib/providers/`, React client components, Vitest.

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/20260915100000_source_intro.sql` | `sources.intro_summary`, `sources.intro_generated_at`, `messages.source_id` |
| Modify | `src/lib/generation/notebookIntro.ts` | Strip to title-only generation; rename `maybeGenerateNotebookIntro` → `maybeGenerateNotebookTitle` |
| Modify | `src/lib/generation/notebookIntro.integration.test.ts` | Update for title-only behavior and new function name |
| Create | `src/lib/generation/sourceIntro.ts` | Per-source intro: evenly-spaced whole-document sampling, summary, follow-ups, message insert |
| Create | `src/lib/generation/sourceIntro.test.ts` | Unit test for the pure sampling helper |
| Create | `src/lib/generation/sourceIntro.integration.test.ts` | Real Supabase+OpenAI integration test, mirrors `notebookIntro.integration.test.ts` |
| Modify | `src/lib/ingestion/index.ts` | Call `maybeGenerateNotebookTitle` (renamed) and new `maybeGenerateSourceIntro` from the finalize path |
| Modify | `src/components/sources/source-item.tsx` | Add `intro_generated_at` to `SourceSummary` |
| Modify | `src/app/api/notebooks/[notebookId]/sources/route.ts` | Select `intro_generated_at` in GET |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | Widen polling condition; compute `pendingIntroTitles`; guard `submitQuestion`; pass into `ChatPanel` |
| Modify | `src/components/chat/chat-panel.tsx` | New `pendingIntroTitles` prop; block input/send; distinct "Summarizing…" indicator |
| Modify | `src/components/chat/chat-panel.test.tsx` | Cover the new blocking indicator/disabled state |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx` | Cover polling/guard changes if this file exercises them |
| Modify | `src/lib/generation/studio.ts` | Thread the owning source's `intro_summary` into flashcard/quiz prompts as framing context |
| Modify | `src/lib/generation/studio.integration.test.ts` | Assert framing context flows through `selectNextPassage` |

---

## Tasks

### Task 1: Migration + decouple notebook title from the summary

**Files:** `supabase/migrations/20260915100000_source_intro.sql`, `src/lib/generation/notebookIntro.ts`, `src/lib/generation/notebookIntro.integration.test.ts`

- [ ] Write the migration:
  ```sql
  alter table public.sources
    add column intro_summary text,
    add column intro_generated_at timestamptz;

  alter table public.messages
    add column source_id uuid references public.sources (id) on delete set null;
  ```
  Apply it (`npx supabase db push`, or however this repo's real Supabase project is targeted for dev — check `package.json`/README for the exact command already in use elsewhere in this repo before running).
- [ ] Update the failing test first — rewrite `notebookIntro.integration.test.ts`'s third test (currently `'generates a title and posts one summary message once a ready source exists, and never repeats'`) to assert **no message is inserted** and the function is renamed:
  ```ts
  import { maybeGenerateNotebookTitle } from './notebookIntro';
  // ...
  describe.skipIf(!hasRealEnv)('maybeGenerateNotebookTitle', () => {
    // ... keep the two existing "does nothing" tests, calling maybeGenerateNotebookTitle ...
    it('generates a title once a ready source exists, posts no message, and never repeats', async () => {
      const user = await createPrimaryTestClient();
      const notebook = await makeNotebook(user);
      const { data: source } = await user
        .from('sources')
        .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'Cat facts', status: 'ready' })
        .select()
        .single();
      await user.from('source_chunks').insert({
        source_id: source!.id,
        chunk_index: 0,
        content: 'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
      });

      await maybeGenerateNotebookTitle(user, notebook.id);

      const { data: afterFirst } = await user
        .from('notebooks')
        .select('title, intro_generated_at')
        .eq('id', notebook.id)
        .single();
      expect(afterFirst?.title).not.toBe('Untitled notebook');
      expect(afterFirst?.intro_generated_at).not.toBeNull();

      const { data: messages } = await user.from('messages').select('id').eq('notebook_id', notebook.id);
      expect(messages).toHaveLength(0);

      await maybeGenerateNotebookTitle(user, notebook.id);
      const { data: afterSecond } = await user
        .from('notebooks')
        .select('title')
        .eq('id', notebook.id)
        .single();
      expect(afterSecond?.title).toBe(afterFirst?.title);
    }, 30000);
  });
  ```
- [ ] Run it — confirm it fails (function still named `maybeGenerateNotebookIntro` and still inserts a message)
- [ ] Rewrite `notebookIntro.ts`: rename the export to `maybeGenerateNotebookTitle`, drop the `summary`/`introText` generation call, drop `generateFollowUps` and its import, drop the `messages` insert entirely — keep every guard (`intro_generated_at` check, `allTerminal`/`readySourceIds` check, the sample build, the atomic claim update) exactly as-is, just generating and persisting `title` alone:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { generate } from '@/lib/providers/openai';

  const MAX_CHUNKS_PER_SOURCE = 3;
  const MAX_SAMPLE_CHARS = 6000;

  export async function maybeGenerateNotebookTitle(
    supabase: SupabaseClient,
    notebookId: string,
  ): Promise<void> {
    const { data: notebook } = await supabase
      .from('notebooks')
      .select('intro_generated_at')
      .eq('id', notebookId)
      .single();
    if (!notebook || notebook.intro_generated_at) return;

    const { data: sources } = await supabase
      .from('sources')
      .select('id, status')
      .eq('notebook_id', notebookId)
      .is('deleted_at', null);
    if (!sources || sources.length === 0) return;

    const allTerminal = sources.every((s) => s.status === 'ready' || s.status === 'failed');
    const readySourceIds = sources.filter((s) => s.status === 'ready').map((s) => s.id);
    if (!allTerminal || readySourceIds.length === 0) return;

    const samples: string[] = [];
    for (const sourceId of readySourceIds) {
      const { data: chunks } = await supabase
        .from('source_chunks')
        .select('content')
        .eq('source_id', sourceId)
        .order('chunk_index')
        .limit(MAX_CHUNKS_PER_SOURCE);
      if (chunks && chunks.length > 0) samples.push(chunks.map((c) => c.content).join('\n'));
    }
    const sample = samples.join('\n\n').slice(0, MAX_SAMPLE_CHARS);
    if (!sample.trim()) return;

    let title: string;
    try {
      title = (
        await generate({
          system:
            'You write short, descriptive titles (5-10 words, no quotes, no trailing period) for a research notebook, based on samples from its sources. Respond with only the title.',
          prompt: sample,
        })
      ).trim();
    } catch {
      return;
    }
    if (!title) return;

    await supabase
      .from('notebooks')
      .update({ title, intro_generated_at: new Date().toISOString() })
      .eq('id', notebookId)
      .is('intro_generated_at', null);
  }
  ```
- [ ] Run tests — confirm passing
- [ ] Commit: `git commit -m "feat(notebooks): decouple notebook title generation from the summary"`

---

### Task 2: Per-source intro generation module

**Files:** `src/lib/generation/sourceIntro.ts`, `src/lib/generation/sourceIntro.test.ts`, `src/lib/generation/sourceIntro.integration.test.ts`

- [ ] Write the failing unit test for the pure sampling helper first:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { pickEvenlySpacedIndices } from './sourceIntro';

  describe('pickEvenlySpacedIndices', () => {
    it('returns all indices when count is at or below the sample size', () => {
      expect(pickEvenlySpacedIndices(5, 12)).toEqual([0, 1, 2, 3, 4]);
    });

    it('spreads indices across the full range instead of clustering at the start', () => {
      const indices = pickEvenlySpacedIndices(40, 8);
      expect(indices).toHaveLength(8);
      expect(indices[0]).toBe(0);
      expect(indices[indices.length - 1]).toBeGreaterThanOrEqual(30);
      for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    });
  });
  ```
- [ ] Run it — confirm it fails (module doesn't exist)
- [ ] Write the failing integration test in `sourceIntro.integration.test.ts` (mirror `notebookIntro.integration.test.ts`'s structure: `describe.skipIf(!hasRealEnv)`, `makeNotebook`/`afterAll` helpers):
  ```ts
  it('does nothing for a source that is not ready', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'A', status: 'processing' })
      .select()
      .single();

    await maybeGenerateSourceIntro(user, source!.id);

    const { data: after } = await user
      .from('sources')
      .select('intro_summary, intro_generated_at')
      .eq('id', source!.id)
      .single();
    expect(after?.intro_generated_at).toBeNull();
  });

  it('generates a summary, posts a message with source_id set, and never repeats', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'Cat facts', status: 'ready' })
      .select()
      .single();
    await user.from('source_chunks').insert([
      { source_id: source!.id, chunk_index: 0, content: 'Domestic cats are small, furry, carnivorous mammals.' },
      { source_id: source!.id, chunk_index: 1, content: 'They sleep 12-16 hours a day and have retractable claws.' },
    ]);

    await maybeGenerateSourceIntro(user, source!.id);

    const { data: afterFirst } = await user
      .from('sources')
      .select('intro_summary, intro_generated_at')
      .eq('id', source!.id)
      .single();
    expect(afterFirst?.intro_summary?.trim().length).toBeGreaterThan(0);
    expect(afterFirst?.intro_generated_at).not.toBeNull();

    const { data: messages } = await user
      .from('messages')
      .select('role, status, source_id, follow_up_questions')
      .eq('notebook_id', notebook.id);
    expect(messages).toHaveLength(1);
    expect(messages![0].role).toBe('assistant');
    expect(messages![0].source_id).toBe(source!.id);
    expect(messages![0].follow_up_questions).toHaveLength(3);

    await maybeGenerateSourceIntro(user, source!.id);
    const { data: messagesAfterSecondCall } = await user
      .from('messages')
      .select('id')
      .eq('notebook_id', notebook.id);
    expect(messagesAfterSecondCall).toHaveLength(1);
  }, 30000);
  ```
- [ ] Implement `src/lib/generation/sourceIntro.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { CAPABLE_GENERATION_MODEL, generate } from '@/lib/providers/openai';
  import { generateFollowUps } from './followUps';

  const MAX_SAMPLE_CHUNKS = 12;
  const MAX_SAMPLE_CHARS = 6000;

  export function pickEvenlySpacedIndices(count: number, take: number): number[] {
    if (count <= take) return Array.from({ length: count }, (_, i) => i);
    const step = count / take;
    const indices = new Set<number>();
    for (let i = 0; i < take; i++) indices.add(Math.floor(i * step));
    return [...indices].sort((a, b) => a - b);
  }

  export async function maybeGenerateSourceIntro(
    supabase: SupabaseClient,
    sourceId: string,
  ): Promise<void> {
    const { data: source } = await supabase
      .from('sources')
      .select('id, notebook_id, status, intro_generated_at')
      .eq('id', sourceId)
      .single();
    if (!source || source.status !== 'ready' || source.intro_generated_at) return;

    const { count } = await supabase
      .from('source_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', sourceId);
    if (!count) return;

    const indices = pickEvenlySpacedIndices(count, MAX_SAMPLE_CHUNKS);
    const { data: chunks } = await supabase
      .from('source_chunks')
      .select('content, chunk_index')
      .eq('source_id', sourceId)
      .in('chunk_index', indices)
      .order('chunk_index');
    if (!chunks || chunks.length === 0) return;

    const sample = chunks
      .map((c) => c.content)
      .join('\n\n')
      .slice(0, MAX_SAMPLE_CHARS);
    if (!sample.trim()) return;

    let summary: string;
    try {
      summary = (
        await generate({
          system:
            'You write a short 3-5 sentence introduction that clearly explains what this document is about, based only on the passages given, which are sampled across the whole document. Do not add information beyond what the passages show. Respond with only the summary.',
          prompt: sample,
          model: CAPABLE_GENERATION_MODEL,
        })
      ).trim();
    } catch {
      return;
    }
    if (!summary) return;

    const followUpQuestions = await generateFollowUps({ answer: summary, passages: sample });

    const { data: claimed } = await supabase
      .from('sources')
      .update({ intro_summary: summary, intro_generated_at: new Date().toISOString() })
      .eq('id', sourceId)
      .is('intro_generated_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) return;

    await supabase.from('messages').insert({
      notebook_id: source.notebook_id,
      source_id: sourceId,
      role: 'assistant',
      content: summary,
      status: 'complete',
      follow_up_questions: followUpQuestions,
    });
  }
  ```
- [ ] Run tests — confirm passing
- [ ] Commit: `git commit -m "feat(sources): generate a per-source intro from a whole-document sample"`

---

### Task 3: Wire per-source intro into ingestion

**Files:** `src/lib/ingestion/index.ts`

- [ ] Update imports: `import { maybeGenerateNotebookTitle } from '@/lib/generation/notebookIntro';` and add `import { maybeGenerateSourceIntro } from '@/lib/generation/sourceIntro';`
- [ ] In `onFailure`, rename the `'notebook-intro'` step's inner call to `maybeGenerateNotebookTitle` (no other change — a failed source never gets a per-source intro):
  ```ts
  await step.run('notebook-title', async () => {
    const { data: source } = await supabase
      .from('sources')
      .select('notebook_id')
      .eq('id', sourceId)
      .single();
    if (source) await maybeGenerateNotebookTitle(supabase, source.notebook_id);
  });
  ```
- [ ] In the success path, after the existing `'finalize'` step and before `return { sourceId, chunkCount: chunks.length }`, rename the title step and add a new step for the per-source intro:
  ```ts
  await step.run('notebook-title', async () => {
    const { data: source } = await supabase
      .from('sources')
      .select('notebook_id')
      .eq('id', sourceId)
      .single();
    if (source) await maybeGenerateNotebookTitle(supabase, source.notebook_id);
  });

  await step.run('source-intro', async () => {
    await maybeGenerateSourceIntro(supabase, sourceId);
  });

  return { sourceId, chunkCount: chunks.length };
  ```
- [ ] Run `npm run test` — confirm `ingestSource.test.ts` still passes unmodified (it doesn't assert on intro/title message content today; if it starts failing because of the new step, adjust its assertions minimally to match, but do not weaken its existing checks)
- [ ] Commit: `git commit -m "feat(ingestion): trigger per-source intro generation from the finalize step"`

---

### Task 4: Client polling, blocking, and the "generating" indicator

**Files:** `src/components/sources/source-item.tsx`, `src/app/api/notebooks/[notebookId]/sources/route.ts`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`, `src/components/chat/chat-panel.tsx`, `src/components/chat/chat-panel.test.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx`

- [ ] Write the failing test first in `chat-panel.test.tsx` (follow the existing file's render/props conventions — it already renders `ChatPanel` with a full prop set for the `asking` indicator test; copy that pattern):
  ```tsx
  it('disables input and shows an indicator while an intro is pending', () => {
    render(
      <ChatPanel
        {/* ...existing required props with asking={false}... */}
        pendingIntroTitles={['Q3 Report.pdf']}
      />,
    );
    expect(screen.getByTestId('intro-pending-indicator')).toBeInTheDocument();
    expect(screen.getByText(/summarizing/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
  });
  ```
- [ ] Run it — confirm it fails
- [ ] Add `intro_generated_at: string | null;` to `SourceSummary` in `source-item.tsx`
- [ ] Add `intro_generated_at` to the `.select(...)` list in the sources GET route
- [ ] In `chat-panel.tsx`: add `pendingIntroTitles: string[]` to the props type and destructure it; compute `const hasPendingIntro = pendingIntroTitles.length > 0;`; change the `Input` and submit `Button`'s `disabled` to `disabled={asking || hasPendingIntro}` (and the button's spin condition to `asking || hasPendingIntro`); add a new indicator `<li>` inside the message `<ul>`, alongside the existing `asking` indicator block:
  ```tsx
  {hasPendingIntro && (
    <li className="flex justify-start" aria-live="polite">
      <div
        data-testid="intro-pending-indicator"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        <span>
          Summarizing{' '}
          {pendingIntroTitles.length === 1
            ? pendingIntroTitles[0]
            : `${pendingIntroTitles.length} new sources`}
          …
        </span>
      </div>
    </li>
  )}
  ```
- [ ] In `notebook-workspace.tsx`, replace the `awaitingIntro`-based polling effect (the one gated on `messages.length === 0 && notebookTitle === 'Untitled notebook'`) with a simpler, source-only condition that generalizes to any later source addition, not just the notebook's first:
  ```ts
  useEffect(() => {
    const hasActiveSource = sources.some((source) => ACTIVE_STATUSES.has(source.status));
    const hasPendingIntro = sources.some(
      (source) => source.status === 'ready' && !source.intro_generated_at,
    );
    if (!hasActiveSource && !hasPendingIntro) return;
    const interval = setInterval(() => {
      refreshSources();
      refreshNotebook();
      refreshMessages();
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);
  ```
- [ ] Compute `pendingIntroTitles` near the existing `hasProcessingSources` line and pass it into `ChatPanel`:
  ```ts
  const pendingIntroTitles = sources
    .filter((s) => s.status === 'ready' && !s.intro_generated_at)
    .map((s) => s.title);
  ```
  `<ChatPanel ... pendingIntroTitles={pendingIntroTitles} />`
- [ ] Guard `submitQuestion` against sending while any intro is pending:
  ```ts
  async function submitQuestion(text: string) {
    if (asking) return;
    if (sources.some((s) => s.status === 'ready' && !s.intro_generated_at)) return;
    ...
  ```
- [ ] Run tests — confirm passing; check `notebook-workspace.test.tsx` for any assertion tied to the old `awaitingIntro` polling condition and update it to the new one if present
- [ ] Commit: `git commit -m "feat(chat): block sending while a source intro is generating"`

---

### Task 5: Wire source summaries into Studio framing

**Files:** `src/lib/generation/studio.ts`, `src/lib/generation/studio.integration.test.ts`

- [ ] Update the failing integration test first — extend the existing `selectNextPassage` test (or add a new one) in `studio.integration.test.ts` to set `intro_summary` on the test source and assert it comes back on the passage result:
  ```ts
  it('includes the source intro summary as framing context on the passage result', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const source = await makeReadySourceWithChunks(user, notebook.id, ['Fact A.']);
    await user
      .from('sources')
      .update({ intro_summary: 'This document is a resume covering the author\'s work history.' })
      .eq('id', source.id);

    const result = await selectNextPassage(user, { notebookId: notebook.id, excludeChunkIds: [] });
    expect(result.status).toBe('ok');
    expect((result as { status: 'ok'; sourceSummary: string | null }).sourceSummary).toContain(
      'resume',
    );
  });
  ```
- [ ] Run it — confirm it fails (`sourceSummary` doesn't exist on the result yet)
- [ ] In `studio.ts`: add `intro_summary` to the `sources` select in `selectNextPassage`; add `sourceSummary: string | null` to `PassageResult`'s `ok` variant and return `source.intro_summary` there. Thread it into both `generateNextFlashcards` and `generateNextQuizQuestions` as framing-only context, explicitly instructing the model never to cite it:
  ```ts
  const cards = await generateFlashcards({
    system:
      'Create two distinct study flashcards grounded ONLY in the passage below, each testing a different fact or concept from it. "front" is a question or prompt; "back" is the answer. Never use knowledge outside the passage. A document summary may be given only so you understand what the whole document covers — never cite it, quote it, or treat it as a source of facts; every flashcard must be answerable from the passage alone.',
    prompt: [
      picked.sourceSummary ? `Document summary (context only, not a source):\n${picked.sourceSummary}` : null,
      `Passage:\n${picked.content}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  ```
  Apply the equivalent change to `generateNextQuizQuestions`'s system/prompt construction.
- [ ] Run tests — confirm passing
- [ ] Run `npm run typecheck` and `npm run lint` — confirm clean
- [ ] Commit: `git commit -m "feat(studio): use the owning source's intro summary as generation framing"`

---

## Self-review

1. **Task count:** 5 — under the 7-task limit.
2. **Coverage:** notebook title decoupled from summary ✅ (Task 1); per-source intro from a whole-document sample ✅ (Task 2); wired into ingestion per source, not per notebook ✅ (Task 3); parallel generation landing independently + blocked-until-all-done chat UX with a visible indicator ✅ (Task 4); Studio framing, never-citable ✅ (Task 5); intro message survives source deletion — covered by the migration's `on delete set null` (no application code needed since RLS/query paths already tolerate a null `source_id`, nothing currently filters messages by a required `source_id`).
3. **Placeholders:** none — every step has concrete code or a fully specified change.
4. **Type consistency:** `SourceSummary` (client) and the `sources` GET route select must both carry `intro_generated_at`, checked in Task 4. `PassageResult`'s `sourceSummary` field (Task 5) is additive and doesn't change any existing consumer of `selectNextPassage`. `maybeGenerateNotebookTitle`'s rename (Task 1) is applied consistently in `ingestion/index.ts` (Task 3) — both touch the same two call sites (`onFailure` and the success path).

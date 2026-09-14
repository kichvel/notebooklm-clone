# Streamed Answers with Reasoning — Implementation Plan

**Goal:** Chat questions stream a live, persisted "Thoughts" reasoning transcript and answer text (per ADR-008), and follow-up questions use recent conversation context to retrieve correctly.
**Branch:** `worktree-chat-streaming-reasoning`
**Stack:** Next.js App Router route handlers, OpenAI Responses API (streaming + reasoning summaries), Supabase Postgres, Vitest/Testing Library.

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/providers/openai.ts` | Add `generateStreaming()` (Responses API, reasoning summaries) alongside existing `generate()`/`embed()`. |
| Create | `supabase/migrations/20260914150000_message_reasoning.sql` | Add nullable `messages.reasoning` column. |
| Create | `src/lib/generation/rewriteQuery.ts` | `rewriteFollowUpQuery()` — bounded conversation history → standalone retrieval query. |
| Test | `src/lib/generation/rewriteQuery.test.ts` | Logic test: no history → unchanged, model not called. |
| Test | `src/lib/generation/rewriteQuery.integration.test.ts` | Live test: dependent follow-up gets rewritten using real history. |
| Modify | `src/lib/generation/index.ts` | Replace `askQuestion()` with generator `streamAnswer()` yielding `AskQuestionEvent`s; thread reasoning + rewritten query through. |
| Modify → rename | `src/lib/generation/askQuestion.integration.test.ts` → `src/lib/generation/streamAnswer.integration.test.ts` | Drive the generator, assert `passages`/`reasoning_delta`/`answer_delta`/`done` events and persisted `reasoning`. |
| Modify | `src/app/api/notebooks/[notebookId]/messages/route.ts` | POST returns an NDJSON stream; GET selects/returns `reasoning`. |
| Create | `src/components/chat/thoughts-panel.tsx` | Collapsible reasoning transcript (native `<details>`), used live and for historical replay. |
| Test | `src/components/chat/thoughts-panel.test.tsx` | Renders nothing for empty text; collapsed by default; expandable. |
| Modify | `src/components/chat/chat-panel.tsx` | `Message.reasoning` field; new `streaming` prop; renders `ThoughtsPanel` live and historically. |
| Modify | `src/components/chat/chat-panel.test.tsx` | Cover historical reasoning rendering + live streaming state. |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | `submitQuestion` parses the NDJSON response stream into transient `streaming` state. |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx` | Replace plain-JSON POST mocks with a fake streamed `Response` (helper `streamResponse()`). |

---

## Tasks

### Task 1: Streaming reasoning provider + reasoning persistence column

**Files:** `src/lib/providers/openai.ts`, `supabase/migrations/20260914150000_message_reasoning.sql`

- [ ] Add the migration:
  ```sql
  alter table public.messages add column reasoning text;
  ```
- [ ] Add a live (skip-if-no-key) test in `src/lib/providers/openai.test.ts`:
  ```ts
  describe.skipIf(!process.env.OPENAI_API_KEY)('generateStreaming', () => {
    it('yields reasoning and answer deltas and completes', async () => {
      const chunks: { type: 'reasoning' | 'answer'; text: string }[] = [];
      for await (const chunk of generateStreaming({
        system: 'Answer in one short sentence.',
        prompt: 'What color is the sky on a clear day?',
        model: REASONING_GENERATION_MODEL,
      })) {
        chunks.push(chunk);
      }
      expect(chunks.some((c) => c.type === 'answer')).toBe(true);
      expect(chunks.map((c) => c.text).join('')).not.toHaveLength(0);
    }, 30000);
  });
  ```
- [ ] Run it — confirm it fails (`generateStreaming`/`REASONING_GENERATION_MODEL` don't exist yet).
- [ ] Implement in `src/lib/providers/openai.ts`:
  ```ts
  export const REASONING_GENERATION_MODEL = 'gpt-5.1-mini';

  export async function* generateStreaming({
    system,
    prompt,
    model,
    maxOutputTokens = 2048,
  }: {
    system: string;
    prompt: string;
    model: string;
    maxOutputTokens?: number;
  }): AsyncGenerator<{ type: 'reasoning' | 'answer'; text: string }> {
    const stream = await getClient().responses.create({
      model,
      instructions: system,
      input: prompt,
      reasoning: { effort: 'medium', summary: 'auto' },
      max_output_tokens: maxOutputTokens,
      stream: true,
    });
    for await (const event of stream) {
      if (event.type === 'response.reasoning_summary_text.delta') {
        yield { type: 'reasoning', text: event.delta };
      } else if (event.type === 'response.output_text.delta') {
        yield { type: 'answer', text: event.delta };
      } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
        throw new Error(`Generation ${event.type}`);
      }
    }
  }
  ```
  Note: verify `REASONING_GENERATION_MODEL` is currently available on the account/API being used
  before relying on it in production — pick the closest current reasoning-capable model with
  streamed `summary` support if `gpt-5.1-mini` isn't available.
- [ ] Run tests — confirm passing.
- [ ] Commit: `git commit -m "feat: add streaming reasoning generation to the OpenAI provider"`

### Task 2: Conversation-aware follow-up query rewriting

**Files:** `src/lib/generation/rewriteQuery.ts`, `src/lib/generation/rewriteQuery.test.ts`, `src/lib/generation/rewriteQuery.integration.test.ts`

- [ ] Write the failing logic test (`rewriteQuery.test.ts`):
  ```ts
  // @vitest-environment node
  import { describe, expect, it, vi } from 'vitest';
  import { rewriteFollowUpQuery } from './rewriteQuery';

  vi.mock('@/lib/providers/openai', () => ({ generate: vi.fn() }));

  describe('rewriteFollowUpQuery', () => {
    it('returns the question unchanged and does not call the model when there is no history', async () => {
      const { generate } = await import('@/lib/providers/openai');
      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
            }),
          }),
        }),
      } as never;

      const result = await rewriteFollowUpQuery(supabase, {
        notebookId: 'n1',
        question: 'What is this about?',
      });

      expect(result).toBe('What is this about?');
      expect(generate).not.toHaveBeenCalled();
    });
  });
  ```
- [ ] Run it — confirm it fails (module doesn't exist).
- [ ] Implement `src/lib/generation/rewriteQuery.ts`:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { generate } from '@/lib/providers/openai';

  const RECENT_MESSAGE_WINDOW = 6;

  const REWRITE_SYSTEM_PROMPT = [
    "You rewrite a user's latest question into a standalone question that can be understood",
    'without the conversation above, resolving pronouns and implicit references ("the other one",',
    '"what about X") against it. If the question already stands alone, return it unchanged.',
    'Respond with ONLY the rewritten question and nothing else.',
  ].join(' ');

  export async function rewriteFollowUpQuery(
    supabase: SupabaseClient,
    { notebookId, question }: { notebookId: string; question: string },
  ): Promise<string> {
    const { data: recent, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: false })
      .limit(RECENT_MESSAGE_WINDOW);
    if (error) throw error;
    if (!recent || recent.length === 0) return question;

    const history = [...recent]
      .reverse()
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const rewritten = (
      await generate({
        system: REWRITE_SYSTEM_PROMPT,
        prompt: `Conversation so far:\n${history}\n\nLatest question: ${question}`,
        maxTokens: 200,
      })
    ).trim();
    return rewritten || question;
  }
  ```
- [ ] Run tests — confirm the logic test passes.
- [ ] Add the live integration test (`rewriteQuery.integration.test.ts`, `describe.skipIf(!hasRealEnv)`
      following the same pattern as `askQuestion.integration.test.ts`): insert two prior messages
      ("What does the report say about Q1 revenue?" / an answer mentioning "Q1" and "Q2"), then call
      `rewriteFollowUpQuery` with `"what about the other one?"` and assert the result no longer
      contains "the other one" and mentions "Q2".
- [ ] Run it — confirm it fails, then passes once wired against a real notebook.
- [ ] Commit: `git commit -m "feat: rewrite dependent follow-up questions using conversation history"`

### Task 3: Restructure generation into a streaming generator

**Files:** `src/lib/generation/index.ts`, `src/lib/generation/streamAnswer.integration.test.ts` (renamed from `askQuestion.integration.test.ts`)

- [ ] Rename `askQuestion.integration.test.ts` to `streamAnswer.integration.test.ts` and rewrite it to
      drive the generator:
  ```ts
  import { streamAnswer, REFUSAL_TEXT, type AskQuestionEvent } from './index';
  // ...
  async function collect(notebookId: string, question: string) {
    const events: AskQuestionEvent[] = [];
    for await (const event of streamAnswer(user, { notebookId, question })) events.push(event);
    return events;
  }

  it('answers a supported question with a valid citation and refuses an unsupported one', async () => {
    // ...same setup as before...
    const events = await collect(notebook!.id, 'What kind of animal is a domestic cat?');
    expect(events.some((e) => e.type === 'passages')).toBe(true);
    expect(events.some((e) => e.type === 'reasoning_delta')).toBe(true);
    expect(events.some((e) => e.type === 'answer_delta')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') throw new Error('expected done event');
    expect(done.result.status).toBe('complete');
    expect(done.result.reasoning.length).toBeGreaterThan(0);
    expect(done.result.citations.some((c) => c.content.toLowerCase().includes('cat'))).toBe(true);

    const { data: persistedMessage } = await user
      .from('messages')
      .select('reasoning, status')
      .eq('id', done.result.messageId)
      .single();
    expect(persistedMessage?.status).toBe('complete');
    expect(persistedMessage?.reasoning?.length).toBeGreaterThan(0);

    const refusedEvents = await collect(notebook!.id, 'What is the capital of France?');
    const refusedDone = refusedEvents.find((e) => e.type === 'done');
    if (refusedDone?.type !== 'done') throw new Error('expected done event');
    expect(refusedDone.result.status).toBe('refused');
    expect(refusedDone.result.answer).toBe(REFUSAL_TEXT);
  }, 60000);
  ```
- [ ] Run it — confirm it fails (`streamAnswer`/`AskQuestionEvent` don't exist yet).
- [ ] Implement in `src/lib/generation/index.ts`. Add to `AskQuestionResult`:
  ```ts
  export interface AskQuestionResult {
    messageId: string;
    status: 'complete' | 'refused';
    answer: string;
    reasoning: string;
    citations: Citation[];
    followUpQuestions: string[];
  }

  export type AskQuestionEvent =
    | { type: 'passages'; citations: Citation[] }
    | { type: 'reasoning_delta'; text: string }
    | { type: 'answer_delta'; text: string }
    | { type: 'done'; result: AskQuestionResult }
    | { type: 'error'; message: string };
  ```
  Update `persistRefusal` to accept and store `reasoning = ''`, returning it on the result. Replace
  `askQuestion` with:
  ```ts
  import { CAPABLE_GENERATION_MODEL, REASONING_GENERATION_MODEL, embed, generateStreaming } from '@/lib/providers/openai';
  import { rewriteFollowUpQuery } from './rewriteQuery';
  // `generate` and `CAPABLE_GENERATION_MODEL` stay imported for notebookIntro.ts only if still used there.

  export async function* streamAnswer(
    supabase: SupabaseClient,
    { notebookId, question, sourceIds }: AskQuestionParams,
  ): AsyncGenerator<AskQuestionEvent> {
    const retrievalQuestion = await rewriteFollowUpQuery(supabase, { notebookId, question });

    const { error: userMessageError } = await supabase
      .from('messages')
      .insert({ notebook_id: notebookId, role: 'user', content: question, status: 'complete' });
    if (userMessageError) throw userMessageError;

    const queryEmbedding = await embed(retrievalQuestion);
    const results = await search(supabase, { notebookId, sourceIds, queryEmbedding, matchCount: 8 });
    if (results.length === 0) {
      yield { type: 'done', result: await persistRefusal(supabase, notebookId) };
      return;
    }

    const selectedSourceIds = [...new Set(results.map((r) => r.sourceId))];
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('id, title, type, origin_url')
      .in('id', selectedSourceIds);
    if (sourcesError) throw sourcesError;
    const sourceById = new Map((sources ?? []).map((s) => [s.id as string, s]));

    const passages: Citation[] = results.map((r, i) => {
      const source = sourceById.get(r.sourceId);
      const sourceUrl =
        source?.type === 'youtube' && source.origin_url && r.startSeconds !== null
          ? buildYoutubeTimestampUrl(source.origin_url as string, r.startSeconds)
          : null;
      return {
        label: i + 1,
        sourceId: r.sourceId,
        sourceTitle: (source?.title as string) ?? 'Untitled source',
        chunkIndex: r.chunkIndex,
        pageNumber: r.pageNumber,
        section: r.section,
        startSeconds: r.startSeconds,
        sourceUrl,
        content: r.content,
      };
    });
    yield { type: 'passages', citations: passages };

    const { data: notebook, error: notebookError } = await supabase
      .from('notebooks')
      .select('chat_style, chat_custom_style, chat_answer_length')
      .eq('id', notebookId)
      .single();
    if (notebookError) throw notebookError;
    const chatSettings: ChatSettings = {
      chatStyle: notebook.chat_style,
      chatCustomStyle: notebook.chat_custom_style,
      chatAnswerLength: notebook.chat_answer_length,
    };

    const system = buildSystemPrompt(results.length, chatSettings);
    const passagesBlock = results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');

    let reasoning = '';
    let generated = '';
    for await (const chunk of generateStreaming({
      system,
      prompt: `Passages:\n${passagesBlock}\n\nQuestion: ${question}`,
      model: REASONING_GENERATION_MODEL,
    })) {
      if (chunk.type === 'reasoning') {
        reasoning += chunk.text;
        yield { type: 'reasoning_delta', text: chunk.text };
      } else {
        generated += chunk.text;
        yield { type: 'answer_delta', text: chunk.text };
      }
    }

    const { text: rawAnswer, followUpQuestions } = parseFollowUps(generated.trim());

    const validLabels = new Map<number, (typeof results)[number]>();
    for (const match of rawAnswer.matchAll(/\[(\d+)\]/g)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= results.length) validLabels.set(n, results[n - 1]);
    }
    if (rawAnswer === REFUSAL_TEXT || validLabels.size === 0) {
      yield { type: 'done', result: await persistRefusal(supabase, notebookId, followUpQuestions, reasoning) };
      return;
    }

    const { data: assistantMessage, error: messageError } = await supabase
      .from('messages')
      .insert({
        notebook_id: notebookId,
        role: 'assistant',
        content: rawAnswer,
        status: 'complete',
        reasoning,
        selected_source_ids: selectedSourceIds,
        follow_up_questions: followUpQuestions,
      })
      .select()
      .single();
    if (messageError) throw messageError;

    const citationRows = [...validLabels.entries()].map(([label, r]) => {
      const passage = passages.find((p) => p.label === label)!;
      return {
        message_id: assistantMessage.id,
        label,
        source_id: r.sourceId,
        chunk_id: r.chunkId,
        source_title: passage.sourceTitle,
        chunk_index: r.chunkIndex,
        page_number: r.pageNumber,
        section: r.section,
        start_seconds: r.startSeconds,
        source_url: passage.sourceUrl,
        content_snapshot: r.content,
      };
    });
    const { error: citationsError } = await supabase.from('message_citations').insert(citationRows);
    if (citationsError) throw citationsError;

    yield {
      type: 'done',
      result: {
        messageId: assistantMessage.id,
        status: 'complete',
        answer: rawAnswer,
        reasoning,
        citations: citationRows.map((row) => ({
          label: row.label,
          sourceId: row.source_id,
          sourceTitle: row.source_title,
          chunkIndex: row.chunk_index,
          pageNumber: row.page_number,
          section: row.section,
          startSeconds: row.start_seconds,
          sourceUrl: row.source_url,
          content: row.content_snapshot,
        })),
        followUpQuestions,
      },
    };
  }
  ```
- [ ] Run tests — confirm passing.
- [ ] Commit: `git commit -m "feat: stream generation as reasoning/answer events and persist reasoning"`

### Task 4: NDJSON streaming route

**Files:** `src/app/api/notebooks/[notebookId]/messages/route.ts`

- [ ] Update the POST handler: validation stays synchronous JSON responses (401/400 unchanged);
      success becomes an NDJSON stream:
  ```ts
  import { streamAnswer, type AskQuestionEvent } from '@/lib/generation';

  export const maxDuration = 60;

  export async function POST(/* ...unchanged signature... */) {
    // ...unchanged auth + validation, still returning NextResponse.json for 401/400...

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        function send(event: AskQuestionEvent) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        }
        try {
          for await (const event of streamAnswer(supabase, { notebookId, question, sourceIds })) {
            send(event);
          }
        } catch (error) {
          console.error('streamAnswer failed', { notebookId, error });
          send({ type: 'error', message: 'Failed to generate an answer' });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }
  ```
- [ ] Update the GET handler's select and mapping to include `reasoning`:
  ```ts
  .select('id, role, content, status, created_at, follow_up_questions, reasoning')
  // ...
  reasoning: message.role === 'assistant' ? message.reasoning : null,
  ```
- [ ] No dedicated route test exists today (verified via `find`); rely on Task 3's generator test plus
      Task 5's client-side test for end-to-end coverage. Manually verify with `npm run dev` per
      lean-verify before marking this task done.
- [ ] Commit: `git commit -m "feat: stream chat answers to the client as NDJSON"`

### Task 5: Client streaming UI and Thoughts panel

**Files:** `src/components/chat/thoughts-panel.tsx`, `src/components/chat/thoughts-panel.test.tsx`,
`src/components/chat/chat-panel.tsx`, `src/components/chat/chat-panel.test.tsx`,
`src/app/notebooks/[notebookId]/notebook-workspace.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx`

- [ ] Write the failing `thoughts-panel.test.tsx`:
  ```ts
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { describe, expect, it } from 'vitest';
  import { ThoughtsPanel } from './thoughts-panel';

  describe('ThoughtsPanel', () => {
    it('renders nothing for empty text', () => {
      const { container } = render(<ThoughtsPanel text="" streaming={false} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('is collapsed by default and expands to show the reasoning text', async () => {
      render(<ThoughtsPanel text="Checking the passages for revenue figures." streaming={false} />);
      expect(screen.getByText(/checking the passages/i)).not.toBeVisible();
      await userEvent.click(screen.getByText('Thoughts'));
      expect(screen.getByText(/checking the passages/i)).toBeVisible();
    });

    it('is open by default while streaming', () => {
      render(<ThoughtsPanel text="Looking at source 2." streaming />);
      expect(screen.getByText(/looking at source 2/i)).toBeVisible();
    });
  });
  ```
- [ ] Run it — confirm it fails (component doesn't exist).
- [ ] Implement `src/components/chat/thoughts-panel.tsx`:
  ```tsx
  export function ThoughtsPanel({ text, streaming }: { text: string; streaming: boolean }) {
    if (!text) return null;
    return (
      <details
        className="mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
        open={streaming}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          Thoughts
        </summary>
        <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{text}</p>
      </details>
    );
  }
  ```
- [ ] Run tests — confirm passing.
- [ ] Update `chat-panel.tsx`: add `reasoning: string | null` to `Message`, add a `streaming: { reasoning: string; answer: string; citations: Citation[] } | null` prop, render `ThoughtsPanel` for historical assistant messages and for the live streaming state (replacing the old plain "Thinking…" `asking` block with one that shows the panel + partial answer once bytes arrive, falling back to the spinner only pre-first-byte):
  ```tsx
  {message.role === 'assistant' ? (
    <div>
      {message.reasoning && <ThoughtsPanel text={message.reasoning} streaming={false} />}
      <AnswerText content={message.content} citations={message.citations} onOpenCitation={setOpenCitation} />
      {/* ...unchanged follow-up chips... */}
    </div>
  ) : ( /* ...unchanged user bubble... */ )}
  ```
  ```tsx
  {asking && (
    <li className="flex justify-start" aria-live="polite">
      <div data-testid="asking-indicator" className="flex flex-col gap-2 text-sm text-muted-foreground">
        {streaming?.reasoning && <ThoughtsPanel text={streaming.reasoning} streaming />}
        {streaming?.answer ? (
          <AnswerText content={streaming.answer} citations={streaming.citations} onOpenCitation={setOpenCitation} />
        ) : (
          <div className="flex items-center gap-2">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            <span>Thinking…</span>
          </div>
        )}
      </div>
    </li>
  )}
  ```
  Add a `chat-panel.test.tsx` case asserting a historical message with `reasoning` set renders a
  "Thoughts" summary, and a case passing a non-null `streaming` prop with `reasoning`/`answer` text
  asserts both the panel and partial answer text render instead of "Thinking…".
- [ ] In `notebook-workspace.tsx`, add `import type { AskQuestionEvent } from '@/lib/generation';`,
      a `streaming` state slice, and rewrite `submitQuestion`:
  ```ts
  const [streaming, setStreaming] = useState<{
    reasoning: string;
    answer: string;
    citations: Citation[];
  } | null>(null);

  async function submitQuestion(text: string) {
    if (asking) return;
    setAsking(true);
    setAskError(null);
    setStreaming({ reasoning: '', answer: '', citations: [] });
    const optimisticId = `pending-${crypto.randomUUID()}`;
    setMessages((current) => [
      ...current,
      { id: optimisticId, role: 'user', content: text, status: 'complete',
        created_at: new Date().toISOString(), follow_up_questions: null, citations: [] },
    ]);
    let sawError = false;
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, sourceIds: [...selectedSourceIds] }),
      });
      if (!response.ok || !response.body) throw new Error('Failed to ask question');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AskQuestionEvent;
          if (event.type === 'passages') {
            setStreaming((current) => current && { ...current, citations: event.citations });
          } else if (event.type === 'reasoning_delta') {
            setStreaming((current) => current && { ...current, reasoning: current.reasoning + event.text });
          } else if (event.type === 'answer_delta') {
            setStreaming((current) => current && { ...current, answer: current.answer + event.text });
          } else if (event.type === 'error') {
            sawError = true;
          }
        }
      }
      if (sawError) throw new Error('Failed to generate an answer');
      setQuestion('');
      await refreshMessages();
    } catch {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setAskError('Something went wrong asking that question. Please try again.');
    } finally {
      setAsking(false);
      setStreaming(null);
    }
  }
  ```
  Pass `streaming={streaming}` into `<ChatPanel ... />`.
- [ ] Update `notebook-workspace.test.tsx`: add a `streamResponse(lines: object[])` helper building a
      real `ReadableStream<Uint8Array>` of NDJSON-encoded lines, and use it in place of the three
      plain-JSON POST mocks (`{ ok: true, json: ... }`) in the existing "disables input", "shows sent
      message... swaps in persisted answer" tests, and any other POST-mock in that file:
  ```ts
  function streamResponse(lines: unknown[] = []) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
        controller.close();
      },
    });
    return { ok: true, body } as unknown as Response;
  }
  ```
  For the "shows sent message... swaps in persisted answer" test, resolve `resolvePost` with
  `streamResponse([{ type: 'answer_delta', text: 'This is about cats.' }])` so the live streaming
  state also has content to assert on before the final `refreshMessages()` swap-in, if desired;
  otherwise `streamResponse([])` is sufficient since that test already asserts via the GET refetch.
- [ ] Run the full test suite — confirm passing.
- [ ] Commit: `git commit -m "feat: stream Thoughts and answer text live in the chat UI"`

---

## Self-review

1. **Task count:** 5 — within the ≤7 guideline.
2. **Coverage:** streaming (Tasks 1, 3, 4, 5) ✓; reasoning persistence + historical rendering (Tasks 1,
   3, 5) ✓; Thoughts UI (Task 5) ✓; query rewriting (Task 2, wired in Task 3) ✓; NDJSON transport
   (Task 4) ✓; migration (Task 1) ✓. Lease protocol intentionally excluded per confirmed scope.
3. **Placeholders:** none — every step has concrete code or a fully specified assertion.
4. **Type consistency:** `AskQuestionEvent`/`AskQuestionResult` (including new `reasoning: string`
   field) defined once in Task 3 and reused as-is by the route (Task 4) and client (Task 5);
   `Citation` reused for the `passages` event payload; `generateStreaming`'s chunk union
   (`'reasoning' | 'answer'`) is intentionally distinct from `AskQuestionEvent`'s
   (`'reasoning_delta' | 'answer_delta'`) since one is the provider-level primitive and the other the
   route-level wire event — Task 3's `streamAnswer` is the seam that translates between them.

# Follow-up chips & conversational awareness fixes — Implementation Plan

**Goal:** Follow-up chips are generated via a separate structured call (never leak into answer text, never fall back to generic text), and the answer-generation LLM call sees real conversation history so it can resolve references to prior turns.
**Branch:** `worktree-followups-conversational-fix`
**Stack:** Next.js App Router, TypeScript, Supabase, OpenAI SDK (`openai@7.15.0`), Vitest

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/providers/openai.ts` | Add `generateFollowUpQuestions` structured-output helper (JSON schema, exactly 3 strings) |
| Modify | `src/lib/providers/openai.test.ts` | Integration test for the new structured-output helper |
| Modify | `src/lib/generation/followUps.ts` | Replace delimiter/parsing logic with a thin wrapper calling the provider helper; delete `FALLBACK_FOLLOW_UP_QUESTIONS`, `FOLLOWUPS_DELIMITER`, `followUpPromptInstruction`, `parseFollowUps` |
| Modify | `src/lib/generation/followUps.test.ts` | Rewrite tests for the new function against a mocked provider |
| Modify | `src/lib/generation/rewriteQuery.ts` | Extract `fetchRecentMessages` (shared Supabase fetch) out of `rewriteFollowUpQuery`; `rewriteFollowUpQuery` takes fetched history as input instead of querying itself |
| Modify | `src/lib/generation/rewriteQuery.test.ts` | Update mocks for the new `fetchRecentMessages`/`rewriteFollowUpQuery` split |
| Modify | `src/lib/generation/rewriteQuery.integration.test.ts` | Update call sites if the exported signature changes |
| Modify | `src/lib/generation/index.ts` | `buildSystemPrompt`: drop follow-up instruction, add history-usage instruction; `runGeneration`: fetch history once, pass to rewrite + generation prompt, call new follow-up generator post-stream (skip on refusal, catch errors) |
| Modify | `src/lib/generation/buildSystemPrompt.test.ts` | Add coverage for the new history-usage instruction line |
| Modify | `src/lib/generation/notebookIntro.ts` | Switch to `generateFollowUpQuestions`; remove delimiter usage; no fallback on failure |
| Modify | `src/lib/generation/notebookIntro.integration.test.ts` | Update follow-up assertion (still expects 3, but via new path) |
| Modify | `src/lib/generation/streamAnswer.integration.test.ts` | Verify no delimiter text ever appears in streamed `answer_delta` chunks or final `answer`; verify conversational follow-up resolves correctly |

---

## Tasks

### Task 1: Structured follow-up generation helper in the provider layer

**Files:** `src/lib/providers/openai.ts`, `src/lib/providers/openai.test.ts`

- [ ] Add a JSON-schema-backed generation function to `openai.ts`:
  ```ts
  const FOLLOW_UP_QUESTIONS_SCHEMA = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 3,
      },
    },
    required: ['questions'],
    additionalProperties: false,
  } as const;

  export async function generateFollowUpQuestions({
    system,
    prompt,
    model = GENERATION_MODEL,
  }: {
    system: string;
    prompt: string;
    model?: string;
  }): Promise<string[]> {
    const response = await getClient().chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'follow_up_questions',
          strict: true,
          schema: FOLLOW_UP_QUESTIONS_SCHEMA,
        },
      },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return [];
    const questions = parsed.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
    return questions.length === 3 ? questions : [];
  }
  ```
- [ ] Write an integration test (gated on `OPENAI_API_KEY` like the existing `generateStreaming` test) in `openai.test.ts`:
  ```ts
  describe.skipIf(!process.env.OPENAI_API_KEY)('generateFollowUpQuestions', () => {
    it('returns exactly 3 non-empty follow-up questions', async () => {
      const questions = await generateFollowUpQuestions({
        system: 'Suggest 3 short follow-up questions a reader could ask next, based on the passage.',
        prompt: 'Passage: Cats are obligate carnivores and typically sleep 12-16 hours a day.',
      });
      expect(questions).toHaveLength(3);
      for (const q of questions) expect(q.trim().length).toBeGreaterThan(0);
    }, 15000);
  });
  ```
- [ ] Run `npx vitest run src/lib/providers/openai.test.ts` — confirm it passes (or skips without `OPENAI_API_KEY`)
- [ ] Commit: `git commit -m "feat: add structured follow-up question generation to the openai provider"`

### Task 2: Replace delimiter-based follow-ups with the shared generator

**Files:** `src/lib/generation/followUps.ts`, `src/lib/generation/followUps.test.ts`

- [ ] Rewrite `followUps.ts` to drop all delimiter/parsing exports and add a single domain-level entry point:
  ```ts
  import 'server-only';
  import { generateFollowUpQuestions } from '@/lib/providers/openai';

  export async function generateFollowUps({
    question,
    answer,
    passages,
  }: {
    question?: string;
    answer: string;
    passages: string;
  }): Promise<string[]> {
    try {
      return await generateFollowUpQuestions({
        system:
          'Based on the passages, the answer given, and (if provided) the question asked, ' +
          'suggest exactly 3 short, specific follow-up questions the user could ask next. ' +
          'Only suggest questions answerable from the passages.',
        prompt: [
          question ? `Question: ${question}` : null,
          `Answer: ${answer}`,
          `Passages:\n${passages}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
    } catch (err) {
      console.error('follow-up generation failed', err);
      return [];
    }
  }
  ```
- [ ] Write the failing test first in `followUps.test.ts`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { generateFollowUps } from './followUps';

  vi.mock('@/lib/providers/openai', () => ({ generateFollowUpQuestions: vi.fn() }));

  describe('generateFollowUps', () => {
    it('returns the questions from the provider call', async () => {
      const { generateFollowUpQuestions } = await import('@/lib/providers/openai');
      vi.mocked(generateFollowUpQuestions).mockResolvedValue(['A?', 'B?', 'C?']);

      const result = await generateFollowUps({ question: 'Q', answer: 'A', passages: '[1] text' });

      expect(result).toEqual(['A?', 'B?', 'C?']);
    });

    it('returns an empty array when the provider call throws', async () => {
      const { generateFollowUpQuestions } = await import('@/lib/providers/openai');
      vi.mocked(generateFollowUpQuestions).mockRejectedValue(new Error('boom'));

      const result = await generateFollowUps({ answer: 'A', passages: '[1] text' });

      expect(result).toEqual([]);
    });

    it('omits the question line from the prompt when no question is given', async () => {
      const { generateFollowUpQuestions } = await import('@/lib/providers/openai');
      vi.mocked(generateFollowUpQuestions).mockResolvedValue(['A?', 'B?', 'C?']);

      await generateFollowUps({ answer: 'A', passages: '[1] text' });

      const call = vi.mocked(generateFollowUpQuestions).mock.calls[0][0];
      expect(call.prompt).not.toContain('Question:');
    });
  });
  ```
- [ ] Run `npx vitest run src/lib/generation/followUps.test.ts` — confirm it fails first (function doesn't exist / mock unused), then implement, then confirm passing
- [ ] Delete the old `FALLBACK_FOLLOW_UP_QUESTIONS`, `FOLLOWUPS_DELIMITER`, `followUpPromptInstruction`, `parseFollowUps`, `FOLLOW_UP_COUNT` exports (grep the repo afterward to confirm no remaining references outside files this plan updates)
- [ ] Commit: `git commit -m "feat: replace delimiter-based follow-up parsing with structured generation"`

### Task 3: Share the recent-messages fetch between query rewriting and answer generation

**Files:** `src/lib/generation/rewriteQuery.ts`, `src/lib/generation/rewriteQuery.test.ts`, `src/lib/generation/rewriteQuery.integration.test.ts`

- [ ] Split `rewriteQuery.ts` into a fetch step and a pure rewrite step:
  ```ts
  import 'server-only';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { generate } from '@/lib/providers/openai';

  export const RECENT_MESSAGE_WINDOW = 6;

  export interface RecentMessage {
    role: 'user' | 'assistant';
    content: string;
  }

  export async function fetchRecentMessages(
    supabase: SupabaseClient,
    notebookId: string,
  ): Promise<RecentMessage[]> {
    const { data: recent, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: false })
      .limit(RECENT_MESSAGE_WINDOW);
    if (error) throw error;
    return [...(recent ?? [])].reverse() as RecentMessage[];
  }

  const REWRITE_SYSTEM_PROMPT = [
    "You rewrite a user's latest question into a standalone question that can be understood",
    'without the conversation above, resolving pronouns and implicit references ("the other one",',
    '"what about X") against it. If the question already stands alone, return it unchanged.',
    'Respond with ONLY the rewritten question and nothing else.',
  ].join(' ');

  export async function rewriteFollowUpQuery(
    history: RecentMessage[],
    question: string,
  ): Promise<string> {
    if (history.length === 0) return question;

    const historyText = history
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const rewritten = (
      await generate({
        system: REWRITE_SYSTEM_PROMPT,
        prompt: `Conversation so far:\n${historyText}\n\nLatest question: ${question}`,
      })
    ).trim();
    return rewritten || question;
  }
  ```
- [ ] Update `rewriteQuery.test.ts` for the new signature:
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { rewriteFollowUpQuery } from './rewriteQuery';

  vi.mock('@/lib/providers/openai', () => ({ generate: vi.fn() }));

  describe('rewriteFollowUpQuery', () => {
    it('returns the question unchanged and does not call the model when there is no history', async () => {
      const { generate } = await import('@/lib/providers/openai');
      const result = await rewriteFollowUpQuery([], 'What is this about?');
      expect(result).toBe('What is this about?');
      expect(generate).not.toHaveBeenCalled();
    });
  });
  ```
- [ ] Update `rewriteQuery.integration.test.ts` to call `fetchRecentMessages` then `rewriteFollowUpQuery(history, question)` instead of the old combined signature (keep the same notebook/message setup, just adjust the call site).
- [ ] Run `npx vitest run src/lib/generation/rewriteQuery.test.ts` — confirm passing
- [ ] Commit: `git commit -m "refactor: split recent-message fetch from query rewriting for reuse"`

### Task 4: Thread conversation history and the new follow-up call into generation

**Files:** `src/lib/generation/index.ts`, `src/lib/generation/buildSystemPrompt.test.ts`

- [ ] Update `buildSystemPrompt` to add a history-usage instruction and drop the follow-up instruction:
  ```ts
  export function buildSystemPrompt(passageCount: number, chatSettings: ChatSettings): string {
    const lines = [
      `You answer questions using ONLY the numbered passages below as evidence. Passages are numbered [1] through [${passageCount}].`,
      'Cite every factual claim with the passage number(s) it is drawn from, in square brackets, e.g. "Cats are mammals [1]."',
      'Never use knowledge outside the passages.',
      'Conversation history, if provided, is only to help you understand references and intent in the current question (e.g. pronouns, "that", implicit comparisons) — never use it as a source of facts; facts must still come only from the numbered passages.',
      `If the passages do not contain enough information to answer, write exactly this text as your answer: "${REFUSAL_TEXT}"`,
      LENGTH_INSTRUCTIONS[chatSettings.chatAnswerLength],
    ];
    if (chatSettings.chatStyle === 'custom' && chatSettings.chatCustomStyle) {
      lines.push(`Adopt this conversational goal, style, or role: ${chatSettings.chatCustomStyle}`);
    }
    return lines.join('\n');
  }
  ```
- [ ] Add a test to `buildSystemPrompt.test.ts`:
  ```ts
  it('instructs the model to use history only for context, not facts', () => {
    expect(buildSystemPrompt(3, base)).toMatch(/never use it as a source of facts/i);
  });
  ```
- [ ] In `runGeneration`, fetch history once and use it both for retrieval rewriting and the generation prompt; build the history block for the prompt; call the new follow-up generator after the answer is finalized and skip it on refusal:
  ```ts
  import { generateFollowUps } from './followUps';
  import { fetchRecentMessages, rewriteFollowUpQuery } from './rewriteQuery';
  // remove: import { followUpPromptInstruction, parseFollowUps, FALLBACK_FOLLOW_UP_QUESTIONS } from './followUps';

  // inside runGeneration, replace the retrievalQuestion line:
  const history = await fetchRecentMessages(supabase, notebookId);
  const retrievalQuestion = await rewriteFollowUpQuery(history, question);

  // ...

  const historyBlock =
    history.length > 0
      ? `Conversation so far:\n${history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n')}\n\n`
      : '';

  for await (const chunk of generateStreaming({
    system,
    prompt: `${historyBlock}Passages:\n${passagesBlock}\n\nQuestion: ${question}`,
    model: REASONING_GENERATION_MODEL,
  })) {
    /* unchanged */
  }

  const rawAnswer = generated.trim();

  const validLabels = new Map<number, (typeof results)[number]>();
  for (const match of rawAnswer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= results.length) validLabels.set(n, results[n - 1]);
  }
  const isRefusal = rawAnswer === REFUSAL_TEXT || validLabels.size === 0;

  const followUpQuestions = isRefusal
    ? []
    : await generateFollowUps({ question, answer: rawAnswer, passages: passagesBlock });

  if (isRefusal) {
    yield {
      type: 'done',
      result: await finalizeAsRefused(supabase, { messageId, attemptId, followUpQuestions, reasoning }),
    };
    return;
  }
  // ...finalizeAsComplete call unchanged, still receives followUpQuestions and rawAnswer
  ```
- [ ] Update `finalizeAsRefused`'s default parameter (`followUpQuestions = FALLBACK_FOLLOW_UP_QUESTIONS`) to `followUpQuestions = []` and remove the now-unused import.
- [ ] Run `npx vitest run src/lib/generation/index.ts src/lib/generation/buildSystemPrompt.test.ts` (via `npx vitest run src/lib/generation/buildSystemPrompt.test.ts`) — confirm passing
- [ ] Run `npm run typecheck` — confirm no type errors from the signature changes
- [ ] Commit: `git commit -m "feat: thread conversation history into answer generation and decouple follow-ups"`

### Task 5: Unify notebookIntro onto the shared follow-up generator

**Files:** `src/lib/generation/notebookIntro.ts`, `src/lib/generation/notebookIntro.integration.test.ts`

- [ ] Update `notebookIntro.ts` to drop the delimiter instruction and call `generateFollowUps` after the summary is produced:
  ```ts
  import { generateFollowUps } from './followUps';
  // remove: import { followUpPromptInstruction, parseFollowUps } from './followUps';

  // summary generation call: drop the followUpPromptInstruction() line from `system`
  summary = (
    await generate({
      system:
        'You write a short 2-4 sentence introduction summarizing what a set of notebook sources cover, based only on the passages given. Do not add information beyond what the passages show. Respond with only the summary.',
      prompt: sample,
      model: CAPABLE_GENERATION_MODEL,
    })
  ).trim();

  // ...
  const introText = summary;
  if (!title || !introText) return;
  const followUpQuestions = await generateFollowUps({ answer: introText, passages: sample });
  ```
  and use `followUpQuestions` (possibly `[]`) in the `messages` insert instead of the old parsed value.
- [ ] Update the integration test assertion — it currently expects `follow_up_questions` to have length 3; since generation isn't guaranteed to always hit exactly 3 in the new path only on success, keep the assertion but note it's gated on `OPENAI_API_KEY` so it reflects real model behavior:
  ```ts
  expect(messages![0].follow_up_questions).toHaveLength(3);
  ```
  (unchanged expectation — if this proves flaky in practice, loosen to `.not.toBeNull()`, but start strict since `generateFollowUpQuestions` only returns non-empty on a full 3-item success.)
- [ ] Run `npx vitest run src/lib/generation/notebookIntro.integration.test.ts` (requires real env; otherwise skipped) and `npx vitest run src/lib/generation` for the full unit suite
- [ ] Commit: `git commit -m "refactor: unify notebook intro follow-ups onto the shared generator"`

### Task 6: End-to-end verification via integration tests

**Files:** `src/lib/generation/streamAnswer.integration.test.ts`

- [ ] Add/extend integration test coverage (gated on real env) for both fixes:
  ```ts
  it('never streams follow-up delimiter text into the answer', async () => {
    // ask a question against a seeded source, collect all answer_delta text,
    // assert it does not contain '---FOLLOWUPS---' and matches the finalized message content
  });

  it('resolves a pronoun-dependent follow-up question using prior conversation turns', async () => {
    // seed a notebook + source with two distinguishable facts tied to different years/entities,
    // ask a first question, then ask a follow-up using a pronoun/implicit reference,
    // assert the final answer addresses the correct (second) fact, not the first
  });
  ```
- [ ] Run `npx vitest run src/lib/generation/streamAnswer.integration.test.ts` (requires `OPENAI_API_KEY` + Supabase test env; otherwise skipped) and confirm passing when run against real credentials
- [ ] Run the full suite: `npm run lint && npm run typecheck && npm run test`
- [ ] Commit: `git commit -m "test: verify no follow-up leakage and correct conversational reference resolution"`

---

## Self-review

1. **Task count:** 6 tasks — within the ≤7 limit.
2. **Coverage:** Every design-brief decision has a task — structured follow-up call (Task 1–2), shared history fetch + history in generation prompt + history-only-for-context instruction (Task 3–4), refusal skips follow-ups + error-catching (Task 4), notebookIntro unification + fallback removal (Task 5), end-to-end verification (Task 6).
3. **Placeholders:** None — all steps show real code, no "TBD"/"similar to task N".
4. **Type consistency:** `generateFollowUpQuestions` (provider, `{system, prompt, model?} → string[]`) is consumed by `generateFollowUps` (domain, `{question?, answer, passages} → string[]`), consumed identically by both `index.ts` and `notebookIntro.ts`. `RecentMessage`/`fetchRecentMessages`/`rewriteFollowUpQuery(history, question)` signatures match across Task 3 and Task 4's usage in `index.ts`.

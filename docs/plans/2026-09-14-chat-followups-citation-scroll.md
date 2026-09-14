# Chat Follow-up Questions & Citation Drawer Scroll — Implementation Plan

**Goal:** Every chat answer (success or refusal) and the notebook intro message shows 3 follow-up question chips that immediately send as the next message; the citation drawer scrolls long passage text instead of clipping it.
**Branch:** `worktree-chat-followups-citation-scroll`
**Stack:** Next.js App Router, TypeScript, Supabase Postgres, Vitest + Testing Library

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/20260914090000_message_follow_up_questions.sql` | Add `follow_up_questions` column to `messages` |
| Create | `src/lib/generation/followUps.ts` | Shared prompt instruction + delimiter parsing + fallback questions |
| Create | `src/lib/generation/followUps.test.ts` | Unit tests for the parser |
| Modify | `src/lib/generation/index.ts` | Generate/persist follow-ups on answers and refusals |
| Modify | `src/lib/generation/askQuestion.integration.test.ts` | Assert follow-ups are generated and persisted |
| Modify | `src/lib/generation/notebookIntro.ts` | Generate/persist follow-ups on the intro message |
| Modify | `src/lib/generation/notebookIntro.integration.test.ts` | Assert follow-ups are generated and persisted |
| Modify | `src/app/api/notebooks/[notebookId]/messages/route.ts` | Include `follow_up_questions` in the GET select |
| Create | `src/components/chat/follow-up-chips.tsx` | Renders clickable follow-up chips |
| Modify | `src/components/chat/chat-panel.tsx` | `Message` type + render chips + `onSelectFollowUp` prop |
| Modify | `src/components/chat/chat-panel.test.tsx` | Update `renderPanel` helper; add chip-click test |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | Refactor `handleAsk` into `submitQuestion(text)`; wire chip clicks to send immediately |
| Modify | `src/components/ui/sheet.tsx` | Wrap `SheetContent` children in a scrollable container |
| Create | `src/components/chat/citation-drawer.test.tsx` | Assert passage content sits inside a scrollable container |

---

## Task 1: Add `follow_up_questions` column to `messages`

**Files:** `supabase/migrations/20260914090000_message_follow_up_questions.sql`

- [ ] Create the migration:
  ```sql
  alter table public.messages
    add column follow_up_questions text[] not null default '{}';
  ```
- [ ] Commit: `git commit -m "feat: add follow_up_questions column to messages"`

## Task 2: Shared follow-up prompt instruction + parser

**Files:** `src/lib/generation/followUps.ts`, `src/lib/generation/followUps.test.ts`

- [ ] Write the failing test:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { FOLLOWUPS_DELIMITER, FALLBACK_FOLLOW_UP_QUESTIONS, parseFollowUps } from './followUps';

  describe('parseFollowUps', () => {
    it('splits the answer from three well-formed follow-up questions', () => {
      const raw = `Cats are mammals [1].${FOLLOWUPS_DELIMITER}What do cats eat?\n- Where do cats live?\n1. How long do cats live?`;
      const { text, followUpQuestions } = parseFollowUps(raw);
      expect(text).toBe('Cats are mammals [1].');
      expect(followUpQuestions).toEqual([
        'What do cats eat?',
        'Where do cats live?',
        'How long do cats live?',
      ]);
    });

    it('falls back to generic questions when the delimiter is missing', () => {
      const { text, followUpQuestions } = parseFollowUps('Cats are mammals [1].');
      expect(text).toBe('Cats are mammals [1].');
      expect(followUpQuestions).toEqual(FALLBACK_FOLLOW_UP_QUESTIONS);
    });

    it('falls back to generic questions when fewer than three are parsed', () => {
      const raw = `Cats are mammals [1].${FOLLOWUPS_DELIMITER}Only one question?`;
      expect(parseFollowUps(raw).followUpQuestions).toEqual(FALLBACK_FOLLOW_UP_QUESTIONS);
    });
  });
  ```
- [ ] Run it — confirm it fails (module doesn't exist yet)
- [ ] Implement:
  ```ts
  import 'server-only';

  export const FOLLOW_UP_COUNT = 3;
  export const FOLLOWUPS_DELIMITER = '\n---FOLLOWUPS---\n';

  export const FALLBACK_FOLLOW_UP_QUESTIONS = [
    'What are the key topics in these sources?',
    'Summarize the main points.',
    'What questions do these sources leave unanswered?',
  ];

  export function followUpPromptInstruction(): string {
    return `After your response, on its own line write exactly "${FOLLOWUPS_DELIMITER.trim()}", then list exactly ${FOLLOW_UP_COUNT} short follow-up questions the user could ask next, one per line, with no numbering or bullets.`;
  }

  export function parseFollowUps(raw: string): { text: string; followUpQuestions: string[] } {
    const index = raw.indexOf(FOLLOWUPS_DELIMITER);
    if (index === -1) return { text: raw.trim(), followUpQuestions: FALLBACK_FOLLOW_UP_QUESTIONS };

    const text = raw.slice(0, index).trim();
    const followUpQuestions = raw
      .slice(index + FOLLOWUPS_DELIMITER.length)
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, FOLLOW_UP_COUNT);

    return {
      text,
      followUpQuestions:
        followUpQuestions.length === FOLLOW_UP_COUNT
          ? followUpQuestions
          : FALLBACK_FOLLOW_UP_QUESTIONS,
    };
  }
  ```
- [ ] Run tests — confirm passing: `npx vitest run src/lib/generation/followUps.test.ts`
- [ ] Commit: `git commit -m "feat: add follow-up question prompt instruction and parser"`

## Task 3: Generate and persist follow-ups in `askQuestion` and `notebookIntro`

**Files:** `src/lib/generation/index.ts`, `src/lib/generation/askQuestion.integration.test.ts`, `src/lib/generation/notebookIntro.ts`, `src/lib/generation/notebookIntro.integration.test.ts`

- [ ] In `src/lib/generation/askQuestion.integration.test.ts`, add assertions (after the existing "answers a supported question" block, before the refusal call) that the persisted message carries follow-ups, and extend the refusal assertions too:
  ```ts
  const { data: persistedRow } = await user
    .from('messages')
    .select('follow_up_questions')
    .eq('id', answered.messageId)
    .single();
  expect(persistedRow?.follow_up_questions).toHaveLength(3);
  expect(answered.followUpQuestions).toHaveLength(3);
  ```
  and after the `refused` call:
  ```ts
  expect(refused.followUpQuestions).toHaveLength(3);
  ```
- [ ] Run it — confirm it fails (`hasRealEnv` gates this test; if no real env is available locally, confirm by reading the diff that the assertions reference fields that don't exist yet on `AskQuestionResult`/`messages`, i.e. a type-check failure via `npx tsc --noEmit`)
- [ ] Implement in `src/lib/generation/index.ts`:
  ```ts
  import { followUpPromptInstruction, parseFollowUps, FALLBACK_FOLLOW_UP_QUESTIONS } from './followUps';
  ```
  Update `buildSystemPrompt` to request follow-ups and adjust the refusal instruction wording so it composes with the delimiter:
  ```ts
  function buildSystemPrompt(passageCount: number): string {
    return [
      `You answer questions using ONLY the numbered passages below as evidence. Passages are numbered [1] through [${passageCount}].`,
      'Cite every factual claim with the passage number(s) it is drawn from, in square brackets, e.g. "Cats are mammals [1]."',
      'Never use knowledge outside the passages.',
      `If the passages do not contain enough information to answer, write exactly this text as your answer, before the follow-up section: "${REFUSAL_TEXT}"`,
      followUpPromptInstruction(),
    ].join('\n');
  }
  ```
  Update `AskQuestionResult` to add `followUpQuestions: string[];`.
  Update `persistRefusal` to accept and persist follow-ups:
  ```ts
  async function persistRefusal(
    supabase: SupabaseClient,
    notebookId: string,
    followUpQuestions: string[] = FALLBACK_FOLLOW_UP_QUESTIONS,
  ): Promise<AskQuestionResult> {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        notebook_id: notebookId,
        role: 'assistant',
        content: REFUSAL_TEXT,
        status: 'refused',
        follow_up_questions: followUpQuestions,
      })
      .select()
      .single();
    if (error) throw error;
    return { messageId: data.id, status: 'refused', answer: REFUSAL_TEXT, citations: [], followUpQuestions };
  }
  ```
  In `askQuestion`, parse the generated text before scanning for citation labels, and thread `followUpQuestions` through both the refusal and success return paths:
  ```ts
  const generated = (
    await generate({
      system,
      prompt: `Passages:\n${passagesBlock}\n\nQuestion: ${question}`,
      model: CAPABLE_GENERATION_MODEL,
    })
  ).trim();
  const { text: rawAnswer, followUpQuestions } = parseFollowUps(generated);

  const validLabels = new Map<number, (typeof results)[number]>();
  for (const match of rawAnswer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= results.length) validLabels.set(n, results[n - 1]);
  }
  if (rawAnswer === REFUSAL_TEXT || validLabels.size === 0)
    return persistRefusal(supabase, notebookId, followUpQuestions);
  ```
  Add `follow_up_questions: followUpQuestions` to the assistant message insert, and `followUpQuestions` to the final returned object.
- [ ] In `src/lib/generation/notebookIntro.ts`, import the same helpers, append `followUpPromptInstruction()` to the summary system prompt, parse the result, and add `follow_up_questions: followUpQuestions` to the `messages` insert:
  ```ts
  summary = (
    await generate({
      system: [
        'You write a short 2-4 sentence introduction summarizing what a set of notebook sources cover, based only on the passages given. Do not add information beyond what the passages show. Respond with only the summary, then the follow-up section.',
        followUpPromptInstruction(),
      ].join('\n'),
      prompt: sample,
      model: CAPABLE_GENERATION_MODEL,
    })
  ).trim();
  ```
  and:
  ```ts
  const { text: introText, followUpQuestions } = parseFollowUps(summary);
  ...
  await supabase.from('messages').insert({
    notebook_id: notebookId,
    role: 'assistant',
    content: introText,
    status: 'complete',
    follow_up_questions: followUpQuestions,
  });
  ```
  (rename the later use of `summary` to `introText` in the `!title || !summary` guard accordingly, checking `!introText` instead)
- [ ] Add the equivalent follow-up assertion to `notebookIntro.integration.test.ts` (read it first to match its existing structure and gating pattern before editing).
- [ ] Run tests: `npx vitest run src/lib/generation` (integration tests skip without real env vars — that's expected; also run `npx tsc --noEmit` after `next typegen` to confirm types are consistent)
- [ ] Commit: `git commit -m "feat: generate and persist follow-up questions for answers, refusals, and the intro message"`

## Task 4: Expose `follow_up_questions` through the messages API

**Files:** `src/app/api/notebooks/[notebookId]/messages/route.ts`

- [ ] Update the GET handler's select list:
  ```ts
  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, role, content, status, created_at, follow_up_questions')
    .eq('notebook_id', notebookId)
    .order('created_at');
  ```
- [ ] No new automated test here — covered by the UI test in Task 5, which relies on the shape returned including `follow_up_questions`.
- [ ] Commit: `git commit -m "feat: include follow_up_questions in the messages API response"`

## Task 5: Follow-up chips UI and immediate-send wiring

**Files:** `src/components/chat/follow-up-chips.tsx`, `src/components/chat/chat-panel.tsx`, `src/components/chat/chat-panel.test.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`

- [ ] Write the failing test in `chat-panel.test.tsx` (update `renderPanel` to accept the new prop, add a case with follow-ups):
  ```ts
  function renderPanel(messages: Message[] = [], onSelectFollowUp = vi.fn()) {
    return render(
      <ChatPanel
        messages={messages}
        question=""
        onQuestionChange={vi.fn()}
        onAsk={vi.fn()}
        asking={false}
        askError={null}
        hasProcessingSources={false}
        onSelectFollowUp={onSelectFollowUp}
      />,
    );
  }
  ```
  ```ts
  it('sends a follow-up question immediately when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onSelectFollowUp = vi.fn();
    renderPanel(
      [{ ...messageWithCitation, follow_up_questions: ['What do cats eat?'] }],
      onSelectFollowUp,
    );
    await user.click(screen.getByRole('button', { name: 'What do cats eat?' }));
    expect(onSelectFollowUp).toHaveBeenCalledWith('What do cats eat?');
  });
  ```
  Also add `follow_up_questions: null` to every existing `Message` literal in the test file so they still satisfy the type.
- [ ] Run it — confirm it fails (missing prop/component)
- [ ] Implement `src/components/chat/follow-up-chips.tsx`:
  ```tsx
  'use client';

  import { Button } from '@/components/ui/button';

  export function FollowUpChips({
    questions,
    onSelect,
  }: {
    questions: string[];
    onSelect: (question: string) => void;
  }) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {questions.map((question) => (
          <Button
            key={question}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => onSelect(question)}
          >
            {question}
          </Button>
        ))}
      </div>
    );
  }
  ```
  Update `Message` in `chat-panel.tsx`:
  ```ts
  export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'complete' | 'refused' | 'failed';
    created_at: string;
    follow_up_questions: string[] | null;
    citations: Citation[];
  }
  ```
  Add the `onSelectFollowUp` prop to `ChatPanel` and render chips under assistant messages:
  ```tsx
  export function ChatPanel({
    messages,
    question,
    onQuestionChange,
    onAsk,
    asking,
    askError,
    hasProcessingSources,
    onSelectFollowUp,
  }: {
    messages: Message[];
    question: string;
    onQuestionChange: (value: string) => void;
    onAsk: (event: React.FormEvent) => void;
    asking: boolean;
    askError: string | null;
    hasProcessingSources: boolean;
    onSelectFollowUp: (question: string) => void;
  }) {
  ```
  ```tsx
  {message.role === 'assistant' ? (
    <div>
      <AnswerText
        content={message.content}
        citations={message.citations}
        onOpenCitation={setOpenCitation}
      />
      {message.follow_up_questions && message.follow_up_questions.length > 0 && (
        <FollowUpChips questions={message.follow_up_questions} onSelect={onSelectFollowUp} />
      )}
    </div>
  ) : (
  ```
- [ ] Refactor `src/app/notebooks/[notebookId]/notebook-workspace.tsx` so sending is decoupled from the `question` input state, and wire chip clicks to send immediately:
  ```ts
  async function submitQuestion(text: string) {
    setAsking(true);
    setAskError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, sourceIds: [...selectedSourceIds] }),
      });
      if (!response.ok) throw new Error('Failed to ask question');
      setQuestion('');
      await refreshMessages();
    } catch {
      setAskError('Something went wrong asking that question. Please try again.');
    } finally {
      setAsking(false);
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    await submitQuestion(question);
  }

  function handleSelectFollowUp(text: string) {
    void submitQuestion(text);
  }
  ```
  Pass `onSelectFollowUp={handleSelectFollowUp}` into `<ChatPanel .../>`.
- [ ] Run tests: `npx vitest run src/components/chat/chat-panel.test.tsx`
- [ ] Commit: `git commit -m "feat: render clickable follow-up chips that send immediately"`

## Task 6: Fix citation drawer scroll

**Files:** `src/components/ui/sheet.tsx`, `src/components/chat/citation-drawer.test.tsx`

- [ ] Write the failing test in `src/components/chat/citation-drawer.test.tsx`:
  ```tsx
  import { render } from '@testing-library/react';
  import { describe, expect, it, vi } from 'vitest';
  import { CitationDrawer, type Citation } from './citation-drawer';

  const longCitation: Citation = {
    label: 1,
    sourceId: 's1',
    sourceTitle: 'Long Source',
    chunkIndex: 0,
    pageNumber: null,
    section: null,
    startSeconds: null,
    sourceUrl: null,
    content: 'word '.repeat(500).trim(),
  };

  describe('CitationDrawer', () => {
    it('renders passage content inside a scrollable container', () => {
      render(<CitationDrawer citation={longCitation} onOpenChange={vi.fn()} />);
      const scrollArea = document.querySelector('[data-slot="sheet-scroll-area"]');
      expect(scrollArea).not.toBeNull();
      expect(scrollArea).toHaveClass('overflow-y-auto');
      expect(scrollArea?.textContent).toContain(longCitation.content);
    });
  });
  ```
- [ ] Run it — confirm it fails (no `sheet-scroll-area` element yet)
- [ ] Implement in `src/components/ui/sheet.tsx` — wrap `{children}` in a scrollable container inside `SheetContent`, keeping the close button outside it so it stays fixed:
  ```tsx
  <SheetPrimitive.Popup
    data-slot="sheet-content"
    data-side={side}
    className={cn(
      'fixed z-50 flex flex-col bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
      className,
    )}
    {...props}
  >
    <div
      data-slot="sheet-scroll-area"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
    >
      {children}
    </div>
    {showCloseButton && (
      <SheetPrimitive.Close
        data-slot="sheet-close"
        render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
      >
        <XIcon />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    )}
  </SheetPrimitive.Popup>
  ```
  (note `gap-4` moved off the `Popup` className onto the new wrapper, since it now holds the header/passage/link children that need the gap)
- [ ] Run tests: `npx vitest run src/components/chat/citation-drawer.test.tsx`
- [ ] Manually verify in the dev server: open a notebook, ask a question that cites a long passage, click the citation marker, confirm the drawer's passage area scrolls while the header and close button stay put
- [ ] Commit: `git commit -m "fix: make citation drawer passage content scrollable"`

---

## Self-review notes

- 6 tasks, under the 7-task ceiling.
- Every success criterion from the design brief maps to a task: answer chips (Task 3+5), refusal chips (Task 3), intro message chips (Task 3), immediate-send behavior (Task 5), scroll fix (Task 6), `WelcomeState` unchanged (untouched by any task — verified by name, not modified in the file map).
- No placeholders remain; `parseFollowUps`, `AskQuestionResult`, and `Message` shapes are consistent across generation, API, and UI layers.
- `notebookIntro.ts`'s existing `!title || !summary` guard is explicitly called out for renaming to `!introText` in Task 3 to avoid a stale reference.

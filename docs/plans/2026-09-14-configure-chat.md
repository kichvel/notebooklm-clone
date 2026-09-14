# Configure Chat (Answer Style & Length) — Implementation Plan

**Goal:** Users can open a "Configure Chat" dialog from the chat header to set an answer style (Default or Custom role/tone text) and answer length (Shorter/Default/Longer), saved per-notebook and applied to future chat answers only.
**Branch:** `worktree-configure-chat-settings` (current worktree branch)
**Stack:** Next.js App Router, TypeScript, Supabase Postgres, Vitest + Testing Library

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/20260914120000_notebook_chat_settings.sql` | Adds `chat_style`, `chat_custom_style`, `chat_answer_length` columns to `notebooks` |
| Create | `src/lib/notebooks/chatSettings.ts` | Client-safe shared types/constants (`ChatStyle`, `ChatAnswerLength`, `ChatSettings`, `MAX_CUSTOM_STYLE_LENGTH`) — no `server-only`, so both server and client code can import it |
| Modify | `src/lib/notebooks/index.ts` | Extend `getNotebook` select list, add `updateChatSettings()` |
| Create | `src/app/api/notebooks/[notebookId]/chat-settings/route.ts` | `PATCH` endpoint: auth check, manual validation, calls `updateChatSettings()` |
| Modify | `src/lib/generation/index.ts` | Export `buildSystemPrompt`, add length/style instruction lines, fetch the notebook's chat settings inside `askQuestion` |
| Create | `src/lib/generation/buildSystemPrompt.test.ts` | Pure unit tests for the new instruction text (no live API calls) |
| Create | `src/components/chat/configure-chat-dialog.tsx` | "Configure Chat" dialog: style pills, length pills, custom textarea + char counter |
| Create | `src/components/chat/configure-chat-dialog.test.tsx` | Component tests: pill selection, Save blocked until custom text entered, onSave payload |
| Modify | `src/components/chat/chat-panel.tsx` | Settings icon button in header opening `ConfigureChatDialog`; new `chatSettings`/`onUpdateChatSettings` props |
| Modify | `src/components/chat/chat-panel.test.tsx` | Update `renderPanel` helper for the two new required props |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | Own `chatSettings` state (defaulted, refreshed from `GET /api/notebooks/:id`), `handleUpdateChatSettings` (PATCH), thread into `ChatPanel` |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx` | New test: opening the dialog, filling custom style, saving, PATCHes the right endpoint/body |
| Modify | `docs/ARCHITECTURE.md` | §4 data model note on new notebook columns; §8 note on where style/length is applied |

---

## Tasks

### Task 1: Persist chat settings (migration + lib + API route)

**Files:** `supabase/migrations/20260914120000_notebook_chat_settings.sql`, `src/lib/notebooks/chatSettings.ts`, `src/lib/notebooks/index.ts`, `src/app/api/notebooks/[notebookId]/chat-settings/route.ts`

- [ ] Create the migration:
  ```sql
  alter table public.notebooks
    add column chat_style text not null default 'default' check (chat_style in ('default', 'custom')),
    add column chat_custom_style text,
    add column chat_answer_length text not null default 'default' check (chat_answer_length in ('shorter', 'default', 'longer'));
  ```
- [ ] Create `src/lib/notebooks/chatSettings.ts`:
  ```ts
  export type ChatStyle = 'default' | 'custom';
  export type ChatAnswerLength = 'shorter' | 'default' | 'longer';

  export interface ChatSettings {
    chatStyle: ChatStyle;
    chatCustomStyle: string | null;
    chatAnswerLength: ChatAnswerLength;
  }

  export const MAX_CUSTOM_STYLE_LENGTH = 10000;
  export const CHAT_STYLES: ChatStyle[] = ['default', 'custom'];
  export const CHAT_ANSWER_LENGTHS: ChatAnswerLength[] = ['shorter', 'default', 'longer'];
  ```
- [ ] In `src/lib/notebooks/index.ts`, extend `getNotebook`'s select to `'id, title, created_at, updated_at, chat_style, chat_custom_style, chat_answer_length'` and add:
  ```ts
  import type { ChatSettings } from './chatSettings';

  export async function updateChatSettings(
    supabase: SupabaseClient,
    id: string,
    { chatStyle, chatCustomStyle, chatAnswerLength }: ChatSettings,
  ) {
    const { data, error } = await supabase
      .from('notebooks')
      .update({
        chat_style: chatStyle,
        chat_custom_style: chatCustomStyle,
        chat_answer_length: chatAnswerLength,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  ```
- [ ] Create `src/app/api/notebooks/[notebookId]/chat-settings/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { createClient } from '@/lib/supabase/server';
  import { updateChatSettings } from '@/lib/notebooks';
  import { CHAT_STYLES, CHAT_ANSWER_LENGTHS, MAX_CUSTOM_STYLE_LENGTH } from '@/lib/notebooks/chatSettings';

  export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ notebookId: string }> },
  ) {
    const { notebookId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { chatStyle, chatCustomStyle, chatAnswerLength } = body ?? {};

    if (!CHAT_STYLES.includes(chatStyle)) {
      return NextResponse.json({ error: 'chatStyle must be "default" or "custom"' }, { status: 400 });
    }
    if (!CHAT_ANSWER_LENGTHS.includes(chatAnswerLength)) {
      return NextResponse.json(
        { error: 'chatAnswerLength must be "shorter", "default", or "longer"' },
        { status: 400 },
      );
    }
    if (chatStyle === 'custom') {
      if (typeof chatCustomStyle !== 'string' || !chatCustomStyle.trim()) {
        return NextResponse.json(
          { error: 'chatCustomStyle is required when chatStyle is "custom"' },
          { status: 400 },
        );
      }
      if (chatCustomStyle.length > MAX_CUSTOM_STYLE_LENGTH) {
        return NextResponse.json(
          { error: `chatCustomStyle must be ${MAX_CUSTOM_STYLE_LENGTH} characters or fewer` },
          { status: 400 },
        );
      }
    }

    const notebook = await updateChatSettings(supabase, notebookId, {
      chatStyle,
      chatCustomStyle: chatStyle === 'custom' ? chatCustomStyle : null,
      chatAnswerLength,
    });
    return NextResponse.json(notebook);
  }
  ```
- [ ] Run `npm run typecheck` — confirm it passes (this repo has no unit tests for thin CRUD/route layers; other layers cover this one indirectly, see Tasks 2–4).
- [ ] Commit: `git commit -m "feat: add per-notebook chat style/length settings"`

### Task 2: Apply settings to the system prompt

**Files:** `src/lib/generation/index.ts`, `src/lib/generation/buildSystemPrompt.test.ts`

- [ ] Write the failing test in `src/lib/generation/buildSystemPrompt.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { buildSystemPrompt } from './index';

  const base = { chatStyle: 'default' as const, chatCustomStyle: null, chatAnswerLength: 'default' as const };

  describe('buildSystemPrompt', () => {
    it('instructs a concise answer for "shorter"', () => {
      expect(buildSystemPrompt(3, { ...base, chatAnswerLength: 'shorter' })).toMatch(/concise/i);
    });

    it('instructs a more thorough answer for "default" than "shorter"', () => {
      expect(buildSystemPrompt(3, { ...base, chatAnswerLength: 'default' })).toMatch(/thorough/i);
    });

    it('instructs a comprehensive answer for "longer"', () => {
      expect(buildSystemPrompt(3, { ...base, chatAnswerLength: 'longer' })).toMatch(/comprehensive/i);
    });

    it('includes the custom style text when style is "custom"', () => {
      const prompt = buildSystemPrompt(3, {
        ...base,
        chatStyle: 'custom',
        chatCustomStyle: 'respond at a PhD student level',
      });
      expect(prompt).toContain('respond at a PhD student level');
    });

    it('adds no role/style instruction when style is "default"', () => {
      expect(buildSystemPrompt(3, base)).not.toMatch(/conversational style/i);
    });
  });
  ```
- [ ] Run it — confirm it fails (`buildSystemPrompt` isn't exported and doesn't take a second argument yet).
- [ ] In `src/lib/generation/index.ts`, import the shared types and rewrite `buildSystemPrompt`:
  ```ts
  import type { ChatSettings } from '@/lib/notebooks/chatSettings';

  const LENGTH_INSTRUCTIONS: Record<ChatSettings['chatAnswerLength'], string> = {
    shorter: 'Answer concisely, in a short paragraph or two.',
    default:
      'Answer thoroughly: a few solid paragraphs covering relevant nuance, context, and examples drawn from the passages.',
    longer:
      'Answer comprehensively and in detail: explore the topic thoroughly, using multiple paragraphs or sections as warranted by the passages.',
  };

  export function buildSystemPrompt(passageCount: number, chatSettings: ChatSettings): string {
    const lines = [
      `You answer questions using ONLY the numbered passages below as evidence. Passages are numbered [1] through [${passageCount}].`,
      'Cite every factual claim with the passage number(s) it is drawn from, in square brackets, e.g. "Cats are mammals [1]."',
      'Never use knowledge outside the passages.',
      `If the passages do not contain enough information to answer, write exactly this text as your answer, before the follow-up section: "${REFUSAL_TEXT}"`,
      LENGTH_INSTRUCTIONS[chatSettings.chatAnswerLength],
    ];
    if (chatSettings.chatStyle === 'custom' && chatSettings.chatCustomStyle) {
      lines.push(`Adopt this conversational goal, style, or role: ${chatSettings.chatCustomStyle}`);
    }
    lines.push(followUpPromptInstruction());
    return lines.join('\n');
  }
  ```
- [ ] In `askQuestion`, after the `results.length === 0` refusal check and before building the prompt, fetch the notebook's settings and pass them through:
  ```ts
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
  ```
- [ ] Run `npx vitest run src/lib/generation/buildSystemPrompt.test.ts` — confirm passing.
- [ ] Run `npx vitest run src/lib/generation/askQuestion.integration.test.ts` if real env vars are present (it's `skipIf` otherwise) — confirm still passing against the new notebook columns' defaults.
- [ ] Commit: `git commit -m "feat: apply chat style/length settings to the system prompt"`

### Task 3: Configure Chat dialog component

**Files:** `src/components/chat/configure-chat-dialog.tsx`, `src/components/chat/configure-chat-dialog.test.tsx`

- [ ] Write the failing test in `src/components/chat/configure-chat-dialog.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { describe, expect, it, vi } from 'vitest';
  import { ConfigureChatDialog } from './configure-chat-dialog';

  const defaultSettings = { chatStyle: 'default' as const, chatCustomStyle: null, chatAnswerLength: 'default' as const };

  describe('ConfigureChatDialog', () => {
    it('opens the dialog and shows style/length pill options', async () => {
      const user = userEvent.setup();
      render(<ConfigureChatDialog settings={defaultSettings} onSave={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /configure chat/i }));
      expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Longer' })).toBeInTheDocument();
    });

    it('blocks Save until custom style text is entered, then saves it', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<ConfigureChatDialog settings={defaultSettings} onSave={onSave} />);
      await user.click(screen.getByRole('button', { name: /configure chat/i }));
      await user.click(screen.getByRole('button', { name: 'Custom' }));

      const saveButton = screen.getByRole('button', { name: 'Save' });
      expect(saveButton).toBeDisabled();

      await user.type(screen.getByPlaceholderText(/respond at a phd student level/i), 'Be a pirate');
      expect(saveButton).toBeEnabled();

      await user.click(saveButton);
      expect(onSave).toHaveBeenCalledWith({
        chatStyle: 'custom',
        chatCustomStyle: 'Be a pirate',
        chatAnswerLength: 'default',
      });
    });
  });
  ```
- [ ] Run it — confirm it fails (`configure-chat-dialog.tsx` doesn't exist yet).
- [ ] Implement `src/components/chat/configure-chat-dialog.tsx`:
  ```tsx
  'use client';

  import { useState } from 'react';
  import { SlidersHorizontal } from 'lucide-react';
  import { Button } from '@/components/ui/button';
  import { Textarea } from '@/components/ui/textarea';
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '@/components/ui/dialog';
  import {
    MAX_CUSTOM_STYLE_LENGTH,
    type ChatAnswerLength,
    type ChatSettings,
    type ChatStyle,
  } from '@/lib/notebooks/chatSettings';

  const STYLE_OPTIONS: { id: ChatStyle; label: string }[] = [
    { id: 'default', label: 'Default' },
    { id: 'custom', label: 'Custom' },
  ];

  const LENGTH_OPTIONS: { id: ChatAnswerLength; label: string }[] = [
    { id: 'shorter', label: 'Shorter' },
    { id: 'default', label: 'Default' },
    { id: 'longer', label: 'Longer' },
  ];

  export function ConfigureChatDialog({
    settings,
    onSave,
  }: {
    settings: ChatSettings;
    onSave: (settings: ChatSettings) => Promise<void>;
  }) {
    const [open, setOpen] = useState(false);
    const [chatStyle, setChatStyle] = useState<ChatStyle>(settings.chatStyle);
    const [chatCustomStyle, setChatCustomStyle] = useState(settings.chatCustomStyle ?? '');
    const [chatAnswerLength, setChatAnswerLength] = useState<ChatAnswerLength>(settings.chatAnswerLength);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function handleOpenChange(next: boolean) {
      setOpen(next);
      if (next) {
        setChatStyle(settings.chatStyle);
        setChatCustomStyle(settings.chatCustomStyle ?? '');
        setChatAnswerLength(settings.chatAnswerLength);
        setError(null);
      }
    }

    const canSave = chatStyle === 'default' || chatCustomStyle.trim().length > 0;

    async function handleSubmit(event: React.FormEvent) {
      event.preventDefault();
      if (!canSave) return;
      setSaving(true);
      setError(null);
      try {
        await onSave({
          chatStyle,
          chatCustomStyle: chatStyle === 'custom' ? chatCustomStyle : null,
          chatAnswerLength,
        });
        setOpen(false);
      } catch {
        setError('Something went wrong saving your settings. Please try again.');
      } finally {
        setSaving(false);
      }
    }

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Configure chat"
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontal />
        </Button>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Configure Chat</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Define your conversational goal, style, or role</p>
              <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                {STYLE_OPTIONS.map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant={chatStyle === id ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setChatStyle(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {chatStyle === 'custom' && (
                <div className="flex flex-col gap-1">
                  <Textarea
                    value={chatCustomStyle}
                    onChange={(event) =>
                      setChatCustomStyle(event.target.value.slice(0, MAX_CUSTOM_STYLE_LENGTH))
                    }
                    placeholder='Examples: "respond at a PhD student level", "pretend to be a role-playing game host"'
                    rows={4}
                    required
                  />
                  <span className="text-xs text-muted-foreground">
                    {chatCustomStyle.length} / {MAX_CUSTOM_STYLE_LENGTH}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Choose your response length</p>
              <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                {LENGTH_OPTIONS.map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant={chatAnswerLength === id ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setChatAnswerLength(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={saving || !canSave}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
  ```
- [ ] Run `npx vitest run src/components/chat/configure-chat-dialog.test.tsx` — confirm passing.
- [ ] Commit: `git commit -m "feat: add Configure Chat dialog component"`

### Task 4: Wire the dialog into the chat header and workspace

**Files:** `src/components/chat/chat-panel.tsx`, `src/components/chat/chat-panel.test.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx`

- [ ] Update `chat-panel.test.tsx`'s `renderPanel` helper (and the manual `rerender(...)` call) to pass two new required props:
  ```ts
  chatSettings: { chatStyle: 'default', chatCustomStyle: null, chatAnswerLength: 'default' },
  onUpdateChatSettings: vi.fn(),
  ```
  Add one new test:
  ```tsx
  it('opens Configure Chat from the header settings icon', async () => {
    const user = userEvent.setup();
    renderPanel([]);
    await user.click(screen.getByRole('button', { name: /configure chat/i }));
    expect(screen.getByRole('heading', { name: 'Configure Chat' })).toBeInTheDocument();
  });
  ```
- [ ] Run it — confirm it fails (no settings icon in the header yet, and `ChatPanel` doesn't accept the new props).
- [ ] In `chat-panel.tsx`, import `ConfigureChatDialog` and `ChatSettings`, add the two props, and update the header:
  ```tsx
  import { ConfigureChatDialog } from './configure-chat-dialog';
  import type { ChatSettings } from '@/lib/notebooks/chatSettings';
  // ...
  export function ChatPanel({
    messages,
    question,
    onQuestionChange,
    onAsk,
    asking,
    askError,
    hasProcessingSources,
    onSelectFollowUp,
    sourceCount,
    chatSettings,
    onUpdateChatSettings,
  }: {
    // ...existing fields...
    chatSettings: ChatSettings;
    onUpdateChatSettings: (settings: ChatSettings) => Promise<void>;
  }) {
    // ...
    <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <h2 className="text-sm font-medium text-foreground">Chat</h2>
      <ConfigureChatDialog settings={chatSettings} onSave={onUpdateChatSettings} />
    </div>
  ```
- [ ] Run `npx vitest run src/components/chat/chat-panel.test.tsx` — confirm passing.
- [ ] In `notebook-workspace.tsx`, add state defaulted to `{ chatStyle: 'default', chatCustomStyle: null, chatAnswerLength: 'default' }`, populate it in `refreshNotebook` defensively (`notebook.chat_style ?? 'default'`, etc., so existing test fixtures that omit these fields keep working), add a save handler, and thread both into `<ChatPanel>`:
  ```ts
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    chatStyle: 'default',
    chatCustomStyle: null,
    chatAnswerLength: 'default',
  });

  async function refreshNotebook() {
    const response = await fetch(`/api/notebooks/${notebookId}`);
    if (!response.ok) return;
    const notebook = await response.json();
    setNotebookTitle(notebook.title);
    setChatSettings({
      chatStyle: notebook.chat_style ?? 'default',
      chatCustomStyle: notebook.chat_custom_style ?? null,
      chatAnswerLength: notebook.chat_answer_length ?? 'default',
    });
  }

  async function handleUpdateChatSettings(next: ChatSettings) {
    const response = await fetch(`/api/notebooks/${notebookId}/chat-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!response.ok) throw new Error('Failed to update chat settings');
    setChatSettings(next);
  }
  ```
  and in the `chatPanel` JSX:
  ```tsx
  <ChatPanel
    // ...existing props...
    chatSettings={chatSettings}
    onUpdateChatSettings={handleUpdateChatSettings}
  />
  ```
- [ ] Add a test to `notebook-workspace.test.tsx` covering the full save flow:
  ```tsx
  it('saves chat settings from the Configure Chat dialog', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/sources')) return jsonResponse([]);
      if (url.endsWith('/messages')) return jsonResponse([]);
      if (url.endsWith('/chat-settings')) return jsonResponse({ id: 'n1' });
      return jsonResponse({ id: 'n1', title: 'Untitled notebook' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotebookWorkspace notebookId="n1" />);
    const user = userEvent.setup();
    const [settingsButton] = await screen.findAllByRole('button', { name: /configure chat/i });
    await user.click(settingsButton);
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    await user.type(screen.getByPlaceholderText(/respond at a phd student level/i), 'Be a pirate');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notebooks/n1/chat-settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            chatStyle: 'custom',
            chatCustomStyle: 'Be a pirate',
            chatAnswerLength: 'default',
          }),
        }),
      ),
    );
  });
  ```
- [ ] Run the full test suite (`npm run test`) — confirm everything passes.
- [ ] Run `npm run typecheck` — confirm clean.
- [ ] Commit: `git commit -m "feat: wire Configure Chat dialog into the chat header"`

### Task 5: Docs

**Files:** `docs/ARCHITECTURE.md`

- [ ] In §4 (Logical data model), add a line noting the notebook entity now also carries `chat_style`, `chat_custom_style`, and `chat_answer_length` (per-notebook chat answer configuration).
- [ ] In §8 (Retrieval and grounded chat), note that the generation step's system prompt is built from the notebook's saved style/length settings.
- [ ] Commit: `git commit -m "docs: document per-notebook chat settings"`

---

## Self-review

1. **Task count:** 5 — within the ≤7 limit.
2. **Coverage:** migration/persistence (Task 1), prompt application (Task 2), dialog UI (Task 3), header/workspace wiring (Task 4), docs (Task 5) — every item in the design brief's "Expected files touched" and "Success criteria" is covered. Future-only application falls out naturally (settings are only read at `askQuestion` time, never applied retroactively). Overview generation is untouched by design (no task touches `src/lib/generation/notebookIntro`-related code).
3. **Placeholders:** none — every step has concrete code, not "similar to Task N".
4. **Type consistency:** `ChatStyle`, `ChatAnswerLength`, `ChatSettings`, `MAX_CUSTOM_STYLE_LENGTH` are defined once in `src/lib/notebooks/chatSettings.ts` (deliberately without `server-only`, since Task 3's client component and Task 2's server module both need it) and reused verbatim across Tasks 1–4 — no redefinition or drift.

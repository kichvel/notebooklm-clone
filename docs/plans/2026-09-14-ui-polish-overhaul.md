# UI Polish Overhaul — Implementation Plan

**Goal:** Give Sourcebook a cleaner, more finished look — Inter font, per-file-type source icons, an aligned sidebar header, and NotebookLM-style chat bubbles — with zero functional or color/token changes.

**Branch:** `worktree-ui-polish-overhaul`
**Stack:** Next.js App Router, Tailwind v4 (config-in-CSS), shadcn/ui, lucide-react, Vitest + Testing Library

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/app/layout.tsx` | Swap `Geist` → `Inter` via `next/font/google` |
| Modify | `src/app/globals.css` | Fix `--font-sans` theme token (currently self-referential, never applies the loaded font) to point at the new font variable |
| Modify | `src/components/sources/source-item.tsx` | Map `source.type` to a distinct lucide icon instead of one hardcoded `FileTextIcon` |
| Test   | `src/components/sources/source-list.test.tsx` | Assert each source type renders a distinct icon |
| Modify | `src/components/workspace/workspace-shell.tsx` | Add a `sourcesHeaderAction` slot so "Add sources" renders on the same row as the collapse toggle |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | Lift `AddSourceDialog` out of the panel body into the new header slot |
| Test   | `src/components/workspace/workspace-shell.test.tsx` (new) | Assert the header action and collapse toggle share one row, and the action hides when collapsed |
| Modify | `src/components/chat/chat-panel.tsx` | Render user messages as filled rounded bubbles; assistant messages unchanged |
| Test   | `src/components/chat/chat-panel.test.tsx` | Assert user messages render inside a bubble element |

---

## Tasks

### Task 1: Switch to Inter and fix the font token wiring

**Files:** `src/app/layout.tsx`, `src/app/globals.css`

While surveying, found that `globals.css`'s `@theme inline` block sets `--font-sans: var(--font-sans);` — a self-reference that never actually resolves to the Geist variable Next.js sets on `<html>`. This is fixed as part of the swap, which is also why the font may not have looked distinctive before.

- [ ] In `src/app/layout.tsx`, replace the `Geist` import/usage with `Inter`, naming its CSS variable `--font-inter` (keep `Geist_Mono` as-is — unused by any UI today):
  ```tsx
  import { Geist_Mono, Inter } from 'next/font/google';

  const inter = Inter({
    variable: '--font-inter',
    subsets: ['latin'],
  });

  const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin'],
  });
  ```
  and update the `<html>` className to `${inter.variable} ${geistMono.variable} h-full antialiased`.
- [ ] In `src/app/globals.css`, change line 10 from `--font-sans: var(--font-sans);` to `--font-sans: var(--font-inter);`.
- [ ] Run `npm run dev`, open any page, confirm Inter renders (check DevTools computed `font-family` on `body`).
- [ ] Run `npm run typecheck` and `npm run build` — confirm both pass.
- [ ] Commit: `git commit -m "style: switch UI font to Inter and fix font-sans token wiring"`

### Task 2: Per-file-type source icons

**Files:** `src/components/sources/source-item.tsx`, `src/components/sources/source-list.test.tsx`

- [ ] Add a failing test to `source-list.test.tsx` asserting each known `source.type` renders a distinct icon:
  ```tsx
  it('renders a distinct icon for each source type', () => {
    const types: SourceSummary['type'][] = [
      'pdf',
      'docx',
      'txt',
      'audio',
      'website',
      'youtube',
      'pasted_text',
    ];
    const mixed: SourceSummary[] = types.map((type, i) => ({
      id: String(i),
      title: `source-${type}`,
      status: 'ready',
      failure_reason: null,
      type,
      created_at: '',
    }));
    render(
      <SourceList
        sources={mixed}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const icons = types.map((type) => screen.getByTestId(`source-icon-${type}`).outerHTML);
    expect(new Set(icons).size).toBe(icons.length);
  });
  ```
  Note: `SourceSummary['type']` is currently typed `string`; leave it as `string` in the fixture cast (`type as SourceSummary['type']` not needed since the field is already `string`) — just use `string[]` for the `types` array if the compiler complains about literal narrowing.
- [ ] Run it — confirm it fails (`getByTestId` throws, since no icon carries a `data-testid` yet).
- [ ] In `source-item.tsx`, replace the single hardcoded icon with a type map:
  ```tsx
  import {
    ClipboardIcon,
    FileAudio2Icon,
    FileIcon,
    FileTextIcon,
    FileType2Icon,
    LinkIcon,
    RotateCcwIcon,
    Trash2Icon,
    VideoIcon,
  } from 'lucide-react';

  const SOURCE_TYPE_ICONS: Record<string, typeof FileIcon> = {
    pdf: FileTextIcon,
    docx: FileType2Icon,
    txt: FileIcon,
    audio: FileAudio2Icon,
    website: LinkIcon,
    youtube: VideoIcon,
    pasted_text: ClipboardIcon,
  };

  function SourceTypeIcon({ type }: { type: string }) {
    const Icon = SOURCE_TYPE_ICONS[type] ?? FileIcon;
    return (
      <Icon
        data-testid={`source-icon-${type}`}
        className="size-4 shrink-0 text-muted-foreground"
      />
    );
  }
  ```
  and replace `<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />` in the render with `<SourceTypeIcon type={source.type} />`.
- [ ] Run tests — confirm the new test and all existing `source-list`/`source-item` tests pass.
- [ ] Commit: `git commit -m "feat: give each source type its own icon"`

### Task 3: Align "Add sources" with the collapse toggle

**Files:** `src/components/workspace/workspace-shell.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`, `src/components/workspace/workspace-shell.test.tsx` (new)

- [ ] Create `src/components/workspace/workspace-shell.test.tsx` with a failing test:
  ```tsx
  import { render, screen, within } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { describe, expect, it } from 'vitest';
  import { WorkspaceShell } from './workspace-shell';

  function renderShell() {
    return render(
      <WorkspaceShell
        sources={<div>source list</div>}
        sourcesHeaderAction={<button>Add sources</button>}
        chat={<div>chat</div>}
        studio={<div>studio</div>}
      />,
    );
  }

  describe('WorkspaceShell', () => {
    it('renders the sources header action on the same row as the collapse toggle', () => {
      renderShell();
      const header = screen.getByTestId('sources-panel-header');
      expect(within(header).getByRole('button', { name: 'Add sources' })).toBeInTheDocument();
      expect(
        within(header).getByRole('button', { name: /collapse sources panel/i }),
      ).toBeInTheDocument();
    });

    it('hides the header action once the sources panel is collapsed', async () => {
      const user = userEvent.setup();
      renderShell();
      const header = screen.getByTestId('sources-panel-header');
      await user.click(within(header).getByRole('button', { name: /collapse sources panel/i }));
      expect(within(header).queryByRole('button', { name: 'Add sources' })).not.toBeInTheDocument();
    });
  });
  ```
- [ ] Run it — confirm it fails (`WorkspaceShell` doesn't accept `sourcesHeaderAction` yet and has no `sources-panel-header` testid).
- [ ] In `workspace-shell.tsx`, add the prop and restructure the header row:
  ```tsx
  interface WorkspaceShellProps {
    sources: React.ReactNode;
    sourcesHeaderAction: React.ReactNode;
    chat: React.ReactNode;
    studio: React.ReactNode;
  }

  export function WorkspaceShell({ sources, sourcesHeaderAction, chat, studio }: WorkspaceShellProps) {
    const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
    const [studioCollapsed, setStudioCollapsed] = useState(false);

    return (
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <div
          className={cn(
            'hidden overflow-y-auto border-r border-border lg:flex lg:flex-col lg:shrink-0',
            sourcesCollapsed ? 'lg:w-12' : 'lg:w-80',
          )}
        >
          <div
            data-testid="sources-panel-header"
            className="flex shrink-0 items-center gap-2 border-b border-border p-2"
          >
            {!sourcesCollapsed && <div className="min-w-0 flex-1">{sourcesHeaderAction}</div>}
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={sourcesCollapsed ? 'Expand sources panel' : 'Collapse sources panel'}
              onClick={() => setSourcesCollapsed((collapsed) => !collapsed)}
            >
              {sourcesCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
            </Button>
          </div>
          {!sourcesCollapsed && sources}
        </div>

        <div className="hidden flex-1 flex-col overflow-y-auto lg:flex">{chat}</div>

        <div
          className={cn(
            'hidden overflow-y-auto border-l border-border lg:flex lg:flex-col lg:shrink-0',
            studioCollapsed ? 'lg:w-12' : 'lg:w-80',
          )}
        >
          <div className="flex shrink-0 items-center justify-start border-b border-border p-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={studioCollapsed ? 'Expand studio panel' : 'Collapse studio panel'}
              onClick={() => setStudioCollapsed((collapsed) => !collapsed)}
            >
              {studioCollapsed ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
            </Button>
          </div>
          {!studioCollapsed && studio}
        </div>

        <MobileTabs
          sources={sources}
          sourcesHeaderAction={sourcesHeaderAction}
          chat={chat}
          studio={studio}
        />
      </div>
    );
  }
  ```
  and update `MobileTabs` to render the header action above the sources content (mobile has no header row of its own):
  ```tsx
  function MobileTabs({ sources, sourcesHeaderAction, chat, studio }: WorkspaceShellProps) {
    return (
      <Tabs defaultValue="chat" className="flex flex-1 flex-col overflow-hidden lg:hidden">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="studio">Studio</TabsTrigger>
        </TabsList>
        <TabsContent value="sources" className="flex-1 overflow-y-auto">
          <div className="px-3 pt-3">{sourcesHeaderAction}</div>
          {sources}
        </TabsContent>
        <TabsContent value="chat" className="flex-1 overflow-y-auto">
          {chat}
        </TabsContent>
        <TabsContent value="studio" className="flex-1 overflow-y-auto">
          {studio}
        </TabsContent>
      </Tabs>
    );
  }
  ```
- [ ] In `notebook-workspace.tsx`, split the old `sourcesPanel` into the header action and the panel body, and pass both to `WorkspaceShell`:
  ```tsx
  const sourcesHeaderAction = (
    <>
      <AddSourceDialog
        onAddFiles={handleAddFiles}
        onAddWebsite={handleAddWebsite}
        onAddYoutube={handleAddYoutube}
        onAddText={handleAddText}
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </>
  );

  const sourcesPanel = (
    <SourceList
      sources={sources}
      selectedIds={selectedSourceIds}
      onSelectionChange={setSelectedSourceIds}
      onRetry={handleRetry}
      onDelete={handleDeleteSource}
    />
  );
  ```
  and update the render to `<WorkspaceShell sources={sourcesPanel} sourcesHeaderAction={sourcesHeaderAction} chat={chatPanel} studio={studioPanel} />`.
- [ ] Run tests — confirm the new `workspace-shell.test.tsx` passes and nothing else broke.
- [ ] Manually verify in the browser: expanded sidebar shows "Add sources" and the collapse icon on one row; collapsing hides the button and keeps just the icon; mobile "Sources" tab still shows the add-sources button.
- [ ] Commit: `git commit -m "feat: align add-sources button with the sidebar collapse toggle"`

### Task 4: User chat bubbles

**Files:** `src/components/chat/chat-panel.tsx`, `src/components/chat/chat-panel.test.tsx`

- [ ] Add a failing test to `chat-panel.test.tsx`:
  ```tsx
  it('renders user messages as a bubble distinct from assistant text', () => {
    renderPanel([
      { id: 'u1', role: 'user', content: 'Hello there', status: 'complete', created_at: '', citations: [] },
      messageWithCitation,
    ]);
    expect(screen.getByTestId('chat-bubble-user')).toHaveTextContent('Hello there');
  });
  ```
- [ ] Run it — confirm it fails (no element with that test id yet).
- [ ] In `chat-panel.tsx`, wrap user message content in a bubble instead of a plain paragraph:
  ```tsx
  <li key={message.id} className={message.role === 'user' ? 'self-end' : 'self-start'}>
    {message.role === 'assistant' ? (
      <AnswerText
        content={message.content}
        citations={message.citations}
        onOpenCitation={setOpenCitation}
      />
    ) : (
      <p
        data-testid="chat-bubble-user"
        className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2 text-sm text-secondary-foreground"
      >
        {message.content}
      </p>
    )}
  </li>
  ```
  (drops the old `font-medium` on the `<li>` — the bubble fill now carries the visual weight).
- [ ] Run tests — confirm passing, including the existing citation-drawer test.
- [ ] Manually verify in the browser that user bubbles look like the reference screenshot and assistant replies remain plain text with working citation buttons.
- [ ] Commit: `git commit -m "feat: render user chat messages as bubbles"`

---

## Self-review

1. **Task count:** 4 — well under the 7-task ceiling.
2. **Coverage:** font ✅ (Task 1), source icons ✅ (Task 2), sidebar header alignment ✅ (Task 3), chat bubbles ✅ (Task 4). Color/spacing tokens deliberately untouched per the design brief's constraints.
3. **Placeholders:** none — every step has concrete code.
4. **Type consistency:** `WorkspaceShellProps` shape matches between the test file and the component; `SourceSummary['type']` usage matches the existing `string`-typed field; icon map keys match the real `source.type` values found in `src/lib/sources`.

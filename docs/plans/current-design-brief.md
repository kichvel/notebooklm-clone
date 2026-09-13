# Design Brief — NotebookLM-style Workspace UI

**Goal:** Redesign Sourcebook's UI as a close visual clone of NotebookLM's dark three-column workspace (Sources / Chat / Studio), plus the missing notebook-list page.

**Date:** 2026-09-13

## Shared understanding

We're rebuilding the Sourcebook workspace to closely follow NotebookLM's dark, three-column layout — Sources on the left, Chat in the center, and a new Studio column on the right hosting three generation features: Study guide, Flashcards, and Quiz (UI only, generation logic stubbed with canned output for now). We're also building the notebook list/dashboard page, which currently doesn't exist at all. The workspace header keeps an editable title, a link back to the notebook list, and a way to create a new notebook; everything else from NotebookLM's header (Copy, Analytics, Share, Settings, avatar) is dropped since there's no auth/sharing/collaboration. Citation inspection (ADR-008) stays as an overlay drawer sliding in from the right over the Studio/chat area, not a permanent fourth column. Theme defaults to dark with a light-mode toggle. Notes/saved excerpts stay out of scope.

## Key decisions

- Adopt shadcn/ui (Radix-based primitives) + `next-themes` for dialogs, dropdowns, tooltips, sheet (citation drawer), and theming — not hand-rolled.
- Citation drawer uses shadcn `Sheet` anchored right, replacing the current hand-rolled fixed-position div in `notebook-workspace.tsx`.
- Studio feature cards (Study guide, Flashcards, Quiz) are client-side stubs: clicking produces a fake loading state then canned placeholder output. No new API routes or Inngest functions this pass.
- Backend routes under `src/app/api/**` are unchanged; this is a UI-only pass against existing notebooks/sources/messages endpoints.
- Below the `lg` breakpoint, the three columns collapse into a tab switcher (Sources / Chat / Studio) instead of a separate mobile component tree.
- `docs/PRODUCT.md`'s non-goals section gets a small edit noting Study guide/Flashcards/Quiz are now planned (UI landed, generation logic pending), so it stops contradicting the codebase.

## Constraints

- No changes to backend/API behavior, ingestion pipeline, or grounding rules (ADR-005, ADR-007, ADR-008) — this is presentation-layer only.
- Anonymous single-user model stays intact — no auth, sharing, or collaboration UI.
- Must stay responsive down to mobile width (MVP requirement in `docs/PRODUCT.md`).

## Out of scope

- Real generation logic for Study guide/Flashcards/Quiz (stubbed only).
- Audio/Video Overview, Mind Map, Reports, Infographic, Data Table, Slide Deck.
- Web search / "Search the web" sourcing widget.
- Notes / saved answer excerpts ("Add note").
- Multiple conversations or conversation history/management.
- Any auth, sharing, permissions, or multi-user features.

## Success criteria

- Notebook list page exists: create, open, rename, delete notebooks, with proper empty/loading states.
- Workspace renders the three-column dark layout matching the screenshot's structure and density; collapses to a tabbed single column below `lg`.
- Sources panel: add source, per-source status (processing/ready/failed) with retry, select-all + per-source checkboxes, delete with confirmation.
- Chat panel: welcome/empty state with overview + suggested questions once generated, message list, citation markers open the right-side overlay drawer with exact passage.
- Studio panel: three feature cards (Study guide, Flashcards, Quiz) that open a stub generation flow (loading → canned output).
- Dark theme by default, toggle to light theme works and persists.
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass.

## Expected files touched

- `src/app/page.tsx` — rebuilt as notebook list/dashboard
- `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — rebuilt into three-column shell + header
- `src/app/layout.tsx`, `src/app/globals.css` — theme provider wiring, shadcn CSS variables
- `components.json`, `src/lib/utils.ts` — new, from shadcn init
- `src/components/ui/*` — new shadcn primitives (button, dialog, dropdown-menu, input, tooltip, skeleton, sheet, etc.)
- `src/components/sources/*`, `src/components/chat/*`, `src/components/studio/*`, `src/components/notebooks/*` — new feature components
- `src/components/theme-provider.tsx` — new
- `docs/PRODUCT.md` — small non-goals edit
- `package.json` / `package-lock.json` — new deps (shadcn-generated primitives, `next-themes`, `lucide-react`)

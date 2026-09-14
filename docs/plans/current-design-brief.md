# Design Brief — UI Polish Overhaul

**Goal:** Take Sourcebook from scaffold-level visuals to a cleaner, more finished look — font, source icons, sidebar header layout, and chat bubbles — without touching functionality or the color/spacing design tokens.

**Date:** 2026-09-14

## Shared understanding

The app is functionally scaffolded but visually still rough. This pass fixes four concrete things, prioritizing the notebook workspace view: (1) swap the UI font to Inter — the closest publicly-licensed match to the Google Sans font NotebookLM itself uses (Google Sans is not distributed via Google Fonts/next-font, so it can't be embedded directly); (2) give each source list item a distinct icon based on its file type instead of one generic file icon for everything; (3) move the "Add sources" button onto the same header row as the collapse-left-sidebar toggle, instead of stacked below it; (4) render user chat messages as rounded bubbles (right-aligned, filled background) matching NotebookLM's chat style, while assistant messages stay plain left-aligned text as they are today. The rest of the app (notebook list/dashboard, notebook cards, studio panel, mobile tabs) gets the font change and any icon reuse for free, but no dedicated layout rework this round.

## Key decisions

- Font: `next/font/google` `Inter` replaces `Geist` in `src/app/layout.tsx`. `Geist_Mono` stays as-is — it's not used anywhere in current UI (`font-mono` class has zero usages in `src/components`/`src/app`).
- Source icon map keyed on the existing `source.type` union (`pdf | docx | txt | audio | website | youtube | pasted_text`), added in `src/components/sources/source-item.tsx`, reusing `lucide-react` icons already available in the project (same icon family already used for the add-source mode pills in `add-source-dialog.tsx` where it overlaps, e.g. website/youtube).
- Sidebar header: the sources-panel header row in `src/components/workspace/workspace-shell.tsx` gains the "Add sources" trigger next to the collapse toggle when expanded; collapsed state keeps just the icon-only toggle. The `AddSourceDialog` component's internal dialog/form logic is unchanged — only where its trigger button is mounted moves.
- Chat bubbles: in `src/components/chat/chat-panel.tsx`, user messages get a bubble wrapper (rounded, filled background, right-aligned, max-width constrained); assistant messages and citation-button behavior are unchanged.
- No changes to `globals.css` color tokens, spacing scale, or radius tokens — this is layout/iconography/typography only.

## Constraints

- Keep existing shadcn color, spacing, and radius tokens untouched.
- No functional/behavioral changes — dialog logic, source retry/delete, citation drawer, polling, etc. all work exactly as before.
- No new dependencies beyond `next/font/google`'s `Inter` (already available, no install needed) and existing `lucide-react` icons.

## Out of scope

- Restyling the color palette, spacing rhythm, or component visual language (buttons, cards, badges) beyond what's needed for the four items above.
- Dedicated mobile-layout rework (`MobileTabs` in `workspace-shell.tsx`) — best-effort only (inherits font/icon changes, no bespoke mobile layout work).
- Dashboard/notebook-list (`src/app/page.tsx`, `notebook-card.tsx`) and studio panel layout rework — best-effort only, same reasoning.
- Any new source types or icon fallback design system beyond the current known type union.

## Success criteria

- Inter renders as the visible sans-serif font across the app.
- Each source list item shows an icon matching its file type (pdf/docx/txt/audio/website/youtube/pasted_text are visually distinguishable, not all the same icon).
- In the notebook workspace, "Add sources" and the collapse-sidebar toggle appear on the same row when the sidebar is expanded.
- User chat messages render as rounded bubbles distinct from assistant messages; assistant messages remain plain text with working citations.
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass.

## Expected files touched

- `src/app/layout.tsx` — font swap to Inter
- `src/app/globals.css` — font CSS variable wiring only (no color/spacing changes)
- `src/components/sources/source-item.tsx` — per-type icon map
- `src/components/sources/source-list.tsx` — empty-state icon touch-up if needed
- `src/components/workspace/workspace-shell.tsx` — header row layout for collapse toggle + add-sources trigger
- `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — composition change to lift add-source trigger into the header slot
- `src/components/chat/chat-panel.tsx` — user message bubble styling

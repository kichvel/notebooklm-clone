# Design Brief — Configure Chat (Answer Style & Length)

**Goal:** Users can open a "Configure Chat" dialog from the chat header to set an answer style (Default or a custom role/tone instruction) and answer length (Shorter/Default/Longer), saved per-notebook and applied to future chat answers only.
**Date:** 2026-09-14

## Shared understanding
We're adding a settings (sliders) icon to the chat panel header that opens a "Configure Chat" dialog, matching NotebookLM's UX for feature parity (not driven by a specific user complaint). The dialog lets the user choose an answer style — Default, or Custom with a required free-text role/tone instruction (up to 10,000 chars, Save blocked until non-empty) — and an answer length: Shorter (today's current concise behavior), Default (a new, meaningfully more thorough baseline), or Longer (comprehensive/detailed). Settings are stored per-notebook, alongside title/sources, and only affect future chat answers; existing messages keep the style/length active when they were generated, mirroring how deselecting a source doesn't change past answers. This is scoped strictly to chat Q&A — it does not touch the auto-generated notebook overview (also short today, but tracked as a separate follow-up issue).

## Key decisions
- Two style presets only for now: Default and Custom (no built-in "Learning Guide" preset).
- Settings persist per-notebook via new columns on the `notebooks` table (matches the existing `intro_generated_at` pattern) — no new table.
- Applied via system-prompt instructions in `buildSystemPrompt()`, not `max_tokens` caps — length is currently fully unconstrained in the provider call, so this is prompt-instruction-only.
- Follows the existing mutation pattern exactly: client component → `fetch` → API route (`createClient()`, `auth.getUser()` 401 check, manual `typeof`/allowed-value validation, no Zod) → `src/lib/notebooks` function → Supabase `.update()`.
- `notebookId` and chat settings need to be threaded down into `ChatPanel` (currently not passed), following the same prop-drilling/callback convention used for `AddSourceDialog`.

## Constraints
- Must reuse existing `Dialog` UI kit (`src/components/ui/dialog.tsx`) and the hand-rolled pill-button pattern from `add-source-dialog.tsx` (no `ToggleGroup`/`RadioGroup` exists in the kit).
- No Zod in this codebase — validation stays manual, inline in the route handler.
- RLS/ownership already covers `notebooks` table updates; no new policy needed.

## Out of scope
- Regenerating past answers when settings change.
- Any change to notebook overview generation length (file separately).
- Streaming responses (the messages API route is already non-streaming JSON; unaffected).
- Additional style presets beyond Default/Custom.

## Success criteria
- Settings icon visible in chat header; opens dialog matching the Default/Custom style + Shorter/Default/Longer length layout.
- Custom style requires non-empty text (≤10,000 chars) before Save is enabled.
- Saved settings persist across reloads (stored on the notebook row).
- A new question asked after changing settings produces an answer reflecting the new style/length instruction; previously generated answers are unaffected.
- Overview generation behavior is untouched.

## Expected files touched
- `supabase/migrations/<new>_notebook_chat_settings.sql` — new columns on `notebooks`
- `src/lib/notebooks/index.ts` — `updateChatSettings()`, extend notebook shape
- `src/app/api/notebooks/[notebookId]/chat-settings/route.ts` — new `PATCH` route
- `src/lib/generation/index.ts` — fetch chat settings in `askQuestion`, extend `buildSystemPrompt()` with length/style instructions
- `src/components/chat/configure-chat-dialog.tsx` — new dialog component
- `src/components/chat/chat-panel.tsx` — settings icon in header, thread `notebookId`/settings/save handler
- `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — own chat settings state + save handler, pass down to `ChatPanel`
- `docs/ARCHITECTURE.md` §4 — note new notebook columns

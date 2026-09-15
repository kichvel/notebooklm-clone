# Design Brief — Follow-up chips & conversational awareness fixes

**Goal:** Follow-up chips show real, question-specific suggestions (or none) and never leak into answer text; chat correctly resolves pronoun/implicit references to prior turns.
**Date:** 2026-09-15

## Shared understanding
Two independent bugs in `src/lib/generation/`. (1) Follow-ups are generated in-band via a fragile `---FOLLOWUPS---` text delimiter that the model often fails to reproduce exactly, causing the follow-up section to leak into the visible answer while generic fallback chips are shown instead. (2) The answer-generation LLM call receives only the raw current question with zero conversation history, so it cannot resolve references like "what was he doing 2 years before that" even though a standalone-question rewrite already exists for retrieval purposes.

## Key decisions
- Follow-ups move to a separate, non-streaming, structured-output call made *after* the answer stream finishes and citations are validated. The streaming answer call no longer includes any follow-up instruction, so nothing follow-up-shaped can appear in `answer_delta` text.
- Add a new structured/JSON-schema-backed generation helper to `src/lib/providers/openai.ts` (still the only place touching the OpenAI SDK, per ADR-006) for exact-shape follow-up output — no more delimiter string parsing.
- New follow-up generator input: original question + finalized answer text + the retrieved passages block. Used for both the chat flow and `notebookIntro.ts` (intro has no "question"; pass it as optional/undefined there, with the source sample text as "passages" and the intro summary as "answer").
- `notebookIntro.ts` is refactored onto this same shared helper; its own `followUpPromptInstruction`/delimiter usage is removed.
- `FALLBACK_FOLLOW_UP_QUESTIONS` and all fallback logic are deleted entirely, including from `notebookIntro.ts`. No follow-ups (empty/null `follow_up_questions`) is always the fallback state now — never generic placeholder questions.
- Refused answers (insufficient evidence) skip follow-up generation entirely — no chips.
- If the follow-up generator call itself errors, catch it: the answer message still finalizes as `complete` with valid citations, just with no `follow_up_questions`. A follow-up failure must never fail or block the answer.
- The message's `done` event still waits for follow-up generation to finish before firing (keeps ADR-008's single-completion-event model simple) — no new async/partial-completion event added.
- Conversation history: refactor the existing last-6-messages Supabase fetch (currently inside `rewriteFollowUpQuery`) into a single shared fetch reused by both (a) the standalone-question rewrite for retrieval embedding, and (b) the answer-generation prompt, which now also receives the raw recent turns plus the literal original question.
- System prompt gains an explicit instruction: conversation history is for understanding intent/references only; the model must still answer solely from the numbered passages (ADR-005 preserved — history is never a fact source).

## Constraints
- Never call the OpenAI SDK directly outside `src/lib/providers/openai.ts` (ADR-006).
- Domain module boundaries in `src/lib/` preserved (generation/, retrieval/, providers/ stay separate).
- Answers remain grounded strictly in retrieved passages (ADR-005); history only aids interpretation.
- Streamed answers only marked complete after citation validation (ADR-008) — preserved, follow-up generation is additive to that same completion gate, not a new event type.

## Out of scope
- `retryAnswer` — it re-invokes `runGeneration` and inherits both fixes automatically; no separate changes needed.
- Client-side streaming display logic (`chat-panel.tsx`) — no longer needs any delimiter-awareness since the stream carries only answer text; existing rendering should just work once the server stops sending follow-up text in deltas.

## Success criteria
- No answer ever displays `---FOLLOWUPS---` or raw follow-up question text inline.
- Chips shown are always specific to the actual question/answer/passages, or absent — never `FALLBACK_FOLLOW_UP_QUESTIONS`-style generic text (that constant no longer exists in the codebase).
- Refused answers show no follow-up chips.
- A follow-up-generation failure does not fail or block the underlying answer.
- Asking a pronoun-dependent follow-up question after a prior answer resolves correctly using conversation history, without inventing facts outside the retrieved passages.

## Expected files touched
- `src/lib/generation/followUps.ts` — replace delimiter/parsing logic with the new structured follow-up generator function
- `src/lib/generation/followUps.test.ts` — rewrite tests for the new structured-output approach
- `src/lib/generation/index.ts` — remove in-band follow-up instruction from `buildSystemPrompt`; call new follow-up generator post-stream; thread shared history fetch + history-aware prompt into generation; add history-usage instruction to system prompt
- `src/lib/generation/rewriteQuery.ts` — extract/share the recent-messages fetch so it's queried once and reused
- `src/lib/generation/notebookIntro.ts` — switch to the shared follow-up generator; remove delimiter usage and fallback
- `src/lib/providers/openai.ts` — add a structured/JSON-schema output helper for follow-up generation
- `src/lib/providers/openai.test.ts` — tests for the new structured-output helper

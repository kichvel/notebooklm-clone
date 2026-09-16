# Design Brief — Public-deployment abuse guardrails

**Goal:** Before the live Vercel deployment is shared publicly, add the minimum set of guardrails that prevent it from running up an unbounded OpenAI bill or being trivially spammed — sized for a take-home evaluation demo, not enterprise production.
**Date:** 2026-09-15

## Shared understanding
Sourcebook is a take-home project for an AI Full Stack Engineer role, about to be deployed live and publicly linked. The evaluation bar here is judgment and proportionality, not attack-resistance: the goal is to demonstrate awareness of production AI cost/abuse concerns without over-engineering a 7-day demo. Today the app has solid input-safety fundamentals already in place (server-enforced 10-sources/10MB-per-file limits in `src/app/api/notebooks/[notebookId]/sources/route.ts`, SSRF-hardened URL fetching in `src/lib/ingestion/url-safety.ts`, RLS-backed ownership isolation) but nothing stops total request volume or OpenAI spend from growing unbounded — there's no rate limiting, no shared counter store, no security headers, and per ADR-003 anonymous Supabase identities can be trivially recreated so identity-only limits aren't sufficient alone. We're adding four small, independent pieces: (1) a deployment-wide daily AI-spend kill switch that visibly blocks new AI-costing work once a conservative, env-configurable ceiling is hit — the one failure mode that could actually break the demo or the bill before a reviewer opens it; (2) lightweight rate limiting keyed on both the anonymous identity and the request IP (defense against identity recreation) on the endpoints that cost money — notebook creation, source creation, chat messages; (3) free security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) since they cost nothing and are baseline hygiene; (4) a new ADR in `docs/DECISIONS.md`, matching the project's existing ADR format, explicitly recording this as a scoped "public demo hygiene" decision and naming what's deliberately excluded (CAPTCHA, WAF/bot scoring, ML-based fraud detection) so the trade-off reasoning itself is visible to a reviewer. No CAPTCHA or other user-facing friction — stays frictionless per the product's "useful before prompting" principle. Everything stays behind small, swappable interfaces consistent with the project's existing module boundaries; nothing here touches the anonymous-identity model, RLS, or the already-solid SSRF/file-size protections.

## Key decisions
- New dependency: Upstash Redis (free tier) + `@upstash/ratelimit` — the leanest shared counter store that works across Vercel's serverless/edge invocations; nothing else is set up yet.
- Rate limiting keys: `identity:<supabase-anon-user-id>` and `ip:<x-forwarded-for>`, checked together (request rejected if either is exceeded) — identity alone is insufficient since anon sessions can be recreated (ADR-003).
- Global kill switch: one Redis counter per UTC day (`ai-spend:<date>`), incremented on each AI-costing call site (embeddings, generation, transcription, source/notebook summaries), compared against a conservative env-configurable ceiling (e.g. `AI_DAILY_CALL_CEILING`). Tracks call count as a cost proxy, not literal dollars — simple, no billing-API integration needed.
- New small module `src/lib/abuse-prevention/` (naming to match existing `src/lib/<domain>/index.ts` convention) exposing `checkRateLimit(identity, ip, bucket)` and `checkGlobalCeiling()`, called from API routes before costly work starts. Kept separate from `providers/` since it's a cross-cutting request guard, not a model-provider concern.
- Applied at the API route layer (notebook creation, source creation routes, message/chat route) rather than global `middleware.ts`, since limits differ per action type (e.g. source creation vs. chat has a different bucket/cost weight) and the checks need the authenticated identity, which route handlers already resolve.
- When a limit is hit, return an actionable 429-style response with a clear message; the UI surfaces it using the existing error-display pattern (per product principle: failures are visible, not silent).
- Security headers added via `next.config.ts` `headers()` — no new dependency.
- Numeric defaults are conservative starting points documented in `.env.example` and the new ADR, tunable after watching real traffic — not treated as final/validated numbers.

## Constraints
- No added friction for legitimate users (no CAPTCHA, no verification step).
- Does not modify RLS policies, the anonymous-identity model, or existing SSRF/file-size/source-count enforcement — those are already adequate.
- OpenAI calls remain routed only through `src/lib/providers/` (ADR-006); the ceiling check wraps call sites, it doesn't reach into the provider module.
- Must degrade visibly (explicit blocked/limited message), never silently drop or fail work.

## Out of scope
- CAPTCHA or any bot-verification step.
- Vercel Firewall/WAF configuration, IP reputation, or ML-based abuse scoring.
- Literal dollar-based billing integration (OpenAI usage API polling) — call-count is an adequate proxy for this scope.
- Per-user account tiers, paid plans, or any authentication changes.
- Redoing or extending the existing SSRF, file-size, or source-count protections.

## Success criteria
- A scripted burst of requests (same identity or same IP) against notebook creation, source creation, or chat is visibly rejected with an actionable message once its bucket's limit is exceeded, without affecting other identities/IPs.
- Once the daily AI-call ceiling is reached, new source ingestion and new chat questions are visibly refused (not silently queued or dropped) until the counter resets the next UTC day; already-in-flight work is unaffected.
- Response headers on every page include CSP, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`.
- `docs/DECISIONS.md` has a new ADR describing this scope and its explicit exclusions, in the same rationale/trade-offs/revisit-when format as the existing records.
- `npm run typecheck`, `npm run lint`, and `npm run test` remain green; no existing test's behavior changes.

## Expected files touched
- `src/lib/abuse-prevention/index.ts` (new) — rate limit + global ceiling checks, Upstash client
- `src/lib/abuse-prevention/*.test.ts` (new) — unit tests for limit logic (mocked store)
- `src/app/api/notebooks/route.ts` — rate limit on notebook creation
- `src/app/api/notebooks/[notebookId]/sources/route.ts` — rate limit + ceiling check on source creation
- `src/app/api/notebooks/[notebookId]/sources/website/route.ts`, `.../youtube/route.ts` — same
- `src/app/api/notebooks/[notebookId]/messages/route.ts` — rate limit + ceiling check on chat
- `next.config.ts` — security headers
- `.env.example` — new Upstash + ceiling/limit env vars
- `docs/DECISIONS.md` — new ADR
- `package.json` — new `@upstash/ratelimit`, `@upstash/redis` dependencies

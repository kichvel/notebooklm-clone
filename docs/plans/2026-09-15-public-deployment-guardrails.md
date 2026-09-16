# Public-Deployment Abuse Guardrails — Implementation Plan

**Goal:** Add a deployment-wide daily AI-call ceiling, per-identity/per-IP rate limiting on cost-incurring endpoints, and baseline security headers, sized for a public take-home evaluation demo.
**Branch:** worktree-security-guardrails
**Stack:** Next.js App Router route handlers, Supabase (identity), Upstash Redis (shared counters), Vitest

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/lib/abuse-prevention/index.ts` | Rate limiting + daily AI-call ceiling checks, backed by Upstash Redis |
| Test   | `src/lib/abuse-prevention/index.test.ts` | Unit tests for the above, with `@upstash/redis` mocked |
| Modify | `package.json` | Add `@upstash/redis` dependency |
| Modify | `.env.example` | Document `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `AI_DAILY_CALL_CEILING` |
| Modify | `src/app/api/notebooks/route.ts` | Rate-limit notebook creation |
| Modify | `src/app/api/notebooks/[notebookId]/sources/route.ts` | Rate-limit + ceiling-check file/pasted-text source creation |
| Modify | `src/app/api/notebooks/[notebookId]/sources/website/route.ts` | Rate-limit + ceiling-check website source creation |
| Modify | `src/app/api/notebooks/[notebookId]/sources/youtube/route.ts` | Rate-limit + ceiling-check YouTube source creation |
| Modify | `src/app/api/notebooks/[notebookId]/messages/route.ts` | Rate-limit + ceiling-check chat question submission |
| Modify | `next.config.ts` | Baseline security response headers |
| Modify | `docs/DECISIONS.md` | New ADR-012 recording this as scoped demo hygiene, not production security |

---

## Task 1: Abuse-prevention core module

**Files:** `package.json`, `src/lib/abuse-prevention/index.ts`, `src/lib/abuse-prevention/index.test.ts`, `.env.example`

- [ ] Add the dependency:
  ```bash
  npm install @upstash/redis
  ```
- [ ] Write the failing tests in `src/lib/abuse-prevention/index.test.ts`:
  ```ts
  // @vitest-environment node
  import { afterEach, describe, expect, it, vi } from 'vitest';

  const store = new Map<string, number>();
  const incr = vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  });
  const expire = vi.fn(async () => 1);

  vi.mock('@upstash/redis', () => ({
    Redis: { fromEnv: () => ({ incr, expire }) },
  }));

  const {
    checkRateLimit,
    checkGlobalCeiling,
    getClientIp,
    RateLimitExceededError,
    DailyCeilingExceededError,
  } = await import('./index');

  describe('checkRateLimit', () => {
    afterEach(() => {
      store.clear();
      incr.mockClear();
      expire.mockClear();
    });

    it('allows a request under the bucket limit', async () => {
      await expect(checkRateLimit('notebookCreate', 'user-1', '1.2.3.4')).resolves.toBeUndefined();
    });

    it('throws once the identity exceeds its bucket limit', async () => {
      for (let i = 0; i < 10; i++) {
        await checkRateLimit('notebookCreate', 'user-2', `ip-${i}`);
      }
      await expect(checkRateLimit('notebookCreate', 'user-2', 'ip-new')).rejects.toThrow(
        RateLimitExceededError,
      );
    });

    it('throws once the IP exceeds its bucket limit regardless of identity', async () => {
      for (let i = 0; i < 10; i++) {
        await checkRateLimit('notebookCreate', `user-${i}`, 'shared-ip');
      }
      await expect(checkRateLimit('notebookCreate', 'user-new', 'shared-ip')).rejects.toThrow(
        RateLimitExceededError,
      );
    });
  });

  describe('checkGlobalCeiling', () => {
    afterEach(() => {
      store.clear();
      delete process.env.AI_DAILY_CALL_CEILING;
    });

    it('allows calls under the daily ceiling', async () => {
      process.env.AI_DAILY_CALL_CEILING = '3';
      await expect(checkGlobalCeiling()).resolves.toBeUndefined();
    });

    it('throws once the daily ceiling is exceeded', async () => {
      process.env.AI_DAILY_CALL_CEILING = '2';
      await checkGlobalCeiling();
      await checkGlobalCeiling();
      await expect(checkGlobalCeiling()).rejects.toThrow(DailyCeilingExceededError);
    });
  });

  describe('getClientIp', () => {
    it('reads the first address from x-forwarded-for', () => {
      const request = new Request('http://x', {
        headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
      });
      expect(getClientIp(request)).toBe('1.1.1.1');
    });

    it('falls back to "unknown" with no header', () => {
      const request = new Request('http://x');
      expect(getClientIp(request)).toBe('unknown');
    });
  });
  ```
- [ ] Run it — confirm it fails (module doesn't exist yet): `npx vitest run src/lib/abuse-prevention/index.test.ts`
- [ ] Implement `src/lib/abuse-prevention/index.ts`. The Redis client is created lazily (not at module load) so importing this module never throws in environments without Upstash env vars set (CI build/typecheck), and so tests can mock `@upstash/redis` cleanly:
  ```ts
  import 'server-only';
  import { Redis } from '@upstash/redis';

  let redisClient: Redis | undefined;
  function getRedis(): Redis {
    if (!redisClient) redisClient = Redis.fromEnv();
    return redisClient;
  }

  type Bucket = 'notebookCreate' | 'sourceCreate' | 'chatMessage';

  const BUCKET_LIMITS: Record<Bucket, { max: number; windowSeconds: number }> = {
    notebookCreate: { max: 10, windowSeconds: 60 * 60 },
    sourceCreate: { max: 20, windowSeconds: 60 * 60 },
    chatMessage: { max: 30, windowSeconds: 60 * 60 },
  };

  export class RateLimitExceededError extends Error {}
  export class DailyCeilingExceededError extends Error {}

  async function incrementAndCheck(
    key: string,
    max: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return count <= max;
  }

  export async function checkRateLimit(bucket: Bucket, identity: string, ip: string): Promise<void> {
    const { max, windowSeconds } = BUCKET_LIMITS[bucket];
    const [identityOk, ipOk] = await Promise.all([
      incrementAndCheck(`ratelimit:${bucket}:identity:${identity}`, max, windowSeconds),
      incrementAndCheck(`ratelimit:${bucket}:ip:${ip}`, max, windowSeconds),
    ]);
    if (!identityOk || !ipOk) {
      throw new RateLimitExceededError('Rate limit exceeded. Please slow down and try again shortly.');
    }
  }

  const DAY_SECONDS_WITH_SKEW_BUFFER = 60 * 60 * 25;

  export async function checkGlobalCeiling(): Promise<void> {
    const max = Number(process.env.AI_DAILY_CALL_CEILING ?? 500);
    const today = new Date().toISOString().slice(0, 10);
    const ok = await incrementAndCheck(`ai-ceiling:${today}`, max, DAY_SECONDS_WITH_SKEW_BUFFER);
    if (!ok) {
      throw new DailyCeilingExceededError(
        'Sourcebook has reached its daily usage limit. Please try again tomorrow.',
      );
    }
  }

  export function getClientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for');
    return forwarded?.split(',')[0]?.trim() || 'unknown';
  }
  ```
- [ ] Run tests — confirm passing: `npx vitest run src/lib/abuse-prevention/index.test.ts`
- [ ] Add to `.env.example`:
  ```
  UPSTASH_REDIS_REST_URL=your-upstash-redis-rest-url
  UPSTASH_REDIS_REST_TOKEN=your-upstash-redis-rest-token
  AI_DAILY_CALL_CEILING=500
  ```
- [ ] Commit: `git commit -m "feat: add rate-limit and daily AI-ceiling checks via Upstash Redis"`

## Task 2: Rate limiting on notebook creation

**Files:** `src/app/api/notebooks/route.ts`

- [ ] Modify `POST` to accept the request and enforce the `notebookCreate` bucket (no ceiling check — creating a notebook makes no OpenAI call):
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { createClient } from '@/lib/supabase/server';
  import { createNotebook, listNotebooks } from '@/lib/notebooks';
  import { checkRateLimit, getClientIp, RateLimitExceededError } from '@/lib/abuse-prevention';

  export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      await checkRateLimit('notebookCreate', user.id, getClientIp(request));
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      throw error;
    }

    const notebook = await createNotebook(supabase);
    return NextResponse.json(notebook, { status: 201 });
  }
  ```
  (`GET` is unchanged — listing your own notebooks is free and already ownership-scoped.)
- [ ] Manual smoke test: run `npm run dev`, open the app in a browser to establish an anonymous session, then from the browser console run:
  ```js
  for (let i = 0; i < 11; i++) {
    const res = await fetch('/api/notebooks', { method: 'POST' });
    console.log(i, res.status);
  }
  ```
  Confirm the first 10 return `201` and the 11th returns `429` with a JSON `error` message.
- [ ] Commit: `git commit -m "feat: rate-limit notebook creation"`

## Task 3: Rate limiting + daily ceiling on source creation

**Files:** `src/app/api/notebooks/[notebookId]/sources/route.ts`, `src/app/api/notebooks/[notebookId]/sources/website/route.ts`, `src/app/api/notebooks/[notebookId]/sources/youtube/route.ts`

- [ ] In `sources/route.ts`, add the guard once at the top of `POST`, before branching into file upload or pasted text (both cost embeddings):
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { MAX_TRANSCRIPTION_AUDIO_BYTES } from '@/lib/providers/openai';
  import { createClient } from '@/lib/supabase/server';
  import { createFileSource, createPastedTextSource } from '@/lib/sources';
  import {
    checkRateLimit,
    checkGlobalCeiling,
    getClientIp,
    RateLimitExceededError,
    DailyCeilingExceededError,
  } from '@/lib/abuse-prevention';

  // ...existing MAX_SOURCES_PER_NOTEBOOK, MAX_FILE_BYTES, AUDIO_EXTENSIONS, handleFileUpload unchanged...

  export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ notebookId: string }> },
  ) {
    const { notebookId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      await checkRateLimit('sourceCreate', user.id, getClientIp(request));
      await checkGlobalCeiling();
    } catch (error) {
      if (error instanceof RateLimitExceededError || error instanceof DailyCeilingExceededError) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      throw error;
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      return handleFileUpload(request, supabase, notebookId);
    }

    const body = await request.json();
    const { title, text } = body ?? {};
    if (typeof text !== 'string' || !text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const source = await createPastedTextSource(supabase, {
      notebookId,
      title: typeof title === 'string' ? title : undefined,
      text,
    });
    return NextResponse.json(source, { status: 201 });
  }
  ```
- [ ] Apply the identical guard (same imports, same try/catch, bucket `'sourceCreate'`) to `website/route.ts`'s `POST`, right after the auth check and before reading the request body.
- [ ] Apply the identical guard to `youtube/route.ts`'s `POST`, same placement.
- [ ] Manual smoke test: repeat the Task 2 browser-console loop (20 iterations) against `/api/notebooks/<id>/sources/website` with a valid notebook ID and a small JSON body (`{ url: 'https://example.com' }`); confirm request 21 returns `429`.
- [ ] Commit: `git commit -m "feat: rate-limit and ceiling-check source creation across upload, website, and youtube routes"`

## Task 4: Rate limiting + daily ceiling on chat questions

**Files:** `src/app/api/notebooks/[notebookId]/messages/route.ts`

- [ ] Add the same guard to `POST`, right after the auth check and before reading/validating the body:
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { createClient } from '@/lib/supabase/server';
  import { streamAnswer, NotebookBusyError, type AskQuestionEvent } from '@/lib/generation';
  import { resolveCitations } from '@/lib/citations';
  import {
    checkRateLimit,
    checkGlobalCeiling,
    getClientIp,
    RateLimitExceededError,
    DailyCeilingExceededError,
  } from '@/lib/abuse-prevention';

  export const maxDuration = 60;

  export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ notebookId: string }> },
  ) {
    const { notebookId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      await checkRateLimit('chatMessage', user.id, getClientIp(request));
      await checkGlobalCeiling();
    } catch (error) {
      if (error instanceof RateLimitExceededError || error instanceof DailyCeilingExceededError) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      throw error;
    }

    const body = await request.json();
    // ...rest of the handler (question/sourceIds validation, streaming) unchanged...
  }
  ```
  (`GET` is unchanged — reading chat history is free.)
- [ ] Manual smoke test: with a notebook that has at least one ready source, repeat the Task 2 browser-console loop (30 iterations) against `/api/notebooks/<id>/messages` with body `{ question: 'test' }`; confirm request 31 returns `429` before it reaches the streaming path.
- [ ] Commit: `git commit -m "feat: rate-limit and ceiling-check chat question submission"`

## Task 5: Baseline security headers

**Files:** `next.config.ts`

- [ ] Replace the empty config with:
  ```ts
  import type { NextConfig } from 'next';

  const nextConfig: NextConfig = {
    async headers() {
      return [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            {
              key: 'Content-Security-Policy',
              value: [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "connect-src 'self' https://*.supabase.co",
                "frame-ancestors 'none'",
              ].join('; '),
            },
          ],
        },
      ];
    },
  };

  export default nextConfig;
  ```
- [ ] Manual verification: `npm run dev`, then in another terminal `curl -sI http://localhost:3000/ | grep -Ei 'x-frame-options|x-content-type-options|referrer-policy|content-security-policy'` — confirm all four headers are present.
- [ ] Commit: `git commit -m "feat: add baseline security response headers"`

## Task 6: Document the scope decision

**Files:** `docs/DECISIONS.md`

- [ ] Append a new ADR after ADR-011, matching the existing rationale/trade-offs/revisit-when format:
  ```markdown
  ## ADR-012 — Scope public-deployment guardrails to demo hygiene, not production security

  **Decision:** Before the public Vercel deployment, add a deployment-wide daily AI-call ceiling (kill switch), per-identity-and-per-IP rate limiting on notebook/source creation and chat via Upstash Redis, and baseline security response headers. Explicitly exclude CAPTCHA, Vercel Firewall/WAF configuration, IP reputation scoring, and dollar-denominated billing integration.

  **Rationale:** This is a take-home evaluation project, not a funded product; the goal is demonstrating engineering judgment about production AI cost and abuse concerns proportionate to the project's scope, not building attack-resistant infrastructure. Call-count is an adequate proxy for spend without adding a billing-API dependency. Anonymous identities can be recreated (ADR-003), so IP-based limiting backstops identity-based limiting without adding user friction.

  **Trade-offs:** A determined attacker with rotating IPs can still exceed intended usage before the global ceiling catches it; the ceiling, not per-identity limits, is the actual backstop. Call-count as a cost proxy ignores that requests have very different real costs (a pasted-text source is cheaper than a 10MB PDF). No CAPTCHA means scripted notebook/source creation is only slowed, not prevented, by rate limits.

  **Revisit when:** This moves beyond a demo/evaluation deployment toward sustained real usage, at which point per-request cost-weighted limits, real billing-API integration, and stronger bot resistance become proportionate.
  ```
- [ ] Commit: `git commit -m "docs: record ADR-012 for public-deployment guardrail scope"`

---

## Self-review

1. **Task count:** 6 tasks — within the ≤7 guideline.
2. **Coverage:** global ceiling (Tasks 1, 3, 4) ✓, per-identity/per-IP rate limiting (Tasks 1–4) ✓, security headers (Task 5) ✓, ADR documentation (Task 6) ✓. All four design-brief pieces covered.
3. **Placeholders:** none — every step shows real code or a runnable command.
4. **Type consistency:** `Bucket` values (`'notebookCreate' | 'sourceCreate' | 'chatMessage'`) and the exported names (`checkRateLimit`, `checkGlobalCeiling`, `getClientIp`, `RateLimitExceededError`, `DailyCeilingExceededError`) are identical across Tasks 1–4.

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

describe('failing open when Redis itself errors', () => {
  afterEach(() => {
    store.clear();
    incr.mockReset().mockImplementation(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    });
    vi.restoreAllMocks();
  });

  it('does not throw from checkRateLimit when the store is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    incr.mockRejectedValue(new Error('Failed to parse URL from /pipeline'));

    await expect(checkRateLimit('notebookCreate', 'user-3', '9.9.9.9')).resolves.toBeUndefined();
  });

  it('does not throw from checkGlobalCeiling when the store is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    incr.mockRejectedValue(new Error('Failed to parse URL from /pipeline'));

    await expect(checkGlobalCeiling()).resolves.toBeUndefined();
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

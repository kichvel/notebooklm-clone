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

import { config } from 'dotenv';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { TestProject } from 'vitest/node';

config({ path: path.resolve(__dirname, '.env') });

export interface TestSession {
  accessToken: string;
  refreshToken: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    primaryTestSession: TestSession | null;
    secondaryTestSession: TestSession | null;
  }
}

async function signInAnonymously(): Promise<TestSession> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) {
    throw new Error(`Global test setup: anonymous sign-in failed: ${error?.message}`);
  }
  return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
}

// Runs once for the whole `vitest run`, before any test file/worker starts. Integration
// tests share these two real anonymous sessions instead of each calling
// `signInAnonymously()` for itself — Supabase's anonymous sign-in endpoint is rate-limited
// to 30 requests/hour per IP, and minting a fresh identity per test used to burn 6-8 of
// those per full suite run, which repeated runs over a dev day exhaust quickly.
export default async function setup({ provide }: TestProject) {
  const hasRealEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (!hasRealEnv) {
    provide('primaryTestSession', null);
    provide('secondaryTestSession', null);
    return;
  }

  const [primary, secondary] = await Promise.all([signInAnonymously(), signInAnonymously()]);
  provide('primaryTestSession', primary);
  provide('secondaryTestSession', secondary);
}

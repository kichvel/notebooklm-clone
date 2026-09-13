import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inject } from 'vitest';

interface TestSession {
  accessToken: string;
  refreshToken: string;
}

async function createSignedInClient(session: TestSession | null): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: true } },
  );
  if (session) {
    const { error } = await client.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
    if (error) throw new Error(`Failed to restore shared test session: ${error.message}`);
  }
  return client;
}

/**
 * A real, signed-in anonymous Supabase client shared across integration tests in this run.
 * Backed by one real `signInAnonymously()` call made once in `vitest.global-setup.ts`, since
 * that endpoint is rate-limited to 30 requests/hour per IP and minting a fresh identity per
 * test exhausts it after a handful of suite runs.
 */
export function createPrimaryTestClient(): Promise<SupabaseClient> {
  return createSignedInClient(inject('primaryTestSession'));
}

/** A second, distinct real anonymous identity — for tests that prove cross-user isolation. */
export function createSecondaryTestClient(): Promise<SupabaseClient> {
  return createSignedInClient(inject('secondaryTestSession'));
}

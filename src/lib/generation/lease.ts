import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const LEASE_TIMEOUT_SECONDS = 90;

export class NotebookBusyError extends Error {
  constructor() {
    super('A generation is already in progress for this notebook.');
    this.name = 'NotebookBusyError';
  }
}

export async function claimGenerationLease(
  supabase: SupabaseClient,
  notebookId: string,
): Promise<string> {
  const attemptId = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - LEASE_TIMEOUT_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from('notebooks')
    .update({
      active_attempt_id: attemptId,
      active_attempt_started_at: new Date().toISOString(),
    })
    .eq('id', notebookId)
    .or(`active_attempt_id.is.null,active_attempt_started_at.lt.${staleBefore}`)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new NotebookBusyError();
  return attemptId;
}

export async function releaseGenerationLease(
  supabase: SupabaseClient,
  notebookId: string,
  attemptId: string,
): Promise<void> {
  await supabase
    .from('notebooks')
    .update({ active_attempt_id: null, active_attempt_started_at: null })
    .eq('id', notebookId)
    .eq('active_attempt_id', attemptId);
}

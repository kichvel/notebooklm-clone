// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { claimGenerationLease, releaseGenerationLease, NotebookBusyError } from './lease';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

describe.skipIf(!hasRealEnv)('generation lease', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  it('claims an idle lease, rejects a second claim, and allows a stale one to be reclaimed', async () => {
    const user = await createPrimaryTestClient();

    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'Lease test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const attempt1 = await claimGenerationLease(user, notebook!.id);
    await expect(claimGenerationLease(user, notebook!.id)).rejects.toThrow(NotebookBusyError);

    // Simulate an old, abandoned lease.
    await user
      .from('notebooks')
      .update({ active_attempt_started_at: new Date(Date.now() - 200_000).toISOString() })
      .eq('id', notebook!.id);

    const attempt2 = await claimGenerationLease(user, notebook!.id);
    expect(attempt2).not.toBe(attempt1);

    await releaseGenerationLease(user, notebook!.id, attempt2);
    const { data } = await user
      .from('notebooks')
      .select('active_attempt_id')
      .eq('id', notebook!.id)
      .single();
    expect(data?.active_attempt_id).toBeNull();
  });
});

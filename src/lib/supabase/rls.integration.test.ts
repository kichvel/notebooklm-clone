import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from './server';
import { createPrimaryTestClient, createSecondaryTestClient } from './test-helpers';

const hasRealSupabaseEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

describe.skipIf(!hasRealSupabaseEnv)('notebook RLS isolation', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  it("prevents one anonymous user from reading or modifying another user's notebook", async () => {
    const userA = await createPrimaryTestClient();
    const userB = await createSecondaryTestClient();

    const { data: notebookA, error: insertError } = await userA
      .from('notebooks')
      .insert({ title: 'User A notebook' })
      .select()
      .single();
    expect(insertError).toBeNull();
    createdNotebookIds.push(notebookA!.id);

    const { data: readAsB } = await userB.from('notebooks').select().eq('id', notebookA!.id);
    expect(readAsB).toEqual([]);

    const { data: updateAsB } = await userB
      .from('notebooks')
      .update({ title: 'hijacked' })
      .eq('id', notebookA!.id)
      .select();
    expect(updateAsB).toEqual([]);

    const { data: deleteAsB } = await userB
      .from('notebooks')
      .delete()
      .eq('id', notebookA!.id)
      .select();
    expect(deleteAsB).toEqual([]);

    const { data: stillExists } = await userA.from('notebooks').select().eq('id', notebookA!.id);
    expect(stillExists).toHaveLength(1);
  }, 20000);
});

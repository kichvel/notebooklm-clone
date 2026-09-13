import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from './server';
import { createPrimaryTestClient, createSecondaryTestClient } from './test-helpers';

const hasRealSupabaseEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

describe.skipIf(!hasRealSupabaseEnv)('messages/message_citations RLS isolation', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  it("prevents one anonymous user from reading or modifying another user's messages and citations", async () => {
    const userA = await createPrimaryTestClient();
    const userB = await createSecondaryTestClient();

    const { data: notebookA, error: notebookError } = await userA
      .from('notebooks')
      .insert({ title: 'User A notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebookA!.id);

    const { data: sourceA, error: sourceError } = await userA
      .from('sources')
      .insert({
        notebook_id: notebookA!.id,
        type: 'pasted_text',
        title: 'User A source',
        status: 'ready',
      })
      .select()
      .single();
    expect(sourceError).toBeNull();

    const { data: messageA, error: messageError } = await userA
      .from('messages')
      .insert({ notebook_id: notebookA!.id, role: 'assistant', content: 'Grounded answer [1]' })
      .select()
      .single();
    expect(messageError).toBeNull();

    const { data: citationA, error: citationError } = await userA
      .from('message_citations')
      .insert({
        message_id: messageA!.id,
        label: 1,
        source_id: sourceA!.id,
        source_title: 'User A source',
        content_snapshot: 'Supporting passage text',
      })
      .select()
      .single();
    expect(citationError).toBeNull();

    const { data: messagesAsB } = await userB.from('messages').select().eq('id', messageA!.id);
    expect(messagesAsB).toEqual([]);

    const { data: citationsAsB } = await userB
      .from('message_citations')
      .select()
      .eq('id', citationA!.id);
    expect(citationsAsB).toEqual([]);

    const { data: updateMessageAsB } = await userB
      .from('messages')
      .update({ content: 'hijacked' })
      .eq('id', messageA!.id)
      .select();
    expect(updateMessageAsB).toEqual([]);

    const { data: deleteCitationAsB } = await userB
      .from('message_citations')
      .delete()
      .eq('id', citationA!.id)
      .select();
    expect(deleteCitationAsB).toEqual([]);

    const { data: messageStillExists } = await userA
      .from('messages')
      .select()
      .eq('id', messageA!.id);
    expect(messageStillExists).toHaveLength(1);

    const { data: citationStillExists } = await userA
      .from('message_citations')
      .select()
      .eq('id', citationA!.id);
    expect(citationStillExists).toHaveLength(1);
  }, 20000);
});

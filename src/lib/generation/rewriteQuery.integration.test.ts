// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { fetchRecentMessages, rewriteFollowUpQuery } from './rewriteQuery';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('rewriteFollowUpQuery', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  it('resolves an implicit reference against the prior conversation', async () => {
    const user = await createPrimaryTestClient();

    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'Rewrite test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const { error: messagesError } = await user.from('messages').insert([
      {
        notebook_id: notebook!.id,
        role: 'user',
        content: 'What does the report say about Q1 revenue?',
      },
      {
        notebook_id: notebook!.id,
        role: 'assistant',
        content: 'The report says Q1 revenue was $2M, while Q2 revenue was $3M.',
      },
    ]);
    expect(messagesError).toBeNull();

    const history = await fetchRecentMessages(user, notebook!.id);
    const rewritten = await rewriteFollowUpQuery(history, 'what about the other one?');

    expect(rewritten.toLowerCase()).not.toContain('the other one');
    expect(rewritten).toContain('Q2');
  }, 30000);
});

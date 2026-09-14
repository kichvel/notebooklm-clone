// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { embed } from '@/lib/providers/openai';
import { retryAnswer, type AskQuestionEvent } from './index';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('retryAnswer', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  async function setupFailedMessage(user: Awaited<ReturnType<typeof createPrimaryTestClient>>) {
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Retry test notebook' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);

    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Facts', status: 'ready' })
      .select()
      .single();

    const text = 'Mount Everest is the tallest mountain above sea level on Earth.';
    const embedding = await embed(text);
    await user
      .from('source_chunks')
      .insert({ source_id: source!.id, chunk_index: 0, content: text, embedding });

    await user.from('messages').insert({
      notebook_id: notebook!.id,
      role: 'user',
      content: 'What is the tallest mountain?',
      status: 'complete',
    });
    const { data: failedMessage } = await user
      .from('messages')
      .insert({
        notebook_id: notebook!.id,
        role: 'assistant',
        content: '',
        status: 'failed',
        selected_source_ids: [],
      })
      .select()
      .single();

    return { notebook: notebook!, failedMessage: failedMessage! };
  }

  it('re-runs generation for a failed message in place', async () => {
    const user = await createPrimaryTestClient();
    const { notebook, failedMessage } = await setupFailedMessage(user);

    const events: AskQuestionEvent[] = [];
    for await (const event of retryAnswer(user, {
      notebookId: notebook.id,
      messageId: failedMessage.id,
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('expected done event');
    expect(done.result.status).toBe('complete');
    expect(done.result.messageId).toBe(failedMessage.id);

    const { data: rows } = await user
      .from('messages')
      .select('id, status')
      .eq('notebook_id', notebook.id)
      .eq('role', 'assistant');
    expect(rows).toHaveLength(1);
    expect(rows?.[0].id).toBe(failedMessage.id);
    expect(rows?.[0].status).toBe('complete');
  }, 60000);

  it('refuses to retry a message that is not failed', async () => {
    const user = await createPrimaryTestClient();
    const { notebook, failedMessage } = await setupFailedMessage(user);
    await user.from('messages').update({ status: 'complete' }).eq('id', failedMessage.id);

    const generator = retryAnswer(user, { notebookId: notebook.id, messageId: failedMessage.id });
    await expect(generator.next()).rejects.toThrow('Only a failed message can be retried');
  }, 60000);
});

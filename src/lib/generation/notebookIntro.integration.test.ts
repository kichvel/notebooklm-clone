// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { createServiceClient } from '@/lib/supabase/server';
import { maybeGenerateNotebookIntro } from './notebookIntro';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('maybeGenerateNotebookIntro', () => {
  const createdNotebookIds: string[] = [];
  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    await createServiceClient().from('notebooks').delete().in('id', createdNotebookIds);
  });

  async function makeNotebook(user: Awaited<ReturnType<typeof createPrimaryTestClient>>) {
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Untitled notebook' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);
    return notebook!;
  }

  it('does nothing while a source is still processing', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    await user
      .from('sources')
      .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'A', status: 'processing' });

    await maybeGenerateNotebookIntro(user, notebook.id);

    const { data: after } = await user
      .from('notebooks')
      .select('title, intro_generated_at')
      .eq('id', notebook.id)
      .single();
    expect(after?.title).toBe('Untitled notebook');
    expect(after?.intro_generated_at).toBeNull();
  });

  it('does nothing when every source failed', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    await user
      .from('sources')
      .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'A', status: 'failed' });

    await maybeGenerateNotebookIntro(user, notebook.id);

    const { data: after } = await user
      .from('notebooks')
      .select('intro_generated_at')
      .eq('id', notebook.id)
      .single();
    expect(after?.intro_generated_at).toBeNull();
  });

  it('generates a title and posts one summary message once a ready source exists, and never repeats', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'Cat facts', status: 'ready' })
      .select()
      .single();
    await user.from('source_chunks').insert({
      source_id: source!.id,
      chunk_index: 0,
      content: 'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
    });

    await maybeGenerateNotebookIntro(user, notebook.id);

    const { data: afterFirst } = await user
      .from('notebooks')
      .select('title, intro_generated_at')
      .eq('id', notebook.id)
      .single();
    expect(afterFirst?.title).not.toBe('Untitled notebook');
    expect(afterFirst?.intro_generated_at).not.toBeNull();

    const { data: messages } = await user
      .from('messages')
      .select('role, status')
      .eq('notebook_id', notebook.id);
    expect(messages).toHaveLength(1);
    expect(messages![0].role).toBe('assistant');
    expect(messages![0].status).toBe('complete');

    await maybeGenerateNotebookIntro(user, notebook.id);
    const { data: messagesAfterSecondCall } = await user
      .from('messages')
      .select('id')
      .eq('notebook_id', notebook.id);
    expect(messagesAfterSecondCall).toHaveLength(1);
  }, 30000);
});

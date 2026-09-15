// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { createServiceClient } from '@/lib/supabase/server';
import { maybeGenerateNotebookTitle } from './notebookIntro';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('maybeGenerateNotebookTitle', () => {
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

    await maybeGenerateNotebookTitle(user, notebook.id);

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

    await maybeGenerateNotebookTitle(user, notebook.id);

    const { data: after } = await user
      .from('notebooks')
      .select('intro_generated_at')
      .eq('id', notebook.id)
      .single();
    expect(after?.intro_generated_at).toBeNull();
  });

  it('generates a title once a ready source exists, posts no message, and never repeats', async () => {
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

    await maybeGenerateNotebookTitle(user, notebook.id);

    const { data: afterFirst } = await user
      .from('notebooks')
      .select('title, intro_generated_at')
      .eq('id', notebook.id)
      .single();
    expect(afterFirst?.title).not.toBe('Untitled notebook');
    expect(afterFirst?.intro_generated_at).not.toBeNull();

    const { data: messages } = await user.from('messages').select('id').eq('notebook_id', notebook.id);
    expect(messages).toHaveLength(0);

    await maybeGenerateNotebookTitle(user, notebook.id);
    const { data: afterSecond } = await user
      .from('notebooks')
      .select('title')
      .eq('id', notebook.id)
      .single();
    expect(afterSecond?.title).toBe(afterFirst?.title);
  }, 30000);
});

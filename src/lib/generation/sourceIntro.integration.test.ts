// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { createServiceClient } from '@/lib/supabase/server';
import { maybeGenerateSourceIntro } from './sourceIntro';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('maybeGenerateSourceIntro', () => {
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

  it('does nothing for a source that is not ready', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'A', status: 'processing' })
      .select()
      .single();

    await maybeGenerateSourceIntro(user, source!.id);

    const { data: after } = await user
      .from('sources')
      .select('intro_summary, intro_generated_at')
      .eq('id', source!.id)
      .single();
    expect(after?.intro_generated_at).toBeNull();
  });

  it('generates a summary, posts a message with source_id set, and never repeats', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook.id, type: 'pasted_text', title: 'Cat facts', status: 'ready' })
      .select()
      .single();
    await user.from('source_chunks').insert([
      { source_id: source!.id, chunk_index: 0, content: 'Domestic cats are small, furry, carnivorous mammals.' },
      { source_id: source!.id, chunk_index: 1, content: 'They sleep 12-16 hours a day and have retractable claws.' },
    ]);

    await maybeGenerateSourceIntro(user, source!.id);

    const { data: afterFirst } = await user
      .from('sources')
      .select('intro_summary, intro_generated_at')
      .eq('id', source!.id)
      .single();
    expect(afterFirst?.intro_summary?.trim().length).toBeGreaterThan(0);
    expect(afterFirst?.intro_generated_at).not.toBeNull();

    const { data: messages } = await user
      .from('messages')
      .select('role, status, source_id, follow_up_questions')
      .eq('notebook_id', notebook.id);
    expect(messages).toHaveLength(1);
    expect(messages![0].role).toBe('assistant');
    expect(messages![0].source_id).toBe(source!.id);
    expect(messages![0].follow_up_questions).toHaveLength(3);

    await maybeGenerateSourceIntro(user, source!.id);
    const { data: messagesAfterSecondCall } = await user
      .from('messages')
      .select('id')
      .eq('notebook_id', notebook.id);
    expect(messagesAfterSecondCall).toHaveLength(1);
  }, 30000);
});

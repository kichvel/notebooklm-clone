// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { embed } from '@/lib/providers/openai';
import { askQuestion, REFUSAL_TEXT } from './index';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('askQuestion', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  it('answers a supported question with a valid citation and refuses an unsupported one', async () => {
    const user = await createPrimaryTestClient();

    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'Generation test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const { data: source, error: sourceError } = await user
      .from('sources')
      .insert({
        notebook_id: notebook!.id,
        type: 'pasted_text',
        title: 'Cat facts',
        status: 'ready',
      })
      .select()
      .single();
    expect(sourceError).toBeNull();

    const catText = 'Domestic cats are small, typically furry, carnivorous mammals kept as pets.';
    const airplaneText = 'The Boeing 747 is a wide-body commercial jet airliner.';
    const [catEmbedding, airplaneEmbedding] = await Promise.all([
      embed(catText),
      embed(airplaneText),
    ]);

    const { error: chunksError } = await user.from('source_chunks').insert([
      { source_id: source!.id, chunk_index: 0, content: catText, embedding: catEmbedding },
      {
        source_id: source!.id,
        chunk_index: 1,
        content: airplaneText,
        embedding: airplaneEmbedding,
      },
    ]);
    expect(chunksError).toBeNull();

    const answered = await askQuestion(user, {
      notebookId: notebook!.id,
      question: 'What kind of animal is a domestic cat?',
    });

    expect(answered.status).toBe('complete');
    expect(answered.citations.length).toBeGreaterThanOrEqual(1);
    expect(answered.citations.some((c) => c.content.toLowerCase().includes('cat'))).toBe(true);

    const { data: persistedMessage } = await user
      .from('messages')
      .select('id, role, status')
      .eq('id', answered.messageId)
      .single();
    expect(persistedMessage?.role).toBe('assistant');
    expect(persistedMessage?.status).toBe('complete');

    const { data: persistedCitations } = await user
      .from('message_citations')
      .select('id')
      .eq('message_id', answered.messageId);
    expect(persistedCitations!.length).toBeGreaterThanOrEqual(1);

    const { data: persistedRow } = await user
      .from('messages')
      .select('follow_up_questions')
      .eq('id', answered.messageId)
      .single();
    expect(persistedRow?.follow_up_questions).toHaveLength(3);
    expect(answered.followUpQuestions).toHaveLength(3);

    const refused = await askQuestion(user, {
      notebookId: notebook!.id,
      question: 'What is the capital of France?',
    });

    expect(refused.status).toBe('refused');
    expect(refused.answer).toBe(REFUSAL_TEXT);
    expect(refused.citations).toEqual([]);
    expect(refused.followUpQuestions).toHaveLength(3);
  }, 30000);
});

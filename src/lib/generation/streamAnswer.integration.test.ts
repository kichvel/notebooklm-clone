// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { embed } from '@/lib/providers/openai';
import { streamAnswer, REFUSAL_TEXT, type AskQuestionEvent } from './index';
import { NotebookBusyError } from './lease';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('streamAnswer', () => {
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

    async function collect(notebookId: string, question: string) {
      const events: AskQuestionEvent[] = [];
      for await (const event of streamAnswer(user, { notebookId, question })) events.push(event);
      return events;
    }

    const events = await collect(notebook!.id, 'What kind of animal is a domestic cat?');
    expect(events.some((e) => e.type === 'passages')).toBe(true);
    expect(events.some((e) => e.type === 'reasoning_delta')).toBe(true);
    expect(events.some((e) => e.type === 'answer_delta')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') throw new Error('expected done event');
    expect(done.result.status).toBe('complete');
    expect(done.result.reasoning.length).toBeGreaterThan(0);
    expect(done.result.citations.some((c) => c.content.toLowerCase().includes('cat'))).toBe(true);

    const { data: persistedMessage } = await user
      .from('messages')
      .select('reasoning, status')
      .eq('id', done.result.messageId)
      .single();
    expect(persistedMessage?.status).toBe('complete');
    expect(persistedMessage?.reasoning?.length).toBeGreaterThan(0);

    const { data: persistedRow } = await user
      .from('messages')
      .select('follow_up_questions')
      .eq('id', done.result.messageId)
      .single();
    expect(persistedRow?.follow_up_questions).toHaveLength(3);
    expect(done.result.followUpQuestions).toHaveLength(3);

    const refusedEvents = await collect(notebook!.id, 'What is the capital of France?');
    const refusedDone = refusedEvents.find((e) => e.type === 'done');
    if (refusedDone?.type !== 'done') throw new Error('expected done event');
    expect(refusedDone.result.status).toBe('refused');
    expect(refusedDone.result.answer).toBe(REFUSAL_TEXT);
    expect(refusedDone.result.citations).toEqual([]);
    expect(refusedDone.result.followUpQuestions).toHaveLength(3);
  }, 60000);

  it('persists a pending assistant message before generation completes', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Pending row test' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);
    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Facts', status: 'ready' })
      .select()
      .single();
    const text = 'The Eiffel Tower is located in Paris, France.';
    const embedding = await embed(text);
    await user
      .from('source_chunks')
      .insert({ source_id: source!.id, chunk_index: 0, content: text, embedding });

    const generator = streamAnswer(user, {
      notebookId: notebook!.id,
      question: 'Where is the Eiffel Tower?',
    });
    let event = await generator.next();
    while (!event.done && event.value.type !== 'passages') {
      event = await generator.next();
    }

    const { data: rows } = await user
      .from('messages')
      .select('status')
      .eq('notebook_id', notebook!.id)
      .eq('role', 'assistant');
    expect(rows?.some((r) => r.status === 'pending')).toBe(true);

    // Drain to completion so the lease is released and afterAll cleanup isn't blocked.
    while (!event.done) event = await generator.next();
  }, 60000);

  it('rejects a second generation while the notebook lease is held', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Lease busy test' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);
    const { data: source } = await user
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Facts', status: 'ready' })
      .select()
      .single();
    const text = 'The Great Wall of China is an ancient series of fortifications.';
    const embedding = await embed(text);
    await user
      .from('source_chunks')
      .insert({ source_id: source!.id, chunk_index: 0, content: text, embedding });

    const first = streamAnswer(user, { notebookId: notebook!.id, question: 'What is the Great Wall?' });
    await first.next(); // starts generation, claims the lease

    const second = streamAnswer(user, {
      notebookId: notebook!.id,
      question: 'What is the Great Wall?',
    });
    await expect(second.next()).rejects.toThrow(NotebookBusyError);

    // Drain the first to completion so the lease is released and afterAll cleanup isn't blocked.
    let event = await first.next();
    while (!event.done) event = await first.next();
  }, 60000);
});

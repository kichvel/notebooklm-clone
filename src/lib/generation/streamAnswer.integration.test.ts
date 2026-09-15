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
    // Follow-up questions are generated after the answer is finalized (so the client isn't
    // blocked on them) and delivered via a trailing event, not the 'done' result itself.
    expect(done.result.followUpQuestions).toEqual([]);

    const { data: persistedMessage } = await user
      .from('messages')
      .select('reasoning, status')
      .eq('id', done.result.messageId)
      .single();
    expect(persistedMessage?.status).toBe('complete');
    expect(persistedMessage?.reasoning?.length).toBeGreaterThan(0);

    const followUpEvent = events.find((e) => e.type === 'follow_up_questions');
    if (followUpEvent?.type !== 'follow_up_questions') throw new Error('expected follow-up event');
    expect(followUpEvent.questions).toHaveLength(3);

    const { data: persistedRow } = await user
      .from('messages')
      .select('follow_up_questions')
      .eq('id', done.result.messageId)
      .single();
    expect(persistedRow?.follow_up_questions).toHaveLength(3);

    const refusedEvents = await collect(notebook!.id, 'What is the capital of France?');
    const refusedDone = refusedEvents.find((e) => e.type === 'done');
    if (refusedDone?.type !== 'done') throw new Error('expected done event');
    expect(refusedDone.result.status).toBe('refused');
    expect(refusedDone.result.answer).toBe(REFUSAL_TEXT);
    expect(refusedDone.result.citations).toEqual([]);
    // A refusal never reaches follow-up generation, since there's no grounded answer to
    // suggest follow-ups from.
    expect(refusedDone.result.followUpQuestions).toEqual([]);
    expect(refusedEvents.some((e) => e.type === 'follow_up_questions')).toBe(false);
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

  it('never streams follow-up delimiter text into the answer', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'No delimiter leakage test' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const { data: source, error: sourceError } = await user
      .from('sources')
      .insert({
        notebook_id: notebook!.id,
        type: 'pasted_text',
        title: 'Mountain facts',
        status: 'ready',
      })
      .select()
      .single();
    expect(sourceError).toBeNull();

    const text = 'Mount Everest is the tallest mountain above sea level, standing at 8,849 meters.';
    const embedding = await embed(text);
    const { error: chunksError } = await user
      .from('source_chunks')
      .insert({ source_id: source!.id, chunk_index: 0, content: text, embedding });
    expect(chunksError).toBeNull();

    const events: AskQuestionEvent[] = [];
    for await (const event of streamAnswer(user, {
      notebookId: notebook!.id,
      question: 'How tall is Mount Everest?',
    })) {
      events.push(event);
    }

    const streamedAnswer = events
      .filter((e) => e.type === 'answer_delta')
      .map((e) => e.text)
      .join('');
    expect(streamedAnswer).not.toContain('---FOLLOWUPS---');

    const done = events.find((e) => e.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') throw new Error('expected done event');
    expect(done.result.status).toBe('complete');
    expect(streamedAnswer).toBe(done.result.answer);

    const followUpEvent = events.find((e) => e.type === 'follow_up_questions');
    if (followUpEvent?.type !== 'follow_up_questions') throw new Error('expected follow-up event');
    expect(followUpEvent.questions.some((q) => q.includes('---FOLLOWUPS---'))).toBe(false);
  }, 60000);

  it('resolves a pronoun-dependent follow-up question using prior conversation turns', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'Conversational awareness test' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const { data: source, error: sourceError } = await user
      .from('sources')
      .insert({
        notebook_id: notebook!.id,
        type: 'pasted_text',
        title: 'Author career history',
        status: 'ready',
      })
      .select()
      .single();
    expect(sourceError).toBeNull();

    const fact2019 = 'In 2019, the author worked as a backend engineer at Acme Corp.';
    const fact2017 = 'In 2017, the author worked as a data analyst at Beta Inc.';
    const [embedding2019, embedding2017] = await Promise.all([embed(fact2019), embed(fact2017)]);

    const { error: chunksError } = await user.from('source_chunks').insert([
      { source_id: source!.id, chunk_index: 0, content: fact2019, embedding: embedding2019 },
      { source_id: source!.id, chunk_index: 1, content: fact2017, embedding: embedding2017 },
    ]);
    expect(chunksError).toBeNull();

    async function collect(question: string) {
      const events: AskQuestionEvent[] = [];
      for await (const event of streamAnswer(user, { notebookId: notebook!.id, question })) {
        events.push(event);
      }
      return events;
    }

    const firstEvents = await collect('What did the author do in 2019?');
    const firstDone = firstEvents.find((e) => e.type === 'done');
    if (firstDone?.type !== 'done') throw new Error('expected done event');
    expect(firstDone.result.status).toBe('complete');
    expect(firstDone.result.answer.toLowerCase()).toContain('acme');

    const followUpEvents = await collect('What was he doing 2 years before that?');
    const followUpDone = followUpEvents.find((e) => e.type === 'done');
    if (followUpDone?.type !== 'done') throw new Error('expected done event');
    expect(followUpDone.result.status).toBe('complete');
    const followUpAnswer = followUpDone.result.answer.toLowerCase();
    expect(followUpAnswer).toMatch(/beta|data analyst/);
  }, 90000);
});

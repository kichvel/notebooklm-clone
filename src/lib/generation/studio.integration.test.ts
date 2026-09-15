// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { createServiceClient } from '@/lib/supabase/server';
import { embed } from '@/lib/providers/openai';
import { selectNextPassage } from './studio';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('selectNextPassage', () => {
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

  async function makeReadySourceWithChunks(
    user: Awaited<ReturnType<typeof createPrimaryTestClient>>,
    notebookId: string,
    chunkContents: string[],
  ) {
    const { data: source, error: sourceError } = await user
      .from('sources')
      .insert({
        notebook_id: notebookId,
        type: 'pasted_text',
        title: 'Studio test source',
        status: 'ready',
      })
      .select()
      .single();
    if (sourceError) throw sourceError;

    const rows = await Promise.all(
      chunkContents.map(async (content, chunkIndex) => ({
        source_id: source!.id,
        chunk_index: chunkIndex,
        content,
        embedding: await embed(content),
      })),
    );
    const { error: chunksError } = await user.from('source_chunks').insert(rows);
    if (chunksError) throw chunksError;

    return source!;
  }

  it('excludes already-used chunks and reports exhausted once all are used', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    await makeReadySourceWithChunks(user, notebook.id, ['Fact A.', 'Fact B.']);

    const first = await selectNextPassage(user, { notebookId: notebook.id, excludeChunkIds: [] });
    expect(first.status).toBe('ok');
    const second = await selectNextPassage(user, {
      notebookId: notebook.id,
      excludeChunkIds: [
        (first as { status: 'ok'; citation: { chunkId: string } }).citation.chunkId,
      ],
    });
    expect(second.status).toBe('ok');
    const third = await selectNextPassage(user, {
      notebookId: notebook.id,
      excludeChunkIds: [first, second].map(
        (r) => (r as { status: 'ok'; citation: { chunkId: string } }).citation.chunkId,
      ),
    });
    expect(third.status).toBe('exhausted');
  }, 30000);

  it('includes the source intro summary as framing context on the passage result', async () => {
    const user = await createPrimaryTestClient();
    const notebook = await makeNotebook(user);
    const source = await makeReadySourceWithChunks(user, notebook.id, ['Fact A.']);
    await user
      .from('sources')
      .update({ intro_summary: "This document is a resume covering the author's work history." })
      .eq('id', source.id);

    const result = await selectNextPassage(user, { notebookId: notebook.id, excludeChunkIds: [] });
    expect(result.status).toBe('ok');
    expect((result as { status: 'ok'; sourceSummary: string | null }).sourceSummary).toContain(
      'resume',
    );
  });
});

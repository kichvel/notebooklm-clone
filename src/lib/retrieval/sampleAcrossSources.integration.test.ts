// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { sampleAcrossSources } from './index';

const hasRealSupabaseEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

describe.skipIf(!hasRealSupabaseEnv)('sampleAcrossSources', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  it('caps chunks per source so one large source cannot crowd out the others', async () => {
    const user = await createPrimaryTestClient();

    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Balanced sampling test' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);

    const { data: bigSource } = await user
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Big', status: 'ready' })
      .select()
      .single();
    const { data: smallSource } = await user
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Small', status: 'ready' })
      .select()
      .single();
    const { data: processingSource } = await user
      .from('sources')
      .insert({
        notebook_id: notebook!.id,
        type: 'pasted_text',
        title: 'Still processing',
        status: 'processing',
      })
      .select()
      .single();

    await user.from('source_chunks').insert(
      Array.from({ length: 10 }, (_, i) => ({
        source_id: bigSource!.id,
        chunk_index: i,
        content: `Big source chunk ${i}`,
      })),
    );
    await user
      .from('source_chunks')
      .insert({ source_id: smallSource!.id, chunk_index: 0, content: 'Small source chunk 0' });
    await user.from('source_chunks').insert({
      source_id: processingSource!.id,
      chunk_index: 0,
      content: 'Not-yet-ready chunk',
    });

    const results = await sampleAcrossSources(user, {
      notebookId: notebook!.id,
      chunksPerSource: 3,
    });

    const bySource = new Map<string, number>();
    for (const r of results) bySource.set(r.sourceId, (bySource.get(r.sourceId) ?? 0) + 1);

    expect(bySource.get(bigSource!.id)).toBe(3);
    expect(bySource.get(smallSource!.id)).toBe(1);
    expect(bySource.has(processingSource!.id)).toBe(false);
    // Within a source, the earliest chunks (by chunk_index) come back first.
    const bigResults = results.filter((r) => r.sourceId === bigSource!.id);
    expect(bigResults.map((r) => r.chunkIndex)).toEqual([0, 1, 2]);
  }, 30000);

  it('honors a sourceIds filter', async () => {
    const user = await createPrimaryTestClient();

    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Filtered sampling test' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);

    const { data: sourceA } = await user
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'A', status: 'ready' })
      .select()
      .single();
    const { data: sourceB } = await user
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'B', status: 'ready' })
      .select()
      .single();

    await user
      .from('source_chunks')
      .insert({ source_id: sourceA!.id, chunk_index: 0, content: 'A0' });
    await user
      .from('source_chunks')
      .insert({ source_id: sourceB!.id, chunk_index: 0, content: 'B0' });

    const results = await sampleAcrossSources(user, {
      notebookId: notebook!.id,
      sourceIds: [sourceA!.id],
    });

    expect(results.every((r) => r.sourceId === sourceA!.id)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  }, 30000);
});

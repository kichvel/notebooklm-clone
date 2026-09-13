// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { embed } from '@/lib/providers/openai';
import { search } from './index';

const hasRealSupabaseEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

describe.skipIf(!hasRealSupabaseEnv)('search', () => {
  const createdNotebookIds: string[] = [];

  function createAnonClient() {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  afterAll(async () => {
    if (createdNotebookIds.length === 0) return;
    const service = createServiceClient();
    await service.from('notebooks').delete().in('id', createdNotebookIds);
  });

  it(
    'ranks the semantically closest chunk first and excludes non-ready sources',
    async () => {
      const user = createAnonClient();
      expect((await user.auth.signInAnonymously()).error).toBeNull();

      const { data: notebook, error: notebookError } = await user
        .from('notebooks')
        .insert({ title: 'Retrieval test notebook' })
        .select()
        .single();
      expect(notebookError).toBeNull();
      createdNotebookIds.push(notebook!.id);

      const { data: readySource, error: readyError } = await user
        .from('sources')
        .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Ready source', status: 'ready' })
        .select()
        .single();
      expect(readyError).toBeNull();

      const { data: processingSource, error: processingError } = await user
        .from('sources')
        .insert({
          notebook_id: notebook!.id,
          type: 'pasted_text',
          title: 'Processing source',
          status: 'processing',
        })
        .select()
        .single();
      expect(processingError).toBeNull();

      const catText = 'Domestic cats are small, typically furry, carnivorous mammals kept as pets.';
      const airplaneText = 'The Boeing 747 is a wide-body commercial jet airliner.';
      const processingCatText = 'House cats often sleep for twelve to sixteen hours a day.';

      const [catEmbedding, airplaneEmbedding, processingCatEmbedding] = await Promise.all([
        embed(catText),
        embed(airplaneText),
        embed(processingCatText),
      ]);

      const { error: chunksError } = await user.from('source_chunks').insert([
        { source_id: readySource!.id, chunk_index: 0, content: catText, embedding: catEmbedding },
        { source_id: readySource!.id, chunk_index: 1, content: airplaneText, embedding: airplaneEmbedding },
        {
          source_id: processingSource!.id,
          chunk_index: 0,
          content: processingCatText,
          embedding: processingCatEmbedding,
        },
      ]);
      expect(chunksError).toBeNull();

      const queryEmbedding = await embed('Tell me about pet cats.');
      const results = await search(user, { notebookId: notebook!.id, queryEmbedding });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.sourceId !== processingSource!.id)).toBe(true);
      expect(results[0].content).toBe(catText);
      expect(results[1].content).toBe(airplaneText);
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    },
    30000,
  );
});

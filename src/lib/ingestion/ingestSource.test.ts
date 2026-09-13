// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { ingestSource } from './index';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('ingestSource', () => {
  const createdNotebookIds: string[] = [];
  const uploadedStoragePaths: string[] = [];

  afterAll(async () => {
    const service = createServiceClient();
    if (uploadedStoragePaths.length > 0) {
      await service.storage.from('sources').remove(uploadedStoragePaths);
    }
    if (createdNotebookIds.length > 0) {
      await service.from('notebooks').delete().in('id', createdNotebookIds);
    }
  });

  it('runs parse, normalize, chunk, embed, and finalize for a pasted-text source', async () => {
    const anon = await createPrimaryTestClient();
    const { data: authData, error: authError } = await anon.auth.getUser();
    expect(authError).toBeNull();

    const service = createServiceClient();

    const { data: notebook, error: notebookError } = await service
      .from('notebooks')
      .insert({ owner_id: authData!.user!.id, title: 'Ingestion test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const { data: source, error: sourceError } = await service
      .from('sources')
      .insert({ notebook_id: notebook!.id, type: 'pasted_text', title: 'Ingestion test source' })
      .select()
      .single();
    expect(sourceError).toBeNull();

    const pastedText = [
      'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
      'The Boeing 747 is a wide-body commercial jet airliner.',
    ].join('\n\n');

    const storagePath = `${notebook!.id}/${source!.id}/original.txt`;
    const { error: uploadError } = await service.storage
      .from('sources')
      .upload(storagePath, pastedText, { contentType: 'text/plain' });
    expect(uploadError).toBeNull();
    uploadedStoragePaths.push(storagePath);

    const { error: pathUpdateError } = await service
      .from('sources')
      .update({ storage_path: storagePath })
      .eq('id', source!.id);
    expect(pathUpdateError).toBeNull();

    const t = new InngestTestEngine({ function: ingestSource });
    const { result } = await t.execute({
      events: [{ name: 'sourcebook/source.ingest.requested', data: { sourceId: source!.id } }],
    });

    expect(result).toEqual({ sourceId: source!.id, chunkCount: 2 });

    const { data: finalSource } = await service
      .from('sources')
      .select('status, title')
      .eq('id', source!.id)
      .single();
    expect(finalSource?.status).toBe('ready');
    expect(finalSource?.title).not.toBe('Ingestion test source');

    const { data: chunks } = await service
      .from('source_chunks')
      .select('chunk_index, content, embedding')
      .eq('source_id', source!.id)
      .order('chunk_index');
    expect(chunks).toHaveLength(2);
    expect(chunks![0].content).toContain('Domestic cats');
    expect(chunks![1].content).toContain('Boeing 747');
    expect(chunks![0].embedding).not.toBeNull();

    const { data: steps } = await service
      .from('processing_steps')
      .select('step, status, attempts')
      .eq('source_id', source!.id);
    expect(steps).toHaveLength(5);
    expect(steps!.every((s) => s.status === 'succeeded' && s.attempts === 1)).toBe(true);
  }, 30000);
});

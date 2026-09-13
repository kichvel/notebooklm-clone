// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { ingestSource } from '@/lib/ingestion';
import { createPastedTextSource } from './index';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('createPastedTextSource', () => {
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

  it(
    'uploads the pasted text, registers the source, and enables the real ingestion pipeline to complete it',
    async () => {
      const user = await createPrimaryTestClient();

      const { data: notebook, error: notebookError } = await user
        .from('notebooks')
        .insert({ title: 'Source creation test notebook' })
        .select()
        .single();
      expect(notebookError).toBeNull();
      createdNotebookIds.push(notebook!.id);

      const pastedText = [
        'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
        'The Boeing 747 is a wide-body commercial jet airliner.',
      ].join('\n\n');

      const source = await createPastedTextSource(user, {
        notebookId: notebook!.id,
        title: 'Pasted source test',
        text: pastedText,
      });

      // This sandbox's INNGEST_EVENT_KEY does not authenticate against Inngest Cloud
      // (no local Inngest Dev Server is running here either, matching this slice's
      // "no live Inngest Dev Server processes" constraint), so the real inngest.send()
      // inside createPastedTextSource fails and the source lands in the documented
      // failed/retryable state (ARCHITECTURE.md §6/§12) instead of 'uploaded'. Either
      // way, the row and Storage object it wrote are what matters for ingestion below.
      expect(['uploaded', 'failed']).toContain(source.status);
      expect(source.storage_path).toBe(`${notebook!.id}/${source.id}/original.txt`);
      uploadedStoragePaths.push(source.storage_path);

      const t = new InngestTestEngine({ function: ingestSource });
      const { result } = await t.execute({
        events: [{ name: 'sourcebook/source.ingest.requested', data: { sourceId: source.id } }],
      });
      expect(result).toEqual({ sourceId: source.id, chunkCount: 2 });

      const { data: finalSource } = await user.from('sources').select('status').eq('id', source.id).single();
      expect(finalSource?.status).toBe('ready');
    },
    30000,
  );
});

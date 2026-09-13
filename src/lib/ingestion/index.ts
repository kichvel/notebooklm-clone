import 'server-only';
import { NonRetriableError } from 'inngest';
import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/server';
import { embed } from '@/lib/providers/openai';

type ProcessingStep = 'parse' | 'normalize' | 'chunk' | 'embed' | 'finalize';
type ProcessingStatus = 'in_progress' | 'succeeded' | 'failed';

async function upsertProcessingStep(
  supabase: ReturnType<typeof createServiceClient>,
  sourceId: string,
  step: ProcessingStep,
  status: ProcessingStatus,
) {
  const { data: existing } = await supabase
    .from('processing_steps')
    .select('attempts')
    .eq('source_id', sourceId)
    .eq('step', step)
    .maybeSingle();

  const attempts = status === 'in_progress' ? (existing?.attempts ?? 0) + 1 : (existing?.attempts ?? 1);

  await supabase.from('processing_steps').upsert(
    { source_id: sourceId, step, status, attempts },
    { onConflict: 'source_id,step' },
  );
}

export const ingestSource = inngest.createFunction(
  { id: 'ingest-source', triggers: { event: 'sourcebook/source.ingest.requested' } },
  async ({ event, step }) => {
    const supabase = createServiceClient();
    const sourceId = event.data.sourceId as string;

    const rawText = await step.run('parse', async () => {
      await upsertProcessingStep(supabase, sourceId, 'parse', 'in_progress');

      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .select('storage_path')
        .eq('id', sourceId)
        .single();
      if (sourceError || !source?.storage_path) {
        await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
        throw new NonRetriableError(`Source ${sourceId} not found or missing storage_path`);
      }

      await supabase.from('sources').update({ status: 'processing' }).eq('id', sourceId);

      const { data: blob, error: downloadError } = await supabase.storage
        .from('sources')
        .download(source.storage_path);
      if (downloadError || !blob) {
        await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
        throw downloadError ?? new Error('Missing storage object');
      }

      const text = await blob.text();
      await upsertProcessingStep(supabase, sourceId, 'parse', 'succeeded');
      return text;
    });

    const normalizedText = await step.run('normalize', async () => {
      await upsertProcessingStep(supabase, sourceId, 'normalize', 'in_progress');
      const normalized = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
      await upsertProcessingStep(supabase, sourceId, 'normalize', 'succeeded');
      return normalized;
    });

    const chunks = await step.run('chunk', async () => {
      await upsertProcessingStep(supabase, sourceId, 'chunk', 'in_progress');
      const parts = normalizedText
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      await upsertProcessingStep(supabase, sourceId, 'chunk', 'succeeded');
      return parts;
    });

    await step.run('embed', async () => {
      await upsertProcessingStep(supabase, sourceId, 'embed', 'in_progress');
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await embed(chunks[i]);
        const { error } = await supabase
          .from('source_chunks')
          .upsert(
            { source_id: sourceId, chunk_index: i, content: chunks[i], embedding },
            { onConflict: 'source_id,chunk_index' },
          );
        if (error) {
          await upsertProcessingStep(supabase, sourceId, 'embed', 'failed');
          throw error;
        }
      }
      await upsertProcessingStep(supabase, sourceId, 'embed', 'succeeded');
    });

    await step.run('finalize', async () => {
      await upsertProcessingStep(supabase, sourceId, 'finalize', 'in_progress');
      const { count } = await supabase
        .from('source_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('source_id', sourceId);
      if (!count || count !== chunks.length) {
        await upsertProcessingStep(supabase, sourceId, 'finalize', 'failed');
        throw new Error('Chunk count mismatch during finalize');
      }
      await supabase.from('sources').update({ status: 'ready' }).eq('id', sourceId);
      await upsertProcessingStep(supabase, sourceId, 'finalize', 'succeeded');
    });

    return { sourceId, chunkCount: chunks.length };
  },
);

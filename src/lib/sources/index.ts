import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '@/lib/inngest/client';

export interface CreatePastedTextSourceParams {
  notebookId: string;
  title: string;
  text: string;
}

export async function createPastedTextSource(
  supabase: SupabaseClient,
  { notebookId, title, text }: CreatePastedTextSourceParams,
) {
  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .insert({ notebook_id: notebookId, type: 'pasted_text', title })
    .select()
    .single();
  if (sourceError) throw sourceError;

  const storagePath = `${notebookId}/${source.id}/original.txt`;
  const { error: uploadError } = await supabase.storage
    .from('sources')
    .upload(storagePath, text, { contentType: 'text/plain' });
  if (uploadError) throw uploadError;

  const { data: updated, error: updateError } = await supabase
    .from('sources')
    .update({ storage_path: storagePath })
    .eq('id', source.id)
    .select()
    .single();
  if (updateError) throw updateError;

  try {
    await inngest.send({ name: 'sourcebook/source.ingest.requested', data: { sourceId: source.id } });
  } catch {
    // Per ARCHITECTURE.md §6/§12: a completed upload whose enqueue fails stays visibly
    // failed and retryable, rather than the request throwing and losing the registered source.
    const { data: failed, error: failError } = await supabase
      .from('sources')
      .update({ status: 'failed', failure_reason: 'Failed to enqueue ingestion' })
      .eq('id', source.id)
      .select()
      .single();
    if (failError) throw failError;
    return failed;
  }

  return updated;
}

export async function retrySource(supabase: SupabaseClient, sourceId: string) {
  const { data: reset, error: resetError } = await supabase
    .from('sources')
    .update({ status: 'uploaded', failure_reason: null })
    .eq('id', sourceId)
    .select()
    .single();
  if (resetError) throw resetError;

  try {
    await inngest.send({ name: 'sourcebook/source.ingest.requested', data: { sourceId } });
  } catch {
    const { data: failed, error: failError } = await supabase
      .from('sources')
      .update({ status: 'failed', failure_reason: 'Failed to enqueue ingestion' })
      .eq('id', sourceId)
      .select()
      .single();
    if (failError) throw failError;
    return failed;
  }

  return reset;
}

export async function deleteSource(supabase: SupabaseClient, sourceId: string) {
  const { error } = await supabase
    .from('sources')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sourceId);
  if (error) throw error;
}

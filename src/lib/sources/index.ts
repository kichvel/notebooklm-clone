import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_TRANSCRIPTION_AUDIO_BYTES } from '@/lib/providers/openai';
import { inngest } from '@/lib/inngest/client';

type SourceRow = Record<string, unknown> & { id: string; status: string };

// Per ARCHITECTURE.md §6/§12: a completed upload whose enqueue fails stays visibly
// failed and retryable, rather than the request throwing and losing the registered source.
async function enqueueOrMarkFailed(supabase: SupabaseClient, source: SourceRow) {
  try {
    await inngest.send({
      name: 'sourcebook/source.ingest.requested',
      data: { sourceId: source.id },
    });
  } catch {
    const { data: failed, error: failError } = await supabase
      .from('sources')
      .update({ status: 'failed', failure_reason: 'Failed to enqueue ingestion' })
      .eq('id', source.id)
      .select()
      .single();
    if (failError) throw failError;
    return failed;
  }
  return source;
}

export interface CreatePastedTextSourceParams {
  notebookId: string;
  title?: string;
  text: string;
}

export async function createPastedTextSource(
  supabase: SupabaseClient,
  { notebookId, title, text }: CreatePastedTextSourceParams,
) {
  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .insert({ notebook_id: notebookId, type: 'pasted_text', title: title?.trim() || 'Pasted text' })
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

  return enqueueOrMarkFailed(supabase, updated);
}

const FILE_EXTENSION_TYPE: Record<string, 'pdf' | 'docx' | 'audio'> = {
  pdf: 'pdf',
  docx: 'docx',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  webm: 'audio',
  ogg: 'audio',
};

export interface CreateFileSourceParams {
  notebookId: string;
  filename: string;
  file: Blob;
}

export async function createFileSource(
  supabase: SupabaseClient,
  { notebookId, filename, file }: CreateFileSourceParams,
) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const type = FILE_EXTENSION_TYPE[ext];
  if (!type) throw new Error(`Unsupported file type: .${ext}`);

  // pdf/docx are size-checked upstream in route.ts; audio is capped here too since
  // this module is the only place that knows the transcription size limit.
  if (type === 'audio' && file.size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    throw new Error('Audio file exceeds the 25MB limit');
  }

  const placeholderTitle = filename.replace(/\.[^.]+$/, '') || filename;

  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .insert({ notebook_id: notebookId, type, title: placeholderTitle })
    .select()
    .single();
  if (sourceError) throw sourceError;

  const storagePath = `${notebookId}/${source.id}/original.${ext}`;
  const { error: uploadError } = await supabase.storage.from('sources').upload(storagePath, file);
  if (uploadError) throw uploadError;

  const { data: updated, error: updateError } = await supabase
    .from('sources')
    .update({ storage_path: storagePath })
    .eq('id', source.id)
    .select()
    .single();
  if (updateError) throw updateError;

  return enqueueOrMarkFailed(supabase, updated);
}

export interface CreateWebsiteSourceParams {
  notebookId: string;
  url: string;
}

export async function createWebsiteSource(
  supabase: SupabaseClient,
  { notebookId, url }: CreateWebsiteSourceParams,
) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported URL scheme');
  }

  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .insert({
      notebook_id: notebookId,
      type: 'website',
      title: parsed.hostname,
      origin_url: url,
    })
    .select()
    .single();
  if (sourceError) throw sourceError;

  return enqueueOrMarkFailed(supabase, source);
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com']);

export interface CreateYoutubeSourceParams {
  notebookId: string;
  url: string;
}

export async function createYoutubeSource(
  supabase: SupabaseClient,
  { notebookId, url }: CreateYoutubeSourceParams,
) {
  const parsed = new URL(url);
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) {
    throw new Error('Unsupported URL: not a YouTube link');
  }

  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .insert({
      notebook_id: notebookId,
      type: 'youtube',
      title: 'YouTube video',
      origin_url: url,
    })
    .select()
    .single();
  if (sourceError) throw sourceError;

  return enqueueOrMarkFailed(supabase, source);
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

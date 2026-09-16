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

const FILE_EXTENSION_TYPE: Record<string, 'pdf' | 'docx' | 'txt' | 'audio'> = {
  pdf: 'pdf',
  docx: 'docx',
  md: 'txt',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  webm: 'audio',
  ogg: 'audio',
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateFileSourceParams {
  notebookId: string;
  id: string;
  filename: string;
}

// The client uploads the file directly to Storage before calling this (see
// ARCHITECTURE.md upload flow) — this only registers an object that must already
// exist, verifying its real size via Storage rather than trusting the client's claim.
export async function createFileSource(
  supabase: SupabaseClient,
  { notebookId, id, filename }: CreateFileSourceParams,
) {
  if (!UUID_RE.test(id)) throw new Error('Invalid source id');

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const type = FILE_EXTENSION_TYPE[ext];
  if (!type) throw new Error(`Unsupported file type: .${ext}`);

  const storagePath = `${notebookId}/${id}/original.${ext}`;
  const { data: info, error: infoError } = await supabase.storage.from('sources').info(storagePath);
  if (infoError || !info) throw new Error('Uploaded file was not found in storage');

  const limit = type === 'audio' ? MAX_TRANSCRIPTION_AUDIO_BYTES : MAX_FILE_BYTES;
  if ((info.size ?? 0) > limit) {
    await supabase.storage.from('sources').remove([storagePath]);
    throw new Error(`File exceeds ${limit / (1024 * 1024)}MB limit`);
  }

  const placeholderTitle = filename.replace(/\.[^.]+$/, '') || filename;

  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .insert({
      id,
      notebook_id: notebookId,
      type,
      title: placeholderTitle,
      original_filename: filename,
      storage_path: storagePath,
    })
    .select()
    .single();
  if (sourceError) {
    await supabase.storage.from('sources').remove([storagePath]);
    throw sourceError;
  }

  return enqueueOrMarkFailed(supabase, source);
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

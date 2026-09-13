import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedCitation {
  label: number;
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number | null;
  pageNumber: number | null;
  section: string | null;
  startSeconds: number | null;
  sourceUrl: string | null;
  content: string;
}

export async function resolveCitations(
  supabase: SupabaseClient,
  messageId: string,
): Promise<ResolvedCitation[]> {
  const { data, error } = await supabase
    .from('message_citations')
    .select(
      'label, source_id, source_title, chunk_index, page_number, section, start_seconds, source_url, content_snapshot',
    )
    .eq('message_id', messageId)
    .order('label');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    label: row.label,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    section: row.section,
    startSeconds: row.start_seconds,
    sourceUrl: row.source_url,
    content: row.content_snapshot,
  }));
}

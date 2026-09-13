import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SearchParams {
  notebookId: string;
  sourceIds?: string[];
  queryEmbedding: number[];
  matchCount?: number;
}

export interface SearchResult {
  chunkId: string;
  sourceId: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  section: string | null;
  similarity: number;
}

interface MatchSourceChunksRow {
  chunk_id: string;
  source_id: string;
  content: string;
  chunk_index: number;
  page_number: number | null;
  section: string | null;
  similarity: number;
}

export async function search(
  client: SupabaseClient,
  { notebookId, sourceIds, queryEmbedding, matchCount = 8 }: SearchParams,
): Promise<SearchResult[]> {
  const { data, error } = await client.rpc('match_source_chunks', {
    query_embedding: queryEmbedding,
    match_notebook_id: notebookId,
    match_source_ids: sourceIds ?? null,
    match_count: matchCount,
  });

  if (error) throw error;

  return ((data ?? []) as MatchSourceChunksRow[]).map((row) => ({
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    section: row.section,
    similarity: row.similarity,
  }));
}

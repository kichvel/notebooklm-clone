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
  startSeconds: number | null;
  similarity: number;
}

interface MatchSourceChunksRow {
  chunk_id: string;
  source_id: string;
  content: string;
  chunk_index: number;
  page_number: number | null;
  section: string | null;
  start_seconds: number | null;
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
    startSeconds: row.start_seconds,
    similarity: row.similarity,
  }));
}

export interface SourceSample {
  chunkId: string;
  sourceId: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  section: string | null;
  startSeconds: number | null;
}

export interface SampleAcrossSourcesParams {
  notebookId: string;
  sourceIds?: string[];
  chunksPerSource?: number;
}

interface SourceChunkRow {
  id: string;
  source_id: string;
  content: string;
  chunk_index: number;
  page_number: number | null;
  section: string | null;
  start_seconds: number | null;
}

// Draws the first `chunksPerSource` chunks from every ready source, rather than a single
// similarity search across all chunks — so a notebook-wide question is represented by every
// source in proportion to source count, not dominated by whichever source has the most chunks.
// Chunks come back grouped by source (sources in the order returned by the query, chunks in
// chunk_index order within each), so callers can build source-grouped prompts directly.
export async function sampleAcrossSources(
  client: SupabaseClient,
  { notebookId, sourceIds, chunksPerSource = 3 }: SampleAcrossSourcesParams,
): Promise<SourceSample[]> {
  let query = client
    .from('sources')
    .select('id')
    .eq('notebook_id', notebookId)
    .eq('status', 'ready')
    .is('deleted_at', null);
  if (sourceIds && sourceIds.length > 0) query = query.in('id', sourceIds);
  const { data: sources, error: sourcesError } = await query;
  if (sourcesError) throw sourcesError;
  if (!sources || sources.length === 0) return [];

  const perSource = await Promise.all(
    sources.map(async (source) => {
      const { data: chunks, error } = await client
        .from('source_chunks')
        .select('id, source_id, content, chunk_index, page_number, section, start_seconds')
        .eq('source_id', source.id as string)
        .order('chunk_index')
        .limit(chunksPerSource);
      if (error) throw error;
      return ((chunks ?? []) as SourceChunkRow[]).map((row) => ({
        chunkId: row.id,
        sourceId: row.source_id,
        content: row.content,
        chunkIndex: row.chunk_index,
        pageNumber: row.page_number,
        section: row.section,
        startSeconds: row.start_seconds,
      }));
    }),
  );

  return perSource.flat();
}

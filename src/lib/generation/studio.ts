import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { embed, generateFlashcard, generateQuizQuestion } from '@/lib/providers/openai';
import { search } from '@/lib/retrieval';
import { buildYoutubeTimestampUrl, type Citation } from './index';

export interface StudioCitation extends Citation {
  chunkId: string;
}

const STUDIO_QUERY_TEXT =
  'key facts, concepts, definitions, and important details covered in the source material';
const RETRIEVAL_POOL_SIZE = 30;

export type PassageResult =
  | { status: 'ok'; content: string; citation: StudioCitation }
  | { status: 'exhausted' };

export async function selectNextPassage(
  supabase: SupabaseClient,
  {
    notebookId,
    sourceIds,
    excludeChunkIds,
  }: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
): Promise<PassageResult> {
  const queryEmbedding = await embed(STUDIO_QUERY_TEXT);
  const results = await search(supabase, {
    notebookId,
    sourceIds,
    queryEmbedding,
    matchCount: RETRIEVAL_POOL_SIZE,
  });
  const excluded = new Set(excludeChunkIds);
  const passage = results.find((r) => !excluded.has(r.chunkId));
  if (!passage) return { status: 'exhausted' };

  const { data: source, error } = await supabase
    .from('sources')
    .select('id, title, type, origin_url')
    .eq('id', passage.sourceId)
    .single();
  if (error) throw error;

  const sourceUrl =
    source.type === 'youtube' && source.origin_url && passage.startSeconds !== null
      ? buildYoutubeTimestampUrl(source.origin_url, passage.startSeconds)
      : null;

  return {
    status: 'ok',
    content: passage.content,
    citation: {
      label: 1,
      sourceId: passage.sourceId,
      sourceTitle: source.title ?? 'Untitled source',
      chunkIndex: passage.chunkIndex,
      pageNumber: passage.pageNumber,
      section: passage.section,
      startSeconds: passage.startSeconds,
      sourceUrl,
      content: passage.content,
      chunkId: passage.chunkId,
    },
  };
}

export type StudioFlashcardResult =
  | { status: 'ok'; card: { front: string; back: string }; citation: StudioCitation }
  | { status: 'exhausted' };

export async function generateNextFlashcard(
  supabase: SupabaseClient,
  params: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
): Promise<StudioFlashcardResult> {
  const picked = await selectNextPassage(supabase, params);
  if (picked.status === 'exhausted') return picked;
  const card = await generateFlashcard({
    system:
      'Create one study flashcard grounded ONLY in the passage below. "front" is a question or prompt; "back" is the answer. Never use knowledge outside the passage.',
    prompt: `Passage:\n${picked.content}`,
  });
  if (!card) return { status: 'exhausted' };
  return { status: 'ok', card, citation: picked.citation };
}

export type StudioQuizResult =
  | {
      status: 'ok';
      question: string;
      options: string[];
      correctIndex: number;
      citation: StudioCitation;
    }
  | { status: 'exhausted' };

export async function generateNextQuizQuestion(
  supabase: SupabaseClient,
  params: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
): Promise<StudioQuizResult> {
  const picked = await selectNextPassage(supabase, params);
  if (picked.status === 'exhausted') return picked;
  const question = await generateQuizQuestion({
    system:
      'Create one multiple-choice question with exactly 4 options, grounded ONLY in the passage below. Exactly one option is correct; the rest must be plausible but clearly wrong given the passage. Never use knowledge outside the passage.',
    prompt: `Passage:\n${picked.content}`,
  });
  if (!question) return { status: 'exhausted' };
  return { status: 'ok', ...question, citation: picked.citation };
}

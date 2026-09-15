import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { embed, generateFlashcards, generateQuizQuestions } from '@/lib/providers/openai';
import { search } from '@/lib/retrieval';
import { buildYoutubeTimestampUrl, type Citation } from './index';

export interface StudioCitation extends Citation {
  chunkId: string;
}

const STUDIO_QUERY_TEXT =
  'key facts, concepts, definitions, and important details covered in the source material';
const RETRIEVAL_POOL_SIZE = 30;

export type PassageResult =
  | { status: 'ok'; content: string; citation: StudioCitation; sourceSummary: string | null }
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
    .select('id, title, type, origin_url, intro_summary')
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
    sourceSummary: source.intro_summary ?? null,
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

export type StudioFlashcardsResult =
  | {
      status: 'ok';
      items: { card: { front: string; back: string }; citation: StudioCitation }[];
    }
  | { status: 'exhausted' };

export async function generateNextFlashcards(
  supabase: SupabaseClient,
  params: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
): Promise<StudioFlashcardsResult> {
  const picked = await selectNextPassage(supabase, params);
  if (picked.status === 'exhausted') return picked;
  const cards = await generateFlashcards({
    system:
      'Create two distinct study flashcards grounded ONLY in the passage below, each testing a different fact or concept from it. "front" is a question or prompt; "back" is the answer. Never use knowledge outside the passage. A document summary may be given only so you understand what the whole document covers — never cite it, quote it, or treat it as a source of facts; every flashcard must be answerable from the passage alone.',
    prompt: [
      picked.sourceSummary
        ? `Document summary (context only, not a source):\n${picked.sourceSummary}`
        : null,
      `Passage:\n${picked.content}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  if (!cards) return { status: 'exhausted' };
  return { status: 'ok', items: cards.map((card) => ({ card, citation: picked.citation })) };
}

export type StudioQuizResult =
  | {
      status: 'ok';
      items: {
        question: string;
        options: string[];
        correctIndex: number;
        citation: StudioCitation;
      }[];
    }
  | { status: 'exhausted' };

export async function generateNextQuizQuestions(
  supabase: SupabaseClient,
  params: { notebookId: string; sourceIds?: string[]; excludeChunkIds: string[] },
): Promise<StudioQuizResult> {
  const picked = await selectNextPassage(supabase, params);
  if (picked.status === 'exhausted') return picked;
  const questions = await generateQuizQuestions({
    system:
      'Create two distinct multiple-choice questions, each with exactly 4 options, grounded ONLY in the passage below and testing different facts or concepts from it. Exactly one option per question is correct; the rest must be plausible but clearly wrong given the passage. Never use knowledge outside the passage. A document summary may be given only so you understand what the whole document covers — never cite it, quote it, or treat it as a source of facts; every question must be answerable from the passage alone.',
    prompt: [
      picked.sourceSummary
        ? `Document summary (context only, not a source):\n${picked.sourceSummary}`
        : null,
      `Passage:\n${picked.content}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  if (!questions) return { status: 'exhausted' };
  return {
    status: 'ok',
    items: questions.map((question) => ({ ...question, citation: picked.citation })),
  };
}

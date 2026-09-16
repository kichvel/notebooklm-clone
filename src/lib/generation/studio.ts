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
// A passage can legitimately have no testable content (a heading, a nav label, a
// links list) and the model is instructed to return an empty list rather than
// invent a fact for it. Rather than surfacing that as "exhausted" to the user,
// move on to the next passage — bounded so a run of unusable passages can't turn
// into an unbounded chain of model calls.
const MAX_PASSAGE_ATTEMPTS = 5;

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
  const tried = [...params.excludeChunkIds];
  for (let attempt = 0; attempt < MAX_PASSAGE_ATTEMPTS; attempt++) {
    const picked = await selectNextPassage(supabase, { ...params, excludeChunkIds: tried });
    if (picked.status === 'exhausted') return picked;
    tried.push(picked.citation.chunkId);
    const cards = await generateFlashcards({
      system:
        'Create study flashcards grounded ONLY in the excerpt below: two if it contains two distinct facts or concepts worth testing separately, one if it genuinely supports just a single fact, or an empty list if the excerpt has no testable factual content at all (e.g. it is only a heading, a navigation label, or a list of unrelated links) — never invent a fact to fill the list. "front" is a question or prompt; "back" is the answer. Phrase the question naturally, about the subject matter itself — never refer to "the excerpt," "the passage," or "the text" in the question or answer. Never use knowledge outside the excerpt. A document summary may be given only so you understand what the whole document covers — never cite it, quote it, or treat it as a source of facts; every flashcard must be answerable from the excerpt alone.',
      prompt: [
        picked.sourceSummary
          ? `Document summary (context only, not a source):\n${picked.sourceSummary}`
          : null,
        `Excerpt:\n${picked.content}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    if (cards && cards.length > 0) {
      return { status: 'ok', items: cards.map((card) => ({ card, citation: picked.citation })) };
    }
  }
  return { status: 'exhausted' };
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
  const tried = [...params.excludeChunkIds];
  for (let attempt = 0; attempt < MAX_PASSAGE_ATTEMPTS; attempt++) {
    const picked = await selectNextPassage(supabase, { ...params, excludeChunkIds: tried });
    if (picked.status === 'exhausted') return picked;
    tried.push(picked.citation.chunkId);
    const questions = await generateQuizQuestions({
      system:
        'Create multiple-choice questions, each with exactly 4 options, grounded ONLY in the excerpt below: two if it contains two distinct facts or concepts worth testing separately, one if it genuinely supports just a single fact, or an empty list if the excerpt has no testable factual content at all (e.g. it is only a heading, a navigation label, or a list of unrelated links) — never invent a fact to fill the list. Exactly one option per question is correct; the rest must be plausible but clearly wrong given the excerpt. Phrase each question naturally, about the subject matter itself — never refer to "the excerpt," "the passage," or "the text" in the question or its options. Never use knowledge outside the excerpt. A document summary may be given only so you understand what the whole document covers — never cite it, quote it, or treat it as a source of facts; every question must be answerable from the excerpt alone.',
      prompt: [
        picked.sourceSummary
          ? `Document summary (context only, not a source):\n${picked.sourceSummary}`
          : null,
        `Excerpt:\n${picked.content}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    if (questions && questions.length > 0) {
      return {
        status: 'ok',
        items: questions.map((question) => ({ ...question, citation: picked.citation })),
      };
    }
  }
  return { status: 'exhausted' };
}

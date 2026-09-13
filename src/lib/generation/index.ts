import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CAPABLE_GENERATION_MODEL, embed, generate } from '@/lib/providers/openai';
import { search } from '@/lib/retrieval';

export const REFUSAL_TEXT =
  "I don't have enough information in the selected sources to answer that.";

export interface AskQuestionParams {
  notebookId: string;
  question: string;
  sourceIds?: string[];
}

export interface Citation {
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

export function buildYoutubeTimestampUrl(originUrl: string, startSeconds: number): string {
  const url = new URL(originUrl);
  url.searchParams.set('t', `${Math.floor(startSeconds)}s`);
  return url.toString();
}

export interface AskQuestionResult {
  messageId: string;
  status: 'complete' | 'refused';
  answer: string;
  citations: Citation[];
}

function buildSystemPrompt(passageCount: number): string {
  return [
    `You answer questions using ONLY the numbered passages below as evidence. Passages are numbered [1] through [${passageCount}].`,
    'Cite every factual claim with the passage number(s) it is drawn from, in square brackets, e.g. "Cats are mammals [1]."',
    'Never use knowledge outside the passages.',
    `If the passages do not contain enough information to answer, respond with exactly this text and nothing else: "${REFUSAL_TEXT}"`,
  ].join('\n');
}

async function persistRefusal(
  supabase: SupabaseClient,
  notebookId: string,
): Promise<AskQuestionResult> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      notebook_id: notebookId,
      role: 'assistant',
      content: REFUSAL_TEXT,
      status: 'refused',
    })
    .select()
    .single();
  if (error) throw error;
  return { messageId: data.id, status: 'refused', answer: REFUSAL_TEXT, citations: [] };
}

export async function askQuestion(
  supabase: SupabaseClient,
  { notebookId, question, sourceIds }: AskQuestionParams,
): Promise<AskQuestionResult> {
  const { error: userMessageError } = await supabase
    .from('messages')
    .insert({ notebook_id: notebookId, role: 'user', content: question, status: 'complete' });
  if (userMessageError) throw userMessageError;

  const queryEmbedding = await embed(question);
  const results = await search(supabase, { notebookId, sourceIds, queryEmbedding, matchCount: 8 });
  if (results.length === 0) return persistRefusal(supabase, notebookId);

  const system = buildSystemPrompt(results.length);
  const passagesBlock = results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');
  const rawAnswer = (
    await generate({
      system,
      prompt: `Passages:\n${passagesBlock}\n\nQuestion: ${question}`,
      model: CAPABLE_GENERATION_MODEL,
    })
  ).trim();

  const validLabels = new Map<number, (typeof results)[number]>();
  for (const match of rawAnswer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= results.length) validLabels.set(n, results[n - 1]);
  }
  if (rawAnswer === REFUSAL_TEXT || validLabels.size === 0)
    return persistRefusal(supabase, notebookId);

  const citedSourceIds = [...new Set([...validLabels.values()].map((r) => r.sourceId))];
  const { data: sources, error: sourcesError } = await supabase
    .from('sources')
    .select('id, title, type, origin_url')
    .in('id', citedSourceIds);
  if (sourcesError) throw sourcesError;
  const sourceById = new Map((sources ?? []).map((s) => [s.id as string, s]));

  const selectedSourceIds = [...new Set(results.map((r) => r.sourceId))];
  const { data: assistantMessage, error: messageError } = await supabase
    .from('messages')
    .insert({
      notebook_id: notebookId,
      role: 'assistant',
      content: rawAnswer,
      status: 'complete',
      selected_source_ids: selectedSourceIds,
    })
    .select()
    .single();
  if (messageError) throw messageError;

  const citationRows = [...validLabels.entries()].map(([label, r]) => {
    const source = sourceById.get(r.sourceId);
    const sourceUrl =
      source?.type === 'youtube' && source.origin_url && r.startSeconds !== null
        ? buildYoutubeTimestampUrl(source.origin_url as string, r.startSeconds)
        : null;
    return {
      message_id: assistantMessage.id,
      label,
      source_id: r.sourceId,
      chunk_id: r.chunkId,
      source_title: (source?.title as string) ?? 'Untitled source',
      chunk_index: r.chunkIndex,
      page_number: r.pageNumber,
      section: r.section,
      start_seconds: r.startSeconds,
      source_url: sourceUrl,
      content_snapshot: r.content,
    };
  });
  const { error: citationsError } = await supabase.from('message_citations').insert(citationRows);
  if (citationsError) throw citationsError;

  return {
    messageId: assistantMessage.id,
    status: 'complete',
    answer: rawAnswer,
    citations: citationRows.map((row) => ({
      label: row.label,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      section: row.section,
      startSeconds: row.start_seconds,
      sourceUrl: row.source_url,
      content: row.content_snapshot,
    })),
  };
}

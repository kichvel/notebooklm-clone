import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { embed, generateStreaming, REASONING_GENERATION_MODEL } from '@/lib/providers/openai';
import { search } from '@/lib/retrieval';
import { followUpPromptInstruction, parseFollowUps, FALLBACK_FOLLOW_UP_QUESTIONS } from './followUps';
import { rewriteFollowUpQuery } from './rewriteQuery';
import type { ChatSettings } from '@/lib/notebooks/chatSettings';

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
  reasoning: string;
  citations: Citation[];
  followUpQuestions: string[];
}

export type AskQuestionEvent =
  | { type: 'passages'; citations: Citation[] }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'answer_delta'; text: string }
  | { type: 'done'; result: AskQuestionResult }
  | { type: 'error'; message: string };

const LENGTH_INSTRUCTIONS: Record<ChatSettings['chatAnswerLength'], string> = {
  shorter: 'Answer concisely, in a short paragraph or two.',
  default:
    'Answer thoroughly: a few solid paragraphs covering relevant nuance, context, and examples drawn from the passages.',
  longer:
    'Answer comprehensively and in detail: explore the topic thoroughly, using multiple paragraphs or sections as warranted by the passages.',
};

export function buildSystemPrompt(passageCount: number, chatSettings: ChatSettings): string {
  const lines = [
    `You answer questions using ONLY the numbered passages below as evidence. Passages are numbered [1] through [${passageCount}].`,
    'Cite every factual claim with the passage number(s) it is drawn from, in square brackets, e.g. "Cats are mammals [1]."',
    'Never use knowledge outside the passages.',
    `If the passages do not contain enough information to answer, write exactly this text as your answer, before the follow-up section: "${REFUSAL_TEXT}"`,
    LENGTH_INSTRUCTIONS[chatSettings.chatAnswerLength],
  ];
  if (chatSettings.chatStyle === 'custom' && chatSettings.chatCustomStyle) {
    lines.push(`Adopt this conversational goal, style, or role: ${chatSettings.chatCustomStyle}`);
  }
  lines.push(followUpPromptInstruction());
  return lines.join('\n');
}

async function persistRefusal(
  supabase: SupabaseClient,
  notebookId: string,
  followUpQuestions: string[] = FALLBACK_FOLLOW_UP_QUESTIONS,
  reasoning = '',
): Promise<AskQuestionResult> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      notebook_id: notebookId,
      role: 'assistant',
      content: REFUSAL_TEXT,
      status: 'refused',
      reasoning,
      follow_up_questions: followUpQuestions,
    })
    .select()
    .single();
  if (error) throw error;
  return {
    messageId: data.id,
    status: 'refused',
    answer: REFUSAL_TEXT,
    reasoning,
    citations: [],
    followUpQuestions,
  };
}

export async function* streamAnswer(
  supabase: SupabaseClient,
  { notebookId, question, sourceIds }: AskQuestionParams,
): AsyncGenerator<AskQuestionEvent> {
  const retrievalQuestion = await rewriteFollowUpQuery(supabase, { notebookId, question });

  const { error: userMessageError } = await supabase
    .from('messages')
    .insert({ notebook_id: notebookId, role: 'user', content: question, status: 'complete' });
  if (userMessageError) throw userMessageError;

  const queryEmbedding = await embed(retrievalQuestion);
  const results = await search(supabase, { notebookId, sourceIds, queryEmbedding, matchCount: 8 });
  if (results.length === 0) {
    yield { type: 'done', result: await persistRefusal(supabase, notebookId) };
    return;
  }

  const selectedSourceIds = [...new Set(results.map((r) => r.sourceId))];
  const { data: sources, error: sourcesError } = await supabase
    .from('sources')
    .select('id, title, type, origin_url')
    .in('id', selectedSourceIds);
  if (sourcesError) throw sourcesError;
  const sourceById = new Map((sources ?? []).map((s) => [s.id as string, s]));

  const passages: Citation[] = results.map((r, i) => {
    const source = sourceById.get(r.sourceId);
    const sourceUrl =
      source?.type === 'youtube' && source.origin_url && r.startSeconds !== null
        ? buildYoutubeTimestampUrl(source.origin_url as string, r.startSeconds)
        : null;
    return {
      label: i + 1,
      sourceId: r.sourceId,
      sourceTitle: (source?.title as string) ?? 'Untitled source',
      chunkIndex: r.chunkIndex,
      pageNumber: r.pageNumber,
      section: r.section,
      startSeconds: r.startSeconds,
      sourceUrl,
      content: r.content,
    };
  });
  yield { type: 'passages', citations: passages };

  const { data: notebook, error: notebookError } = await supabase
    .from('notebooks')
    .select('chat_style, chat_custom_style, chat_answer_length')
    .eq('id', notebookId)
    .single();
  if (notebookError) throw notebookError;
  const chatSettings: ChatSettings = {
    chatStyle: notebook.chat_style,
    chatCustomStyle: notebook.chat_custom_style,
    chatAnswerLength: notebook.chat_answer_length,
  };

  const system = buildSystemPrompt(results.length, chatSettings);
  const passagesBlock = results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');

  let reasoning = '';
  let generated = '';
  for await (const chunk of generateStreaming({
    system,
    prompt: `Passages:\n${passagesBlock}\n\nQuestion: ${question}`,
    model: REASONING_GENERATION_MODEL,
  })) {
    if (chunk.type === 'reasoning') {
      reasoning += chunk.text;
      yield { type: 'reasoning_delta', text: chunk.text };
    } else {
      generated += chunk.text;
      yield { type: 'answer_delta', text: chunk.text };
    }
  }

  const { text: rawAnswer, followUpQuestions } = parseFollowUps(generated.trim());

  const validLabels = new Map<number, (typeof results)[number]>();
  for (const match of rawAnswer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= results.length) validLabels.set(n, results[n - 1]);
  }
  if (rawAnswer === REFUSAL_TEXT || validLabels.size === 0) {
    yield {
      type: 'done',
      result: await persistRefusal(supabase, notebookId, followUpQuestions, reasoning),
    };
    return;
  }

  const { data: assistantMessage, error: messageError } = await supabase
    .from('messages')
    .insert({
      notebook_id: notebookId,
      role: 'assistant',
      content: rawAnswer,
      status: 'complete',
      reasoning,
      selected_source_ids: selectedSourceIds,
      follow_up_questions: followUpQuestions,
    })
    .select()
    .single();
  if (messageError) throw messageError;

  const citationRows = [...validLabels.entries()].map(([label, r]) => {
    const passage = passages.find((p) => p.label === label)!;
    return {
      message_id: assistantMessage.id,
      label,
      source_id: r.sourceId,
      chunk_id: r.chunkId,
      source_title: passage.sourceTitle,
      chunk_index: r.chunkIndex,
      page_number: r.pageNumber,
      section: r.section,
      start_seconds: r.startSeconds,
      source_url: passage.sourceUrl,
      content_snapshot: r.content,
    };
  });
  const { error: citationsError } = await supabase.from('message_citations').insert(citationRows);
  if (citationsError) throw citationsError;

  yield {
    type: 'done',
    result: {
      messageId: assistantMessage.id,
      status: 'complete',
      answer: rawAnswer,
      reasoning,
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
      followUpQuestions,
    },
  };
}

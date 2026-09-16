import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  embed,
  generateStreaming,
  GenerationIncompleteError,
  REASONING_GENERATION_MODEL,
} from '@/lib/providers/openai';
import { search, sampleAcrossSources, type SourceSample } from '@/lib/retrieval';
import { generateFollowUps } from './followUps';
import { fetchRecentMessages, rewriteFollowUpQuery } from './rewriteQuery';
import { claimGenerationLease, releaseGenerationLease } from './lease';
import { isNotebookOverviewQuestion } from './overviewIntent';
import type { ChatSettings } from '@/lib/notebooks/chatSettings';

// Balanced per-source sampling for a notebook-overview question: enough chunks per source to
// give a real sense of its content without one large source dwarfing everything else the way
// an unrestricted similarity search does.
const OVERVIEW_CHUNKS_PER_SOURCE = 3;
// Broad "summarize everything" answers need materially more room than a narrow factual answer —
// reasoning alone can otherwise consume the entire default budget before any answer text is
// emitted (see GenerationIncompleteError).
const OVERVIEW_MAX_OUTPUT_TOKENS = 4096;

export { NotebookBusyError } from './lease';

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
  | { type: 'follow_up_questions'; messageId: string; questions: string[] }
  | { type: 'error'; message: string };

const LENGTH_INSTRUCTIONS: Record<ChatSettings['chatAnswerLength'], string> = {
  shorter: 'Answer concisely, in a short paragraph or two.',
  default:
    'Answer thoroughly: a few solid paragraphs covering relevant nuance, context, and examples drawn from the passages.',
  longer:
    'Answer comprehensively and in detail: explore the topic thoroughly, using multiple paragraphs or sections as warranted by the passages.',
};

export interface SourceContext {
  sourceCount: number;
  sourceTitles: string[];
}

export function buildSystemPrompt(
  passageCount: number,
  chatSettings: ChatSettings,
  sourceContext?: SourceContext,
): string {
  const lines = [
    `You answer questions using ONLY the numbered passages below as evidence. Passages are numbered [1] through [${passageCount}].`,
  ];
  if (sourceContext) {
    const { sourceCount, sourceTitles } = sourceContext;
    const plural = sourceCount === 1 ? '' : 's';
    lines.push(
      `These ${passageCount} passages are grouped by source and drawn from exactly ${sourceCount} source${plural} in this notebook: ${sourceTitles.map((t) => `"${t}"`).join(', ')}. Multiple passages can and do come from the same source — passages are NOT sources. When describing what the notebook contains, refer to its ${sourceCount} source${plural} by name, never by counting passages.`,
    );
  }
  lines.push(
    'Cite every factual claim with the passage number(s) it is drawn from, in square brackets, e.g. "Cats are mammals [1]."',
    'Never use knowledge outside the passages.',
    'Conversation history, if provided, is only to help you understand references and intent in the current question (e.g. pronouns, "that", implicit comparisons) — never use it as a source of facts; facts must still come only from the numbered passages.',
    `If the passages do not contain enough information to answer, write exactly this text as your answer: "${REFUSAL_TEXT}"`,
    LENGTH_INSTRUCTIONS[chatSettings.chatAnswerLength],
  );
  if (chatSettings.chatStyle === 'custom' && chatSettings.chatCustomStyle) {
    lines.push(`Adopt this conversational goal, style, or role: ${chatSettings.chatCustomStyle}`);
  }
  return lines.join('\n');
}

// Groups passages under their source's title so the model sees source boundaries explicitly,
// rather than a flat numbered list it could mistake for one passage per source.
function buildGroupedPassagesBlock(
  results: SourceSample[],
  sourceById: Map<string, { title: string }>,
): string {
  const sourceOrder: string[] = [];
  const bySource = new Map<string, SourceSample[]>();
  for (const r of results) {
    if (!bySource.has(r.sourceId)) {
      bySource.set(r.sourceId, []);
      sourceOrder.push(r.sourceId);
    }
    bySource.get(r.sourceId)!.push(r);
  }
  const labelByChunkId = new Map(results.map((r, i) => [r.chunkId, i + 1]));

  return sourceOrder
    .map((sourceId, i) => {
      const title = sourceById.get(sourceId)?.title ?? 'Untitled source';
      const passageLines = bySource
        .get(sourceId)!
        .map((r) => `  [${labelByChunkId.get(r.chunkId)}] ${r.content}`)
        .join('\n\n');
      return `Source ${i + 1}/${sourceOrder.length}: "${title}"\n${passageLines}`;
    })
    .join('\n\n');
}

async function finalizeAsRefused(
  supabase: SupabaseClient,
  {
    messageId,
    attemptId,
    followUpQuestions = [],
    reasoning = '',
  }: {
    messageId: string;
    attemptId: string;
    followUpQuestions?: string[];
    reasoning?: string;
  },
): Promise<AskQuestionResult> {
  const { error } = await supabase
    .from('messages')
    .update({
      content: REFUSAL_TEXT,
      status: 'refused',
      reasoning,
      follow_up_questions: followUpQuestions,
    })
    .eq('id', messageId)
    .eq('attempt_id', attemptId);
  if (error) throw error;
  return {
    messageId,
    status: 'refused',
    answer: REFUSAL_TEXT,
    reasoning,
    citations: [],
    followUpQuestions,
  };
}

interface CitationRow {
  label: number;
  source_id: string;
  chunk_id: string | null;
  source_title: string;
  chunk_index: number;
  page_number: number | null;
  section: string | null;
  start_seconds: number | null;
  source_url: string | null;
  content_snapshot: string;
}

async function finalizeAsComplete(
  supabase: SupabaseClient,
  {
    messageId,
    attemptId,
    rawAnswer,
    reasoning,
    followUpQuestions = [],
    selectedSourceIds,
    citationRows,
  }: {
    messageId: string;
    attemptId: string;
    rawAnswer: string;
    reasoning: string;
    followUpQuestions?: string[];
    selectedSourceIds: string[];
    citationRows: CitationRow[];
  },
): Promise<AskQuestionResult> {
  const { error: messageError } = await supabase
    .from('messages')
    .update({
      content: rawAnswer,
      status: 'complete',
      reasoning,
      selected_source_ids: selectedSourceIds,
      follow_up_questions: followUpQuestions,
    })
    .eq('id', messageId)
    .eq('attempt_id', attemptId);
  if (messageError) throw messageError;

  const { error: citationsError } = await supabase
    .from('message_citations')
    .insert(citationRows.map((row) => ({ ...row, message_id: messageId })));
  if (citationsError) throw citationsError;

  return {
    messageId,
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
  };
}

async function* runGeneration(
  supabase: SupabaseClient,
  {
    notebookId,
    question,
    sourceIds,
    messageId,
    attemptId,
  }: {
    notebookId: string;
    question: string;
    sourceIds: string[] | undefined;
    messageId: string;
    attemptId: string;
  },
): AsyncGenerator<AskQuestionEvent> {
  let reasoning = '';
  let generated = '';
  try {
    const history = await fetchRecentMessages(supabase, notebookId);
    const overviewIntent = isNotebookOverviewQuestion(question);

    let results: SourceSample[];
    if (overviewIntent) {
      results = await sampleAcrossSources(supabase, {
        notebookId,
        sourceIds,
        chunksPerSource: OVERVIEW_CHUNKS_PER_SOURCE,
      });
    } else {
      const retrievalQuestion = await rewriteFollowUpQuery(history, question);
      const queryEmbedding = await embed(retrievalQuestion);
      results = await search(supabase, {
        notebookId,
        sourceIds,
        queryEmbedding,
        matchCount: 8,
      });
    }
    if (results.length === 0) {
      yield { type: 'done', result: await finalizeAsRefused(supabase, { messageId, attemptId }) };
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

    const sourceContext: SourceContext | undefined = overviewIntent
      ? {
          sourceCount: selectedSourceIds.length,
          sourceTitles: selectedSourceIds.map(
            (id) => (sourceById.get(id)?.title as string) ?? 'Untitled source',
          ),
        }
      : undefined;
    const system = buildSystemPrompt(results.length, chatSettings, sourceContext);
    const passagesBlock = overviewIntent
      ? buildGroupedPassagesBlock(results, sourceById)
      : results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');
    const historyBlock =
      history.length > 0
        ? `Conversation so far:\n${history
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n')}\n\n`
        : '';

    for await (const chunk of generateStreaming({
      system,
      prompt: `${historyBlock}Passages:\n${passagesBlock}\n\nQuestion: ${question}`,
      model: REASONING_GENERATION_MODEL,
      ...(overviewIntent ? { maxOutputTokens: OVERVIEW_MAX_OUTPUT_TOKENS } : {}),
    })) {
      if (chunk.type === 'reasoning') {
        reasoning += chunk.text;
        yield { type: 'reasoning_delta', text: chunk.text };
      } else {
        generated += chunk.text;
        yield { type: 'answer_delta', text: chunk.text };
      }
    }

    const rawAnswer = generated.trim();

    const validLabels = new Map<number, (typeof results)[number]>();
    for (const match of rawAnswer.matchAll(/\[(\d+)\]/g)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= results.length) validLabels.set(n, results[n - 1]);
    }
    const isRefusal = rawAnswer === REFUSAL_TEXT || validLabels.size === 0;

    if (isRefusal) {
      yield {
        type: 'done',
        result: await finalizeAsRefused(supabase, { messageId, attemptId, reasoning }),
      };
      return;
    }

    const citationRows: CitationRow[] = [...validLabels.entries()].map(([label, r]) => {
      const passage = passages.find((p) => p.label === label)!;
      return {
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

    // Finalize and surface the answer as soon as it's validated, rather than making the
    // client wait on a follow-up-question suggestion call that has nothing to do with the
    // answer's correctness; follow-ups are generated afterward and delivered as a trailing
    // event once ready.
    yield {
      type: 'done',
      result: await finalizeAsComplete(supabase, {
        messageId,
        attemptId,
        rawAnswer,
        reasoning,
        selectedSourceIds,
        citationRows,
      }),
    };

    try {
      const followUpQuestions = await generateFollowUps({
        question,
        answer: rawAnswer,
        passages: passagesBlock,
      });
      if (followUpQuestions.length > 0) {
        const { error } = await supabase
          .from('messages')
          .update({ follow_up_questions: followUpQuestions })
          .eq('id', messageId)
          .eq('attempt_id', attemptId);
        if (error) throw error;
      }
      yield { type: 'follow_up_questions', messageId, questions: followUpQuestions };
    } catch (err) {
      console.error('follow-up question generation failed', { messageId, attemptId, err });
      yield { type: 'follow_up_questions', messageId, questions: [] };
    }
  } catch (err) {
    await supabase
      .from('messages')
      .update({ status: 'failed', content: generated, reasoning })
      .eq('id', messageId)
      .eq('attempt_id', attemptId);
    console.error('generation attempt failed', { messageId, attemptId, err });
    // A GenerationIncompleteError means the model run was cut off (most often: reasoning
    // consumed the whole output-token budget before any answer text was produced) rather than
    // a hard provider/DB failure — surface a specific, retryable message instead of a generic
    // one. The message is already persisted as 'failed' above, so the retry affordance works
    // the same way for both cases; this only changes what the user is told went wrong.
    yield {
      type: 'error',
      message:
        err instanceof GenerationIncompleteError
          ? 'The answer was cut off before it finished. You can retry to try again.'
          : 'Failed to generate an answer',
    };
  }
}

export async function* streamAnswer(
  supabase: SupabaseClient,
  { notebookId, question, sourceIds }: AskQuestionParams,
): AsyncGenerator<AskQuestionEvent> {
  const attemptId = await claimGenerationLease(supabase, notebookId);
  try {
    const { error: userMessageError } = await supabase
      .from('messages')
      .insert({ notebook_id: notebookId, role: 'user', content: question, status: 'complete' });
    if (userMessageError) throw userMessageError;

    const { data: pending, error: pendingError } = await supabase
      .from('messages')
      .insert({
        notebook_id: notebookId,
        role: 'assistant',
        content: '',
        status: 'pending',
        attempt_id: attemptId,
        selected_source_ids: sourceIds ?? [],
      })
      .select('id')
      .single();
    if (pendingError) throw pendingError;

    yield* runGeneration(supabase, {
      notebookId,
      question,
      sourceIds,
      messageId: pending.id,
      attemptId,
    });
  } finally {
    await releaseGenerationLease(supabase, notebookId, attemptId);
  }
}

export async function* retryAnswer(
  supabase: SupabaseClient,
  { notebookId, messageId }: { notebookId: string; messageId: string },
): AsyncGenerator<AskQuestionEvent> {
  const { data: message, error: messageError } = await supabase
    .from('messages')
    .select('id, status, selected_source_ids, created_at')
    .eq('id', messageId)
    .eq('notebook_id', notebookId)
    .eq('role', 'assistant')
    .single();
  if (messageError) throw messageError;
  if (message.status !== 'failed') {
    throw new Error('Only a failed message can be retried');
  }

  const { data: questionMessage, error: questionError } = await supabase
    .from('messages')
    .select('content')
    .eq('notebook_id', notebookId)
    .eq('role', 'user')
    .lt('created_at', message.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (questionError) throw questionError;

  const attemptId = await claimGenerationLease(supabase, notebookId);
  try {
    const sourceIds: string[] | undefined =
      message.selected_source_ids && message.selected_source_ids.length > 0
        ? message.selected_source_ids
        : undefined;

    const { error: resetError } = await supabase
      .from('messages')
      .update({
        status: 'pending',
        content: '',
        reasoning: '',
        attempt_id: attemptId,
        follow_up_questions: null,
      })
      .eq('id', messageId);
    if (resetError) throw resetError;

    yield* runGeneration(supabase, {
      notebookId,
      question: questionMessage.content,
      sourceIds,
      messageId,
      attemptId,
    });
  } finally {
    await releaseGenerationLease(supabase, notebookId, attemptId);
  }
}

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CAPABLE_GENERATION_MODEL, generate } from '@/lib/providers/openai';
import { generateFollowUps } from './followUps';

const MAX_SAMPLE_CHUNKS = 12;
const MAX_SAMPLE_CHARS = 6000;

export function pickEvenlySpacedIndices(count: number, take: number): number[] {
  if (count <= take) return Array.from({ length: count }, (_, i) => i);
  const step = count / take;
  const indices = new Set<number>();
  for (let i = 0; i < take; i++) indices.add(Math.floor(i * step));
  return [...indices].sort((a, b) => a - b);
}

export async function maybeGenerateSourceIntro(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<void> {
  const { data: source } = await supabase
    .from('sources')
    .select('id, notebook_id, status, intro_generated_at')
    .eq('id', sourceId)
    .single();
  if (!source || source.status !== 'ready' || source.intro_generated_at) return;

  const { count } = await supabase
    .from('source_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId);
  if (!count) return;

  const indices = pickEvenlySpacedIndices(count, MAX_SAMPLE_CHUNKS);
  const { data: chunks } = await supabase
    .from('source_chunks')
    .select('content, chunk_index')
    .eq('source_id', sourceId)
    .in('chunk_index', indices)
    .order('chunk_index');
  if (!chunks || chunks.length === 0) return;

  const sample = chunks
    .map((c) => c.content)
    .join('\n\n')
    .slice(0, MAX_SAMPLE_CHARS);
  if (!sample.trim()) return;

  let summary: string;
  try {
    summary = (
      await generate({
        system:
          'You write a short 3-5 sentence introduction that clearly explains what this document is about, based only on the passages given, which are sampled across the whole document. Do not add information beyond what the passages show. Respond with only the summary.',
        prompt: sample,
        model: CAPABLE_GENERATION_MODEL,
      })
    ).trim();
  } catch {
    return;
  }
  if (!summary) return;

  const followUpQuestions = await generateFollowUps({ answer: summary, passages: sample });

  const { data: claimed } = await supabase
    .from('sources')
    .update({ intro_summary: summary, intro_generated_at: new Date().toISOString() })
    .eq('id', sourceId)
    .is('intro_generated_at', null)
    .select('id');
  if (!claimed || claimed.length === 0) return;

  await supabase.from('messages').insert({
    notebook_id: source.notebook_id,
    source_id: sourceId,
    role: 'assistant',
    content: summary,
    status: 'complete',
    follow_up_questions: followUpQuestions,
  });
}

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CAPABLE_GENERATION_MODEL, generate } from '@/lib/providers/openai';

const MAX_CHUNKS_PER_SOURCE = 3;
const MAX_SAMPLE_CHARS = 6000;

export async function maybeGenerateNotebookIntro(
  supabase: SupabaseClient,
  notebookId: string,
): Promise<void> {
  const { data: notebook } = await supabase
    .from('notebooks')
    .select('intro_generated_at')
    .eq('id', notebookId)
    .single();
  if (!notebook || notebook.intro_generated_at) return;

  const { data: sources } = await supabase
    .from('sources')
    .select('id, status')
    .eq('notebook_id', notebookId)
    .is('deleted_at', null);
  if (!sources || sources.length === 0) return;

  const allTerminal = sources.every((s) => s.status === 'ready' || s.status === 'failed');
  const readySourceIds = sources.filter((s) => s.status === 'ready').map((s) => s.id);
  if (!allTerminal || readySourceIds.length === 0) return;

  const samples: string[] = [];
  for (const sourceId of readySourceIds) {
    const { data: chunks } = await supabase
      .from('source_chunks')
      .select('content')
      .eq('source_id', sourceId)
      .order('chunk_index')
      .limit(MAX_CHUNKS_PER_SOURCE);
    if (chunks && chunks.length > 0) samples.push(chunks.map((c) => c.content).join('\n'));
  }
  const sample = samples.join('\n\n').slice(0, MAX_SAMPLE_CHARS);
  if (!sample.trim()) return;

  let title: string;
  let summary: string;
  try {
    title = (
      await generate({
        system:
          'You write short, descriptive titles (5-10 words, no quotes, no trailing period) for a research notebook, based on samples from its sources. Respond with only the title.',
        prompt: sample,
      })
    ).trim();
    summary = (
      await generate({
        system:
          'You write a short 2-4 sentence introduction summarizing what a set of notebook sources cover, based only on the passages given. Do not add information beyond what the passages show. Respond with only the summary.',
        prompt: sample,
        model: CAPABLE_GENERATION_MODEL,
      })
    ).trim();
  } catch {
    return;
  }
  if (!title || !summary) return;

  const { data: claimed } = await supabase
    .from('notebooks')
    .update({ title, intro_generated_at: new Date().toISOString() })
    .eq('id', notebookId)
    .is('intro_generated_at', null)
    .select('id');
  if (!claimed || claimed.length === 0) return;

  await supabase.from('messages').insert({
    notebook_id: notebookId,
    role: 'assistant',
    content: summary,
    status: 'complete',
  });
}

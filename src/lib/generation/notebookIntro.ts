import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generate } from '@/lib/providers/openai';

const MAX_CHUNKS_PER_SOURCE = 3;
const MAX_SAMPLE_CHARS = 6000;

export async function maybeGenerateNotebookTitle(
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
  try {
    title = (
      await generate({
        system:
          'You write short, descriptive titles (5-10 words, no quotes, no trailing period) for a research notebook, based on samples from its sources. Respond with only the title.',
        prompt: sample,
      })
    ).trim();
  } catch {
    return;
  }
  if (!title) return;

  await supabase
    .from('notebooks')
    .update({ title, intro_generated_at: new Date().toISOString() })
    .eq('id', notebookId)
    .is('intro_generated_at', null);
}

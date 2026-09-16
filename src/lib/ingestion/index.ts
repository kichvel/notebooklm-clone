import 'server-only';
import { NonRetriableError } from 'inngest';
import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/server';
import { embed, generate } from '@/lib/providers/openai';
import { maybeGenerateNotebookTitle } from '@/lib/generation/notebookIntro';
import { maybeGenerateSourceIntro } from '@/lib/generation/sourceIntro';
import { getAdapter } from './adapters';
import type { SourceBlock } from './adapters/types';

type ProcessingStep = 'parse' | 'normalize' | 'chunk' | 'embed' | 'finalize';
type ProcessingStatus = 'in_progress' | 'succeeded' | 'failed';

interface Chunk {
  text: string;
  page?: number;
  section?: string;
  startSeconds?: number;
}

async function upsertProcessingStep(
  supabase: ReturnType<typeof createServiceClient>,
  sourceId: string,
  step: ProcessingStep,
  status: ProcessingStatus,
) {
  const { data: existing } = await supabase
    .from('processing_steps')
    .select('attempts')
    .eq('source_id', sourceId)
    .eq('step', step)
    .maybeSingle();

  const attempts =
    status === 'in_progress' ? (existing?.attempts ?? 0) + 1 : (existing?.attempts ?? 1);

  await supabase
    .from('processing_steps')
    .upsert({ source_id: sourceId, step, status, attempts }, { onConflict: 'source_id,step' });
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const TARGET_CHUNK_CHARS = 800;
const MIN_CHUNK_CHARS = 200;

function packUnits(units: string[], joiner: string, maxChars: number): string[] {
  const packed: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current.length === 0) {
      current = unit;
    } else if (current.length + joiner.length + unit.length <= maxChars) {
      current += joiner + unit;
    } else {
      packed.push(current);
      current = unit;
    }
  }
  if (current.length > 0) packed.push(current);
  return packed;
}

const BULLET_LINE = /^[•▪◦‣∙*-]\s|^\d+[.)]\s/;
const HARD_LINE_BREAK = /[.:;!?]$/;

// Matches a resume/CV entry heading that opens with a date range, e.g.
// "12.2023 – Present Management Analyst ..." or "2019 - 2021 Engineer ...".
const DATE_RANGE_HEADING = new RegExp(
  `^(?:\\d{1,2}[./]\\d{4}|\\d{4})\\s*[–—-]\\s*(?:present|\\d{1,2}[./]\\d{4}|\\d{4})\\b`,
  'i',
);

// PDF text extraction gives one line per visually wrapped line on the page, not one
// per sentence or bullet, so a single bullet point often spans several extracted
// lines. Rejoin a line into the previous one when the previous line doesn't already
// end a sentence/clause and the current line isn't starting a new bullet — so the
// size-based packer below only ever sees whole sentences/bullets as its units and
// can't cut one in half.
export function joinWrappedLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const prev = out[out.length - 1];
    const prevJoinable =
      prev !== undefined && prev.trim().length > 0 && !HARD_LINE_BREAK.test(prev.trim());
    if (prevJoinable && line.trim().length > 0 && !BULLET_LINE.test(line.trim())) {
      out[out.length - 1] = `${prev} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

// PDF extraction of dense, multi-entry documents (resumes/CVs) often drops the blank
// line between the last bullet of one entry and the dated heading of the next, so both
// land in the same blank-line-delimited paragraph below. Without a forced break here,
// the size-based packer in splitOversizedParagraph is free to glue the new entry's
// heading onto the tail of the previous entry's chunk. Insert a paragraph break before
// any such heading line so it always starts fresh.
function insertSectionBreaks(text: string): string {
  return text
    .split('\n')
    .map((line, i) => (i > 0 && DATE_RANGE_HEADING.test(line.trim()) ? `\n${line}` : line))
    .join('\n');
}

// A size-based split can still leave a small leftover piece (e.g. one short trailing
// sentence). Fold anything under the minimum into a neighbor rather than publishing a
// decontextualized fragment as its own chunk.
function mergeTinyPieces(pieces: string[], minChars: number): string[] {
  const merged: string[] = [];
  for (const piece of pieces) {
    if (merged.length > 0 && piece.length < minChars) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${piece}`;
    } else {
      merged.push(piece);
    }
  }
  if (merged.length > 1 && merged[0].length < minChars) {
    const first = merged.shift()!;
    merged[0] = `${first} ${merged[0]}`;
  }
  return merged;
}

// Paragraphs (blank-line-separated) rarely exceed the target on their own, but PDF
// text extraction often yields a whole page as one blank-line-free paragraph. Fall
// back through progressively finer boundaries — lines, then sentences, then a hard
// character cut — only for the paragraphs that actually need it.
function splitOversizedParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const lines = text.split('\n').filter((line) => line.length > 0);
  const lineChunks = lines.length > 1 ? packUnits(lines, '\n', maxChars) : [text];

  const pieces = lineChunks.flatMap((chunk) => {
    if (chunk.length <= maxChars) return [chunk];

    const sentences = chunk.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter((s) => s.length > 0);
    const sentenceChunks = sentences.length > 1 ? packUnits(sentences, ' ', maxChars) : [chunk];

    return sentenceChunks.flatMap((sentence) => {
      if (sentence.length <= maxChars) return [sentence];
      const hardPieces: string[] = [];
      for (let i = 0; i < sentence.length; i += maxChars) {
        hardPieces.push(sentence.slice(i, i + maxChars));
      }
      return hardPieces;
    });
  });

  return mergeTinyPieces(pieces, MIN_CHUNK_CHARS);
}

export function chunkBlock(block: SourceBlock): Chunk[] {
  return insertSectionBreaks(joinWrappedLines(block.text))
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .flatMap((part) => splitOversizedParagraph(part, TARGET_CHUNK_CHARS))
    .map((text) => ({
      text,
      page: block.page,
      section: block.section,
      startSeconds: block.startSeconds,
    }));
}

export async function markSourceIngestionFailed(
  supabase: ReturnType<typeof createServiceClient>,
  sourceId: string,
  reason: string,
) {
  await supabase
    .from('sources')
    .update({ status: 'failed', failure_reason: reason })
    .eq('id', sourceId);
}

export const ingestSource = inngest.createFunction(
  {
    id: 'ingest-source',
    triggers: { event: 'sourcebook/source.ingest.requested' },
    onFailure: async ({ event, error, step }) => {
      const supabase = createServiceClient();
      const sourceId = event.data.event.data.sourceId as string;
      await step.run('mark-failed', () =>
        markSourceIngestionFailed(supabase, sourceId, error.message || 'Ingestion failed'),
      );
      await step.run('notebook-title', async () => {
        const { data: source } = await supabase
          .from('sources')
          .select('notebook_id')
          .eq('id', sourceId)
          .single();
        if (source) await maybeGenerateNotebookTitle(supabase, source.notebook_id);
      });
    },
  },
  async ({ event, step }) => {
    const supabase = createServiceClient();
    const sourceId = event.data.sourceId as string;

    const blocks = await step.run('parse', async () => {
      await upsertProcessingStep(supabase, sourceId, 'parse', 'in_progress');

      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .select('type, storage_path, origin_url')
        .eq('id', sourceId)
        .single();
      if (sourceError || !source) {
        await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
        throw new NonRetriableError(`Source ${sourceId} not found`);
      }

      await supabase.from('sources').update({ status: 'processing' }).eq('id', sourceId);

      try {
        const { blocks } = await getAdapter(source.type).parse(supabase, {
          sourceId,
          storagePath: source.storage_path,
          originUrl: source.origin_url,
        });
        await upsertProcessingStep(supabase, sourceId, 'parse', 'succeeded');
        return blocks;
      } catch (err) {
        await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
        throw err;
      }
    });

    const normalizedBlocks = await step.run('normalize', async () => {
      await upsertProcessingStep(supabase, sourceId, 'normalize', 'in_progress');
      const normalized = blocks.map((block: SourceBlock) => ({
        ...block,
        text: normalizeText(block.text),
      }));
      await upsertProcessingStep(supabase, sourceId, 'normalize', 'succeeded');
      return normalized;
    });

    const chunks = await step.run('chunk', async () => {
      await upsertProcessingStep(supabase, sourceId, 'chunk', 'in_progress');
      const parts = normalizedBlocks.flatMap((block: SourceBlock) => chunkBlock(block));
      await upsertProcessingStep(supabase, sourceId, 'chunk', 'succeeded');
      return parts;
    });

    await step.run('embed', async () => {
      await upsertProcessingStep(supabase, sourceId, 'embed', 'in_progress');
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i] as Chunk;
        const embedding = await embed(chunk.text);
        const { error } = await supabase.from('source_chunks').upsert(
          {
            source_id: sourceId,
            chunk_index: i,
            content: chunk.text,
            page_number: chunk.page ?? null,
            section: chunk.section ?? null,
            start_seconds: chunk.startSeconds ?? null,
            embedding,
          },
          { onConflict: 'source_id,chunk_index' },
        );
        if (error) {
          await upsertProcessingStep(supabase, sourceId, 'embed', 'failed');
          throw error;
        }
      }
      await upsertProcessingStep(supabase, sourceId, 'embed', 'succeeded');
    });

    await step.run('generate-title', async () => {
      const sample = chunks
        .slice(0, 5)
        .map((c: Chunk) => c.text)
        .join('\n\n')
        .slice(0, 4000);
      if (!sample.trim()) return;
      try {
        const title = await generate({
          system:
            'You write short, descriptive titles (5-10 words, no quotes, no trailing period) for documents added to a research notebook. Respond with only the title.',
          prompt: sample,
        });
        if (title.trim()) {
          await supabase.from('sources').update({ title: title.trim() }).eq('id', sourceId);
        }
      } catch {
        // Title quality is not a correctness gate ingestion should fail on; keep the
        // placeholder title set at source creation if generation is unavailable.
      }
    });

    await step.run('finalize', async () => {
      await upsertProcessingStep(supabase, sourceId, 'finalize', 'in_progress');
      const { count } = await supabase
        .from('source_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('source_id', sourceId);
      if (!count || count !== chunks.length) {
        await upsertProcessingStep(supabase, sourceId, 'finalize', 'failed');
        throw new Error('Chunk count mismatch during finalize');
      }
      await supabase.from('sources').update({ status: 'ready' }).eq('id', sourceId);
      await upsertProcessingStep(supabase, sourceId, 'finalize', 'succeeded');
    });

    await step.run('notebook-title', async () => {
      const { data: source } = await supabase
        .from('sources')
        .select('notebook_id')
        .eq('id', sourceId)
        .single();
      if (source) await maybeGenerateNotebookTitle(supabase, source.notebook_id);
    });

    await step.run('source-intro', async () => {
      await maybeGenerateSourceIntro(supabase, sourceId);
    });

    return { sourceId, chunkCount: chunks.length };
  },
);

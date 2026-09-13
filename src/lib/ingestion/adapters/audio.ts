import 'server-only';
import { NonRetriableError } from 'inngest';
import { transcribeAudio } from '@/lib/providers/openai';
import { groupTimedItemsIntoBlocks } from '../blockGrouping';
import type { SourceAdapter } from './types';

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export const audioAdapter: SourceAdapter = {
  async parse(supabase, { storagePath }) {
    if (!storagePath) throw new Error('Missing storage_path');
    const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
    if (error || !blob) throw error ?? new Error('Missing storage object');
    if (blob.size > MAX_AUDIO_BYTES) {
      throw new NonRetriableError('Audio file exceeds the 25MB transcription limit');
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const filename = storagePath.split('/').pop() ?? 'audio';
    const segments = await transcribeAudio(buffer, filename);
    const blocks = groupTimedItemsIntoBlocks(segments);

    if (blocks.length === 0) {
      throw new NonRetriableError('Could not transcribe any speech from this audio');
    }
    return { blocks };
  },
};

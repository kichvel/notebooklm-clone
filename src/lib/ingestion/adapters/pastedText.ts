import 'server-only';
import type { SourceAdapter } from './types';

export const pastedTextAdapter: SourceAdapter = {
  async parse(supabase, { storagePath }) {
    if (!storagePath) throw new Error('Missing storage_path');
    const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
    if (error || !blob) throw error ?? new Error('Missing storage object');
    const text = await blob.text();
    return { blocks: [{ text }] };
  },
};

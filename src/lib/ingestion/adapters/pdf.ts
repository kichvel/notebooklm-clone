import 'server-only';
import { NonRetriableError } from 'inngest';
import { extractText, getDocumentProxy } from 'unpdf';
import type { SourceAdapter } from './types';

export const pdfAdapter: SourceAdapter = {
  async parse(supabase, { storagePath }) {
    if (!storagePath) throw new Error('Missing storage_path');
    const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
    if (error || !blob) throw error ?? new Error('Missing storage object');

    const buffer = new Uint8Array(await blob.arrayBuffer());
    const doc = await getDocumentProxy(buffer);
    const { text } = await extractText(doc, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];

    const blocks = pages
      .map((pageText, i) => ({ text: pageText.trim(), page: i + 1 }))
      .filter((b) => b.text.length > 0);

    if (blocks.length === 0) {
      throw new NonRetriableError('PDF has no extractable text (encrypted or image-only)');
    }

    return { blocks };
  },
};

import 'server-only';
import { NonRetriableError } from 'inngest';
import mammoth from 'mammoth';
import { parseHTML } from 'linkedom';
import type { SourceAdapter, SourceBlock } from './types';

const HEADING_TAG = /^h[1-6]$/;

export function splitHtmlIntoSectionBlocks(html: string): SourceBlock[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const blocks: SourceBlock[] = [];
  let currentSection: string | undefined;
  let currentParagraphs: string[] = [];

  function flush() {
    const text = currentParagraphs.join('\n\n').trim();
    if (text) blocks.push({ text, section: currentSection });
    currentParagraphs = [];
  }

  for (const el of Array.from(document.body.children)) {
    const tag = el.tagName.toLowerCase();
    if (HEADING_TAG.test(tag)) {
      flush();
      currentSection = el.textContent?.trim() || undefined;
    } else {
      const text = el.textContent?.trim();
      if (text) currentParagraphs.push(text);
    }
  }
  flush();

  return blocks;
}

export const docxAdapter: SourceAdapter = {
  async parse(supabase, { storagePath }) {
    if (!storagePath) throw new Error('Missing storage_path');
    const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
    if (error || !blob) throw error ?? new Error('Missing storage object');

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { value: html } = await mammoth.convertToHtml({ buffer });
    const blocks = splitHtmlIntoSectionBlocks(html);

    if (blocks.length === 0) {
      throw new NonRetriableError('DOCX has no extractable text');
    }

    return { blocks };
  },
};

import 'server-only';
import { NonRetriableError } from 'inngest';
import { extractTextItems, getDocumentProxy } from 'unpdf';
import type { StructuredTextItem } from 'unpdf';
import type { SourceAdapter } from './types';

interface Line {
  text: string;
  y: number;
}

function groupItemsIntoLines(items: StructuredTextItem[]): Line[] {
  const lines: Line[] = [];
  let text = '';
  let y = 0;
  let hasContent = false;

  for (const item of items) {
    if (!hasContent) y = item.y;
    text += item.str;
    hasContent = true;
    if (item.hasEOL) {
      lines.push({ text, y });
      text = '';
      hasContent = false;
    }
  }
  if (hasContent) lines.push({ text, y });
  return lines;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// PDF.js's per-line `hasEOL` flag only says a new line started, not how much vertical
// space separates it from the previous one — so a blank line the document's author
// used to visually separate two sections (e.g. two resume entries) is indistinguishable
// from an ordinary line wrap once flattened to plain text, and downstream chunking
// (which splits on blank lines) can no longer see that boundary. Reconstruct the
// missing signal from each line's y-position: a gap noticeably larger than the page's
// typical line spacing is rendered back as a blank line.
export function reconstructPageText(lines: Line[]): string {
  if (lines.length === 0) return '';

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y; // PDF y decreases going down the page.
    if (gap > 0) gaps.push(gap);
  }
  const typicalGap = median(gaps);

  const out: string[] = [lines[0].text];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    const isSectionBreak = typicalGap > 0 && gap > typicalGap * 1.5;
    out.push(isSectionBreak ? `\n${lines[i].text}` : lines[i].text);
  }
  return out.join('\n');
}

export const pdfAdapter: SourceAdapter = {
  async parse(supabase, { storagePath }) {
    if (!storagePath) throw new Error('Missing storage_path');
    const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
    if (error || !blob) throw error ?? new Error('Missing storage object');

    const buffer = new Uint8Array(await blob.arrayBuffer());
    const doc = await getDocumentProxy(buffer);
    const { items } = await extractTextItems(doc);

    const blocks = items
      .map((pageItems, i) => ({
        text: reconstructPageText(groupItemsIntoLines(pageItems)).trim(),
        page: i + 1,
      }))
      .filter((b) => b.text.length > 0);

    if (blocks.length === 0) {
      throw new NonRetriableError('PDF has no extractable text (encrypted or image-only)');
    }

    return { blocks };
  },
};

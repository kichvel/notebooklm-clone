import 'server-only';
import type { SourceBlock } from './adapters/types';

const BLOCK_DURATION_SECONDS = 30;

export interface TimedItem {
  start: number;
  text: string;
}

export function groupTimedItemsIntoBlocks(items: TimedItem[]): SourceBlock[] {
  if (items.length === 0) return [];

  const blocks: SourceBlock[] = [];
  let blockStart = items[0].start;
  let blockTexts: string[] = [];

  for (const item of items) {
    if (item.start - blockStart >= BLOCK_DURATION_SECONDS && blockTexts.length > 0) {
      blocks.push({ text: blockTexts.join(' ').trim(), startSeconds: blockStart });
      blockStart = item.start;
      blockTexts = [];
    }
    blockTexts.push(item.text);
  }
  if (blockTexts.length > 0) {
    blocks.push({ text: blockTexts.join(' ').trim(), startSeconds: blockStart });
  }

  return blocks.filter((b) => b.text.length > 0);
}

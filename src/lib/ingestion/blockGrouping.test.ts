import { describe, expect, it } from 'vitest';
import { groupTimedItemsIntoBlocks } from './blockGrouping';

describe('groupTimedItemsIntoBlocks', () => {
  it('groups items into ~30 second blocks carrying startSeconds', () => {
    const items = [
      { start: 0, text: 'Hello' },
      { start: 5, text: 'world' },
      { start: 31, text: 'this is minute one' },
      { start: 40, text: 'continuing' },
    ];
    const blocks = groupTimedItemsIntoBlocks(items);
    expect(blocks).toEqual([
      { text: 'Hello world', startSeconds: 0 },
      { text: 'this is minute one continuing', startSeconds: 31 },
    ]);
  });

  it('returns an empty array for no items', () => {
    expect(groupTimedItemsIntoBlocks([])).toEqual([]);
  });
});

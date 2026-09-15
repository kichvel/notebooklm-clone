// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chunkBlock } from './index';

const MAX_CHARS = 800;

describe('chunkBlock', () => {
  it('keeps blank-line-separated paragraphs as-is when each is under the size target', () => {
    const text = [
      'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
      'The Boeing 747 is a wide-body commercial jet airliner.',
    ].join('\n\n');

    const chunks = chunkBlock({ text, page: 1, section: 'Intro' });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({
      text: 'Domestic cats are small, typically furry, carnivorous mammals kept as pets.',
      page: 1,
      section: 'Intro',
      startSeconds: undefined,
    });
    expect(chunks[1].text).toBe('The Boeing 747 is a wide-body commercial jet airliner.');
  });

  it('splits a single blank-line-free block at line boundaries once it exceeds the target size', () => {
    // Mirrors a PDF page: many single-newline-separated lines, no blank lines at all.
    const lines = Array.from(
      { length: 30 },
      (_, i) => `Line ${i}: some resume bullet content here.`,
    );
    const text = lines.join('\n');
    expect(text).not.toMatch(/\n\s*\n/);
    expect(text.length).toBeGreaterThan(MAX_CHARS);

    const chunks = chunkBlock({ text, page: 1 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHARS);
      expect(chunk.page).toBe(1);
    }
    // No line was dropped or reordered across the split.
    expect(chunks.map((c) => c.text).join('\n')).toBe(text);
  });

  it('falls back to sentence boundaries for a long paragraph with no newlines', () => {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} makes a small claim.`,
    );
    const text = sentences.join(' ');
    expect(text).not.toContain('\n');
    expect(text.length).toBeGreaterThan(MAX_CHARS);

    const chunks = chunkBlock({ text, page: 2 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHARS);
      // Every chunk should end on a sentence boundary, not mid-sentence.
      expect(chunk.text.trim()).toMatch(/\.$/);
    }
  });

  it('hard-splits a single run with no line, sentence, or space boundaries', () => {
    const text = 'x'.repeat(2000);

    const chunks = chunkBlock({ text, page: 3 });

    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHARS);
    }
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  it('ignores empty blank-line-separated segments', () => {
    const chunks = chunkBlock({ text: 'One paragraph.\n\n\n\n', page: 1 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('One paragraph.');
  });
});

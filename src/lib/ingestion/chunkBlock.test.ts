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

  it('keeps a bullet that wraps across two PDF-extracted lines together instead of cutting it mid-sentence', () => {
    // Mirrors real PDF extraction: a bullet's continuation line has no leading marker
    // and the line before it has no sentence-ending punctuation, so it should be
    // rejoined before the size-based packer ever runs.
    const padding = Array.from(
      { length: 20 },
      (_, i) => `Filler sentence number ${i} adds bulk to this paragraph.`,
    ).join('\n');
    const bulletStart =
      '▪ Trained and certified autonomous vehicle safety drivers for the MOIA autonomous mobility';
    const bulletContinuation =
      'program, conducting theoretical and practical training sessions and operational assessments.';
    const text = [padding, bulletStart, bulletContinuation].join('\n');
    expect(text.length).toBeGreaterThan(MAX_CHARS);

    const chunks = chunkBlock({ text, page: 1 });

    expect(
      chunks.some(
        (c) =>
          c.text.includes('MOIA autonomous mobility') &&
          c.text.includes('conducting theoretical and practical'),
      ),
    ).toBe(true);
  });

  it('does not rejoin a line that starts a new bullet, even without preceding punctuation', () => {
    const text = [
      '▪ First bullet has no trailing period',
      '▪ Second bullet starts fresh regardless',
    ].join('\n');

    const chunks = chunkBlock({ text, page: 1 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it('does not rejoin a line that follows sentence-ending punctuation', () => {
    const text = ['First sentence ends cleanly.', 'Second sentence starts fresh.'].join('\n');

    const chunks = chunkBlock({ text, page: 1 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it("does not merge the next resume entry's dated heading into the previous entry's chunk", () => {
    // Mirrors real PDF extraction of a resume: no blank line separates the last bullet
    // of one job from the dated heading of the next, so both would otherwise land in
    // the same blank-line-delimited paragraph and get packed together.
    const previousEntryBullets = [
      "▪ Built and operated the product's subscription and growth stack, integrating analytics, attribution, lifecycle marketing, and monetization systems to support experimentation across pricing, onboarding, acquisition, and retention.",
      '▪ Designed event-driven backend infrastructure for asynchronous workflows, lifecycle messaging, localization, and multi-stage automation pipelines.',
      '▪ Drove data-informed product development through funnel and cohort analysis, A/B experimentation, user research, and acquisition attribution, continuously optimizing activation, retention, monetization, and store conversion while maintaining a <0.1% production crash rate.',
    ].join('\n');
    const nextEntryHeading =
      '12.2023 – Present Management Analyst & Technical Consultant Accenture - Industry X, Munich';
    const text = [previousEntryBullets, nextEntryHeading].join('\n');

    const chunks = chunkBlock({ text, page: 1 });

    const chunkWithBullets = chunks.find((c) => c.text.includes('production crash rate'));
    expect(chunkWithBullets?.text).not.toContain('Management Analyst');
    expect(chunks.some((c) => c.text.startsWith(nextEntryHeading))).toBe(true);
  });

  it('merges a tiny leftover piece into its neighbor instead of publishing an orphaned fragment', () => {
    const bigLine = `${'Y'.repeat(789)}.`;
    const smallLine = 'Tiny trailing fact stands alone.';
    const text = [bigLine, smallLine].join('\n');
    expect(text.length).toBeGreaterThan(MAX_CHARS);

    const chunks = chunkBlock({ text, page: 1 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain(smallLine);
  });
});

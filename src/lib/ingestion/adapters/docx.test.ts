// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { splitHtmlIntoSectionBlocks } from './docx';

describe('splitHtmlIntoSectionBlocks', () => {
  it('groups paragraphs under the nearest preceding heading as their section', () => {
    const html = [
      '<h1>Introduction</h1>',
      '<p>This document explains the process.</p>',
      '<p>It has two parts.</p>',
      '<h2>Part two</h2>',
      '<p>Here is the second part.</p>',
    ].join('');

    const blocks = splitHtmlIntoSectionBlocks(html);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].section).toBe('Introduction');
    expect(blocks[0].text).toContain('This document explains the process.');
    expect(blocks[0].text).toContain('It has two parts.');
    expect(blocks[1].section).toBe('Part two');
    expect(blocks[1].text).toContain('Here is the second part.');
  });

  it('leaves section undefined for paragraphs with no preceding heading', () => {
    const html = '<p>No heading above this.</p>';
    const blocks = splitHtmlIntoSectionBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].section).toBeUndefined();
    expect(blocks[0].text).toBe('No heading above this.');
  });

  it('returns no blocks for empty content', () => {
    expect(splitHtmlIntoSectionBlocks('')).toEqual([]);
    expect(splitHtmlIntoSectionBlocks('<h1>Only a heading</h1>')).toEqual([]);
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CitationDrawer, type Citation } from './citation-drawer';

const longCitation: Citation = {
  label: 1,
  sourceId: 's1',
  sourceTitle: 'Long Source',
  chunkIndex: 0,
  pageNumber: null,
  section: null,
  startSeconds: null,
  sourceUrl: null,
  content: 'word '.repeat(500).trim(),
};

describe('CitationDrawer', () => {
  it('renders passage content inside a scrollable container', () => {
    render(<CitationDrawer citation={longCitation} onOpenChange={vi.fn()} />);
    const scrollArea = document.querySelector('[data-slot="sheet-scroll-area"]');
    expect(scrollArea).not.toBeNull();
    expect(scrollArea).toHaveClass('overflow-y-auto');
    expect(scrollArea?.textContent).toContain(longCitation.content);
  });
});

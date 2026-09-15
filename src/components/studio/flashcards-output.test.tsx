import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlashcardsOutput } from './flashcards-output';

const citation = {
  chunkId: 'c1',
  sourceTitle: 'Doc',
  content: 'x',
  label: 1,
  sourceId: 's1',
  chunkIndex: 0,
  pageNumber: null,
  section: null,
  startSeconds: null,
  sourceUrl: null,
};

describe('FlashcardsOutput', () => {
  it('loads a pair of cards from one chunk, flips, and only fetches again once both are seen', async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          status: 'ok',
          items: [
            { card: { front: 'Q1', back: 'A1' }, citation },
            { card: { front: 'Q2', back: 'A2' }, citation },
          ],
        }),
      })
      .mockResolvedValueOnce({ json: async () => ({ status: 'exhausted' }) });

    render(<FlashcardsOutput notebookId="nb1" sourceIds={['s1']} />);
    expect(await screen.findByText('Q1')).toBeInTheDocument();
    await user.click(screen.getByText('Q1'));
    expect(screen.getByText('A1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('Q2')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText(/covered everything/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
    );
    expect(secondCallBody.excludeChunkIds).toEqual(['c1']);
  });
});

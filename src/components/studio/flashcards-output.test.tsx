import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlashcardsOutput } from './flashcards-output';

describe('FlashcardsOutput', () => {
  it('loads the first card, flips it, and fetches the next on demand', async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          status: 'ok',
          card: { front: 'Q1', back: 'A1' },
          citation: {
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
          },
        }),
      })
      .mockResolvedValueOnce({ json: async () => ({ status: 'exhausted' }) });

    render(<FlashcardsOutput notebookId="nb1" sourceIds={['s1']} />);
    expect(await screen.findByText('Q1')).toBeInTheDocument();
    await user.click(screen.getByText('Q1'));
    expect(screen.getByText('A1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText(/covered everything/i)).toBeInTheDocument();
  });
});

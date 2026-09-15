import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizOutput } from './quiz-output';

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

function mockPairResponse() {
  return {
    json: async () => ({
      status: 'ok',
      items: [
        { question: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 1, citation },
        { question: 'Q2', options: ['E', 'F', 'G', 'H'], correctIndex: 0, citation },
      ],
    }),
  };
}

describe('QuizOutput', () => {
  it('gives instant feedback and reveals the source only when wrong', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValueOnce(mockPairResponse());

    render(<QuizOutput notebookId="nb1" sourceIds={['s1']} />);
    await screen.findByText('Q1');
    await user.click(screen.getByText('A')); // wrong answer

    expect(screen.getByRole('button', { name: /see source/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next question/i })).toBeInTheDocument();
  });

  it('does not show a source button when the answer is correct', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValueOnce(mockPairResponse());

    render(<QuizOutput notebookId="nb1" sourceIds={['s1']} />);
    await screen.findByText('Q1');
    await user.click(screen.getByText('B')); // correct answer

    expect(screen.queryByRole('button', { name: /see source/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next question/i })).toBeInTheDocument();
  });

  it('locks in the selection so further clicks do not change it', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValueOnce(mockPairResponse());

    render(<QuizOutput notebookId="nb1" sourceIds={['s1']} />);
    await screen.findByText('Q1');
    await user.click(screen.getByText('A'));
    await user.click(screen.getByText('C'));

    // Only one "see source" button should still be there, selection unchanged.
    expect(screen.getAllByRole('button', { name: /see source/i })).toHaveLength(1);
  });

  it('advances through the pair from one chunk before fetching the next pair', async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockPairResponse())
      .mockResolvedValueOnce({ json: async () => ({ status: 'exhausted' }) });

    render(<QuizOutput notebookId="nb1" sourceIds={['s1']} />);
    await screen.findByText('Q1');
    await user.click(screen.getByText('B'));
    await user.click(screen.getByRole('button', { name: /next question/i }));

    expect(await screen.findByText('Q2')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText('E'));
    await user.click(screen.getByRole('button', { name: /next question/i }));

    expect(await screen.findByText(/covered everything/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
    );
    expect(secondCallBody.excludeChunkIds).toEqual(['c1']);
  });
});

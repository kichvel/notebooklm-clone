import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StudioPanel } from './studio-panel';

describe('StudioPanel', () => {
  it('disables feature cards when there are zero ready sources', () => {
    render(<StudioPanel notebookId="nb1" readySourceCount={0} selectedSourceIds={new Set()} />);
    expect(screen.getByRole('button', { name: /flashcards/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /quiz/i })).toBeDisabled();
  });

  it('only shows flashcards and quiz cards', () => {
    render(<StudioPanel notebookId="nb1" readySourceCount={2} selectedSourceIds={new Set()} />);
    expect(screen.queryByRole('button', { name: /study guide/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /flashcards/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quiz/i })).toBeInTheDocument();
  });

  it('resets the active feature session when selected sources change', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ status: 'exhausted' }) });

    const { rerender } = render(
      <StudioPanel notebookId="nb1" readySourceCount={2} selectedSourceIds={new Set(['s1'])} />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /flashcards/i }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/notebooks/nb1/studio/flashcards',
      expect.objectContaining({
        body: JSON.stringify({ sourceIds: ['s1'], excludeChunkIds: [] }),
      }),
    );

    rerender(
      <StudioPanel notebookId="nb1" readySourceCount={2} selectedSourceIds={new Set(['s2'])} />,
    );

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/notebooks/nb1/studio/flashcards',
      expect.objectContaining({
        body: JSON.stringify({ sourceIds: ['s2'], excludeChunkIds: [] }),
      }),
    );
  });
});

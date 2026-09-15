import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

  // TODO(task 5): GenerationOutput is a stub until tasks 3-4 implement real flashcards/quiz generation.
  it.skip('shows canned output after clicking a feature card', async () => {
    const user = userEvent.setup();
    render(<StudioPanel notebookId="nb1" readySourceCount={2} selectedSourceIds={new Set()} />);
    await user.click(screen.getByRole('button', { name: /flashcards/i }));
    expect(await screen.findByText(/flip to reveal/i)).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StudioPanel } from './studio-panel';

describe('StudioPanel', () => {
  it('disables feature cards when there are zero ready sources', () => {
    render(<StudioPanel readySourceCount={0} />);
    expect(screen.getByRole('button', { name: /flashcards/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /study guide/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /quiz/i })).toBeDisabled();
  });

  it('shows canned output after clicking a feature card', async () => {
    const user = userEvent.setup();
    render(<StudioPanel readySourceCount={2} />);
    await user.click(screen.getByRole('button', { name: /flashcards/i }));
    expect(await screen.findByText(/flip to reveal/i)).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThoughtsPanel } from './thoughts-panel';

describe('ThoughtsPanel', () => {
  it('renders nothing for empty text', () => {
    const { container } = render(<ThoughtsPanel text="" streaming={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is collapsed by default and expands to show the reasoning text', async () => {
    render(<ThoughtsPanel text="Checking the passages for revenue figures." streaming={false} />);
    expect(screen.getByText(/checking the passages/i)).not.toBeVisible();
    await userEvent.click(screen.getByText('Thoughts'));
    expect(screen.getByText(/checking the passages/i)).toBeVisible();
  });

  it('is open by default while streaming', () => {
    render(<ThoughtsPanel text="Looking at source 2." streaming />);
    expect(screen.getByText(/looking at source 2/i)).toBeVisible();
  });
});

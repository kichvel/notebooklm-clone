import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Page from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('Home page', () => {
  it('renders without crashing', () => {
    render(<Page />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('shows the new-notebook action', () => {
    render(<Page />);
    expect(screen.getByRole('button', { name: /new notebook/i })).toBeInTheDocument();
  });
});

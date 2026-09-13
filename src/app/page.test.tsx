import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Home page', () => {
  it('renders without crashing', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<Page />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('shows the new-notebook action', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<Page />);
    expect(screen.getAllByRole('button', { name: /new notebook/i }).length).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no notebooks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<Page />);
    expect(await screen.findByText(/create your first notebook/i)).toBeInTheDocument();
  });

  it('renders a notebook card for each notebook', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: '1', title: 'My Notebook', updated_at: new Date().toISOString() }],
      }),
    );
    render(<Page />);
    expect(await screen.findByText('My Notebook')).toBeInTheDocument();
  });
});

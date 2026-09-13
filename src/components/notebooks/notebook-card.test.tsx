import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookCard, type NotebookSummary } from './notebook-card';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const notebook: NotebookSummary = {
  id: 'nb-1',
  title: 'Original title',
  updated_at: new Date().toISOString(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('NotebookCard', () => {
  it('submits a PATCH with the new title on rename', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...notebook, title: 'New title' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onRenamed = vi.fn();

    render(<NotebookCard notebook={notebook} onRenamed={onRenamed} onDeleted={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /notebook options/i }));
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }));

    const input = await screen.findByDisplayValue('Original title');
    await user.clear(input);
    await user.type(input, 'New title');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notebooks/nb-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'New title' }),
      }),
    );
    expect(onRenamed).toHaveBeenCalledWith({ ...notebook, title: 'New title' });
  });

  it('submits a DELETE and calls onDeleted on confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const onDeleted = vi.fn();

    render(<NotebookCard notebook={notebook} onRenamed={vi.fn()} onDeleted={onDeleted} />);

    await user.click(screen.getByRole('button', { name: /notebook options/i }));
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: /^delete$/i }));

    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/nb-1', { method: 'DELETE' });
    expect(onDeleted).toHaveBeenCalledWith('nb-1');
  });
});

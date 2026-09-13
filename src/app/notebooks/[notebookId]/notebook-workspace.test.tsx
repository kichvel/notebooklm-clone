import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookWorkspace } from './notebook-workspace';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe('NotebookWorkspace', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps polling notebook title and messages while a ready source has not produced its intro yet', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sources')) {
        return jsonResponse([
          { id: 's1', title: 'Doc', type: 'pdf', status: 'ready', failure_reason: null, created_at: '' },
        ]);
      }
      if (url.endsWith('/messages')) return jsonResponse([]);
      return jsonResponse({ id: 'n1', title: 'Untitled notebook' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotebookWorkspace notebookId="n1" />);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    const callsAfterMount = fetchMock.mock.calls.length;

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount), {
      timeout: 3000,
    });
  });
});

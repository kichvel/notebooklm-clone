import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('disables the question input while a question is being asked, preventing duplicate submits', async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/messages')) {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      if (url.endsWith('/sources')) return jsonResponse([]);
      if (url.endsWith('/messages')) return jsonResponse([]);
      return jsonResponse({ id: 'n1', title: 'Untitled notebook' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotebookWorkspace notebookId="n1" />);
    // ChatPanel is rendered twice (desktop pane + MobileTabs); CSS picks one visible
    // instance at runtime, but jsdom has no layout, so both exist in the DOM here.
    const [input] = await screen.findAllByPlaceholderText(/ask a question about your sources/i);
    const user = userEvent.setup();
    await user.type(input, 'What is this about?');
    const [sendButton] = screen.getAllByRole('button', { name: 'Ask' });
    await user.click(sendButton);

    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();

    const postCallsBeforeSecondClick = fetchMock.mock.calls.filter(
      ([callUrl, callInit]) =>
        String(callUrl).endsWith('/messages') && (callInit as RequestInit | undefined)?.method === 'POST',
    ).length;
    await user.click(sendButton);
    const postCallsAfterSecondClick = fetchMock.mock.calls.filter(
      ([callUrl, callInit]) =>
        String(callUrl).endsWith('/messages') && (callInit as RequestInit | undefined)?.method === 'POST',
    ).length;
    expect(postCallsAfterSecondClick).toBe(postCallsBeforeSecondClick);

    resolvePost?.({ ok: true, json: () => Promise.resolve({ id: 'm1' }) } as Response);
  });
});

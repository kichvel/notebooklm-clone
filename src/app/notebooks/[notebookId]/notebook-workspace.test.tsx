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

  it('shows the sent message immediately with a processing indicator, then swaps in the persisted answer', async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    let getMessagesCallCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/messages')) {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      if (url.endsWith('/sources')) return jsonResponse([]);
      if (url.endsWith('/messages')) {
        getMessagesCallCount += 1;
        if (getMessagesCallCount === 1) return jsonResponse([]);
        return jsonResponse([
          {
            id: 'u1',
            role: 'user',
            content: 'What is this about?',
            status: 'complete',
            created_at: '',
            follow_up_questions: null,
            citations: [],
          },
          {
            id: 'a1',
            role: 'assistant',
            content: 'This is about cats.',
            status: 'complete',
            created_at: '',
            follow_up_questions: ['What do cats eat?'],
            citations: [],
          },
        ]);
      }
      return jsonResponse({ id: 'n1', title: 'Untitled notebook' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotebookWorkspace notebookId="n1" />);
    const [input] = await screen.findAllByPlaceholderText(/ask a question about your sources/i);
    const user = userEvent.setup();
    await user.type(input, 'What is this about?');
    const [sendButton] = screen.getAllByRole('button', { name: 'Ask' });
    await user.click(sendButton);

    // Immediately, before the server responds: the sent message is visible, with the
    // processing indicator under it.
    const [userBubble] = await screen.findAllByTestId('chat-bubble-user');
    expect(userBubble).toHaveTextContent('What is this about?');
    expect(screen.getAllByTestId('asking-indicator').length).toBeGreaterThan(0);

    resolvePost?.({ ok: true, json: () => Promise.resolve({ id: 'm-server' }) } as Response);

    await waitFor(() => expect(screen.queryAllByTestId('asking-indicator')).toHaveLength(0));
    expect(screen.getAllByTestId('chat-bubble-user')[0]).toHaveTextContent('What is this about?');
    expect(screen.getAllByText('This is about cats.').length).toBeGreaterThan(0);
  });

  it('saves chat settings from the Configure Chat dialog', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sources')) return jsonResponse([]);
      if (url.endsWith('/messages')) return jsonResponse([]);
      if (url.endsWith('/chat-settings')) return jsonResponse({ id: 'n1' });
      return jsonResponse({ id: 'n1', title: 'Untitled notebook' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotebookWorkspace notebookId="n1" />);
    const user = userEvent.setup();
    const [settingsButton] = await screen.findAllByRole('button', { name: /configure chat/i });
    await user.click(settingsButton);
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    await user.type(screen.getByPlaceholderText(/respond at a phd student level/i), 'Be a pirate');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notebooks/n1/chat-settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            chatStyle: 'custom',
            chatCustomStyle: 'Be a pirate',
            chatAnswerLength: 'default',
          }),
        }),
      ),
    );
  });
});

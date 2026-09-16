import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel, type Message } from './chat-panel';

const messageWithCitation: Message = {
  id: 'm1',
  role: 'assistant',
  content: 'Cats are mammals [1].',
  status: 'complete',
  created_at: '',
  follow_up_questions: null,
  reasoning: null,
  citations: [
    {
      label: 1,
      sourceId: 's1',
      sourceTitle: 'Animal Facts',
      chunkIndex: 0,
      pageNumber: null,
      section: null,
      startSeconds: null,
      sourceUrl: null,
      content: 'Cats are small carnivorous mammals.',
    },
  ],
};

const defaultChatSettings = {
  chatStyle: 'default' as const,
  chatCustomStyle: null,
  chatAnswerLength: 'default' as const,
};

function renderPanel(
  messages: Message[] = [],
  onSelectFollowUp = vi.fn(),
  asking = false,
  sourceCount = 0,
  streaming: { reasoning: string; answer: string; citations: Message['citations'] } | null = null,
  retryingMessageId: string | null = null,
  onRetry = vi.fn(),
  pendingIntroTitles: string[] = [],
  hasProcessingSources = false,
) {
  return render(
    <ChatPanel
      messages={messages}
      question=""
      onQuestionChange={vi.fn()}
      onAsk={vi.fn()}
      asking={asking}
      askError={null}
      hasProcessingSources={hasProcessingSources}
      onSelectFollowUp={onSelectFollowUp}
      sourceCount={sourceCount}
      chatSettings={defaultChatSettings}
      onUpdateChatSettings={vi.fn()}
      streaming={streaming}
      retryingMessageId={retryingMessageId}
      onRetry={onRetry}
      pendingIntroTitles={pendingIntroTitles}
    />,
  );
}

describe('ChatPanel', () => {
  it('shows the welcome state when there are no messages', () => {
    renderPanel([]);
    expect(screen.getByText(/let.s start your notebook/i)).toBeInTheDocument();
  });

  it('keeps the welcome state loading indicator visible while a source intro is still generating', () => {
    const { container } = renderPanel(
      [],
      vi.fn(),
      false,
      0,
      null,
      null,
      vi.fn(),
      ['Q3 Report.pdf'],
      false,
    );
    expect(screen.getByText(/let.s start your notebook/i)).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  });

  it('opens the citation drawer with the exact passage when a marker is clicked', async () => {
    const user = userEvent.setup();
    renderPanel([messageWithCitation]);

    await user.click(screen.getByRole('button', { name: '[1]' }));
    expect(await screen.findByText(messageWithCitation.citations[0].content)).toBeInTheDocument();
  });

  it('renders user messages as a bubble distinct from assistant text', () => {
    renderPanel([
      {
        id: 'u1',
        role: 'user',
        content: 'Hello there',
        status: 'complete',
        created_at: '',
        follow_up_questions: null,
        reasoning: null,
        citations: [],
      },
      messageWithCitation,
    ]);
    expect(screen.getByTestId('chat-bubble-user')).toHaveTextContent('Hello there');
  });

  it('sends a follow-up question immediately when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onSelectFollowUp = vi.fn();
    renderPanel(
      [{ ...messageWithCitation, follow_up_questions: ['What do cats eat?'] }],
      onSelectFollowUp,
    );
    await user.click(screen.getByRole('button', { name: 'What do cats eat?' }));
    expect(onSelectFollowUp).toHaveBeenCalledWith('What do cats eat?');
  });

  it('disables the input, send button, and follow-up chips while a question is processing', async () => {
    const user = userEvent.setup();
    const onSelectFollowUp = vi.fn();
    renderPanel(
      [{ ...messageWithCitation, follow_up_questions: ['What do cats eat?'] }],
      onSelectFollowUp,
      true,
    );

    expect(screen.getByPlaceholderText(/ask a question about your sources/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();

    const chip = screen.getByRole('button', { name: 'What do cats eat?' });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onSelectFollowUp).not.toHaveBeenCalled();
  });

  it('shows a processing indicator while a question is being answered', () => {
    renderPanel([messageWithCitation], vi.fn(), true);
    expect(screen.getByTestId('asking-indicator')).toBeInTheDocument();
  });

  it('disables input and shows an indicator while an intro is pending', () => {
    renderPanel([messageWithCitation], vi.fn(), false, 0, null, null, vi.fn(), ['Q3 Report.pdf']);
    expect(screen.getByTestId('intro-pending-indicator')).toBeInTheDocument();
    expect(screen.getByText(/summarizing/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
  });

  it('disables input and shows an indicator while a new source is still processing', () => {
    renderPanel([messageWithCitation], vi.fn(), false, 0, null, null, vi.fn(), [], true);
    expect(screen.getByTestId('source-processing-indicator')).toBeInTheDocument();
    expect(screen.getByText(/processing new source/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
  });

  it('shows the source title and filename as a header for a source intro message', () => {
    renderPanel([
      {
        ...messageWithCitation,
        introSource: { title: 'Quarterly Report', filename: 'Q3 Report.pdf' },
      },
    ]);
    expect(screen.getByRole('heading', { name: 'Quarterly Report' })).toBeInTheDocument();
    expect(screen.getByText('Q3 Report.pdf')).toBeInTheDocument();
  });

  it('scrolls to the bottom when the processing indicator appears and again when the answer arrives', () => {
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { rerender } = renderPanel([messageWithCitation], vi.fn(), false);
    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth', block: 'end' }),
    );
    const callsAfterMount = scrollIntoViewMock.mock.calls.length;

    // Chip clicked / question sent: asking flips true, a "Thinking…" indicator appears.
    rerender(
      <ChatPanel
        messages={[messageWithCitation]}
        question=""
        onQuestionChange={vi.fn()}
        onAsk={vi.fn()}
        asking={true}
        askError={null}
        hasProcessingSources={false}
        onSelectFollowUp={vi.fn()}
        sourceCount={0}
        chatSettings={defaultChatSettings}
        onUpdateChatSettings={vi.fn()}
        streaming={null}
        retryingMessageId={null}
        onRetry={vi.fn()}
        pendingIntroTitles={[]}
      />,
    );
    expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
    const callsBeforeAnswer = scrollIntoViewMock.mock.calls.length;

    // Answer arrives: asking flips false, a new message is appended.
    const secondMessage: Message = {
      ...messageWithCitation,
      id: 'm2',
      content: 'Dogs are mammals too.',
    };
    rerender(
      <ChatPanel
        messages={[messageWithCitation, secondMessage]}
        question=""
        onQuestionChange={vi.fn()}
        onAsk={vi.fn()}
        asking={false}
        askError={null}
        hasProcessingSources={false}
        onSelectFollowUp={vi.fn()}
        sourceCount={0}
        chatSettings={defaultChatSettings}
        onUpdateChatSettings={vi.fn()}
        streaming={null}
        retryingMessageId={null}
        onRetry={vi.fn()}
        pendingIntroTitles={[]}
      />,
    );
    expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(callsBeforeAnswer);

    // @ts-expect-error -- jsdom doesn't implement scrollIntoView; remove the test stub
    delete HTMLElement.prototype.scrollIntoView;
  });

  it('shows a "Chat" header', () => {
    renderPanel([]);
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });

  it('shows the current source count under the send button', () => {
    renderPanel([], vi.fn(), false, 3);
    expect(screen.getByText('Sources: 3')).toBeInTheDocument();
  });

  it('opens Configure Chat from the header settings icon', async () => {
    const user = userEvent.setup();
    renderPanel([]);
    await user.click(screen.getByRole('button', { name: /configure chat/i }));
    expect(screen.getByRole('heading', { name: 'Configure Chat' })).toBeInTheDocument();
  });

  it('shows a Thoughts panel for a historical message with reasoning', () => {
    renderPanel([{ ...messageWithCitation, reasoning: 'Checking the passages.' }]);
    expect(screen.getByText('Thoughts')).toBeInTheDocument();
  });

  it('shows the live Thoughts panel and partial answer while streaming, instead of "Thinking…"', () => {
    renderPanel([], vi.fn(), true, 0, {
      reasoning: 'Looking at source 2.',
      answer: 'Cats are mammals.',
      citations: [],
    });
    expect(screen.getByText('Thoughts')).toBeInTheDocument();
    expect(screen.getByText(/looking at source 2/i)).toBeVisible();
    expect(screen.getByText('Cats are mammals.')).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
  });

  it('shows a Retry button for a failed message and calls onRetry with its id', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderPanel(
      [{ ...messageWithCitation, id: 'failed-1', status: 'failed', content: 'partial answer' }],
      vi.fn(),
      false,
      0,
      null,
      null,
      onRetry,
    );
    const retryButton = screen.getByTestId('retry-answer');
    await user.click(retryButton);
    expect(onRetry).toHaveBeenCalledWith('failed-1');
  });

  it('renders live streaming content in place of a retrying message instead of its stored content', () => {
    renderPanel(
      [{ ...messageWithCitation, id: 'failed-1', status: 'failed', content: 'stale content' }],
      vi.fn(),
      true,
      0,
      { reasoning: '', answer: 'fresh retried answer', citations: [] },
      'failed-1',
    );
    expect(screen.getByText('fresh retried answer')).toBeInTheDocument();
    expect(screen.queryByText('stale content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('retry-answer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asking-indicator')).not.toBeInTheDocument();
  });
});

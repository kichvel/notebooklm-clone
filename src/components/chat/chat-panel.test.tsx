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

function renderPanel(messages: Message[] = [], onSelectFollowUp = vi.fn(), asking = false) {
  return render(
    <ChatPanel
      messages={messages}
      question=""
      onQuestionChange={vi.fn()}
      onAsk={vi.fn()}
      asking={asking}
      askError={null}
      hasProcessingSources={false}
      onSelectFollowUp={onSelectFollowUp}
    />,
  );
}

describe('ChatPanel', () => {
  it('shows the welcome state when there are no messages', () => {
    renderPanel([]);
    expect(screen.getByText(/let.s start your notebook/i)).toBeInTheDocument();
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
});

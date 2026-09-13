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

function renderPanel(messages: Message[] = []) {
  return render(
    <ChatPanel
      messages={messages}
      question=""
      onQuestionChange={vi.fn()}
      onAsk={vi.fn()}
      asking={false}
      askError={null}
      hasProcessingSources={false}
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
});

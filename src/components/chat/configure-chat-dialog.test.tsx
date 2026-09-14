import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfigureChatDialog } from './configure-chat-dialog';

const defaultSettings = {
  chatStyle: 'default' as const,
  chatCustomStyle: null,
  chatAnswerLength: 'default' as const,
};

describe('ConfigureChatDialog', () => {
  it('opens the dialog and shows style/length pill options', async () => {
    const user = userEvent.setup();
    render(<ConfigureChatDialog settings={defaultSettings} onSave={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /configure chat/i }));
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Longer' })).toBeInTheDocument();
  });

  it('blocks Save until custom style text is entered, then saves it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ConfigureChatDialog settings={defaultSettings} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /configure chat/i }));
    await user.click(screen.getByRole('button', { name: 'Custom' }));

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/respond at a phd student level/i), 'Be a pirate');
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(onSave).toHaveBeenCalledWith({
      chatStyle: 'custom',
      chatCustomStyle: 'Be a pirate',
      chatAnswerLength: 'default',
    });
  });
});

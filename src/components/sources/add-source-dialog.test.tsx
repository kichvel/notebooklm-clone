import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddSourceDialog } from './add-source-dialog';

function setup() {
  const onAddFiles = vi.fn().mockResolvedValue(undefined);
  const onAddWebsite = vi.fn().mockResolvedValue(undefined);
  const onAddYoutube = vi.fn().mockResolvedValue(undefined);
  const onAddText = vi.fn().mockResolvedValue(undefined);
  render(
    <AddSourceDialog
      onAddFiles={onAddFiles}
      onAddWebsite={onAddWebsite}
      onAddYoutube={onAddYoutube}
      onAddText={onAddText}
    />,
  );
  return { onAddFiles, onAddWebsite, onAddYoutube, onAddText };
}

describe('AddSourceDialog', () => {
  it('shows a file drop zone by default and no title field', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /add sources/i }));

    expect(screen.getByText(/drop your files/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/title/i)).not.toBeInTheDocument();
  });

  it('switches to a single URL field with no title field when the Website pill is clicked', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /add sources/i }));
    await user.click(screen.getByRole('button', { name: /^website$/i }));

    expect(screen.getByPlaceholderText(/website url/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/title/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/drop your files/i)).not.toBeInTheDocument();
  });

  it('switches to a single URL field when the YouTube pill is clicked', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /add sources/i }));
    await user.click(screen.getByRole('button', { name: /youtube/i }));

    expect(screen.getByPlaceholderText(/youtube link/i)).toBeInTheDocument();
  });

  it('switches to the paste-text form with no title field when Copied text is clicked', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /add sources/i }));
    await user.click(screen.getByRole('button', { name: /copied text/i }));

    expect(screen.getByPlaceholderText(/paste text here/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/title/i)).not.toBeInTheDocument();
  });

  it('submits the website URL to onAddWebsite', async () => {
    const user = userEvent.setup();
    const { onAddWebsite } = setup();
    await user.click(screen.getByRole('button', { name: /add sources/i }));
    await user.click(screen.getByRole('button', { name: /^website$/i }));
    await user.type(screen.getByPlaceholderText(/website url/i), 'https://example.com');
    await user.click(screen.getByRole('button', { name: /^add source$/i }));

    expect(onAddWebsite).toHaveBeenCalledWith('https://example.com');
  });
});

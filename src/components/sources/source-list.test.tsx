import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SourceList } from './source-list';
import type { SourceSummary } from './source-item';

const sources: SourceSummary[] = [
  {
    id: '1',
    title: 'a.pdf',
    status: 'failed',
    failure_reason: 'bad file',
    type: 'pdf',
    created_at: '',
  },
  { id: '2', title: 'b.pdf', status: 'ready', failure_reason: null, type: 'pdf', created_at: '' },
  { id: '3', title: 'c.pdf', status: 'ready', failure_reason: null, type: 'pdf', created_at: '' },
];

describe('SourceList', () => {
  it('shows a retry action for failed sources', () => {
    render(
      <SourceList
        sources={[sources[0]]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('toggling select all selects and deselects every ready source', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <SourceList
        sources={sources}
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /select all/i }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['2', '3']));

    onSelectionChange.mockClear();
    render(
      <SourceList
        sources={sources}
        selectedIds={new Set(['2', '3'])}
        onSelectionChange={onSelectionChange}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await user.click(screen.getAllByRole('checkbox', { name: /select all/i })[1]);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });

  it('shows an empty state when there are no sources', () => {
    render(
      <SourceList
        sources={[]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/saved sources will appear here/i)).toBeInTheDocument();
  });
});

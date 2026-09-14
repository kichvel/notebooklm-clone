import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WorkspaceShell } from './workspace-shell';

function renderShell() {
  return render(
    <WorkspaceShell
      sources={<div>source list</div>}
      sourcesHeaderAction={<button>Add sources</button>}
      chat={<div>chat</div>}
      studio={<div>studio</div>}
    />,
  );
}

describe('WorkspaceShell', () => {
  it('renders the sources header action on the same row as the collapse toggle', () => {
    renderShell();
    const header = screen.getByTestId('sources-panel-header');
    expect(within(header).getByRole('button', { name: 'Add sources' })).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: /collapse sources panel/i }),
    ).toBeInTheDocument();
  });

  it('hides the header action once the sources panel is collapsed', async () => {
    const user = userEvent.setup();
    renderShell();
    const header = screen.getByTestId('sources-panel-header');
    await user.click(within(header).getByRole('button', { name: /collapse sources panel/i }));
    expect(within(header).queryByRole('button', { name: 'Add sources' })).not.toBeInTheDocument();
  });
});

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import DialogGallery from '../../src/components/settings/DialogGallery.jsx';

/**
 * The gallery exists so a conflict dialog can be looked at without staging the
 * conflict. That is only true if every fixture in it actually renders — a
 * dialog that throws on a missing prop sends you straight back to reproducing
 * the failure by hand, which is the thing being avoided.
 *
 * So: open every entry, and assert each one puts a dialog on screen.
 */

afterEach(cleanup);

const showButtons = () => screen.getAllByText('Show').map((label) => label.closest('button'));

describe('DialogGallery', () => {
  it('lists an entry per dialog', () => {
    render(<DialogGallery />);
    expect(showButtons().length).toBeGreaterThanOrEqual(11);
    expect(screen.getByText('Universe Target Collision')).toBeTruthy();
  });

  it('opens and closes every dialog it offers', () => {
    render(<DialogGallery />);
    const total = showButtons().length;

    for (let i = 0; i < total; i += 1) {
      fireEvent.click(showButtons()[i]);

      // Every dialog in this family renders into the portal with a Close
      // Preview escape hatch alongside it.
      const close = screen.getByText('Close Preview');
      expect(close).toBeTruthy();

      fireEvent.click(close);
      expect(screen.queryByText('Close Preview')).toBeNull();
    }
  });

  it('reports which handler a dialog fired, not the onClose that follows it', () => {
    render(<DialogGallery />);

    // Slot Conflict: choosing git calls onChooseGit only, so the row should
    // name that. ConfirmDialog is the case that matters — it calls onConfirm
    // and then onClose in one click.
    const slotRow = screen.getByText('Slot Conflict').closest('.settings-row');
    fireEvent.click(within(slotRow).getByText('Show').closest('button'));
    fireEvent.click(screen.getByText('Use Git Version'));
    expect(within(slotRow).getByText('onChooseGit')).toBeTruthy();

    const confirmRow = screen.getByText('Confirm — default').closest('.settings-row');
    fireEvent.click(within(confirmRow).getByText('Show').closest('button'));
    fireEvent.click(screen.getByText('Leave'));
    expect(within(confirmRow).getByText('onConfirm')).toBeTruthy();
  });
});

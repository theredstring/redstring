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

  it('builds every dialog on the shared shell', () => {
    // The family drifted once already — three scrim opacities, three corner
    // radii, four button shapes. Opening each one and asserting it is the shared
    // frame is what keeps the next dialog from being hand-rolled again.
    render(<DialogGallery />);
    const total = showButtons().length;

    for (let i = 0; i < total; i += 1) {
      fireEvent.click(showButtons()[i]);

      const scrim = document.querySelector('.rs-dialog-scrim');
      expect(scrim, 'a dialog is not using the shared scrim').toBeTruthy();
      // Above the TypeList bar (19999) and its toggle (20000), or the bar
      // covers the dialog's own footer whenever it is open.
      expect(Number(scrim.style.zIndex)).toBeGreaterThan(20000);

      const dialog = scrim.querySelector('[role="dialog"]');
      expect(dialog.style.borderRadius).toBe('12px');
      expect(dialog.style.maxHeight).toBe('100%');
      expect(dialog.style.maxWidth).toBe('100%');

      fireEvent.click(screen.getByText('Close Preview'));
    }
  });

  it('says one thing in one colour in every header', () => {
    // The local-file conflict shipped with a maroon warning triangle beside a
    // white heading, because the icon and the title took separate tone props
    // that defaulted differently. They are one statement; they get one colour.
    render(<DialogGallery />);
    const total = showButtons().length;

    for (let i = 0; i < total; i += 1) {
      fireEvent.click(showButtons()[i]);

      const header = document.querySelector('.rs-dialog-header');
      const heading = header.querySelector('h2');
      const iconBox = header.querySelector('.rs-dialog-header-icon');
      if (heading && iconBox) {
        expect(iconBox.style.color, `dialog ${i}'s icon and title disagree`)
          .toBe(heading.style.color);
      }

      fireEvent.click(screen.getByText('Close Preview'));
    }
  });

  it('bands the header and footer with a recess, not with canvas.border', () => {
    // canvas.border is DARKER than the canvas in light mode and much LIGHTER
    // than it in dark (#6a6464 over #2E2A2A), so using it as the band gave the
    // dark dialogs a pale grey bar top and bottom. The band is stated as a
    // relationship — the surface with a shadow in it — so it works either way.
    render(<DialogGallery />);
    fireEvent.click(showButtons()[0]);

    const band = 'rgba(0, 0, 0, 0.22)';
    expect(document.querySelector('.rs-dialog-header').style.backgroundColor).toBe(band);

    fireEvent.click(screen.getByText('Close Preview'));

    // Pick a dialog that actually has a footer.
    const confirmRow = screen.getByText('Confirm — default').closest('.settings-row');
    fireEvent.click(within(confirmRow).getByText('Show').closest('button'));
    expect(document.querySelector('.rs-dialog-footer').style.backgroundColor).toBe(band);
  });

  it('gives every action in every dialog the same pill, stroked at rest', () => {
    render(<DialogGallery />);
    const total = showButtons().length;
    let checked = 0;

    for (let i = 0; i < total; i += 1) {
      fireEvent.click(showButtons()[i]);

      // The two places a dialog puts an action: its footer, and the foot of a
      // card that IS a choice. Option rows are not actions and are left out.
      const actions = document.querySelectorAll(
        '.rs-dialog-footer button, button.rs-dialog-card-action'
      );

      actions.forEach((button) => {
        const where = `${button.textContent} in dialog ${i}`;
        expect(button.className, `${where} is not a PanelIconButton pill`)
          .toContain('panel-icon-button');
        expect(button.style.borderRadius, `${where} is not pill-shaped`).toBe('20px');
        // A pill with no stroke reads as a label until you hover it.
        expect(button.style.borderWidth, `${where} has no stroke`).toBe('1px');
        expect(['', 'transparent'], `${where} has an invisible stroke`)
          .not.toContain(button.style.borderColor);
        checked += 1;
      });

      fireEvent.click(screen.getByText('Close Preview'));
    }

    // The Close Preview pill is itself outside any dialog, so a run that found
    // nothing would otherwise pass silently.
    expect(checked).toBeGreaterThan(total);
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

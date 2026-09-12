import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WizardIntentModal from '../../src/components/wizard/WizardIntentModal.jsx';
import { SURFACES } from '../../src/wizard/prompts/intents.js';

const base = {
  isOpen: true,
  surface: SURFACES.THING,
  facts: { webInstanceCount: 6, hasLadder: true },
  subjectLabel: '"Rotterdam"',
  destination: 'new',
  onDestinationChange: () => {},
  onConfirm: () => {},
  onClose: () => {}
};

describe('WizardIntentModal', () => {
  it('renders every intent plus a permanent Other box', () => {
    render(<WizardIntentModal {...base} />);
    expect(screen.getByText('Define its components')).toBeTruthy();
    expect(screen.getByText('Does this connect to anything here?')).toBeTruthy();
    expect(screen.getByText('Expand its abstraction ladder')).toBeTruthy();
    expect(screen.getByText('Explain this Thing')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
    // The box is there without anyone having to click a row first.
    expect(screen.getByPlaceholderText('Ask something specific…')).toBeTruthy();
    // The old expandable row label is gone.
    expect(screen.queryByText('Ask something specific…')).toBeNull();
  });

  it('confirms the default intent, and never a policy-less surprise', () => {
    const onConfirm = vi.fn();
    render(<WizardIntentModal {...base} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Ask'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].intent.id).toBe('define-components');
    expect(onConfirm.mock.calls[0][0].destination).toBe('new');
  });

  it('typing in Other selects it', () => {
    const onConfirm = vi.fn();
    render(<WizardIntentModal {...base} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByPlaceholderText('Ask something specific…'), {
      target: { value: 'why is this here?' }
    });
    fireEvent.click(screen.getByText('Ask'));
    expect(onConfirm.mock.calls[0][0].intent.tier).toBe('freetext');
    expect(onConfirm.mock.calls[0][0].freeText).toBe('why is this here?');
  });

  it('drives destination from one sticky checkbox', () => {
    const onDestinationChange = vi.fn();
    const { rerender } = render(<WizardIntentModal {...base} onDestinationChange={onDestinationChange} />);
    const box = screen.getByRole('checkbox');
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onDestinationChange).toHaveBeenCalledWith('current');
    rerender(<WizardIntentModal {...base} destination="current" onDestinationChange={onDestinationChange} />);
    expect(screen.getByRole('checkbox').checked).toBe(true);
  });

  it('refuses to send an empty Other', () => {
    const onConfirm = vi.fn();
    render(<WizardIntentModal {...base} onConfirm={onConfirm} />);
    fireEvent.focus(screen.getByPlaceholderText('Ask something specific…'));
    fireEvent.click(screen.getByText('Ask'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sizes rows inside the list rather than 28px past it', () => {
    // box-sizing is not global in this app (App.css sets it on `body` only), so a
    // row with width:100% plus padding and a border overhangs its container and
    // the list's overflow-y turns that into a horizontal scrollbar.
    const { container } = render(<WizardIntentModal {...base} />);
    const rows = container.querySelectorAll('button[style*="border-radius: 8px"], div[style*="border-radius: 8px"]');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.style.boxSizing, `row "${row.textContent.slice(0, 30)}" is not border-box`).toBe('border-box');
    });
  });
});

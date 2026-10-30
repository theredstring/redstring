import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import AppDialogHost from '../../src/components/shared/AppDialogHost.jsx';
import { askConfirm, showNotice, useAppDialogStore } from '../../src/components/shared/appDialogs.js';

afterEach(() => {
  cleanup();
  useAppDialogStore.setState({ queue: [] });
});

const click = (label) => act(() => { fireEvent.click(screen.getByText(label)); });

describe('askConfirm / showNotice', () => {
  it('confirm resolves true', async () => {
    render(<AppDialogHost />);
    let answer;
    act(() => { answer = askConfirm({ title: 'Delete Universe?', message: '"A" is deleted.', confirmLabel: 'Delete' }); });
    expect(screen.getByText('Delete Universe?')).toBeTruthy();
    expect(screen.getByText('"A" is deleted.')).toBeTruthy();
    await click('Delete');
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByText('Delete Universe?')).toBeNull();
  });

  it('cancel resolves false', async () => {
    render(<AppDialogHost />);
    let answer;
    act(() => { answer = askConfirm({ title: 'Remove API Key?', confirmLabel: 'Remove' }); });
    await click('Cancel');
    await expect(answer).resolves.toBe(false);
  });

  it('Escape resolves false', async () => {
    render(<AppDialogHost />);
    let answer;
    act(() => { answer = askConfirm({ title: 'Clear Conversation?' }); });
    await act(() => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); });
    await expect(answer).resolves.toBe(false);
  });

  it('a notice shows its title and detail line and resolves when dismissed', async () => {
    render(<AppDialogHost />);
    let done;
    act(() => { done = showNotice({ title: 'Could Not Save', details: 'disk full', variant: 'error' }); });
    expect(screen.getByText('Could Not Save')).toBeTruthy();
    expect(screen.getByText('disk full')).toBeTruthy();
    await click('OK');
    await expect(done).resolves.toBeUndefined();
    expect(screen.queryByText('Could Not Save')).toBeNull();
  });

  it('queues: two asks show one at a time, each with its own answer', async () => {
    render(<AppDialogHost />);
    let first; let second;
    act(() => {
      first = askConfirm({ title: 'First?', confirmLabel: 'Yes' });
      second = askConfirm({ title: 'Second?', confirmLabel: 'Yes' });
    });
    expect(screen.getByText('First?')).toBeTruthy();
    expect(screen.queryByText('Second?')).toBeNull();
    await click('Yes');
    await expect(first).resolves.toBe(true);
    expect(screen.getByText('Second?')).toBeTruthy();
    await click('Cancel');
    await expect(second).resolves.toBe(false);
    expect(useAppDialogStore.getState().queue).toHaveLength(0);
  });

  it('with no host mounted, a confirm answers false and a notice resolves at once', async () => {
    await expect(askConfirm({ title: 'Delete?' })).resolves.toBe(false);
    await expect(showNotice({ title: 'Saved' })).resolves.toBeUndefined();
    expect(useAppDialogStore.getState().queue).toHaveLength(0);
  });

  it('unmounting the host settles what is waiting', async () => {
    const { unmount } = render(<AppDialogHost />);
    let answer;
    act(() => { answer = askConfirm({ title: 'Pending?' }); });
    unmount();
    await expect(answer).resolves.toBe(false);
  });
});

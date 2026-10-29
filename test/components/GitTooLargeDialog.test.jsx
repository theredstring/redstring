import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GitTooLargeDialog from '../../src/components/shared/GitTooLargeDialog.jsx';

const MB = 1024 * 1024;

describe('GitTooLargeDialog', () => {
  it('says sync paused and that this device keeps every change', () => {
    const onDismiss = vi.fn();
    render(<GitTooLargeDialog isOpen universeName="Chambers" bytes={97.4 * MB} limit={95 * MB} hasLocalFile onDismiss={onDismiss} />);
    expect(screen.getByText('Too large for Git')).toBeTruthy();
    expect(screen.getByText(/"Chambers" is 97\.4 MB, over the 95\.0 MB Git sync can carry/)).toBeTruthy();
    expect(screen.getByText('Your file keeps every change')).toBeTruthy();
    fireEvent.click(screen.getByText('OK'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('says the repository copy was left alone when opening is refused', () => {
    render(<GitTooLargeDialog isOpen universeName="Chambers" phase="open" bytes={120 * MB} limit={95 * MB} onDismiss={() => {}} />);
    expect(screen.getByText(/repository's copy of "Chambers" is 120\.0 MB, over the 95\.0 MB Git sync can open/)).toBeTruthy();
    expect(screen.getByText('Left as it is')).toBeTruthy();
  });

  it('still reads when the sizes are unknown', () => {
    render(<GitTooLargeDialog isOpen universeName="Chambers" onDismiss={() => {}} />);
    expect(screen.getByText(/"Chambers" is over the limit Git sync can carry/)).toBeTruthy();
  });
});

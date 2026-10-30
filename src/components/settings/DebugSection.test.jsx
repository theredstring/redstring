import React from 'react';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import debugConfig from '../../utils/debugConfig.js';
import DebugSection from './DebugSection.jsx';

const storageToggle = () => {
  const row = screen.getByText('Disable Local Storage').closest('.settings-row');
  return within(row).getByRole('checkbox');
};

describe('Debug settings: Disable Local Storage', () => {
  afterEach(() => {
    cleanup();
    debugConfig.setLocalStorageDisabled(false);
    vi.restoreAllMocks();
  });

  it('asks before turning on, and does nothing on Cancel', () => {
    const set = vi.spyOn(debugConfig, 'setLocalStorageDisabled');
    render(<DebugSection onCloseSettings={() => {}} onRelock={() => {}} />);
    fireEvent.click(storageToggle());
    expect(screen.getByText('Disable Local Storage?')).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(set).not.toHaveBeenCalled();
    expect(screen.queryByText('Disable Local Storage?')).toBeNull();
  });

  it('turns on after Disable', () => {
    const set = vi.spyOn(debugConfig, 'setLocalStorageDisabled');
    render(<DebugSection onCloseSettings={() => {}} onRelock={() => {}} />);
    fireEvent.click(storageToggle());
    fireEvent.click(screen.getByText('Disable'));
    expect(set).toHaveBeenCalledWith(true);
  });
});

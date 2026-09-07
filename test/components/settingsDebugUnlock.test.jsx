import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SettingsModal from '../../src/components/SettingsModal.jsx';
import { isDebugSettingsUnlocked } from '../../src/utils/debugUnlock.js';

/**
 * Five taps on About, the build-number gesture. The count is the contract: four
 * taps must leave the page hidden, and the fifth must reveal it and remember.
 */

const nav = (name) => screen.getAllByRole('button')
  .find((button) => button.textContent.trim() === name);

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Settings debug unlock', () => {
  it('stays hidden for four taps and appears on the fifth', () => {
    render(<SettingsModal isVisible onClose={() => {}} />);

    expect(nav('Debug')).toBeUndefined();

    for (let i = 0; i < 4; i += 1) fireEvent.click(nav('About'));
    expect(nav('Debug')).toBeUndefined();
    // The countdown only starts once the run is clearly deliberate.
    expect(screen.getByText('1 more to show debug settings')).toBeTruthy();

    fireEvent.click(nav('About'));
    expect(nav('Debug')).toBeTruthy();
    expect(isDebugSettingsUnlocked()).toBe(true);
  });

  it('starts the count over if you go somewhere else', () => {
    render(<SettingsModal isVisible onClose={() => {}} />);

    for (let i = 0; i < 4; i += 1) fireEvent.click(nav('About'));
    fireEvent.click(nav('Display'));
    for (let i = 0; i < 4; i += 1) fireEvent.click(nav('About'));

    expect(nav('Debug')).toBeUndefined();
  });

  it('opens straight to Debug when it was already unlocked', () => {
    localStorage.setItem('redstring_debug_settings_unlocked', 'true');
    render(<SettingsModal isVisible onClose={() => {}} />);

    const debugNav = nav('Debug');
    expect(debugNav).toBeTruthy();
    fireEvent.click(debugNav);

    // The ported switches and the gallery are both on the page.
    expect(screen.getByText('Debug Overlay')).toBeTruthy();
    expect(screen.getByText('Force Git-Only Mode')).toBeTruthy();
    expect(screen.getByText('Universe Target Collision')).toBeTruthy();
  });

  it('hides again on request, and the section it was showing goes with it', () => {
    localStorage.setItem('redstring_debug_settings_unlocked', 'true');
    render(<SettingsModal isVisible onClose={() => {}} />);

    fireEvent.click(nav('Debug'));
    fireEvent.click(screen.getByText('Hide').closest('button'));

    expect(nav('Debug')).toBeUndefined();
    expect(isDebugSettingsUnlocked()).toBe(false);
    // Left on About rather than on a section that no longer exists.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('About');
  });
});

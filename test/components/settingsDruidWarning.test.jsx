import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DebugSection from '../../src/components/settings/DebugSection.jsx';
import debugConfig from '../../src/utils/debugConfig.js';

/**
 * The Druid is off by default, and switching it on waits for a warning that
 * it is experimental: only "Turn It On" turns it on.
 */

const druidSwitch = () => screen.getByText('The Druid').closest('.settings-row').querySelector('input[type="checkbox"]');
const warning = () => screen.queryByText('The Druid is experimental');
const button = (name) => screen.getAllByRole('button').find(b => b.textContent.trim() === name);

beforeEach(() => { localStorage.clear(); debugConfig.reset(); });
afterEach(() => { cleanup(); localStorage.clear(); debugConfig.reset(); });

describe('switching the Druid on', () => {
  it('is off by default, and asks first', () => {
    render(<DebugSection />);
    expect(debugConfig.isDruidEnabled()).toBe(false);
    expect(druidSwitch().checked).toBe(false);

    fireEvent.click(druidSwitch());
    expect(warning()).toBeTruthy();
    expect(screen.getByText('But it is pretty cool.')).toBeTruthy();
    expect(debugConfig.isDruidEnabled()).toBe(false);
  });

  it('stays off on Not Now', () => {
    render(<DebugSection />);
    fireEvent.click(druidSwitch());
    fireEvent.click(button('Not Now'));
    expect(warning()).toBeNull();
    expect(debugConfig.isDruidEnabled()).toBe(false);
    expect(druidSwitch().checked).toBe(false);
  });

  it('turns on with Turn It On, and off again without asking', () => {
    render(<DebugSection />);
    fireEvent.click(druidSwitch());
    fireEvent.click(button('Turn It On'));
    expect(warning()).toBeNull();
    expect(debugConfig.isDruidEnabled()).toBe(true);
    expect(druidSwitch().checked).toBe(true);

    fireEvent.click(druidSwitch());
    expect(warning()).toBeNull();
    expect(debugConfig.isDruidEnabled()).toBe(false);
  });
});

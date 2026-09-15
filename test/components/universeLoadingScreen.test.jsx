/**
 * The screen that holds the canvas while a universe is still arriving.
 *
 * What it replaces: a five-second timer that ended the wait on the user's
 * behalf and marked the UI loaded while the read was still running. That put
 * an empty canvas and a "create something" button in front of a universe that
 * was seconds away — and if the user accepted the invitation, the arriving
 * universe was discarded to protect their edits.
 *
 * So the two things worth pinning are that nothing decides for the user, and
 * that a fast load is not cluttered by the apparatus built for a slow one.
 */
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UniverseLoadingScreen from '../../src/components/UniverseLoadingScreen.jsx';

const advance = async (ms) => {
  await act(async () => { vi.advanceTimersByTime(ms); });
};

describe('UniverseLoadingScreen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('names the universe it is waiting on', () => {
    render(<UniverseLoadingScreen universeName="Claude's Chambers" />);
    expect(screen.getByText("Loading Claude's Chambers")).toBeTruthy();
  });

  it('falls back to generic wording when the name is not known yet', () => {
    render(<UniverseLoadingScreen />);
    expect(screen.getByText('Preparing your universe…')).toBeTruthy();
  });

  it('offers no escape hatch while the wait is still ordinary', async () => {
    render(<UniverseLoadingScreen universeName="Chloroplast" />);
    await advance(3000);
    expect(screen.queryByText('Start without it')).toBeNull();
  });

  it('offers one once waiting has gone on long enough to worry', async () => {
    render(<UniverseLoadingScreen universeName="Chloroplast" />);
    await advance(6500);
    expect(screen.getByText('Start without it')).toBeTruthy();
  });

  it('never ends the wait on its own, however long it runs', async () => {
    const onStopWaiting = vi.fn();
    render(<UniverseLoadingScreen universeName="Chloroplast" onStopWaiting={onStopWaiting} />);

    // Well past every threshold, and past the five seconds that used to decide.
    await advance(60000);

    expect(onStopWaiting).not.toHaveBeenCalled();
    expect(screen.getByText('Loading Chloroplast')).toBeTruthy();
  });

  it('ends the wait only when the user asks', async () => {
    const onStopWaiting = vi.fn();
    render(<UniverseLoadingScreen universeName="Chloroplast" onStopWaiting={onStopWaiting} />);
    await advance(6500);

    await act(async () => { screen.getByText('Start without it').click(); });
    expect(onStopWaiting).toHaveBeenCalledTimes(1);
  });

  it('tells the backend to stop waiting when no handler is supplied', async () => {
    const heard = vi.fn();
    window.addEventListener('redstring:stop-waiting-for-universe', heard);
    render(<UniverseLoadingScreen universeName="Chloroplast" />);
    await advance(6500);

    await act(async () => { screen.getByText('Start without it').click(); });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('redstring:stop-waiting-for-universe', heard);
  });

  it('says the load continues, so stopping the wait does not read as cancelling it', async () => {
    render(<UniverseLoadingScreen universeName="Chloroplast" />);
    await advance(6500);
    expect(screen.getByText('It will still load in the background.')).toBeTruthy();
  });

  it('counts the seconds once waiting is worth remarking on', async () => {
    render(<UniverseLoadingScreen universeName="Chloroplast" />);
    await advance(3000);
    expect(screen.getByText('3s')).toBeTruthy();
  });
});

/**
 * What the save indicator is allowed to claim.
 *
 * On 2026-09-13 a universe was opened, the indicator read "Syncing...", then
 * "Saved" — and a couple of seconds later 1,830 things loaded in. Nothing had
 * been written; the repository was never touched and every commit that day was
 * ~6.95 MB. The indicator had simply reached the end of a chain of conditions
 * and taken "none of these matched" to mean "a write succeeded".
 *
 * These pin the difference between those two statements.
 */
import { describe, it, expect } from 'vitest';
import { resolveSaveStatus } from '../../src/utils/saveStatus.js';

/** A universe fully loaded and settled — the only state that may say "Saved". */
const settled = { hasLoadedFromFile: true };

describe('resolveSaveStatus', () => {
  it('never says Saved before anything has been loaded', () => {
    // The exact reported state: not saving, not dirty, nothing pending, and
    // the universe not yet in.
    expect(resolveSaveStatus({ hasLoadedFromFile: false }).text).toBe('Syncing...');
  });

  it('says Saved once there is something that could have been saved', () => {
    expect(resolveSaveStatus(settled).text).toBe('Saved');
  });

  it('reports syncing while a universe load is in flight', () => {
    expect(resolveSaveStatus({ ...settled, isLoadingFromRepo: true }).text).toBe('Syncing...');
  });

  it('puts a load ahead of a Saved it would otherwise report', () => {
    // Loading beats settled: a previous universe having loaded does not make
    // the one currently arriving saved.
    const status = resolveSaveStatus({ ...settled, isLoadingFromRepo: true });
    expect(status.text).not.toBe('Saved');
  });

  it('says nothing at all during the normal debounce window', () => {
    // Not "Saving..." — that made a single edit look like a ten-second save.
    expect(resolveSaveStatus({ ...settled, hasUnsavedChanges: true }).text).toBeNull();
  });

  it('says Saving only while a write is genuinely in flight', () => {
    expect(resolveSaveStatus({ ...settled, isSaving: true }).text).toBe('Saving...');
  });

  it('surfaces a refused or failed write instead of sitting on a stale Saved', () => {
    expect(resolveSaveStatus({ ...settled, hasUnsavedChanges: true, dirtyStalled: true }).text)
      .toBe('Unsaved');
  });

  it('distinguishes git catching up from not yet saved', () => {
    expect(resolveSaveStatus({ ...settled, gitBehind: true }).text).toBe('Syncing...');
  });

  it('puts an error ahead of everything else', () => {
    expect(resolveSaveStatus({ ...settled, isInErrorBackoff: true, isSaving: true }).text).toBe('Error');
    expect(resolveSaveStatus({ ...settled, isUnhealthy: true }).text).toBe('Error');
  });

  it('reports a paused engine rather than a clean Saved', () => {
    expect(resolveSaveStatus({ ...settled, isPaused: true }).text).toBe('Paused');
  });

  it('asks for storage before claiming anything about saving', () => {
    const status = resolveSaveStatus({ ...settled, hasStorage: false });
    expect(status).toEqual({ text: 'Connect', isCTA: true });
  });

  it('reports no universe first of all', () => {
    expect(resolveSaveStatus({ hasUniverse: false, hasStorage: false }).text).toBe('No universe');
  });

  it('only ever offers a call to action for missing storage', () => {
    const states = [
      {}, settled,
      { ...settled, isSaving: true },
      { ...settled, isLoadingFromRepo: true },
      { ...settled, isInErrorBackoff: true },
      { ...settled, hasUnsavedChanges: true, dirtyStalled: true },
      { hasUniverse: false }
    ];
    for (const state of states) {
      expect(resolveSaveStatus(state).isCTA).toBe(false);
    }
  });

  it('defaults to claiming nothing when called with no information', () => {
    // An empty call means "we know nothing", and knowing nothing must never
    // render as Saved.
    expect(resolveSaveStatus().text).toBe('Syncing...');
  });
});

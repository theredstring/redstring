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
const settled = { universeReady: true };

describe('resolveSaveStatus', () => {
  it('never says Saved before anything has been loaded', () => {
    // The exact reported state: not saving, not dirty, nothing pending, and
    // the universe not yet in.
    expect(resolveSaveStatus({ universeReady: false }).text).toBe('Syncing...');
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

  it('says Saving from the edit until the write lands, like Git says Syncing', () => {
    // Local saves had no indicator at all while a write was pending, so the
    // user could not tell whether one was coming (2026-09-26).
    expect(resolveSaveStatus({ ...settled, hasUnsavedChanges: true }).text).toBe('Saving...');
    expect(resolveSaveStatus({ ...settled, isSaving: true }).text).toBe('Saving...');
  });

  it('says nothing mid-drag, when nothing is written until release', () => {
    expect(resolveSaveStatus({ ...settled, hasUnsavedChanges: true, isInteracting: true }).text).toBeNull();
  });

  it('says Not saved at once when a write is refused, with the reason and a way to act', () => {
    const status = resolveSaveStatus({
      ...settled, hasUnsavedChanges: true, blockedReason: 'Much less is here than was last saved'
    });
    expect(status).toEqual({
      text: 'Not saved', isCTA: true, action: 'universes', detail: 'Much less is here than was last saved'
    });
  });

  it('says Not saved when changes stall with no reason reported', () => {
    const status = resolveSaveStatus({ ...settled, hasUnsavedChanges: true, dirtyStalled: true });
    expect(status.text).toBe('Not saved');
    expect(status.detail).toBeTruthy();
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

  it('asks to reconnect, not "Syncing...", when a Git universe has no auth', () => {
    // The sync summary reports this as standby, which also drives
    // isLoadingFromRepo — the combination used to read "Syncing..." forever.
    const status = resolveSaveStatus({ needsGitAuth: true, isLoadingFromRepo: true, universeReady: true });
    expect(status).toEqual({ text: 'Reconnect', isCTA: true, action: 'reconnect' });
  });

  it('reports no universe first of all', () => {
    expect(resolveSaveStatus({ hasUniverse: false, hasStorage: false }).text).toBe('No universe');
  });

  it('offers a call to action only for something the user can act on', () => {
    const states = [
      {}, settled,
      { ...settled, isSaving: true },
      { ...settled, hasUnsavedChanges: true },
      { ...settled, isLoadingFromRepo: true },
      { ...settled, isInErrorBackoff: true },
      { hasUniverse: false }
    ];
    for (const state of states) {
      expect(resolveSaveStatus(state).isCTA).toBe(false);
    }
  });

  it('clears once the universe is in, even if nothing has flowed through the coordinator', () => {
    // The regression this replaced: gating on SaveCoordinator's own
    // `hasLoadedFromFile`, which only flips when a change passes through it.
    // A universe that loaded and then sat idle never set it, so the indicator
    // stuck on "Syncing..." forever — the same mistake as the false "Saved",
    // pointing the other way.
    expect(resolveSaveStatus({ universeReady: true }).text).toBe('Saved');
  });

  it('defaults to claiming nothing when called with no information', () => {
    // An empty call means "we know nothing", and knowing nothing must never
    // render as Saved.
    expect(resolveSaveStatus().text).toBe('Syncing...');
  });
});

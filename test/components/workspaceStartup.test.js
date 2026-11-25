import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startSelectUniverse } from '../../src/components/canvas/hosts/workspaceStartup.js';

/**
 * iOS and Android always report SELECT_UNIVERSE once onboarded (the app's own
 * Universes/ folder, no activeUniverse in its config). A universe already in
 * the backend's registry must open like desktop, not on the Universes tab.
 */

const makeDeps = (activeUniverse) => {
  const storeActions = {
    setStorageMode: vi.fn(),
    setUniverseConnected: vi.fn(),
    setUniverseLoaded: vi.fn(),
    setLeftPanelExpanded: vi.fn(),
  };
  return {
    storeActions,
    openLeftPanelView: vi.fn(),
    setShowStorageSetupModal: vi.fn(),
    getActiveUniverse: vi.fn(async () => activeUniverse),
  };
};

describe('startSelectUniverse', () => {
  beforeEach(() => localStorage.clear());

  it('leaves a universe the backend will reopen alone: no Universes tab, no empty canvas', async () => {
    const deps = makeDeps({ slug: 'atlas', name: 'Atlas' });
    const result = await startSelectUniverse(deps);

    expect(result).toEqual({ openedUniverses: false });
    expect(deps.openLeftPanelView).not.toHaveBeenCalled();
    expect(deps.storeActions.setLeftPanelExpanded).not.toHaveBeenCalled();
    expect(deps.storeActions.setUniverseLoaded).not.toHaveBeenCalled();
    expect(deps.storeActions.setStorageMode).toHaveBeenCalledWith('folder');
    expect(deps.setShowStorageSetupModal).toHaveBeenCalledWith(false);
  });

  it('opens the Universes grid when there is nothing to reopen', async () => {
    const deps = makeDeps(null);
    const result = await startSelectUniverse(deps);

    expect(result).toEqual({ openedUniverses: true });
    expect(deps.storeActions.setUniverseLoaded).toHaveBeenCalledWith(true, false);
    expect(deps.storeActions.setLeftPanelExpanded).toHaveBeenCalledWith(true);
    expect(deps.openLeftPanelView).toHaveBeenCalledWith('federation');
  });

  it('treats a failed lookup as nothing to reopen', async () => {
    const deps = makeDeps(null);
    deps.getActiveUniverse = vi.fn(async () => { throw new Error('backend unavailable'); });
    const result = await startSelectUniverse(deps);

    expect(result).toEqual({ openedUniverses: true });
    expect(deps.openLeftPanelView).toHaveBeenCalledWith('federation');
  });

  it('marks onboarding as seen either way', async () => {
    await startSelectUniverse(makeDeps({ slug: 'atlas' }));
    const seen = Object.keys(localStorage).some(k => k.endsWith('redstring-welcome-seen') && localStorage.getItem(k) === 'true');
    expect(seen).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * iOS and Android always have a workspace folder: the app's own Universes/.
 * A fresh install (or one deleted and installed again) must still be sent to
 * onboarding, not to an empty Universes grid that marks onboarding as seen.
 */

const folder = 'capacitor://Documents/Universes';
const env = { capacitor: true, files: [], config: null };

vi.mock('../../src/utils/capacitorAdapter.js', () => ({
  isCapacitor: () => env.capacitor,
  capListFiles: async () => env.files,
}));
vi.mock('../../src/services/folderPersistence.js', () => ({
  validateStoredFolder: async () => ({ valid: true, folderHandle: folder }),
  storeFolderHandle: async () => {},
}));
vi.mock('../../src/utils/fileAccessAdapter.js', () => ({
  isElectron: () => false,
  validateFolderAccess: async () => true,
  getFileInFolder: async () => {
    if (!env.config) throw new Error('not found');
    return 'config-handle';
  },
  readFile: async () => JSON.stringify(env.config),
  writeFile: async () => {},
}));

const { workspaceService } = await import('../../src/services/WorkspaceService.js');

describe('WorkspaceService.initialize on iOS and Android', () => {
  beforeEach(() => {
    Object.assign(env, { capacitor: true, files: [], config: null });
    workspaceService.config = null;
    workspaceService.folderHandle = null;
  });

  it('sends a fresh install to onboarding', async () => {
    expect(await workspaceService.initialize()).toEqual({ status: 'NEEDS_ONBOARDING' });
  });

  it('opens the grid when universes are already on the device', async () => {
    env.files = [{ name: 'Atlas.redstring', handle: `${folder}/Atlas.redstring`, kind: 'file' }];
    expect(await workspaceService.initialize()).toEqual({ status: 'SELECT_UNIVERSE' });
  });

  it('opens the active universe when the config names one', async () => {
    env.config = { activeUniverse: 'Atlas' };
    expect(await workspaceService.initialize()).toEqual({ status: 'READY', activeUniverse: 'Atlas' });
  });

  it('leaves a folder someone picked alone: an empty one is still the grid', async () => {
    env.capacitor = false;
    expect(await workspaceService.initialize()).toEqual({ status: 'SELECT_UNIVERSE' });
  });
});

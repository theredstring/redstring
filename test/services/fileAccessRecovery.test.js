import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * readFileAccess must never ask, and grantFileAccess must ask for the folder
 * before the file: a grant on the folder covers the files inside it, which is
 * what keeps this to one browser prompt for a universe in the workspace.
 */

const calls = [];
const perms = { folder: 'prompt', file: 'prompt' };

const makeHandle = (key, name) => ({
  name,
  kind: key === 'folder' ? 'directory' : 'file',
  queryPermission: async () => perms[key],
  requestPermission: async () => {
    calls.push(`request:${key}`);
    perms[key] = 'granted';
    // Chrome extends a folder grant to the files inside it.
    if (key === 'folder') perms.file = 'granted';
    return perms[key];
  }
});

const folderHandle = makeHandle('folder', 'Redstring');
const fileHandle = makeHandle('file', 'nerd.redstring');

const universe = {
  slug: 'nerd',
  name: 'Nerd',
  sourceOfTruth: 'local',
  localFile: { enabled: true, fileName: 'nerd.redstring', fileHandleStatus: 'permission_needed' }
};

const backend = {
  fileHandles: new Map([['nerd', fileHandle]]),
  getActiveUniverse: () => universe,
  reconnectFromWorkspaceFolder: vi.fn(async () => { calls.push('reconnect:folder'); }),
  ensureLocalFileHandle: vi.fn(async () => { calls.push('reconnect:file'); })
};

vi.mock('../../src/services/universeBackend.js', () => ({ default: backend }));
vi.mock('../../src/services/workspaceFolderService.js', () => ({
  getWorkspaceHandle: async () => folderHandle,
  checkWorkspacePermission: async () => perms.folder,
  requestWorkspacePermission: async () => folderHandle.requestPermission()
}));
vi.mock('../../src/services/fileHandlePersistence.js', () => ({
  checkFileHandlePermission: async (h) => h.queryPermission(),
  requestFileHandlePermission: async (h) => h.requestPermission(),
  getFileHandleMetadata: async () => null
}));

const {
  readFileAccess,
  grantFileAccess,
  fileAccessNeeded,
  activeLoadBlockedByFileAccess
} = await import('../../src/services/fileAccessRecovery.js');

beforeEach(() => {
  calls.length = 0;
  perms.folder = 'prompt';
  perms.file = 'prompt';
});

describe('fileAccessRecovery', () => {
  it('reads what is locked without asking for anything', async () => {
    const access = await readFileAccess();
    expect(access.folder).toEqual({ name: 'Redstring', state: 'prompt' });
    expect(access.file).toMatchObject({ name: 'nerd.redstring', state: 'prompt', isSourceOfTruth: true });
    expect(fileAccessNeeded(access)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('asks for the folder first, and skips the file the folder already covered', async () => {
    const after = await grantFileAccess();
    expect(calls).toEqual(['request:folder', 'reconnect:folder']);
    expect(fileAccessNeeded(after)).toBe(false);
  });

  it('asks for the file itself when there is no folder to cover it', async () => {
    perms.folder = 'granted';
    await grantFileAccess();
    expect(calls).toEqual(['request:file', 'reconnect:folder']);
  });

  it('treats a locked local-first file as the reason the load failed', async () => {
    expect(await activeLoadBlockedByFileAccess()).toBe(true);
  });
});

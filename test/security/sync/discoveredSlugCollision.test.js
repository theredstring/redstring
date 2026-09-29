/**
 * S-76: linking a discovered universe whose slug collides with an existing
 * local universe must not rewrite that universe's gitRepo (which would aim
 * its saves at someone else's file). Only a true relink — same repo, same
 * file — updates in place; anything else gets a fresh slug.
 *
 * Runs on a bare prototype instance so the singleton never boots.
 */
import { describe, it, expect, vi } from 'vitest';
import { universeBackend, isSameGitTarget } from '../../../src/services/universeBackend.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const makeBackend = (entries) => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.isInitialized = true;
  backend.universes = new Map(entries);
  backend.gitSyncEngines = new Map();
  backend.notifyStatus = () => {};
  backend.saveToStorage = vi.fn();
  backend.safeNormalizeUniverse = (u) => u;
  backend.ensureGitSyncEngine = vi.fn().mockResolvedValue(undefined);
  backend.removeGitSyncEngine = vi.fn().mockResolvedValue(undefined);
  return backend;
};

const discovered = {
  slug: 'ideas',
  name: 'ideas',
  fileName: 'ideas.redstring',
  path: 'universes/ideas/ideas.redstring',
  metadata: {}
};
const repoConfig = { type: 'github', user: 'someone-else', repo: 'notes', authMethod: 'oauth' };

describe('isSameGitTarget', () => {
  const git = (linkedRepo, universeFolder, universeFile) => ({ linkedRepo, universeFolder, universeFile });

  it('matches only same repo and same file', () => {
    expect(isSameGitTarget(git({ user: 'A', repo: 'R' }, 'ideas', 'ideas.redstring'), git('a/r', 'ideas', 'ideas.redstring'))).toBe(true);
    expect(isSameGitTarget(git({ user: 'a', repo: 'r' }, 'ideas', 'ideas.redstring'), git({ user: 'b', repo: 'r' }, 'ideas', 'ideas.redstring'))).toBe(false);
    expect(isSameGitTarget(git({ user: 'a', repo: 'r' }, 'ideas', 'ideas.redstring'), git({ user: 'a', repo: 'r' }, 'other', 'ideas.redstring'))).toBe(false);
    expect(isSameGitTarget(null, git({ user: 'a', repo: 'r' }, 'ideas', 'ideas.redstring'))).toBe(false);
    expect(isSameGitTarget(git(null, '', ''), git(null, '', ''))).toBe(false);
  });
});

describe('linkToDiscoveredUniverse slug collision', () => {
  it('gives a colliding discovered universe its own slug and leaves the local one untouched', async () => {
    const local = {
      slug: 'ideas',
      name: 'My local ideas',
      sourceOfTruth: 'local',
      localFile: { enabled: true, path: '/Users/me/ideas.redstring' },
      gitRepo: { enabled: false, linkedRepo: null }
    };
    const backend = makeBackend([['ideas', local]]);

    const slug = await backend.linkToDiscoveredUniverse(discovered, repoConfig);

    expect(slug).not.toBe('ideas');
    expect(backend.universes.get('ideas')).toBe(local);
    expect(local.gitRepo.linkedRepo).toBeNull();
    expect(backend.universes.get(slug).gitRepo.linkedRepo).toMatchObject({ user: 'someone-else', repo: 'notes' });
  });

  it('a universe linked to a DIFFERENT repo is not relinked either', async () => {
    const other = {
      slug: 'ideas',
      name: 'ideas',
      gitRepo: { enabled: true, linkedRepo: { user: 'me', repo: 'mine' }, universeFolder: 'ideas', universeFile: 'ideas.redstring' }
    };
    const backend = makeBackend([['ideas', other]]);
    const slug = await backend.linkToDiscoveredUniverse(discovered, repoConfig);
    expect(slug).not.toBe('ideas');
    expect(backend.universes.get('ideas').gitRepo.linkedRepo).toEqual({ user: 'me', repo: 'mine' });
  });

  it('a true relink (same repo and file) still updates in place', async () => {
    const same = {
      slug: 'ideas',
      name: 'ideas',
      gitRepo: { enabled: true, linkedRepo: { user: 'someone-else', repo: 'notes' }, universeFolder: 'ideas', universeFile: 'ideas.redstring' }
    };
    const backend = makeBackend([['ideas', same]]);
    const slug = await backend.linkToDiscoveredUniverse(discovered, repoConfig);
    expect(slug).toBe('ideas');
    expect(backend.universes.size).toBe(1);
  });
});

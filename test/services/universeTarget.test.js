import { describe, it, expect } from 'vitest';
import {
  universeTargetKey,
  gitUniversePath,
  findTargetCollisions,
  resolveUniqueUniverseFolder
} from '../../src/services/universeTarget.js';

const REPO = { type: 'github', user: 'grantiguess', repo: 'Ontologies' };

const gitUniverse = (slug, folder, file = `${folder}.redstring`) => ({
  slug,
  name: slug,
  sourceOfTruth: 'git',
  gitRepo: { enabled: true, linkedRepo: REPO, universeFolder: folder, universeFile: file }
});

describe('gitUniversePath', () => {
  it('matches the path the engine actually writes', () => {
    expect(gitUniversePath('ii', 'ii.redstring')).toBe('universes/ii/ii.redstring');
  });

  it('collapses a raw file name onto its sanitized form', () => {
    // The engine writes the sanitized name. If the key used the raw one, the
    // same file would look like two targets and the collision check would miss.
    expect(gitUniversePath('ii', 'My Universe.redstring'))
      .toBe(gitUniversePath('ii', 'My-Universe'));
  });
});

describe('universeTargetKey', () => {
  it('gives two universes on one repo folder the SAME key', () => {
    // This is the 2026-09-06 wipe in one assertion: slug dedup produced ii-2,
    // but both universes wrote universes/ii/ii.redstring.
    const ii = gitUniverse('ii', 'ii');
    const nerd = { ...gitUniverse('ii-2', 'ii'), name: 'Nerd' };
    expect(universeTargetKey(nerd)).toBe(universeTargetKey(ii));
  });

  it('separates universes in different folders or different repos', () => {
    expect(universeTargetKey(gitUniverse('a', 'a')))
      .not.toBe(universeTargetKey(gitUniverse('b', 'b')));

    const otherRepo = {
      ...gitUniverse('a', 'a'),
      gitRepo: { enabled: true, linkedRepo: { user: 'grantiguess', repo: 'Other' }, universeFolder: 'a', universeFile: 'a.redstring' }
    };
    expect(universeTargetKey(otherRepo)).not.toBe(universeTargetKey(gitUniverse('a', 'a')));
  });

  it('normalizes local paths', () => {
    const a = { slug: 'a', localFile: { enabled: true, path: './Docs/Universe.redstring' } };
    const b = { slug: 'b', localFile: { enabled: true, path: 'Docs\\universe.redstring' } };
    expect(universeTargetKey(a)).toBe(universeTargetKey(b));
  });

  it('accepts the legacy "user/repo" linkedRepo string', () => {
    const legacy = {
      slug: 'ii-2',
      gitRepo: { enabled: true, linkedRepo: 'grantiguess/Ontologies', universeFolder: 'ii', universeFile: 'ii.redstring' }
    };
    expect(universeTargetKey(legacy)).toBe(universeTargetKey(gitUniverse('ii', 'ii')));
  });

  it('returns null for a universe that writes nowhere', () => {
    expect(universeTargetKey({ slug: 'a' })).toBeNull();
    expect(universeTargetKey({ slug: 'a', gitRepo: { enabled: false, linkedRepo: REPO } })).toBeNull();
  });
});

describe('findTargetCollisions', () => {
  it('reports only targets claimed more than once', () => {
    const collisions = findTargetCollisions([
      gitUniverse('ii', 'ii'),
      { ...gitUniverse('ii-2', 'ii'), name: 'Nerd' },
      gitUniverse('777', '777'),
    ]);

    expect(collisions.size).toBe(1);
    expect([...collisions.values()][0].sort()).toEqual(['ii', 'ii-2']);
  });

  it('is empty when every universe writes its own file', () => {
    expect(findTargetCollisions([gitUniverse('a', 'a'), gitUniverse('b', 'b')]).size).toBe(0);
  });
});

describe('resolveUniqueUniverseFolder', () => {
  const existing = [gitUniverse('ii', 'ii'), gitUniverse('ii-2', 'ii-2')];

  it('keeps the requested folder when it is free', () => {
    expect(resolveUniqueUniverseFolder({
      folder: 'fresh', file: 'fresh.redstring', linkedRepo: REPO, existingUniverses: existing
    })).toBe('fresh');
  });

  it('suffixes past every folder already claimed', () => {
    expect(resolveUniqueUniverseFolder({
      folder: 'ii', file: 'ii.redstring', linkedRepo: REPO, existingUniverses: existing
    })).toBe('ii-3');
  });

  it('lets a universe keep the folder it already owns', () => {
    // Re-linking an existing universe must be idempotent, not walk it to ii-3.
    expect(resolveUniqueUniverseFolder({
      folder: 'ii', file: 'ii.redstring', linkedRepo: REPO, existingUniverses: existing, selfSlug: 'ii'
    })).toBe('ii');
  });

  it('ignores a same-named folder in a different repo', () => {
    expect(resolveUniqueUniverseFolder({
      folder: 'ii',
      file: 'ii.redstring',
      linkedRepo: { user: 'grantiguess', repo: 'Other' },
      existingUniverses: existing
    })).toBe('ii');
  });
});

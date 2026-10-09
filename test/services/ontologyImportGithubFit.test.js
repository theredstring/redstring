/**
 * Whether an ontology import fits a universe synced to GitHub, which carries
 * files up to 50 MB.
 */
import { describe, it, expect } from 'vitest';
import { githubFit, estimateUniverseBytes, estimateImportBytes } from '../../src/services/ontologyImport.js';
import { GIT_WRITE_CAP_BYTES } from '../../src/services/gitSyncEngine.js';

const MB = 1024 * 1024;
const repoOnly = { gitLinked: true, hasLocalFile: false, heldBytes: 0 };
const fileAndRepo = { gitLinked: true, hasLocalFile: true, heldBytes: 0 };
const fileOnly = { gitLinked: false, hasLocalFile: true, heldBytes: 0 };

describe('githubFit', () => {
  it('measures against the limit Git sync enforces', () => {
    expect(githubFit(repoOnly, 0, 1).limit).toBe(GIT_WRITE_CAP_BYTES);
  });

  it('refuses an import that alone is over the limit, whatever the universe', () => {
    expect(githubFit(repoOnly, 0, 60 * MB).verdict).toBe('refuse');
    expect(githubFit(fileAndRepo, 0, 60 * MB).verdict).toBe('refuse');
  });

  it('blocks a universe kept only in the repository from going over', () => {
    expect(githubFit(repoOnly, 30 * MB, 25 * MB).verdict).toBe('block');
  });

  it('warns a universe with a file, which keeps everything', () => {
    expect(githubFit(fileAndRepo, 30 * MB, 25 * MB).verdict).toBe('warn');
  });

  it('lets a universe under the limit, or not on GitHub, through', () => {
    expect(githubFit(repoOnly, 10 * MB, 10 * MB).verdict).toBe('ok');
    expect(githubFit(fileOnly, 0, 400 * MB).verdict).toBe('ok');
  });

  it('counts a universe Git already refused as at least that size', () => {
    const held = { ...repoOnly, heldBytes: 52 * MB };
    const fit = githubFit(held, 1 * MB, 1 * MB);
    expect(fit.verdict).toBe('block');
    expect(fit.totalBytes).toBe(53 * MB);
  });
});

describe('size estimates', () => {
  it('estimates a universe from what is in the store', () => {
    const graphs = new Map([['g', { instances: new Map([['i1', {}], ['i2', {}]]) }]]);
    const state = { nodePrototypes: new Map([['a', {}], ['b', {}]]), graphs, edges: new Map([['e', {}]]) };
    expect(estimateUniverseBytes(state)).toBe(2 * 2000 + 2 * 950 + 1 * 950 + 1 * 850);
  });

  it('estimates an import from its preview', () => {
    expect(estimateImportBytes({ things: 10, placements: 20, compositionWebs: 1, connectionsWebs: 1, kindsWebs: 0, connections: 5 }))
      .toBe(10 * 2000 + 20 * 950 + 3 * 950 + 5 * 850);
  });
});

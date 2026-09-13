import { describe, it, expect } from 'vitest';
import {
  BASE_PROTOTYPE_IDS,
  countUserPrototypes,
  countGraphs,
  isEffectivelyEmpty,
  isRecognizedShape,
  userDataCounts
} from '../../src/formats/userDataCounts.js';

const baseOnlyMap = () => new Map([
  ['base-thing-prototype', { id: 'base-thing-prototype', name: 'Thing' }],
  ['base-connection-prototype', { id: 'base-connection-prototype', name: 'Connection' }]
]);

// The exact GitHub contents-API envelope that was imported as a universe on 2026-09-12.
const ENVELOPE = {
  name: 'claude-s-chambers-2.redstring',
  path: 'universes/claude-s-chambers-2/claude-s-chambers-2.redstring',
  sha: 'd2e961555ac8180c4e4332de0d453ec29c47184d',
  size: 6916496,
  url: 'https://api.github.com/repos/x/y/contents/z?ref=main',
  html_url: 'https://github.com/x/y/blob/main/z',
  git_url: 'https://api.github.com/repos/x/y/git/blobs/d2e9',
  download_url: 'https://raw.githubusercontent.com/x/y/main/z?token=abc',
  type: 'file',
  content: '',
  encoding: 'none',
  _links: { self: '', git: '', html: '' }
};

describe('userDataCounts', () => {
  it('exports the seeded base prototype ids', () => {
    expect(BASE_PROTOTYPE_IDS.has('base-thing-prototype')).toBe(true);
    expect(BASE_PROTOTYPE_IDS.has('base-connection-prototype')).toBe(true);
  });

  it('a store holding only the seeded base prototypes has zero user prototypes', () => {
    const state = { nodePrototypes: baseOnlyMap(), graphs: new Map() };
    expect(countUserPrototypes(state)).toBe(0);
    expect(isEffectivelyEmpty(state)).toBe(true);
    expect(isRecognizedShape(state)).toBe(true);
  });

  it('counts user prototypes in a Map store and ignores base ones', () => {
    const np = baseOnlyMap();
    np.set('a', { id: 'a' });
    np.set('b', { id: 'b' });
    expect(countUserPrototypes({ nodePrototypes: np })).toBe(2);
    expect(isEffectivelyEmpty({ nodePrototypes: np })).toBe(false);
  });

  it('handles plain-object stores', () => {
    const state = {
      nodePrototypes: { 'base-thing-prototype': {}, a: {}, b: {}, c: {} },
      graphs: { g1: {}, g2: {} }
    };
    expect(userDataCounts(state)).toEqual({ nodes: 3, graphs: 2, recognized: true });
  });

  it('handles array-shaped collections (v1 flat `nodes`)', () => {
    const doc = { nodes: [{ id: 'base-thing-prototype' }, { id: 'x' }, { id: 'y' }], graphs: [{ id: 'g' }] };
    expect(countUserPrototypes(doc)).toBe(2);
    expect(countGraphs(doc)).toBe(1);
  });

  it('reads v4 prototypeSpace / spatialGraphs documents', () => {
    const doc = {
      format: 'redstring-v4.1.0',
      prototypeSpace: { prototypes: { 'base-thing-prototype': {}, p1: {} } },
      spatialGraphs: { graphs: { g1: {} } }
    };
    expect(userDataCounts(doc)).toEqual({ nodes: 1, graphs: 1, recognized: true });
  });

  it('reads v3 legacy documents', () => {
    const doc = { format: 'redstring-v3.0.0', legacy: { nodePrototypes: { p1: {}, p2: {} }, graphs: {} } };
    expect(countUserPrototypes(doc)).toBe(2);
    expect(countGraphs(doc)).toBe(0);
    expect(isRecognizedShape(doc)).toBe(true);
  });

  it('unwraps { storeState } debug dumps', () => {
    const wrapped = { storeState: { nodePrototypes: new Map([['a', {}]]), graphs: new Map() } };
    expect(countUserPrototypes(wrapped)).toBe(1);
  });

  it('an empty v4 document with sections is recognized and empty', () => {
    const doc = { prototypeSpace: { prototypes: {} }, spatialGraphs: { graphs: {} } };
    expect(isRecognizedShape(doc)).toBe(true);
    expect(isEffectivelyEmpty(doc)).toBe(true);
  });

  it('the contents-API envelope is NOT a recognized shape', () => {
    expect(isRecognizedShape(ENVELOPE)).toBe(false);
    expect(userDataCounts(ENVELOPE)).toEqual({ nodes: 0, graphs: 0, recognized: false });
  });

  it('null, primitives and arrays are not recognized and count as zero', () => {
    for (const value of [null, undefined, 42, 'x', [], {}]) {
      expect(isRecognizedShape(value)).toBe(false);
      expect(countUserPrototypes(value)).toBe(0);
      expect(countGraphs(value)).toBe(0);
    }
  });

  it('webs without things are still effectively empty', () => {
    const state = { nodePrototypes: baseOnlyMap(), graphs: new Map([['g', {}]]) };
    expect(isEffectivelyEmpty(state)).toBe(true);
    expect(countGraphs(state)).toBe(1);
  });
});

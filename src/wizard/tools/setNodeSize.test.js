/**
 * Tests for setNodeSize tool and the shared node-size vocabulary
 */
import { describe, it, expect } from 'vitest';
import { setNodeSize } from './setNodeSize.js';
import { resolveNodeSize, nodeSizeMul, NODE_SIZE_NAMES } from './utils/nodeSize.js';

const baseState = {
  nodePrototypes: [
    { id: 'proto-galaxy', name: 'Galaxy' },
    { id: 'proto-asteroid', name: 'Asteroid' }
  ],
  graphs: [
    {
      id: 'graph-1',
      name: 'Cosmos',
      instances: [
        { id: 'inst-galaxy', prototypeId: 'proto-galaxy' },
        { id: 'inst-asteroid', prototypeId: 'proto-asteroid' }
      ],
      edgeIds: []
    }
  ],
  activeGraphId: 'graph-1'
};

describe('resolveNodeSize', () => {
  it('resolves every canonical name to a positive multiplier', () => {
    const muls = NODE_SIZE_NAMES.map(n => resolveNodeSize(n).multiplier);
    expect(muls).toEqual([0.5, 0.75, 1.0, 1.5, 2.0]);
  });

  it('accepts aliases and loose spellings', () => {
    expect(resolveNodeSize('XL').name).toBe('extra-large');
    expect(resolveNodeSize('Extra Large').name).toBe('extra-large');
    expect(resolveNodeSize('extra_small').name).toBe('extra-small');
    expect(resolveNodeSize('  Big ').name).toBe('large');
  });

  it('returns null for unrecognized words', () => {
    expect(resolveNodeSize('gigantic')).toBe(null);
    expect(resolveNodeSize('')).toBe(null);
    expect(resolveNodeSize(undefined)).toBe(null);
  });

  it('snaps a raw multiplier to the nearest step', () => {
    expect(resolveNodeSize(1.9).name).toBe('extra-large');
    expect(resolveNodeSize(0.7).name).toBe('small');
    expect(resolveNodeSize(0.6).name).toBe('extra-small'); // 0.6 is nearer 0.5 than 0.75
  });
});

describe('nodeSizeMul', () => {
  it('is undefined at the default so specs stay clean', () => {
    expect(nodeSizeMul(undefined)).toBeUndefined();
    expect(nodeSizeMul('medium')).toBeUndefined();
    expect(nodeSizeMul('default')).toBeUndefined();
  });

  it('never throws on a typo — falls back to the default', () => {
    expect(nodeSizeMul('ginormous')).toBeUndefined();
  });

  it('returns the multiplier for a real deviation', () => {
    expect(nodeSizeMul('large')).toBe(1.5);
    expect(nodeSizeMul('extra-small')).toBe(0.5);
  });
});

describe('setNodeSize', () => {
  it('resolves the instance and returns the multiplier', async () => {
    const result = await setNodeSize(
      { nodeName: 'Galaxy', size: 'extra-large' },
      baseState
    );
    expect(result.action).toBe('setNodeSize');
    expect(result.graphId).toBe('graph-1');
    expect(result.instanceId).toBe('inst-galaxy');
    expect(result.size).toBe('extra-large');
    expect(result.sizeMul).toBe(2.0);
  });

  it('treats medium as a real (restoring) size, not a no-op', async () => {
    const result = await setNodeSize(
      { nodeName: 'Asteroid', size: 'medium' },
      baseState
    );
    expect(result.sizeMul).toBe(1.0);
    expect(result.size).toBe('medium');
  });

  it('throws on missing nodeName', async () => {
    await expect(setNodeSize({ size: 'large' }, baseState)).rejects.toThrow('nodeName is required');
  });

  it('throws a self-correctable error on an unknown size', async () => {
    await expect(
      setNodeSize({ nodeName: 'Galaxy', size: 'gigantic' }, baseState)
    ).rejects.toThrow(/Unknown size "gigantic"/);
  });

  it('still returns an action when the node is absent from graphState (client resolves by name)', async () => {
    const result = await setNodeSize(
      { nodeName: 'Comet', size: 'small' },
      baseState
    );
    expect(result.action).toBe('setNodeSize');
    expect(result.instanceId).toBe(null);
    expect(result.nodeName).toBe('Comet');
  });
});

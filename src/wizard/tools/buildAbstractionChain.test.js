/**
 * Tests for buildAbstractionChain — the one-call ladder builder.
 */
import { describe, it, expect } from 'vitest';
import { buildAbstractionChain } from './buildAbstractionChain.js';

const state = () => ({
  nodePrototypes: [
    { id: 'proto-bunge', name: 'Bunge & Born', color: '#8B0000', abstractionChains: {} },
    { id: 'proto-merchants', name: 'Merchants' },
    { id: 'proto-town', name: 'Company Town' },
    { id: 'proto-org', name: 'Organization' }
  ]
});

describe('buildAbstractionChain', () => {
  it('lays down a whole ladder in one call, ordered nearest-first', async () => {
    const result = await buildAbstractionChain({
      nodeName: 'Bunge & Born',
      dimension: 'Generalization Axis',
      moreGeneric: ['Trading House', 'Company', 'Organization']
    }, state());

    expect(result.action).toBe('buildAbstractionChain');
    expect(result.nodeId).toBe('proto-bunge');
    expect(result.levels.map((l) => l.name)).toEqual(['Trading House', 'Company', 'Organization']);
    expect(result.levels.every((l) => l.direction === 'below')).toBe(true);
    // Levels climb away from the anchor so the applier can chain each to the last.
    expect(result.levels.map((l) => l.level)).toEqual([1, 2, 3]);
  });

  it('reuses an existing node across a plural difference', async () => {
    const result = await buildAbstractionChain({
      nodeName: 'Bunge & Born',
      dimension: 'Generalization Axis',
      moreGeneric: ['Merchant']
    }, state());

    // "Merchants" already exists — a plural is not a different category, so this
    // must reuse it rather than minting a near-duplicate "Merchant".
    expect(result.levels[0].existingId).toBe('proto-merchants');
    expect(result.levels[0].create).toBeNull();
  });

  it('does not reuse a node that merely shares a word', async () => {
    const result = await buildAbstractionChain({
      nodeName: 'Bunge & Born',
      dimension: 'Generalization Axis',
      moreGeneric: ['Company']
    }, state());

    // "Company Town" is not the category "Company".
    expect(result.levels[0].existingId).toBeNull();
    expect(result.levels[0].create.name).toBe('Company');
  });

  it('colors created rungs the way the carousel shades them', async () => {
    const result = await buildAbstractionChain({
      nodeName: 'Bunge & Born',
      dimension: 'Generalization Axis',
      moreGeneric: ['Trading House', 'Company']
    }, state());

    const [near, far] = result.levels;
    expect(near.create.color).toBeTruthy();
    // More generic reads darker, and keeps darkening with distance.
    expect(far.create.color).not.toBe(near.create.color);
  });

  it('accepts entries carrying a description', async () => {
    const result = await buildAbstractionChain({
      nodeName: 'Bunge & Born',
      dimension: 'Generalization Axis',
      moreGeneric: [{ name: 'Trading House', description: 'A firm dealing in commodities.' }]
    }, state());

    expect(result.levels[0].create.description).toBe('A firm dealing in commodities.');
  });

  it('places moreSpecific rungs on the narrow side', async () => {
    const result = await buildAbstractionChain({
      nodeName: 'Bunge & Born',
      dimension: 'Generalization Axis',
      moreGeneric: ['Company'],
      moreSpecific: ['Bunge Argentina']
    }, state());

    const specific = result.levels.find((l) => l.name === 'Bunge Argentina');
    expect(specific.direction).toBe('above');
    expect(specific.level).toBe(-1);
  });

  it('writes to the node that already owns the chain, not the anchor', async () => {
    const s = state();
    s.nodePrototypes.push({
      id: 'proto-owner',
      name: 'Grain Trader',
      abstractionChains: { 'Generalization Axis': ['proto-bunge', 'proto-owner'] }
    });

    const result = await buildAbstractionChain({
      nodeName: 'Bunge & Born',
      dimension: 'Generalization Axis',
      moreGeneric: ['Company']
    }, s);

    // Writing to the anchor would start a second, competing chain.
    expect(result.nodeId).toBe('proto-owner');
    expect(result.anchorId).toBe('proto-bunge');
  });

  it('requires at least one rung', async () => {
    await expect(
      buildAbstractionChain({ nodeName: 'Bunge & Born', dimension: 'Generalization Axis' }, state())
    ).rejects.toThrow(/at least one level/);
  });

  it('requires nodeName and dimension', async () => {
    await expect(buildAbstractionChain({}, state())).rejects.toThrow('nodeName is required');
    await expect(
      buildAbstractionChain({ nodeName: 'Bunge & Born' }, state())
    ).rejects.toThrow('dimension is required');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { THING_PROTOTYPE_ID, DEFAULT_ABSTRACTION_DIMENSION } from '../tools/utils/abstractionSpec.js';

// "Jotunheim" typed as "Realm". Nothing has ever been edited by hand, so
// resolveChain synthesizes the seeded chain [Jotunheim, Realm, Thing] — which is
// what the carousel puts on screen.
const nodePrototypes = new Map([
  ['p-jotun', { id: 'p-jotun', name: 'Jotunheim', description: 'Land of the giants', typeNodeId: 'p-realm' }],
  ['p-realm', { id: 'p-realm', name: 'Realm', description: 'One of the nine worlds' }],
  [THING_PROTOTYPE_ID, { id: THING_PROTOTYPE_ID, name: 'Thing' }]
]);

const state = {
  activeGraphId: 'g-1',
  graphs: new Map([['g-1', { id: 'g-1', name: 'Norse Cosmology', instances: new Map(), edgeIds: [], edges: [] }]]),
  nodePrototypes,
  edges: new Map()
};

vi.mock('../../store/graphStore.js', () => ({ default: { getState: () => state } }));

const { buildWizardAbstractionPrompt } = await import('./ladderPrompt.js');

const build = () => buildWizardAbstractionPrompt(
  nodePrototypes.get('p-jotun'),
  DEFAULT_ABSTRACTION_DIMENSION,
  {}
).message;

describe('the ladder prompt shows the chain the carousel is showing', () => {
  it('renders a seeded chain instead of claiming there is none', () => {
    // The bug: a synthesized chain was nulled out, so the prompt said "there is no
    // chain yet" while the user watched a carousel holding the node, its type and
    // Thing. The model built from scratch and re-added the type, doubling it.
    const msg = build();
    expect(msg).not.toContain('There is no "Generalization Axis" chain yet');
    expect(msg).toContain('the carousel is showing right now');
  });

  it('lists the type and the Thing floor as rungs that already exist', () => {
    const msg = build();
    expect(msg).toMatch(/\+1: "Realm"/);
    expect(msg).toMatch(/\+2: "Thing"/);
    expect(msg).toContain('the base Thing, the floor of every ladder');
  });

  it('says plainly that re-listing a rung duplicates it', () => {
    const msg = build();
    expect(msg).toContain('EVERY rung listed above already exists on this chain');
    expect(msg).toContain('do not re-add the type');
  });

  it('marks the type ladder as already on the chain rather than urging it on', () => {
    const msg = build();
    expect(msg).toContain('[ALREADY ON THE CHAIN]');
    // The old line told the model in as many words to add the very rung the
    // seeded chain already had.
    expect(msg).not.toContain('Strongly prefer putting THESE on the chain');
    expect(msg).toContain('adding them again would duplicate them');
  });

  it('still names the chain owner so a second competing chain is not started', () => {
    expect(build()).toContain('owned by the node "Jotunheim"');
  });
});

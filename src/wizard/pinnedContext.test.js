import { describe, it, expect } from 'vitest';
import { buildPinnedContext, buildPersistentContextHeader, PINNED_CONTEXT_TOKEN_BUDGET } from './ContextBuilder.js';
import { estimateTokens } from './tokenEstimate.js';

// A small universe: "Heart" is placed in "Body" with a connection to "Lungs",
// is a kind of "Organ", and is defined by its own web "Heart" holding two parts.
const graphState = {
  activeGraphId: 'g-body',
  openGraphIds: ['g-body'],
  graphs: [
    {
      id: 'g-body', name: 'Body', edgeIds: ['e-1'], groups: [],
      instances: [
        { id: 'i-heart', prototypeId: 'p-heart' },
        { id: 'i-lungs', prototypeId: 'p-lungs' }
      ]
    },
    {
      id: 'g-heart', name: 'Heart', description: 'What a heart is made of.', edgeIds: ['e-2'], groups: [],
      definingNodeIds: ['p-heart'],
      instances: [
        { id: 'i-atrium', prototypeId: 'p-atrium' },
        { id: 'i-ventricle', prototypeId: 'p-ventricle' }
      ]
    }
  ],
  nodePrototypes: [
    { id: 'p-heart', name: 'Heart', description: 'Pumps blood.', typeNodeId: 'p-organ', definitionGraphIds: ['g-heart'] },
    { id: 'p-lungs', name: 'Lungs', description: '', definitionGraphIds: [] },
    { id: 'p-organ', name: 'Organ', description: '', definitionGraphIds: [] },
    { id: 'p-atrium', name: 'Atrium', description: '', definitionGraphIds: [] },
    { id: 'p-ventricle', name: 'Ventricle', description: '', definitionGraphIds: [] },
    { id: 'p-oxygenates', name: 'Oxygenates', description: '', definitionGraphIds: [] }
  ],
  edges: [
    { id: 'e-1', sourceId: 'i-lungs', destinationId: 'i-heart', definitionNodeIds: ['p-oxygenates'] },
    { id: 'e-2', sourceId: 'i-atrium', destinationId: 'i-ventricle', definitionNodeIds: [] }
  ]
};

describe('buildPinnedContext', () => {
  it('is empty with nothing pinned', () => {
    expect(buildPinnedContext(graphState, [])).toBe('');
    expect(buildPinnedContext(graphState, [{ id: 'missing' }])).toBe('');
  });

  it('gives a pinned Thing its type, bio, definition, and connections across the universe', () => {
    const out = buildPinnedContext(graphState, [{ id: 'p-heart' }]);
    expect(out).toContain('## Pinned by the user');
    expect(out).toContain('Thing "Heart" [Type: Organ]');
    expect(out).toContain('Bio: Pumps blood.');
    expect(out).toContain('Defined by the web: "Heart" (2 Things, 1 Connections)');
    // The definition web's contents
    expect(out).toContain('Atrium');
    expect(out).toContain('Ventricle');
    expect(out).toContain('Placed in: "Body"');
    expect(out).toContain('Lungs --[Oxygenates]--> Heart (in "Body")');
  });

  it('shows the web a pin was dragged in from, and points at the header when it is the current web', () => {
    const fromTab = buildPinnedContext(graphState, [{ id: 'p-heart', graphId: 'g-heart' }]);
    expect(fromTab).toContain('Web "Heart", defining the Thing "Heart"');
    // The first definition's bio is the Thing's
    expect(fromTab).toContain('Bio: Pumps blood.');

    const onScreen = buildPinnedContext(
      { ...graphState, activeGraphId: 'g-heart' },
      [{ id: 'p-heart', graphId: 'g-heart' }]
    );
    expect(onScreen).toContain('is the current web, shown in full above');
  });

  it('keeps many pins inside its budget by stepping detail down', () => {
    const many = { ...graphState, nodePrototypes: [...graphState.nodePrototypes], graphs: [...graphState.graphs] };
    const pins = [];
    for (let i = 0; i < 60; i++) {
      many.nodePrototypes.push({ id: `p-${i}`, name: `Thing ${i}`, description: 'y'.repeat(900), definitionGraphIds: [] });
      pins.push({ id: `p-${i}` });
    }
    const out = buildPinnedContext(many, pins);
    expect(estimateTokens(out)).toBeLessThan(PINNED_CONTEXT_TOKEN_BUDGET * 1.2);
    expect(out).toContain('reduced detail for space');
  });

  it('is appended to the header, and still sent when the current web is switched off', () => {
    const items = [{ type: 'activeGraph', enabled: true }, { type: 'thing', id: 'p-heart', enabled: true }];
    expect(buildPersistentContextHeader(graphState, items)).toContain('Thing "Heart"');

    const off = [{ type: 'activeGraph', enabled: false }, { type: 'thing', id: 'p-heart', enabled: true }];
    const header = buildPersistentContextHeader(graphState, off);
    expect(header).toContain('Active graph context is disabled by user.');
    expect(header).toContain('Thing "Heart"');
  });
});

/**
 * Tests for edgeValidator utility
 */

import { describe, it, expect } from 'vitest';
import { validateEdges, validateEdgesSmart, describeEdgeValidation, edgeScopeFromState } from './edgeValidator.js';

describe('validateEdges', () => {
  it('returns all edges as valid when source and target match nodes', () => {
    const nodeSpecs = [
      { name: 'Apples' },
      { name: 'Bread' }
    ];
    const edges = [
      { source: 'Apples', target: 'Bread', type: 'Near' }
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges);

    expect(validEdges).toHaveLength(1);
    expect(validEdges[0].source).toBe('Apples');
    expect(droppedEdges).toHaveLength(0);
  });

  it('drops edges where target does not exist in nodes', () => {
    const nodeSpecs = [
      { name: 'Apples' },
      { name: 'Bread' }
    ];
    const edges = [
      { source: 'Apples', target: 'Produce Section', type: 'Stocked In' }
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges);

    expect(validEdges).toHaveLength(0);
    expect(droppedEdges).toHaveLength(1);
    expect(droppedEdges[0].target).toBe('Produce Section');
    expect(droppedEdges[0].reason).toContain('target "Produce Section" is not in the nodes array');
  });

  it('drops edges where source does not exist in nodes', () => {
    const nodeSpecs = [
      { name: 'Apples' },
      { name: 'Bread' }
    ];
    const edges = [
      { source: 'Nonexistent', target: 'Apples', type: 'Relates' }
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges);

    expect(validEdges).toHaveLength(0);
    expect(droppedEdges).toHaveLength(1);
    expect(droppedEdges[0].reason).toContain('source "Nonexistent" is not in the nodes array');
  });

  it('drops edges where both source and target are missing', () => {
    const nodeSpecs = [{ name: 'Apples' }];
    const edges = [
      { source: 'Ghost1', target: 'Ghost2', type: 'Haunts' }
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges);

    expect(validEdges).toHaveLength(0);
    expect(droppedEdges).toHaveLength(1);
    expect(droppedEdges[0].reason).toContain('source "Ghost1"');
    expect(droppedEdges[0].reason).toContain('target "Ghost2"');
  });

  it('matches node names case-insensitively', () => {
    const nodeSpecs = [
      { name: 'Produce Section' },
      { name: 'Apples' }
    ];
    const edges = [
      { source: 'apples', target: 'produce section', type: 'Stocked In' }
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges);

    expect(validEdges).toHaveLength(1);
    expect(droppedEdges).toHaveLength(0);
  });

  it('accepts edges referencing existingNodeNames', () => {
    const nodeSpecs = [
      { name: 'Europa' }
    ];
    const existingNodeNames = ['Jupiter', 'Saturn'];
    const edges = [
      { source: 'Europa', target: 'Jupiter', type: 'Orbits' }
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges, existingNodeNames);

    expect(validEdges).toHaveLength(1);
    expect(droppedEdges).toHaveLength(0);
  });

  it('returns empty arrays for empty edges input', () => {
    const nodeSpecs = [{ name: 'A' }];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, []);

    expect(validEdges).toHaveLength(0);
    expect(droppedEdges).toHaveLength(0);
  });

  it('returns empty arrays for null/undefined edges input', () => {
    const nodeSpecs = [{ name: 'A' }];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, null);

    expect(validEdges).toHaveLength(0);
    expect(droppedEdges).toHaveLength(0);
  });

  it('handles mixed valid and invalid edges', () => {
    const nodeSpecs = [
      { name: 'Apples' },
      { name: 'Bread' },
      { name: 'Milk' }
    ];
    const edges = [
      { source: 'Apples', target: 'Bread', type: 'Near' },       // valid
      { source: 'Apples', target: 'Produce Section', type: 'In' }, // invalid target
      { source: 'Milk', target: 'Bread', type: 'Adjacent' }       // valid
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges);

    expect(validEdges).toHaveLength(2);
    expect(validEdges[0].source).toBe('Apples');
    expect(validEdges[0].target).toBe('Bread');
    expect(validEdges[1].source).toBe('Milk');
    expect(droppedEdges).toHaveLength(1);
    expect(droppedEdges[0].target).toBe('Produce Section');
  });

  it('trims whitespace when matching names', () => {
    const nodeSpecs = [
      { name: 'Apples' },
      { name: 'Bread' }
    ];
    const edges = [
      { source: ' Apples ', target: ' Bread ', type: 'Near' }
    ];

    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges);

    expect(validEdges).toHaveLength(1);
    expect(droppedEdges).toHaveLength(0);
  });
});

describe('validateEdgesSmart (exact names only)', () => {
  it('resolves case and spacing differences and reports them', async () => {
    const r = await validateEdgesSmart([{ name: 'Softmax' }, { name: 'Logits' }], [
      { source: 'logits', target: '  SOFTMAX ', type: 'Feeds' }
    ]);
    expect(r.validEdges).toEqual([{ source: 'Logits', target: 'Softmax', type: 'Feeds' }]);
    expect(r.remappedEndpoints).toEqual([
      { from: 'logits', to: 'Logits' },
      { from: '  SOFTMAX ', to: 'Softmax' }
    ]);
    expect(describeEdgeValidation(r)).toContain('"logits" as "Logits"');
  });

  it('never resolves by substring, either way round', async () => {
    const r = await validateEdgesSmart([{ name: 'max' }, { name: 'Temperature' }, { name: 'Logits' }], [
      { source: 'Logits', target: 'Softmax Function', type: 'Feeds' },
      { source: 'Logits', target: 'Sampling Temperature', type: 'Scaled By' }
    ]);
    expect(r.validEdges).toHaveLength(0);
    expect(r.droppedEdges).toHaveLength(2);
    expect(r.droppedEdges[0].reason).toContain('target "Softmax Function" is not a Thing');
    expect(r.droppedEdges[1].reason).toContain('closest: "Temperature"');
  });

  it("counts layers and what a decomposed layer opens into, not a collapsed one's insides", async () => {
    const layers = [
      { name: 'Engine', display: 'decomposed', definition: { nodes: [{ name: 'Piston' }], layers: [{ name: 'Valve Train', definition: { nodes: [{ name: 'Cam' }] } }] } },
      { name: 'Gearbox', display: 'collapsed', definition: { nodes: [{ name: 'Clutch' }] } }
    ];
    const r = await validateEdgesSmart([{ name: 'Driver' }], [
      { source: 'Driver', target: 'Engine', type: 'a' },
      { source: 'Driver', target: 'Cam', type: 'b' },
      { source: 'Driver', target: 'Gearbox', type: 'c' },
      { source: 'Driver', target: 'Clutch', type: 'd' }
    ], { layers });
    expect(r.validEdges.map(e => e.target)).toEqual(['Engine', 'Cam', 'Gearbox']);
    expect(r.validEdges.every(e => e.toLayer)).toBe(true);
    expect(r.droppedEdges.map(d => d.target)).toEqual(['Clutch']);
  });

  it('resolves in order: the call, the web, then the universe (last match)', async () => {
    const graphState = {
      graphs: [{ id: 'g', name: 'G', definingNodeIds: ['p-self'], instances: [{ id: 'i1', prototypeId: 'p-web' }] }],
      nodePrototypes: [
        { id: 'p-web', name: 'Water' },
        { id: 'p-old', name: 'Ice' },
        { id: 'p-new', name: 'ice' },
        { id: 'p-self', name: 'Ocean' }
      ]
    };
    const r = await validateEdgesSmart([{ name: 'Steam' }], [
      { source: 'Steam', target: 'Water', type: 'a' },
      { source: 'Water', target: 'ICE', type: 'b' },
      { source: 'Water', target: 'Ocean', type: 'c' }
    ], edgeScopeFromState(graphState, 'g'));
    expect(r.validEdges.map(e => `${e.source}>${e.target}`)).toEqual(['Steam>Water', 'Water>ice']);
    expect(r.placedExisting).toEqual([{ name: 'ice', prototypeId: 'p-new' }]);
    // The web's own defining Thing is never placed inside it.
    expect(r.droppedEdges.map(d => d.target)).toEqual(['Ocean']);
  });

  it('describes nothing when nothing changed', async () => {
    const r = await validateEdgesSmart([{ name: 'A' }, { name: 'B' }], [{ source: 'A', target: 'B' }]);
    expect(describeEdgeValidation(r)).toBeNull();
  });
});

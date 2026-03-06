/**
 * Tests for edgeValidator utility
 */

import { describe, it, expect } from 'vitest';
import { validateEdges } from './edgeValidator.js';

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

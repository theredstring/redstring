import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import useGraphStore from '../../src/store/graphStore.js';
import { installCanvasStubs, teardownCanvasStubs } from '../../src/test-utils/canvasHarness.jsx';
import GraphPreview from '../../src/GraphPreview.jsx';
import InnerNetwork from '../../src/InnerNetwork.jsx';

// Both web previews draw connections in the user's connection style. The
// geometry itself is checked against the canvas in
// src/NodeCanvas.previewParity.test.jsx; this checks the two components draw
// it: a curved parallel pair, routed paths and the arrowheads.

const prototypes = new Map([
  ['pa', { id: 'pa', name: 'Alpha', color: '#800000' }],
  ['pb', { id: 'pb', name: 'Bravo', color: '#004080' }],
]);
const nodes = [
  { ...prototypes.get('pa'), id: 'a', prototypeId: 'pa', x: 0, y: 0 },
  { ...prototypes.get('pb'), id: 'b', prototypeId: 'pb', x: 700, y: 300 },
];
const edges = [
  { id: 'e1', sourceId: 'a', destinationId: 'b', directionality: { arrowsToward: new Set(['b']) } },
  { id: 'e2', sourceId: 'a', destinationId: 'b', directionality: { arrowsToward: new Set() } },
  { id: 'e3', sourceId: 'b', destinationId: 'b', directionality: { arrowsToward: new Set(['b']) } },
];

const setStyle = (routingStyle) => useGraphStore.setState((s) => ({
  nodePrototypes: prototypes,
  autoLayoutSettings: { ...s.autoLayoutSettings, enableAutoRouting: routingStyle !== 'straight', routingStyle },
}));

const renderBoth = () => [
  render(<GraphPreview nodes={nodes} edges={edges} width={200} height={120} />).container,
  render(<svg><InnerNetwork nodes={nodes} edges={edges} width={200} height={120} padding={4} /></svg>).container,
];

describe('web previews draw the connection style', () => {
  beforeEach(() => { installCanvasStubs(); setStyle('straight'); });
  afterEach(() => teardownCanvasStubs());

  it('straight: the parallel pair bows apart and the self-loop is drawn', () => {
    renderBoth().forEach((root) => {
      // Two parallel connections share a chord, so both bow into curves; the
      // self-loop is a path too. Nothing is a straight line.
      expect(root.querySelectorAll('path[d*="Q"]').length).toBeGreaterThanOrEqual(2);
      expect(root.querySelectorAll('line').length).toBe(0);
      // e1's arrow and the self-loop's arrow.
      expect(root.querySelectorAll('polygon').length).toBe(2);
    });
  });

  it.each(['manhattan', 'clean', 'lombardi'])('%s: every connection is a routed path', (style) => {
    setStyle(style);
    renderBoth().forEach((root) => {
      expect(root.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
      expect(root.querySelectorAll('polygon').length).toBe(2);
    });
  });
});

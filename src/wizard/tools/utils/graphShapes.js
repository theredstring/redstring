/**
 * Structural shape library.
 *
 * When the wizard builds a graph from a request, the structure it should produce
 * is almost always one of these nine shapes. Classifying the shape up front lets
 * the build path route correctly — most importantly:
 *
 *   - `set` LICENSES not drawing edges. Over-connection is a known model failure
 *     mode; when things don't clearly relate, `set` is the right answer, not a
 *     sparse `web`.
 *   - `ladder` routes to the ABSTRACTION AXIS (is-a / carousel / abstractionChain),
 *     NOT to canvas edges. Kind-of hierarchies are a different dimension in
 *     Redstring than part/role trees. This distinction is the single most
 *     valuable thing the shape call makes.
 *
 * Default bias when uncertain: `web` (or `set` if relations are unclear).
 *
 * MCP stdio rule: this file is reachable from redstring-mcp-server.js via the
 * tools — no console.log (this module has none).
 */

export const GRAPH_SHAPES = [
  {
    key: 'set',
    description: 'Unrelated items with NO edges — a bag of things that do not clearly relate',
    examples: ['brainstorm 20 product ideas', 'list ingredients for a pantry'],
    buildNotes: 'Create nodes only. Draw NO edges. Do not invent relationships.',
    routing: 'nodes-only'
  },
  {
    key: 'web',
    description: 'Things plus relations, flat, with no single center',
    examples: ['how do the Greek gods relate?', 'the ecosystem of a coral reef'],
    buildNotes: 'Nodes plus labeled edges where relations genuinely exist. Do not force a center.',
    routing: 'canvas-edges'
  },
  {
    key: 'star',
    description: 'One protagonist elaborated by its aspects radiating outward',
    examples: ['tell me about the Ottoman Empire', 'an overview of photosynthesis'],
    buildNotes: 'One center node; spokes to aspect nodes. Edges connect center to each aspect.',
    routing: 'canvas-edges'
  },
  {
    key: 'sequence',
    description: 'An ordered chain from a start to an end',
    examples: ['steps of photosynthesis', 'the Radiohead albums in order'],
    buildNotes: 'Directed edge chain A→B→C… in order. One start, one end.',
    routing: 'canvas-edges-directed'
  },
  {
    key: 'cycle',
    description: 'A directed loop with no start or end — feedback',
    examples: ['the water cycle', 'the Krebs cycle'],
    buildNotes: 'Directed edges that close back to the beginning. No terminal node.',
    routing: 'canvas-edges-directed'
  },
  {
    key: 'tree',
    description: 'Branching parent–child by ROLE (org chart, family, decision tree) — parts/reporting, not kinds',
    examples: ['the Tudor family tree', 'the org chart of a company'],
    buildNotes: 'Edges fan out parent→children on the canvas. This is roles/parts, NOT is-a.',
    routing: 'canvas-edges-directed'
  },
  {
    key: 'ladder',
    description: 'A chain of KINDS (is-a): poodle → dog → mammal → animal',
    examples: ['where does a virus sit between chemistry and life?', 'from poodle up to animal'],
    buildNotes: 'Route to the ABSTRACTION AXIS (carousel / abstractionChain), NOT canvas edges. Each rung is more/less general than the next.',
    routing: 'abstraction-axis'
  },
  {
    key: 'correspondence',
    description: 'Two kinds of things with a mapping across them',
    examples: ['which actors played which characters', 'countries and their capitals'],
    buildNotes: 'Two groups of nodes; edges ONLY across groups (never within a group).',
    routing: 'canvas-edges'
  },
  {
    key: 'dialectic',
    description: 'Claims with supports/contradicts, left unresolved',
    examples: ['map the debate over nuclear power', 'arguments for and against remote work'],
    buildNotes: 'Position/evidence nodes; support/oppose edges. Do NOT resolve to a winner.',
    routing: 'canvas-edges-directed'
  }
];

/** Map of key → shape descriptor. */
export const GRAPH_SHAPES_BY_KEY = Object.freeze(
  GRAPH_SHAPES.reduce((acc, s) => { acc[s.key] = s; return acc; }, {})
);

/** All valid shape keys. */
export const GRAPH_SHAPE_KEYS = GRAPH_SHAPES.map((s) => s.key);

/** Shapes whose build path is NOT canvas edges (special routing). */
export const NON_CANVAS_EDGE_SHAPES = Object.freeze({
  set: 'nodes-only',
  ladder: 'abstraction-axis'
});

/** @returns {boolean} true if the shape means "do not draw edges". */
export function isEdgelessShape(key) {
  return key === 'set';
}

/** @returns {boolean} true if the shape routes to the abstraction axis, not canvas edges. */
export function isAbstractionShape(key) {
  return key === 'ladder';
}

/** @returns {object|null} the shape descriptor for a key, or null. */
export function getShape(key) {
  return GRAPH_SHAPES_BY_KEY[key] || null;
}

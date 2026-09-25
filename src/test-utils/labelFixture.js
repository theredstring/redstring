/**
 * A connection-label fixture and a DOM snapshot reader, for pinning where the
 * canvas puts its connection labels (P1.12a).
 *
 * The render contract (canvasContract.js) pins the SHAPE of the label DOM: that
 * the attributes useNodeDrag reads exist. This pins the VALUES: where each
 * label sits, at what rotation, cut to what text, and the `d` of every stroke
 * it is placed along. That is the safety net for any change to what triggers a
 * label re-solve (P1.12b, P3.05): a label that moves is a failure here, not a
 * silent visual diff. (After a selection, some moves are expected today; see
 * NodeCanvas.labelSnapshot.test.jsx.)
 *
 * The fixture is built to make label placement do real work:
 *   - a hub with seven incident connections, so selecting it changes the most
 *     geometry any single selection can (see F-21 in the plan: the selected
 *     node's hitbox grows by the selection stroke)
 *   - two parallel bundles (a triple and a pair)
 *   - long diagonals that cross other connections, so the crossing index has
 *     something to report
 *   - arrows at both ends, including one INTO the hub (the Lombardi arrow tip
 *     is placed on the selection-aware hitbox)
 *   - a name long enough to be truncated
 *   - a leaf with exactly one connection, for the "select something far from
 *     most labels" case
 *   - a node-group, whose anchor box reaches the label pass one render late
 *     (anchorPositionUpdatesRef) and is therefore sensitive to WHEN the
 *     crossing index gets rebuilt
 */
import useGraphStore from '../store/graphStore.js';
import { seedUniverse } from './canvasHarness.jsx';

export const LABEL_ROUTING_STYLES = ['straight', 'manhattan', 'clean', 'lombardi'];

// World (800, 600) at the centre of jsdom's 1024x768 window, at zoom 0.4. The
// canvas SVG is 100k square with offset -50k, so screen = (world + 50000) *
// zoom + pan. Everything below sits inside that view.
const ZOOM = 0.4;
export const LABEL_VIEW = {
  panOffset: { x: 512 - (800 + 50000) * ZOOM, y: 384 - (600 + 50000) * ZOOM },
  zoomLevel: ZOOM,
};

export const HUB_ID = 'hub';
export const LEAF_ID = 'leaf';

const NODE_PROTOTYPES = [
  ['p-hub', 'Hub'], ['p-n', 'North'], ['p-s', 'South'], ['p-w', 'West'],
  ['p-e', 'East'], ['p-ne', 'Northeast'], ['p-sw', 'Southwest'],
  ['p-leaf', 'Leaf'], ['p-m1', 'Member One'], ['p-m2', 'Member Two'],
  ['p-crew', 'Crew'],
];

// Connection names come from a definition prototype (definitionNodeIds[0]),
// the same way a typed connection gets its name in the app.
const RELATION_PROTOTYPES = [
  ['r-supports', 'supports'],
  ['r-contains', 'contains'],
  ['r-influences', 'influences'],
  ['r-long', 'is a deliberately long relation name that has to be cut to fit'],
  ['r-part', 'part of'],
  ['r-precedes', 'precedes'],
  ['r-echoes', 'echoes'],
  ['r-crosses', 'crosses'],
  ['r-spans', 'spans the whole canvas'],
  ['r-follows', 'follows'],
  ['r-mirrors', 'mirrors'],
  ['r-reflects', 'reflects'],
  ['r-leads', 'leads to'],
  ['r-joins', 'joins'],
  ['r-inner', 'inner link'],
];

const INSTANCES = [
  [HUB_ID, 'p-hub', 700, 500],
  ['n', 'p-n', 700, 0],
  ['s', 'p-s', 700, 1000],
  ['w', 'p-w', 0, 500],
  ['e', 'p-e', 1400, 500],
  ['ne', 'p-ne', 1400, 0],
  ['sw', 'p-sw', 0, 1000],
  [LEAF_ID, 'p-leaf', 1700, 1050],
  ['m1', 'p-m1', 0, 1500],
  ['m2', 'p-m2', 450, 1500],
];

// [id, source, destination, relation, arrowsToward]
const EDGES = [
  ['l-supports', HUB_ID, 'n', 'r-supports', ['n']],
  ['l-contains', HUB_ID, 's', 'r-contains', []],
  ['l-influences', 'w', HUB_ID, 'r-influences', [HUB_ID]],
  ['l-long', HUB_ID, 'e', 'r-long', []],
  ['l-par1', 'e', 'ne', 'r-part', []],
  ['l-par2', 'e', 'ne', 'r-precedes', ['ne']],
  ['l-par3', 'e', 'ne', 'r-echoes', []],
  ['l-crosses', 'n', 'w', 'r-crosses', []],
  ['l-spans', 'ne', 'sw', 'r-spans', ['sw']],
  ['l-follows', 's', 'e', 'r-follows', ['e']],
  ['l-mirror1', 'sw', 's', 'r-mirrors', []],
  ['l-mirror2', 'sw', 's', 'r-reflects', ['sw']],
  ['l-leads', LEAF_ID, 'e', 'r-leads', ['e']],
  ['l-hubne', HUB_ID, 'ne', 'r-crosses', []],
  ['l-inner', 'm1', 'm2', 'r-inner', []],
];

/** Every connection id in the fixture. None is a self-loop. */
export const LABEL_EDGE_IDS = [...EDGES.map(([id]) => id), 'l-joins'];
/** Connections with the hub at one end (the anchor edge excluded). */
export const HUB_EDGE_IDS = EDGES.filter(([, s, d]) => s === HUB_ID || d === HUB_ID).map(([id]) => id);

/**
 * Seed the label fixture for one routing style.
 *
 * @param {object} [opts]
 * @param {'straight'|'manhattan'|'clean'|'lombardi'} [opts.routingStyle]
 * @param {object} [opts.state] extra top-level store keys
 * @returns {{ nodeGroupId: string, anchorId: string }}
 */
export const seedLabelFixture = ({ routingStyle = 'lombardi', state = {} } = {}) => {
  const baseLayout = useGraphStore.getState().autoLayoutSettings || {};
  seedUniverse({
    prototypes: [...NODE_PROTOTYPES, ...RELATION_PROTOTYPES],
    view: LABEL_VIEW,
    state: {
      autoLayoutSettings: {
        ...baseLayout,
        enableAutoRouting: routingStyle !== 'straight',
        routingStyle,
      },
      showConnectionNames: true,
      ...state,
    },
  });

  let st = useGraphStore.getState();
  INSTANCES.forEach(([id, protoId, x, y]) => st.addNodeInstance('g1', protoId, { x, y }, id));

  // Fresh objects every call: addEdge normalises `directionality` in place.
  const edge = (id, sourceId, destinationId, relation, arrowsToward = []) => st.addEdge('g1', {
    id,
    sourceId,
    destinationId,
    definitionNodeIds: [relation],
    directionality: { arrowsToward: new Set(arrowsToward) },
  });
  EDGES.forEach(([id, s, d, rel, arrows]) => edge(id, s, d, rel, arrows));

  const nodeGroupId = st.createGroup('g1', { name: 'Crew', memberInstanceIds: ['m1', 'm2'] });
  st.convertGroupToNodeGroup('g1', nodeGroupId, 'p-crew');
  // The snapshot above is stale after an action.
  st = useGraphStore.getState();
  const anchorId = st.graphs.get('g1').groups.get(nodeGroupId)?.anchorInstanceId;
  if (!anchorId) throw new Error('label fixture: node-group conversion produced no anchor');
  edge('l-joins', 'sw', anchorId, 'r-joins', []);

  return { nodeGroupId, anchorId };
};

// ---------------------------------------------------------------------------
// Snapshot reader
// ---------------------------------------------------------------------------

/** Round to the nearest 0.5, so float noise below that can't fail a snapshot. */
export const roundHalf = (n) => {
  const r = Math.round(n * 2) / 2;
  return Object.is(r, -0) ? 0 : r;
};

// Every number in a geometry string (path d, transform, frame token).
const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
export const roundNumbersIn = (s) => (s == null ? s : String(s).replace(NUMBER, (m) => String(roundHalf(Number(m)))));

const attr = (el, name) => roundNumbersIn(el.getAttribute(name));

/**
 * Read every connection's drawn geometry and label, in a stable order, as
 * plain data: `{ [edgeId]: { strokes: [...], labels: [...] } }`.
 *
 * - strokes: each visible stroke and hit target, as `path d` or the four
 *   `line` coordinates, rounded to 0.5.
 * - labels: each `text[data-connection-label]` (the label and the ring drawn
 *   under it), with its frame token (x/y/angle, or per-glyph x/y/rotate lists
 *   for a curved label), the drawn text, the uncut name, x/y/transform.
 *
 * Scoped to `.canvas-area`, like the render contract.
 */
export const readLabelSnapshot = (root, edgeIds = LABEL_EDGE_IDS) => {
  const out = {};
  edgeIds.forEach((edgeId) => {
    const wrappers = Array.from(root.querySelectorAll(`[data-edge-id="${edgeId}"]`));
    const strokes = [];
    const labels = [];
    wrappers.forEach((w) => {
      w.querySelectorAll('path, line').forEach((el) => {
        if (el.closest('clipPath')) return;
        const tag = el.tagName.toLowerCase();
        const role = el.hasAttribute('data-edge-hit') ? 'hit' : 'stroke';
        strokes.push(tag === 'path'
          ? `${role} path ${attr(el, 'd')}`
          : `${role} line ${['x1', 'y1', 'x2', 'y2'].map((k) => attr(el, k)).join(' ')}`);
      });
      w.querySelectorAll('text[data-connection-label]').forEach((t) => {
        labels.push({
          frame: attr(t, 'data-label-frame'),
          text: t.textContent,
          full: t.getAttribute('data-label-full'),
          x: attr(t, 'x'),
          y: attr(t, 'y'),
          transform: attr(t, 'transform'),
        });
      });
    });
    out[edgeId] = { wrappers: wrappers.length, strokes, labels };
  });
  return out;
};

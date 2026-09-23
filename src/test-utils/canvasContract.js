/**
 * The NodeCanvas render contract: the DOM that useNodeDrag.js finds by
 * selector at drag start and then writes directly every drag frame.
 *
 * Nothing throws when this DOM changes shape. Rename an attribute, move an
 * element out from under its wrapper, or drop a rect from a group, and the
 * drag silently stops moving that piece: an edge freezes, a label strands, a
 * group box lags. So the contract is pinned here, and both
 * NodeCanvas.contract.test.jsx (culling off) and
 * NodeCanvas.contract.culling.test.jsx (culling on) assert it.
 *
 * The selector list, with file:line for both the reader (useNodeDrag) and the
 * writer (the renderers), is in
 * documentation/dev-ops/nodecanvas-refactor/reports/P0.05.md.
 *
 * Every query below is scoped to `.canvas-area`, which is what NodeCanvas hands
 * useNodeDrag as `containerRef`, so an element rendered outside it fails here
 * the same way it would fail for the drag.
 */
import { expect } from 'vitest';
import useGraphStore from '../store/graphStore.js';
import { seedUniverse } from './canvasHarness.jsx';

export const ROUTING_STYLES = ['straight', 'manhattan', 'clean', 'lombardi'];

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
//
//   a ──► b          directed, arrow at dest        → [data-arrow="dest"]
//   a ◄── c          directed, arrow at source      → [data-arrow="source"]
//   c ═══ d          two parallel edges             → curved path[data-edge-hit]
//   b ─── d          undirected, SELECTED           → [data-endpoint-dot] circles
//   e ⟲              self-loop with arrow           → [data-arrow="self"]
//   [ f ─── g ]      regular group, wrapped title   → .group[data-group-id], <tspan>s
//   [[ h ─── i ]]    node-group "Crew"              → .node-group-bg / -title
//   j ─── Crew       undirected edge to the anchor  → path[data-shell-clip]
//   far              30,000 units away              → culled when culling is on
//
// Connection names are on, since labels only render then. The camera is
// pinned so every node except `far` is inside the viewport at the same zoom in
// every routing style.

// World (900, 650) at the centre of jsdom's 1024x768 window, at zoom 0.5. The
// canvas SVG is 100k square with offset -50k, so screen = (world + 50000) *
// zoom + pan. With culling on, that puts the viewport at world x -124..1924,
// y -118..1418. runCulling's inner padding (500 / zoom = 1000) then covers
// every fixture node except `far`.
const ZOOM = 0.5;
export const CONTRACT_VIEW = {
  panOffset: { x: 512 - (900 + 50000) * ZOOM, y: 384 - (650 + 50000) * ZOOM },
  zoomLevel: ZOOM,
};

const PROTOTYPES = [
  ['pa', 'Alpha'], ['pb', 'Bravo'], ['pc', 'Charlie'], ['pd', 'Delta'],
  ['pe', 'Echo'], ['pf', 'Foxtrot'], ['pg', 'Golf'], ['ph', 'Hotel'],
  ['pi', 'India'], ['pj', 'Juliet'], ['pfar', 'Faraway'], ['pcrew', 'Crew'],
];

const INSTANCES = [
  ['a', 'pa', 0, 0],
  ['b', 'pb', 700, 0],
  ['c', 'pc', 0, 500],
  ['d', 'pd', 700, 500],
  ['e', 'pe', 1400, 0],
  ['f', 'pf', 1300, 500],
  ['g', 'pg', 1700, 500],
  ['h', 'ph', 0, 1000],
  ['i', 'pi', 450, 1000],
  ['j', 'pj', 1300, 1150],
  ['far', 'pfar', 30000, 30000],
];

/** Nodes inside the pinned viewport. `far` is deliberately not one of them. */
export const NEAR_NODE_IDS = INSTANCES.map(([id]) => id).filter((id) => id !== 'far');
export const FAR_NODE_ID = 'far';

// Long enough to pass the title tab's width ceiling (titleMaxWidth in
// groupLayout.js), so the regular group's title renders in its wrapped form,
// one <tspan> per line. The node-group title ("Crew") stays one line, so both
// forms are covered.
const REGULAR_GROUP_NAME = 'Plain Group With A Deliberately Long Title So The Tab Has To Wrap';

export const SELECTED_EDGE_ID = 'e-plain';
export const SELF_LOOP_EDGE_ID = 'e-self';
const PARALLEL_EDGE_IDS = new Set(['e-par1', 'e-par2']);
/** Every edge the regular renderer draws (everything but the self-loop). */
export const CONNECTION_EDGE_IDS = ['e-dir', 'e-src', 'e-par1', 'e-par2', SELECTED_EDGE_ID, 'e-grp', 'e-ng', 'e-shell'];

/**
 * Seed the fixture for one routing style.
 *
 * @param {object} [opts]
 * @param {'straight'|'manhattan'|'clean'|'lombardi'} [opts.routingStyle]
 * @param {object} [opts.state] extra top-level store keys
 * @returns {{ regularGroupId: string, nodeGroupId: string, anchorId: string }}
 */
export const seedContractFixture = ({ routingStyle = 'straight', state = {} } = {}) => {
  const baseLayout = useGraphStore.getState().autoLayoutSettings || {};
  seedUniverse({
    prototypes: PROTOTYPES,
    view: CONTRACT_VIEW,
    state: {
      autoLayoutSettings: {
        ...baseLayout,
        // Straight is what the canvas draws with auto-routing off. The other
        // three only take effect with it on (see isRoutedStyle in NodeCanvas).
        enableAutoRouting: routingStyle !== 'straight',
        routingStyle,
      },
      selectedEdgeIds: new Set([SELECTED_EDGE_ID]),
      ...state,
    },
  });

  let st = useGraphStore.getState();
  INSTANCES.forEach(([id, protoId, x, y]) => st.addNodeInstance('g1', protoId, { x, y }, id));

  // Fresh objects every call: addEdge normalises `directionality` in place.
  const edge = (id, sourceId, destinationId, arrowsToward = []) => st.addEdge('g1', {
    id, sourceId, destinationId, directionality: { arrowsToward: new Set(arrowsToward) },
  });
  edge('e-dir', 'a', 'b', ['b']);
  edge('e-src', 'c', 'a', ['c']);
  edge('e-par1', 'c', 'd');
  edge('e-par2', 'c', 'd');
  edge(SELECTED_EDGE_ID, 'b', 'd');
  edge(SELF_LOOP_EDGE_ID, 'e', 'e', ['e']);
  edge('e-grp', 'f', 'g');
  edge('e-ng', 'h', 'i');

  const regularGroupId = st.createGroup('g1', { name: REGULAR_GROUP_NAME, memberInstanceIds: ['f', 'g'] });
  const nodeGroupId = st.createGroup('g1', { name: 'Crew', memberInstanceIds: ['h', 'i'] });
  st.convertGroupToNodeGroup('g1', nodeGroupId, 'pcrew');

  // The conversion mints the anchor instance. Re-read the store: the snapshot
  // above is stale after an action.
  st = useGraphStore.getState();
  const anchorId = st.graphs.get('g1').groups.get(nodeGroupId)?.anchorInstanceId;
  if (!anchorId) throw new Error('contract fixture: node-group conversion produced no anchor');
  edge('e-shell', 'j', anchorId);

  return { regularGroupId, nodeGroupId, anchorId };
};

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const all = (root, selector) => Array.from(root.querySelectorAll(selector));

// `s|x|y|angle` for a straight label, `g|xs|ys|rotates` for a curved one. See
// labelFrameToken / applyLabelFrame in utils/canvas/edgeLabelPlacement.js.
const LABEL_FRAME = /^[sg]\|[^|]+\|[^|]+\|[^|]+$/;
// `x|y|rot|cx|cy`, one per glyph quad. See the drop restore in useNodeDrag.
const GLYPH_FRAME = /^[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+$/;

/** The element NodeCanvas passes to useNodeDrag as containerRef. */
export const canvasRoot = () => {
  const root = document.querySelector('.canvas-area');
  expect(root, '.canvas-area (useNodeDrag containerRef) is missing').toBeTruthy();
  return root;
};

const edgeWrappers = (root, edgeId) => {
  const els = all(root, `[data-edge-id="${edgeId}"]`);
  expect(els.length, `edge ${edgeId}: no [data-edge-id] wrapper`).toBeGreaterThan(0);
  return els;
};

/** Node <g>s, found by `[data-instance-id]` (useNodeDrag.js:435, :2404). */
export const assertNodeContract = (root, ids = NEAR_NODE_IDS) => {
  ids.forEach((id) => {
    const els = all(root, `[data-instance-id="${id}"]`);
    expect(els.length, `node ${id}: expected one [data-instance-id] element`).toBe(1);
    expect(els[0].classList.contains('node'), `node ${id}: [data-instance-id] is not the g.node`).toBe(true);
  });
};

/**
 * Edge geometry: the wrapper, hit target, visible stroke, arrows, endpoint
 * dots and shell clip that cacheDOMElements collects (useNodeDrag.js:616-641).
 */
export const assertEdgeGeometryContract = (root, routingStyle) => {
  const routed = routingStyle !== 'straight';

  CONNECTION_EDGE_IDS.forEach((edgeId) => {
    // A chord is a <line>. A curve (a parallel edge in straight mode) or any
    // routed style is a <path>. The drag writes different attributes to each,
    // so the tag is part of the contract.
    const tag = (!routed && !PARALLEL_EDGE_IDS.has(edgeId)) ? 'line' : 'path';
    const other = tag === 'line' ? 'path' : 'line';

    edgeWrappers(root, edgeId).forEach((w) => {
      const hits = all(w, '[data-edge-hit]');
      expect(hits.length, `${routingStyle} ${edgeId}: expected exactly one [data-edge-hit]`).toBe(1);
      expect(hits[0].tagName.toLowerCase(), `${routingStyle} ${edgeId}: hit target should be a <${tag}>`).toBe(tag);
      expect(all(w, `${other}[data-edge-hit]`).length).toBe(0);

      const strokes = tag === 'line'
        ? all(w, 'line:not([data-edge-hit])')
        : all(w, 'path:not([data-shell-clip]):not([data-edge-hit])');
      expect(strokes.length, `${routingStyle} ${edgeId}: no visible <${tag}> stroke for the drag to rewrite`).toBeGreaterThan(0);

      const expectArrows = { 'e-dir': { source: 0, dest: 1 }, 'e-src': { source: 1, dest: 0 } }[edgeId]
        || { source: 0, dest: 0 };
      expect(all(w, '[data-arrow="source"]').length, `${routingStyle} ${edgeId}: [data-arrow="source"]`).toBe(expectArrows.source);
      expect(all(w, '[data-arrow="dest"]').length, `${routingStyle} ${edgeId}: [data-arrow="dest"]`).toBe(expectArrows.dest);

      // Endpoint dots render for a selected (or hovered) edge only. The drag
      // moves the <circle>s inside each marker group.
      const selected = edgeId === SELECTED_EDGE_ID;
      expect(all(w, '[data-endpoint-dot="source"] circle').length > 0,
        `${routingStyle} ${edgeId}: [data-endpoint-dot="source"] circle`).toBe(selected);
      expect(all(w, '[data-endpoint-dot="dest"] circle').length > 0,
        `${routingStyle} ${edgeId}: [data-endpoint-dot="dest"] circle`).toBe(selected);

      // The shell cutout only exists for an arrow-less end on a node-group
      // anchor. It must be a <path> inside a <clipPath>, because the drag
      // rewrites its `d`.
      const clips = all(w, 'path[data-shell-clip]');
      expect(clips.length, `${routingStyle} ${edgeId}: path[data-shell-clip]`).toBe(edgeId === 'e-shell' ? 1 : 0);
      clips.forEach((clip) => expect(clip.closest('clipPath')).toBeTruthy());
    });
  });

  // Self-loops: the drag rewrites every <path> with the new loop, moves the
  // arrow by `[data-arrow="self"]`, and moves every <text> to the apex
  // (useNodeDrag.js:1008-1021).
  edgeWrappers(root, SELF_LOOP_EDGE_ID).forEach((w) => {
    expect(all(w, '[data-arrow="self"]').length, `${routingStyle} self-loop: [data-arrow="self"]`).toBe(1);
    expect(all(w, 'path').length, `${routingStyle} self-loop: no <path> for the drag to rewrite`).toBeGreaterThan(0);
    expect(all(w, 'text').length, `${routingStyle} self-loop: no label <text>`).toBeGreaterThan(0);
  });
};

/**
 * Connection labels in the <text> form, which is what renders whenever a
 * sprite is not ready (always, in jsdom, unless faked). labelTextOf reads
 * `text[data-connection-label]`, `font-size` and `data-label-full`. The drop
 * restore reads `data-label-frame` and `data-label-text` (useNodeDrag.js:562-608,
 * :2312-2314).
 */
export const assertTextLabelContract = (root, routingStyle) => {
  let curved = 0;
  CONNECTION_EDGE_IDS.forEach((edgeId) => {
    edgeWrappers(root, edgeId).forEach((w) => {
      expect(all(w, 'g[data-label-sprite]').length, `${routingStyle} ${edgeId}: unexpected sprite label in the <text> run`).toBe(0);
      const texts = all(w, 'text[data-connection-label]');
      expect(texts.length, `${routingStyle} ${edgeId}: no text[data-connection-label]`).toBeGreaterThan(0);
      expect(texts.some((t) => t.classList.contains('connection-label')),
        `${routingStyle} ${edgeId}: no .connection-label (CSS contract, .canvas-moving)`).toBe(true);
      texts.forEach((t) => {
        const frame = t.getAttribute('data-label-frame');
        expect(frame, `${routingStyle} ${edgeId}: data-label-frame "${frame}"`).toMatch(LABEL_FRAME);
        if (frame.startsWith('g|')) curved++;
        expect(parseFloat(t.getAttribute('font-size')), `${routingStyle} ${edgeId}: font-size`).toBeGreaterThan(0);
        // Truncation is on by default, and that is what adds these two.
        expect(t.getAttribute('data-label-full'), `${routingStyle} ${edgeId}: data-label-full`).toBeTruthy();
        const committed = t.getAttribute('data-label-text');
        expect(committed, `${routingStyle} ${edgeId}: data-label-text`).toBeTruthy();
        expect(t.textContent).toBe(committed);
      });
    });
  });
  if (routingStyle === 'lombardi') {
    // Lombardi arcs carry their labels along the curve. That form uses the
    // `g|` frame the drop restore has its own branch for.
    expect(curved, 'lombardi: no curved (g|) label frame rendered').toBeGreaterThan(0);
  } else {
    expect(curved, `${routingStyle}: curved label frame on a non-arc style`).toBe(0);
  }
};

/**
 * Connection labels in the sprite forms (useNodeDrag.js:545-579, :2330-2343):
 *   - straight: `g[data-label-sprite]:not([data-label-glyph-sprite])`, moved by
 *     one transform and restored from its `s|` data-label-frame
 *   - curved:   `g[data-label-glyph-sprite]` carrying data-label-text and
 *     data-label-font-size, holding `g[data-glyph-layer]` passes of <image>s,
 *     each with data-gi / data-advance / data-oy / data-gframe / width / height
 */
export const assertSpriteLabelContract = (root, routingStyle) => {
  let straightSprites = 0;
  let glyphHosts = 0;
  CONNECTION_EDGE_IDS.forEach((edgeId) => {
    edgeWrappers(root, edgeId).forEach((w) => {
      expect(all(w, 'text[data-connection-label]').length,
        `${routingStyle} ${edgeId}: <text> label rendered although a sprite was available`).toBe(0);

      const straight = all(w, 'g[data-label-sprite]:not([data-label-glyph-sprite])');
      const glyph = all(w, 'g[data-label-glyph-sprite]');
      expect(straight.length + glyph.length, `${routingStyle} ${edgeId}: expected exactly one sprite label`).toBe(1);

      straight.forEach((g) => {
        straightSprites++;
        expect(g.getAttribute('data-connection-label')).toBe('1');
        expect(g.classList.contains('connection-label')).toBe(true);
        const frame = g.getAttribute('data-label-frame');
        expect(frame, `${routingStyle} ${edgeId}: straight sprite data-label-frame "${frame}"`).toMatch(/^s\|[^|]+\|[^|]+\|[^|]+$/);
        expect(g.querySelector('image'), `${routingStyle} ${edgeId}: straight sprite has no <image>`).toBeTruthy();
      });

      glyph.forEach((g) => {
        glyphHosts++;
        expect(g.getAttribute('data-connection-label')).toBe('1');
        expect(g.getAttribute('data-label-sprite'), 'a glyph sprite is also a data-label-sprite').toBe('1');
        expect(g.getAttribute('data-label-text'), `${edgeId}: glyph sprite data-label-text`).toBeTruthy();
        expect(parseFloat(g.getAttribute('data-label-font-size')), `${edgeId}: glyph sprite data-label-font-size`).toBeGreaterThan(0);
        const layers = all(g, 'g[data-glyph-layer]');
        expect(layers.map((l) => l.getAttribute('data-glyph-layer')), `${edgeId}: glyph layers`).toContain('fill');
        const perLayer = layers.map((l) => all(l, 'image').length);
        expect(perLayer[0], `${edgeId}: empty glyph layer`).toBeGreaterThan(0);
        expect(new Set(perLayer).size, `${edgeId}: glyph layers disagree on glyph count ${perLayer}`).toBe(1);
        layers.forEach((l) => all(l, 'image').forEach((img) => {
          // A regex, not Number.isInteger(Number(…)): a MISSING attribute is
          // null, and Number(null) is 0, which is an integer.
          expect(img.getAttribute('data-gi'), `${edgeId}: data-gi`).toMatch(/^\d+$/);
          expect(parseFloat(img.getAttribute('data-advance')), `${edgeId}: data-advance`).toBeGreaterThan(0);
          expect(Number.isFinite(parseFloat(img.getAttribute('data-oy'))), `${edgeId}: data-oy`).toBe(true);
          expect(img.getAttribute('data-gframe'), `${edgeId}: data-gframe`).toMatch(GLYPH_FRAME);
          expect(parseFloat(img.getAttribute('width'))).toBeGreaterThan(0);
          expect(parseFloat(img.getAttribute('height'))).toBeGreaterThan(0);
        }));
      });
    });
  });
  if (routingStyle === 'lombardi') {
    expect(glyphHosts, 'lombardi: no curved glyph-sprite label rendered').toBeGreaterThan(0);
  } else {
    expect(glyphHosts, `${routingStyle}: glyph sprite on a non-arc style`).toBe(0);
    expect(straightSprites).toBe(CONNECTION_EDGE_IDS.length);
  }
};

/**
 * Group boxes (useNodeDrag.js:658-683, :1753-1830). The drag tells the three
 * kinds apart by class, and indexes their direct <rect> children by position.
 */
export const assertGroupContract = (root, { regularGroupId, nodeGroupId }) => {
  const regular = all(root, `[data-group-id="${regularGroupId}"]`);
  expect(regular.length, 'regular group: expected one [data-group-id] element').toBe(1);
  expect(regular[0].classList.contains('group'), 'regular group: missing .group').toBe(true);
  expect(all(regular[0], ':scope > rect').length, 'regular group: no direct <rect> outline').toBeGreaterThan(0);
  const regularLabel = all(regular[0], ':scope > .group-label');
  expect(regularLabel.length, 'regular group: expected one direct .group-label').toBe(1);
  expect(regularLabel[0].querySelector('rect'), 'regular group: .group-label has no <rect>').toBeTruthy();
  expect(regularLabel[0].querySelector('text'), 'regular group: .group-label has no <text>').toBeTruthy();
  // A wrapped title is one <text> of <tspan> lines, each with its own absolute
  // x. The drag re-centres every one of them (setLabelTextX, useNodeDrag.js:1742-1745).
  const lines = all(regularLabel[0], 'text tspan');
  expect(lines.length, 'regular group: long title did not wrap into <tspan> lines').toBeGreaterThan(1);
  lines.forEach((span) => expect(span.getAttribute('x'), 'regular group: title <tspan> has no x').toBeTruthy());

  const nodeGroup = all(root, `[data-group-id="${nodeGroupId}"]`);
  expect(nodeGroup.length, 'node-group: expected a .node-group-bg and a .node-group-title').toBe(2);
  const bg = nodeGroup.filter((el) => el.classList.contains('node-group-bg'));
  const title = nodeGroup.filter((el) => el.classList.contains('node-group-title'));
  expect(bg.length, 'node-group: missing .node-group-bg').toBe(1);
  expect(title.length, 'node-group: missing .node-group-title').toBe(1);
  // [0] band, [1] interior, [2] grid repaint. The drag resizes them by index.
  expect(all(bg[0], ':scope > rect').length, 'node-group bg: expected 3 direct <rect>s (band, interior, grid)').toBe(3);
  expect(all(bg[0], ':scope > .group-label').length, 'node-group bg: carries no label').toBe(0);
  const titleLabel = all(title[0], ':scope > .group-label');
  expect(titleLabel.length, 'node-group title: expected one direct .group-label').toBe(1);
  expect(titleLabel[0].querySelector('rect'), 'node-group title: .group-label has no <rect>').toBeTruthy();
  expect(titleLabel[0].querySelector('text'), 'node-group title: .group-label has no <text>').toBeTruthy();
};

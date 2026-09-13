import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import EdgeGlowIndicator from '../../src/components/EdgeGlowIndicator.jsx';
import useGraphStore from '../../src/store/graphStore.js';
import { HEADER_HEIGHT } from '../../src/constants';

const WIN_W = 1000;
const WIN_H = 800;
const CANVAS_ORIGIN = 50000;

// What useViewportBounds resolves to for this window with both panels collapsed
// and the TypeList closed: the full width, and everything below the header.
const VB = { x: 0, y: HEADER_HEIGHT, w: WIN_W, h: WIN_H - HEADER_HEIGHT };

const makeNode = (id, x, y) => ({
  id,
  x,
  y,
  color: '#8B0000',
  name: id,
  prototype: { name: id, color: '#8B0000' }
});

const NODE_W = 100;
const NODE_H = 40;
const dimsFor = (nodes) => new Map(nodes.map(n => [n.id, { currentWidth: NODE_W, currentHeight: NODE_H }]));

/**
 * The inverse of the projection the painter does: where a node must sit in
 * canvas coordinates for its centre to land at (px, py) in overlay coordinates.
 */
const canvasPosFor = (px, py, pan, zoom) => ({
  x: (px + VB.x - pan.x) / zoom - CANVAS_ORIGIN - NODE_W / 2,
  y: (py + VB.y - pan.y) / zoom - CANVAS_ORIGIN - NODE_H / 2
});

const nodeAt = (id, px, py, pan = { x: 0, y: 0 }, zoom = 1) => {
  const p = canvasPosFor(px, py, pan, zoom);
  return makeNode(id, p.x, p.y);
};

/**
 * The flare transform the ORIGINAL implementation would have produced, worked
 * out the way it worked it out: build all four edge crossings, keep the one with
 * the smallest positive t, classify the edge from the coordinates. The painter
 * now gets there by comparing two axis crossings directly, so this is a genuine
 * second opinion rather than a restatement.
 */
const expectedFlare = (px, py, W = VB.w, H = VB.h) => {
  const cx = W / 2;
  const cy = H / 2;
  const dx = px - cx;
  const dy = py - cy;
  const hits = [];
  if (dx !== 0) {
    let t = -cx / dx;
    let y = cy + t * dy;
    if (t > 0 && y >= 0 && y <= H) hits.push({ x: 0, y, t });
    t = (W - cx) / dx;
    y = cy + t * dy;
    if (t > 0 && y >= 0 && y <= H) hits.push({ x: W, y, t });
  }
  if (dy !== 0) {
    let t = -cy / dy;
    let x = cx + t * dx;
    if (t > 0 && x >= 0 && x <= W) hits.push({ x, y: 0, t });
    t = (H - cy) / dy;
    x = cx + t * dx;
    if (t > 0 && x >= 0 && x <= W) hits.push({ x, y: H, t });
  }
  const best = hits.reduce((m, c) => (c.t < m.t ? c : m));

  const eps = 0.75;
  let edge = 'left';
  if (Math.abs(best.x) < eps) edge = 'left';
  else if (Math.abs(best.x - W) < eps) edge = 'right';
  else if (Math.abs(best.y) < eps) edge = 'top';
  else if (Math.abs(best.y - H) < eps) edge = 'bottom';

  const rotation = edge === 'left' ? 0 : edge === 'right' ? 180 : edge === 'top' ? 90 : -90;
  let tx = best.x;
  let ty = best.y;
  if (edge === 'left') tx = -3;
  else if (edge === 'right') tx = W + 3;
  else if (edge === 'top') ty = -3;
  else ty = H + 3;

  return `translate(${Math.round(tx)}px, ${Math.round(ty)}px) rotate(${rotation}deg)`;
};

const Harness = ({ nodes, pan, zoom, panRef, zoomRef, glowRef }) => {
  const containerRef = React.useRef(null);
  return (
    <div ref={containerRef}>
      <EdgeGlowIndicator
        nodes={nodes}
        baseDimensionsById={dimsFor(nodes)}
        panOffset={pan}
        zoomLevel={zoom}
        panOffsetRef={panRef}
        zoomLevelRef={zoomRef}
        glowUpdateRef={glowRef}
        leftPanelExpanded={false}
        rightPanelExpanded={false}
        previewingNodeId={null}
        containerRef={containerRef}
      />
    </div>
  );
};

// Flares are the pool's outer divs — absolutely positioned, zero-sized, each
// wrapping exactly one appearance div.
const flareSlots = (container) =>
  Array.from(container.querySelectorAll('div[style*="transform-origin"]'));

const visibleFlares = (container) =>
  flareSlots(container).filter(el => el.style.display !== 'none');

describe('EdgeGlowIndicator', () => {
  let panRef;
  let zoomRef;
  let glowRef;
  let originalRect;

  const mount = (nodes, pan = { x: 0, y: 0 }, zoom = 1) => {
    const result = render(
      <Harness nodes={nodes} pan={pan} zoom={zoom} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );
    // The container is an ancestor of the overlay, so its ref lands after the
    // overlay's first layout effect. A resize is the deterministic way to make
    // the overlay measure it; in the app the component's own frame-retry does.
    act(() => { window.dispatchEvent(new Event('resize')); });
    return result;
  };

  const pan = (x, y = 0) => act(() => {
    panRef.current = { x, y };
    glowRef.current();
  });

  beforeEach(() => {
    localStorage.clear();
    window.innerWidth = WIN_W;
    window.innerHeight = WIN_H;
    // jsdom lays nothing out, so the canvas container measures 0x0 and the
    // painter would have no coordinate system. Pin it to the window.
    originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: WIN_W, bottom: WIN_H, width: WIN_W, height: WIN_H, x: 0, y: 0 };
    };
    panRef = { current: { x: 0, y: 0 } };
    zoomRef = { current: 1 };
    glowRef = { current: null };
    act(() => {
      useGraphStore.getState().setEdgeGlowMode('fancy');
      // An open TypeList reserves a strip at the bottom, which would move the
      // overlay's centre out from under VB above.
      useGraphStore.getState().setTypeListMode('closed');
      useGraphStore.getState().setEdgeGlowIntensity(1);
    });
  });

  afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = originalRect;
  });

  it('draws a flare for an off-screen Thing and none for an on-screen one', () => {
    const { container } = mount([
      nodeAt('far-left', -5000, VB.h / 2),
      nodeAt('centre', VB.w / 2, VB.h / 2)
    ]);

    const shown = visibleFlares(container);
    expect(shown).toHaveLength(1);
    expect(shown[0].style.transform).toBe(expectedFlare(-5000, VB.h / 2));
    // Straight out to the left, so: on the left border, unrotated.
    expect(shown[0].style.transform).toBe(`translate(-3px, ${VB.h / 2}px) rotate(0deg)`);
  });

  it('puts flares on the border the original four-edge scan would have chosen', () => {
    // One Thing per border, plus two diagonals that could plausibly go either way.
    const cases = [
      ['left', -5000, VB.h / 2],
      ['right', 6000, VB.h / 2],
      ['top', VB.w / 2, -900],
      ['bottom', VB.w / 2, 4000],
      ['up-left', -1200, -900],
      ['down-right', 3000, 2400]
    ];
    const { container } = mount(cases.map(([id, px, py]) => nodeAt(id, px, py)));

    const shown = visibleFlares(container);
    expect(shown).toHaveLength(cases.length);
    shown.forEach((el, i) => {
      expect(el.style.transform).toBe(expectedFlare(cases[i][1], cases[i][2]));
    });
  });

  it('tracks a live pan without waiting for the settled transform', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. The painter used to return early for
    // the whole duration of a gesture and let the settled props put it right
    // afterwards, so the flares sat still through a pan and jumped at the end —
    // and the larger the web the longer the gesture and the more obvious the
    // jump. A live update has to move them on its own.
    const { container } = mount([nodeAt('above', VB.w / 2, -5000)]);

    const before = visibleFlares(container)[0].style.transform;
    expect(before).toBe(expectedFlare(VB.w / 2, -5000));

    // Mid-gesture: the live ref moves, the settled `panOffset` prop does not.
    pan(300);

    const after = visibleFlares(container)[0].style.transform;
    expect(after).not.toBe(before);
    expect(after).toBe(expectedFlare(VB.w / 2 + 300, -5000));
    // Still riding the top border, having slid along it toward the Thing.
    expect(after).toMatch(/, -3px\) rotate\(90deg\)$/);
  });

  it('raises a flare for a Thing that leaves the viewport mid-gesture', () => {
    const { container } = mount([nodeAt('inside', VB.w / 2, VB.h / 2)]);
    expect(visibleFlares(container)).toHaveLength(0);

    pan(3000); // shoves it out past the right-hand border

    const shown = visibleFlares(container);
    expect(shown).toHaveLength(1);
    expect(shown[0].style.transform).toBe(`translate(${VB.w + 3}px, ${VB.h / 2}px) rotate(180deg)`);
  });

  it('hides the slots a shrinking flare count leaves behind', () => {
    const { container } = mount([
      nodeAt('a', -4000, 100),
      nodeAt('b', -4000, 300),
      nodeAt('c', -4000, 500)
    ]);
    expect(visibleFlares(container)).toHaveLength(3);

    pan(4500); // brings all three on screen

    expect(visibleFlares(container)).toHaveLength(0);
    // The pool keeps its slots for the next frame; they just go dark.
    expect(flareSlots(container).length).toBeGreaterThanOrEqual(3);
  });

  it('grows the pool past its first block when a web needs more flares', () => {
    // 40 Things off the left border — more than one POOL_CHUNK of 16, so the
    // pool has to grow and repaint rather than silently drop the overflow.
    const nodes = Array.from({ length: 40 }, (_, i) => nodeAt(`n${i}`, -4000, 10 * (i + 1)));
    const { container } = mount(nodes);

    expect(visibleFlares(container)).toHaveLength(40);
  });

  it('gives fancy a blur and a halo, and fast neither', () => {
    const { container } = mount([nodeAt('far', -5000, VB.h / 2)]);

    const appearance = () => visibleFlares(container)[0].firstChild.style;
    expect(appearance().filter).toMatch(/blur/);
    expect(appearance().boxShadow).not.toBe('');
    expect(appearance().background).toMatch(/radial-gradient/);

    act(() => { useGraphStore.getState().setEdgeGlowMode('fast'); });

    expect(appearance().filter).toBe('');
    expect(appearance().boxShadow).toBe('');
    // The gradient alone still has to read as a glow.
    expect(appearance().background).toMatch(/radial-gradient/);
    // And it grows to cover the ground the dropped blur used to bleed into.
    expect(parseFloat(appearance().width)).toBeGreaterThan(0);
  });

  it('scales flare size and opacity together with the strength slider', () => {
    const { container } = mount([nodeAt('far', -5000, VB.h / 2)]);
    const appearance = () => visibleFlares(container)[0].firstChild.style;

    const readAt = (strength) => {
      act(() => { useGraphStore.getState().setEdgeGlowIntensity(strength); });
      const st = appearance();
      return {
        width: parseFloat(st.width),
        height: parseFloat(st.height),
        blur: parseFloat((st.filter.match(/blur\(([\d.]+)px\)/) || [])[1]),
        // The gradient's core stop carries the opacity, as an 8-digit hex.
        core: (st.background.match(/#[0-9a-f]{6}([0-9a-f]{2})/i) || [])[1]
      };
    };

    const dim = readAt(0.5);
    const mid = readAt(1);
    const loud = readAt(1.8);

    // Size, blur and opacity all move in the same direction.
    expect(dim.width).toBeLessThan(mid.width);
    expect(mid.width).toBeLessThan(loud.width);
    expect(dim.height).toBeLessThan(mid.height);
    expect(mid.height).toBeLessThan(loud.height);
    expect(dim.blur).toBeLessThan(mid.blur);
    expect(mid.blur).toBeLessThan(loud.blur);
    expect(parseInt(dim.core, 16)).toBeLessThan(parseInt(mid.core, 16));
    expect(parseInt(mid.core, 16)).toBeLessThan(parseInt(loud.core, 16));

    // The flare keeps its proportions, so more gain reads as more of the same
    // effect rather than as a different one.
    expect(dim.width / dim.height).toBeCloseTo(mid.width / mid.height, 6);
    expect(loud.width / loud.height).toBeCloseTo(mid.width / mid.height, 6);
  });

  it('keeps the alpha channel a valid byte at maximum strength', () => {
    // intensity * 255 * 0.6 * 2 overflows 255, and an unclamped value would
    // produce a three-digit hex that silently breaks the whole colour.
    const { container } = mount([nodeAt('close', -520, VB.h / 2)]);
    act(() => { useGraphStore.getState().setEdgeGlowIntensity(2); });

    const background = visibleFlares(container)[0].firstChild.style.background;
    const stops = background.match(/#[0-9a-f]{6,}/gi) || [];
    expect(stops.length).toBeGreaterThan(0);
    stops.forEach(stop => expect(stop).toMatch(/^#[0-9a-f]{8}$/i));
  });

  it('renders nothing at all when adaptive steps down to off', () => {
    // Past EDGE_GLOW_FAST_MAX_COUNT, where adaptive resolves to off.
    const nodes = Array.from({ length: 801 }, (_, i) => nodeAt(`n${i}`, -4000, i));
    act(() => { useGraphStore.getState().setEdgeGlowMode('adaptive'); });

    const { container } = mount(nodes);

    expect(flareSlots(container)).toHaveLength(0);
  });

  it('unregisters its painter on unmount', () => {
    const { unmount } = mount([nodeAt('far', -5000, VB.h / 2)]);
    expect(typeof glowRef.current).toBe('function');
    unmount();
    expect(glowRef.current).toBeNull();
  });
});

import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import EdgeGlowIndicator from '../../src/components/EdgeGlowIndicator.jsx';
import useGraphStore from '../../src/store/graphStore.js';

// The overlay sits inside the canvas container, which is the full viewport here.
const VIEW_W = 1000;
const VIEW_H = 800;
const CANVAS_ORIGIN = 50000;

// Nodes carry their own dimensions so getNodeDimensions never has to measure.
const makeNode = (id, x, y) => ({
  id,
  x,
  y,
  color: '#8B0000',
  name: id,
  prototype: { name: id, color: '#8B0000' }
});

const dimsFor = (nodes) => new Map(nodes.map(n => [n.id, { currentWidth: 100, currentHeight: 40 }]));

/**
 * The inverse of the projection the painter does: where a node has to sit in
 * canvas coordinates for its centre to land at (px, py) on screen.
 */
const canvasPosFor = (px, py, pan, zoom) => ({
  x: (px - pan.x) / zoom - CANVAS_ORIGIN - 50,
  y: (py - pan.y) / zoom - CANVAS_ORIGIN - 20
});

const Harness = ({ nodes, pan, zoom, panRef, zoomRef, glowRef }) => {
  const containerRef = React.useRef(null);
  return (
    <div ref={containerRef} style={{ width: VIEW_W, height: VIEW_H }}>
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
        canvasViewportSize={{ width: VIEW_W, height: VIEW_H }}
      />
    </div>
  );
};

// Flares are the pool's outer divs: absolutely positioned, zero-sized, each
// wrapping exactly one appearance div.
const flareSlots = (container) =>
  Array.from(container.querySelectorAll('div[style*="transform-origin"]'));

const visibleFlares = (container) =>
  flareSlots(container).filter(el => el.style.display !== 'none');

describe('EdgeGlowIndicator', () => {
  let panRef;
  let zoomRef;
  let glowRef;

  beforeEach(() => {
    localStorage.clear();
    window.innerWidth = VIEW_W;
    window.innerHeight = VIEW_H;
    // jsdom lays nothing out, so the container measures 0x0 by default and the
    // painter would bail. Pin it to the viewport.
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: VIEW_W, bottom: VIEW_H, width: VIEW_W, height: VIEW_H, x: 0, y: 0 };
    };
    panRef = { current: { x: 0, y: 0 } };
    zoomRef = { current: 1 };
    glowRef = { current: null };
    act(() => { useGraphStore.getState().setEdgeGlowMode('fancy'); });
  });

  afterEach(() => {
    cleanup();
    delete Element.prototype.getBoundingClientRect;
  });

  it('draws a flare for an off-screen Thing and none for an on-screen one', () => {
    const pan = { x: 0, y: 0 };
    const off = canvasPosFor(-5000, VIEW_H / 2, pan, 1);
    const on = canvasPosFor(VIEW_W / 2, VIEW_H / 2, pan, 1);
    const nodes = [makeNode('far-left', off.x, off.y), makeNode('centre', on.x, on.y)];

    const { container } = render(
      <Harness nodes={nodes} pan={pan} zoom={1} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );

    const shown = visibleFlares(container);
    expect(shown).toHaveLength(1);
    // Off to the left, so the flare rides just past the left border, unrotated.
    expect(shown[0].style.transform).toBe(`translate(-3px, ${VIEW_H / 2}px) rotate(0deg)`);
  });

  it('tracks a live pan without waiting for the settled transform', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. The painter used to return early for
    // the whole duration of a gesture and let the settled props put it right
    // afterwards, so on a large web the flares sat still through the pan and
    // jumped at the end. A live update must move them on its own.
    const pan = { x: 0, y: 0 };
    const above = canvasPosFor(VIEW_W / 2, -5000, pan, 1);
    const nodes = [makeNode('above', above.x, above.y)];

    const { container } = render(
      <Harness nodes={nodes} pan={pan} zoom={1} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );

    const before = visibleFlares(container)[0].style.transform;
    expect(before).toBe(`translate(${VIEW_W / 2}px, -3px) rotate(90deg)`);

    // Pan right by 200px. The settled `panOffset` prop is deliberately NOT
    // updated — this is mid-gesture.
    act(() => {
      panRef.current = { x: 200, y: 0 };
      glowRef.current();
    });

    const after = visibleFlares(container)[0].style.transform;
    expect(after).toBe(`translate(${VIEW_W / 2 + 200}px, -3px) rotate(90deg)`);
  });

  it('moves a Thing that leaves the viewport mid-gesture onto the border', () => {
    const pan = { x: 0, y: 0 };
    const inside = canvasPosFor(VIEW_W / 2, VIEW_H / 2, pan, 1);
    const nodes = [makeNode('inside', inside.x, inside.y)];

    const { container } = render(
      <Harness nodes={nodes} pan={pan} zoom={1} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );
    expect(visibleFlares(container)).toHaveLength(0);

    // Pan far enough left that the node exits the right-hand edge.
    act(() => {
      panRef.current = { x: 3000, y: 0 };
      glowRef.current();
    });

    const shown = visibleFlares(container);
    expect(shown).toHaveLength(1);
    expect(shown[0].style.transform).toBe(`translate(${VIEW_W + 3}px, ${VIEW_H / 2}px) rotate(180deg)`);
  });

  it('hides the slots a shrinking flare count leaves behind', () => {
    const pan = { x: 0, y: 0 };
    const nodes = [
      makeNode('a', ...Object.values(canvasPosFor(-4000, 100, pan, 1))),
      makeNode('b', ...Object.values(canvasPosFor(-4000, 300, pan, 1))),
      makeNode('c', ...Object.values(canvasPosFor(-4000, 500, pan, 1)))
    ];

    const { container, rerender } = render(
      <Harness nodes={nodes} pan={pan} zoom={1} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );
    expect(visibleFlares(container)).toHaveLength(3);

    // Bring them all on screen. The pool keeps its slots; they must go dark
    // rather than keep their last transform.
    act(() => {
      panRef.current = { x: 4500, y: 0 };
      glowRef.current();
    });
    expect(visibleFlares(container)).toHaveLength(0);
    expect(flareSlots(container).length).toBeGreaterThanOrEqual(3);
  });

  it('grows the pool past its first block when a web needs more flares', () => {
    const pan = { x: 0, y: 0 };
    // 40 Things stacked off the left edge — more than one POOL_CHUNK of 16.
    const nodes = Array.from({ length: 40 }, (_, i) => {
      const p = canvasPosFor(-4000, 20 * (i + 1), pan, 1);
      return makeNode(`n${i}`, p.x, p.y);
    });

    const { container } = render(
      <Harness nodes={nodes} pan={pan} zoom={1} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );

    expect(visibleFlares(container)).toHaveLength(40);
  });

  it('gives fancy a blur and a halo, and fast neither', () => {
    const pan = { x: 0, y: 0 };
    const off = canvasPosFor(-5000, VIEW_H / 2, pan, 1);
    const nodes = [makeNode('far', off.x, off.y)];

    const { container } = render(
      <Harness nodes={nodes} pan={pan} zoom={1} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );

    const appearance = () => visibleFlares(container)[0].firstChild.style;
    expect(appearance().filter).toMatch(/blur/);
    expect(appearance().boxShadow).not.toBe('');
    expect(appearance().background).toMatch(/radial-gradient/);

    act(() => { useGraphStore.getState().setEdgeGlowMode('fast'); });

    expect(appearance().filter).toBe('');
    expect(appearance().boxShadow).toBe('');
    // The gradient alone still has to read as a glow.
    expect(appearance().background).toMatch(/radial-gradient/);
  });

  it('renders nothing at all when adaptive steps down to off', () => {
    const pan = { x: 0, y: 0 };
    // Past EDGE_GLOW_FAST_MAX_COUNT, so adaptive resolves to off.
    const nodes = Array.from({ length: 801 }, (_, i) => {
      const p = canvasPosFor(-4000, i, pan, 1);
      return makeNode(`n${i}`, p.x, p.y);
    });
    act(() => { useGraphStore.getState().setEdgeGlowMode('adaptive'); });

    const { container } = render(
      <Harness nodes={nodes} pan={pan} zoom={1} panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );

    expect(flareSlots(container)).toHaveLength(0);
  });

  it('unregisters its painter on unmount', () => {
    const pan = { x: 0, y: 0 };
    const off = canvasPosFor(-5000, VIEW_H / 2, pan, 1);
    const { unmount } = render(
      <Harness nodes={[makeNode('far', off.x, off.y)]} pan={pan} zoom={1}
        panRef={panRef} zoomRef={zoomRef} glowRef={glowRef} />
    );
    expect(typeof glowRef.current).toBe('function');
    unmount();
    expect(glowRef.current).toBeNull();
  });
});

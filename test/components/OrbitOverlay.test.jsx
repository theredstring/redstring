import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import OrbitOverlay from '../../src/components/OrbitOverlay.jsx';
import { EDGE_LABEL_BASE_FONT_SIZE, estimateEdgeLabelWidth } from '../../src/services/layoutGeometry.js';
import { POLY_TIP } from '../../src/utils/canvas/edgeRouting.js';

// Drive requestAnimationFrame by hand so we can count frames and React commits.
let rafQueue = [];
let now = 0;

const flushFrames = (count, stepMs = 16) => {
  for (let i = 0; i < count; i++) {
    const due = rafQueue;
    rafQueue = [];
    now += stepMs;
    act(() => { due.forEach((cb) => cb(now)); });
  }
};

// jsdom has no 2D context, and the text measurement layer needs one. A fixed
// per-character advance is enough: these tests assert geometry relationships,
// not exact glyph widths.
const stubCanvas2D = () => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    let font = '';
    return {
      get font() { return font; },
      set font(v) { font = v; },
      measureText: (text) => {
        const size = Number((font.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16;
        return {
          width: text.length * size * 0.55,
          actualBoundingBoxAscent: size * 0.8,
          actualBoundingBoxDescent: size * 0.2,
        };
      },
    };
  };
};

beforeEach(() => {
  rafQueue = [];
  now = 0;
  stubCanvas2D();
  vi.stubGlobal('requestAnimationFrame', (cb) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const candidate = (id, predicate, extra = {}) => ({
  id,
  name: `Candidate ${id}`,
  color: '#8B0000',
  predicate,
  ...extra,
});

// An item's live box: its background rect plus whatever drift the animation
// loop has written onto the group. The overlay is always rendered with its
// focus node at the origin, so these are also vectors from the focus centre.
const itemBox = (itemG) => {
  const rect = itemG.querySelector('rect');
  const drift = itemG.getAttribute('transform')?.match(/^translate\(([-\d.]+), ([-\d.]+)\)/);
  const dx = drift ? Number(drift[1]) : 0;
  const dy = drift ? Number(drift[2]) : 0;
  const w = Number(rect.getAttribute('width'));
  const h = Number(rect.getAttribute('height'));
  return { w, h, cx: Number(rect.getAttribute('x')) + dx + w / 2, cy: Number(rect.getAttribute('y')) + dy + h / 2 };
};

// Distance from a centred box's centre to its border along a unit direction.
const borderDist = (w, h, ux, uy) => Math.min(
  ux !== 0 ? (w / 2) / Math.abs(ux) : Infinity,
  uy !== 0 ? (h / 2) / Math.abs(uy) : Infinity
);

// Where a connection's label group sits, as a distance from the focus centre.
const labelDistance = (connG) => {
  const m = connG.querySelectorAll('g')[1].getAttribute('transform')
    .match(/translate\(([-\d.]+), ([-\d.]+)\)/);
  return Math.hypot(Number(m[1]), Number(m[2]));
};

const renderOverlay = (props = {}) => {
  const spy = vi.fn();
  const Counting = (p) => { spy(); return <OrbitOverlay {...p} />; };
  // One tree builder for both the initial render and any re-render: swapping the
  // component TYPE at this position would unmount rather than update, throwing
  // away every ref the overlay keeps its animation state in.
  const tree = (p) => (
    <DndProvider backend={HTML5Backend}>
      <svg>
        <Counting
          centerX={0}
          centerY={0}
          focusWidth={400}
          focusHeight={200}
          ring1Candidates={[candidate('a', 'instanceOf'), candidate('b', 'partOf')]}
          ring2Candidates={[]}
          ring3Candidates={[]}
          ring4Candidates={[]}
          onOrbitItemClick={() => {}}
          {...p}
        />
      </svg>
    </DndProvider>
  );
  const utils = render(tree(props));
  return {
    ...utils,
    spy,
    rerenderWith: (next) => act(() => { utils.rerender(tree({ ...props, ...next })); }),
  };
};

describe('OrbitOverlay', () => {
  it('animates without re-rendering React on every frame', () => {
    const { spy, container } = renderOverlay();
    const initialRenders = spy.mock.calls.length;

    flushFrames(30);

    expect(spy.mock.calls.length).toBe(initialRenders);
    // ...and the animation actually ran: items carry a drift transform.
    const items = container.querySelectorAll('.orbit-items > g');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('transform')).toMatch(/translate\(/);
  });

  it('draws connection labels at the canvas default size', () => {
    const { container } = renderOverlay();
    const labels = container.querySelectorAll('.orbit-connection text');
    expect(labels.length).toBe(2);
    for (const label of labels) {
      expect(Number(label.getAttribute('font-size'))).toBeCloseTo(EDGE_LABEL_BASE_FONT_SIZE, 5);
    }
  });

  it('uses the canvas arrow polygon and stroke width', () => {
    const { container } = renderOverlay();
    const polygon = container.querySelector('.orbit-connection polygon');
    expect(polygon.getAttribute('points')).toBe('-26,34 26,34 0,-34');
    const line = container.querySelector('.orbit-connection line');
    expect(Number(line.getAttribute('stroke-width'))).toBe(27);
  });

  it('stops the arrow at the target border rather than inside the node', () => {
    const { container } = renderOverlay();
    flushFrames(3);

    const items = container.querySelectorAll('.orbit-items > g');
    const conns = container.querySelectorAll('.orbit-connection');

    for (let i = 0; i < conns.length; i++) {
      const arrowG = conns[i].querySelectorAll('g')[0];
      const m = arrowG.getAttribute('transform')
        .match(/translate\(([-\d.]+), ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+)\)/);
      expect(m).toBeTruthy();
      const [ax, ay, angleDeg, cw] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];

      // The polygon points up (-y) and is rotated by angle+90, so the tip sits
      // POLY_TIP*cw ahead of the origin along the connection's direction.
      const rad = (angleDeg - 90) * Math.PI / 180;
      const tipX = ax + Math.cos(rad) * POLY_TIP * cw;
      const tipY = ay + Math.sin(rad) * POLY_TIP * cw;

      // Node box for this item, from its background rect plus its live transform.
      const rect = items[i].querySelector('rect');
      const drift = items[i].getAttribute('transform')
        .match(/^translate\(([-\d.]+), ([-\d.]+)\)/);
      const dx = drift ? Number(drift[1]) : 0;
      const dy = drift ? Number(drift[2]) : 0;
      const x = Number(rect.getAttribute('x')) + dx;
      const y = Number(rect.getAttribute('y')) + dy;
      const w = Number(rect.getAttribute('width'));
      const h = Number(rect.getAttribute('height'));

      // Signed distance outside the box: <= 0 means at or inside the border.
      const depth = Math.max(
        Math.abs(tipX - (x + w / 2)) - w / 2,
        Math.abs(tipY - (y + h / 2)) - h / 2
      );
      expect(depth).toBeLessThanOrEqual(0.01);   // never pokes out past the border
      expect(depth).toBeGreaterThan(-6);          // and doesn't sink into the node
    }
  });

  it('reserves radial room for long labels', () => {
    const shortLabel = renderOverlay({ ring1Candidates: [candidate('a', 'partOf')] });
    const shortX = Number(shortLabel.container.querySelector('.orbit-items rect').getAttribute('x'));
    cleanup();

    const longLabel = renderOverlay({
      ring1Candidates: [candidate('a', 'isThePrincipalManufacturingSubsidiaryOf')],
    });
    const longX = Number(longLabel.container.querySelector('.orbit-items rect').getAttribute('x'));

    expect(longX).toBeGreaterThan(shortX);
  });

  it('centres every label on the run between the focus node and its item', () => {
    // NodeCanvas builds a separate border-to-border path purely so an edge label
    // lands mid-visible-segment. Outer orbit rings used to start that run at the
    // ring inside them instead — which pinned their labels against their own
    // items and read as badly off-centre.
    const { container } = renderOverlay({
      ring1Candidates: [candidate('a', 'instanceOf')],
      ring2Candidates: [candidate('b', 'partOf')],
    });
    flushFrames(3);

    const items = container.querySelectorAll('.orbit-items > g');
    const conns = container.querySelectorAll('.orbit-connection');
    expect(conns.length).toBe(2);

    for (let i = 0; i < conns.length; i++) {
      const box = itemBox(items[i]);
      const len = Math.hypot(box.cx, box.cy);
      const ux = box.cx / len;
      const uy = box.cy / len;

      const dist = labelDistance(conns[i]);
      const behind = dist - borderDist(400, 200, ux, uy);              // focus border → label
      const ahead = (len - borderDist(box.w, box.h, -ux, -uy)) - dist; // label → item border

      expect(behind).toBeGreaterThan(0);
      expect(behind).toBeCloseTo(ahead, 6);
    }
  });

  it('extends only the item whose label outgrows its run, not its whole ring', () => {
    // Outer rings reserve no label room, so a long predicate can outgrow the run
    // it is centred on. The fix is local: that item steps outward far enough to
    // fit, and its ring-mate stays put. Sizing the ring for its worst label
    // instead is what used to push every ring beyond it out as well.
    const long = 'isThePrincipalManufacturingSubsidiaryOfTheParentHoldingCompany';
    // Resting positions only — no frames — so both renders are compared at the
    // same point in the drift animation.
    const ring1 = [candidate('a', 'instanceOf')];
    const radii = (container) => Array.from(container.querySelectorAll('.orbit-items > g'))
      .map((g) => { const b = itemBox(g); return Math.hypot(b.cx, b.cy); });

    // [ring1 a, ring2 b, ring2 c] in both renders; only c's predicate differs.
    const withLong = renderOverlay({ ring1Candidates: ring1, ring2Candidates: [candidate('b', 'partOf'), candidate('c', long)] });
    const items = withLong.container.querySelectorAll('.orbit-items > g');
    const longRadii = radii(withLong.container);
    cleanup();

    const control = renderOverlay({ ring1Candidates: ring1, ring2Candidates: [candidate('b', 'partOf'), candidate('c', 'partOf')] });
    const shortRadii = radii(control.container);

    // The long label moved its own item out...
    expect(longRadii[2]).toBeGreaterThan(shortRadii[2]);
    // ...and left its ring-mate, and the ring inside it, exactly where they were.
    expect(longRadii[1]).toBeCloseTo(shortRadii[1], 6);
    expect(longRadii[0]).toBeCloseTo(shortRadii[0], 6);

    // It moved far enough that the label actually fits the run it is centred on.
    const box = itemBox(items[2]);
    const len = Math.hypot(box.cx, box.cy);
    const ux = box.cx / len;
    const uy = box.cy / len;
    const run = (len - borderDist(box.w, box.h, -ux, -uy)) - borderDist(400, 200, ux, uy);
    expect(run).toBeGreaterThan(estimateEdgeLabelWidth(long, EDGE_LABEL_BASE_FONT_SIZE));
  });

  it('reports the circle it occupies so the canvas can frame it', () => {
    const onExtentChange = vi.fn();
    const { container, unmount } = renderOverlay({
      onExtentChange,
      ring1Candidates: [candidate('a', 'instanceOf'), candidate('b', 'partOf')],
      ring2Candidates: [candidate('c', 'hasPart')],
    });

    const extent = onExtentChange.mock.calls.at(-1)[0];
    expect(extent).toMatchObject({ centerX: 0, centerY: 0 });

    // Every item's farthest corner is inside the reported circle...
    const farthest = Math.max(...Array.from(container.querySelectorAll('.orbit-items > g')).map((g) => {
      const b = itemBox(g);
      return Math.max(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
        Math.hypot(b.cx + sx * b.w / 2, b.cy + sy * b.h / 2)));
    }));
    expect(extent.radius).toBeGreaterThanOrEqual(farthest);
    // ...and not so far outside it that framing would leave the orbit tiny.
    expect(extent.radius).toBeLessThan(farthest * 1.1);

    unmount();
    // Cleared on the way out — otherwise the next orbit gets framed on this one.
    expect(onExtentChange.mock.calls.at(-1)[0]).toBeNull();
  });

  it('reports no extent until something is actually placed', () => {
    // Candidates arrive asynchronously. Framing the bare focus node in the gap
    // would zoom hard in and then straight back out as the first results land.
    const onExtentChange = vi.fn();
    renderOverlay({ onExtentChange, ring1Candidates: [] });
    expect(onExtentChange.mock.calls.at(-1)[0]).toBeNull();
  });

  it('renders no connection for hidden predicates', () => {
    const { container } = renderOverlay({
      ring1Candidates: [candidate('a', 'relatedTo'), candidate('b', 'seeAlso'), candidate('c', 'instanceOf')],
    });
    expect(container.querySelectorAll('.orbit-connection').length).toBe(1);
    expect(container.querySelectorAll('.orbit-items > g').length).toBe(3);
  });

  it('schedules no animation frames when there is nothing to show', () => {
    const { container } = renderOverlay({
      ring1Candidates: [],
      ring2Candidates: [],
      ring3Candidates: [],
      ring4Candidates: [],
    });

    expect(container.querySelector('.orbit-overlay')).toBeNull();
    expect(rafQueue.length).toBe(0);
  });

  it('keeps rotating after entrances without ever touching React', () => {
    const { spy } = renderOverlay();
    const before = spy.mock.calls.length;
    // Entrance is ~350ms; at 16ms/frame it completes near frame 22. Rotation
    // then keeps the imperative loop alive indefinitely — but never through a
    // React commit.
    flushFrames(60);
    expect(rafQueue.length).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBe(before);
  });

  it('pauses rotation on hover and resumes from the frozen pose', () => {
    const { container } = renderOverlay();
    flushFrames(40); // finish entrances so hover highlighting is armed

    const item = container.querySelector('.orbit-items > g');
    const conn = container.querySelector('.orbit-connection');
    const moving = item.getAttribute('transform');
    flushFrames(6); // > one steady-write interval (15Hz ≈ every 5th 16ms frame)
    expect(item.getAttribute('transform')).not.toBe(moving); // rotation is live

    fireEvent.mouseEnter(item);
    // Highlight rides [data-hovered] + stylesheet fill/stroke-opacity — group
    // opacity would force the item into an offscreen isolation surface.
    expect(item.hasAttribute('data-hovered')).toBe(true);
    expect(conn.hasAttribute('data-hovered')).toBe(true);
    expect(item.style.opacity).toBe('');
    flushFrames(2); // let the pause land, then the loop stands down
    const frozen = item.getAttribute('transform');
    flushFrames(4);
    expect(item.getAttribute('transform')).toBe(frozen); // clock held while hovered

    fireEvent.mouseLeave(item);
    expect(item.hasAttribute('data-hovered')).toBe(false);
    expect(conn.hasAttribute('data-hovered')).toBe(false);
    flushFrames(6); // > one steady-write interval
    expect(item.getAttribute('transform')).not.toBe(frozen); // resumed
  });

  it('fades every other triplet back while one is hovered, and restores them after', () => {
    const { container } = renderOverlay({
      ring1Candidates: [candidate('a', 'instanceOf'), candidate('b', 'partOf')],
      ring2Candidates: [candidate('c', 'hasPart')],
    });
    flushFrames(40); // finish entrances — dimming waits for them, like the highlight

    const items = Array.from(container.querySelectorAll('.orbit-items > g'));
    const conns = Array.from(container.querySelectorAll('.orbit-connection'));
    const dimmed = () => [...items, ...conns].filter((el) => el.hasAttribute('data-dimmed'));

    expect(dimmed()).toEqual([]);

    fireEvent.mouseEnter(items[0]);
    // Everything except the hovered item and its own connection goes back.
    expect(dimmed()).toEqual([items[1], items[2], conns[1], conns[2]]);
    expect(items[0].hasAttribute('data-dimmed')).toBe(false);
    expect(conns[0].hasAttribute('data-dimmed')).toBe(false);
    // Via the stylesheet, as ever — group opacity would cost an isolation surface.
    expect(items[1].style.opacity).toBe('');
    expect(items[1].style.fillOpacity).toBe('');

    fireEvent.mouseLeave(items[0]);
    expect(dimmed()).toEqual([]);
  });

  it('keeps the orbit dimmed when the pointer crosses straight to another triplet', () => {
    // Leave and enter arrive in browser-chosen order. A leave that fired after
    // the next item's enter used to clear the new hover, un-dimming everything
    // and restarting rotation under the pointer.
    const { container } = renderOverlay();
    flushFrames(40);

    const items = Array.from(container.querySelectorAll('.orbit-items > g'));
    fireEvent.mouseEnter(items[0]);
    fireEvent.mouseEnter(items[1]);
    fireEvent.mouseLeave(items[0]); // the straggler

    expect(items[1].hasAttribute('data-hovered')).toBe(true);
    expect(items[1].hasAttribute('data-dimmed')).toBe(false);
    expect(items[0].hasAttribute('data-dimmed')).toBe(true);

    // ...and rotation is still held for the triplet actually under the pointer.
    flushFrames(2); // the already-scheduled frame only stands down when it runs
    const frozen = items[1].getAttribute('transform');
    flushFrames(6);
    expect(items[1].getAttribute('transform')).toBe(frozen);
  });

  it('brings a late arrival in already dimmed when a triplet is hovered', () => {
    // Candidates stream in, so entrances finish mid-hover. Their alpha is
    // written inline until they land, which outranks the stylesheet — the dim
    // has to be re-applied at the moment the entrance hands alpha back.
    const { rerenderWith, container } = renderOverlay();
    flushFrames(40);

    const first = container.querySelector('.orbit-items > g');
    fireEvent.mouseEnter(first);

    rerenderWith({
      ring1Candidates: [candidate('a', 'instanceOf'), candidate('b', 'partOf'), candidate('late', 'hasPart')],
    });

    const late = container.querySelectorAll('.orbit-items > g')[2];
    expect(late.hasAttribute('data-dimmed')).toBe(false); // still entering
    flushFrames(40);                                      // entrance completes
    expect(late.hasAttribute('data-dimmed')).toBe(true);
    expect(late.style.fillOpacity).toBe('');              // handed back to the sheet
  });

  it('never uses group opacity, so no entry needs an isolation surface', () => {
    // A value strictly between 0 and 1 in `style.opacity` on a multi-child <g>
    // makes the rasterizer allocate an offscreen surface for that group. During
    // an entrance that would happen to every item and connection every frame —
    // ~80 surfaces churning at frame rate, which is what pushed the compositor's
    // tile budget over in bursts. The fade rides inherited fill/stroke-opacity
    // instead, which paints inline with no surface.
    const { container } = renderOverlay();
    const item = container.querySelector('.orbit-items > g');
    const conn = container.querySelector('.orbit-connection');

    const assertNoGroupOpacity = (where) => {
      for (const el of [item, conn]) {
        const o = el.style.opacity;
        if (o === '') continue;
        const n = Number(o);
        expect(n === 0 || n === 1, `group opacity ${o} on ${el.getAttribute('class')} ${where}`).toBe(true);
      }
    };

    // Mid-entrance: alpha ramps, but via fill-opacity — never group opacity.
    flushFrames(3);
    assertNoGroupOpacity('mid-entrance');
    const mid = Number(item.style.fillOpacity);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(Number(item.style.strokeOpacity)).toBeCloseTo(mid, 6);
    expect(item.hasAttribute('data-entering')).toBe(true);

    // Alpha climbs as the entrance eases in.
    flushFrames(4);
    expect(Number(item.style.fillOpacity)).toBeGreaterThan(mid);

    // Entrance complete: inline alpha handed back to the stylesheet.
    flushFrames(40);
    assertNoGroupOpacity('after entrance');
    for (const el of [item, conn]) {
      expect(el.style.fillOpacity).toBe('');
      expect(el.style.strokeOpacity).toBe('');
      expect(el.style.opacity).toBe('');
      expect(el.hasAttribute('data-entering')).toBe(false);
    }
  });

  it('keeps animating through a canvas gesture by default', () => {
    // The pause existed because a translucent scrim inside the content group
    // made every write here blend through it. The scrim is its own compositor
    // layer now, so the animation is free to keep running while the canvas
    // moves.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { container } = renderOverlay();
      flushFrames(40); // entrances done, rotation running
      const item = container.querySelector('.orbit-items > g');

      const before = item.getAttribute('transform');
      act(() => {
        window.dispatchEvent(new CustomEvent('canvas-transform-change', { detail: { zoom: 1.2 } }));
      });
      expect(rafQueue.length).toBeGreaterThan(0); // loop still alive
      flushFrames(6); // > one steady-write interval
      expect(item.getAttribute('transform')).not.toBe(before); // and still moving
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the animation longer through a zoom than through a pan', () => {
    // Zoom arrives in discrete steps; resuming in the gap between two of them
    // makes the orbit stutter back to life mid-zoom.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.__orbitGesturePause = true; // opt in — the default no longer pauses
    try {
      const { container } = renderOverlay();
      flushFrames(40); // entrances done, rotation running
      const item = container.querySelector('.orbit-items > g');

      const fire = (zoom) => act(() => {
        window.dispatchEvent(new CustomEvent('canvas-transform-change', { detail: { zoom } }));
      });

      // Two events at the SAME zoom read as a pan: resumed by 400ms.
      fire(1);
      fire(1);
      flushFrames(1); // the already-scheduled frame stands down
      expect(rafQueue.length).toBe(0); // paused either way
      act(() => { vi.advanceTimersByTime(400); });
      expect(rafQueue.length).toBeGreaterThan(0);

      // A changed zoom holds past the pan delay…
      flushFrames(2);
      fire(1);
      fire(1.2);
      flushFrames(1);
      const frozen = item.getAttribute('transform');
      act(() => { vi.advanceTimersByTime(400); });
      expect(rafQueue.length).toBe(0);
      flushFrames(4);
      expect(item.getAttribute('transform')).toBe(frozen); // still frozen

      // …and resumes once the longer window elapses.
      act(() => { vi.advanceTimersByTime(300); });
      expect(rafQueue.length).toBeGreaterThan(0);
      flushFrames(4);
      expect(item.getAttribute('transform')).not.toBe(frozen);
    } finally {
      delete window.__orbitGesturePause;
      vi.useRealTimers();
    }
  });

  it('freezes rotation but stays visible while the canvas transform changes', () => {
    // Fake only the timeout clock — faking rAF would displace the manual
    // rafQueue stub the frame accounting in these tests is built on.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.__orbitGesturePause = true; // this covers the opt-in pause path
    try {
      const { container } = renderOverlay();
      flushFrames(40); // entrances done, rotation running
      const root = container.querySelector('.orbit-overlay');
      const item = container.querySelector('.orbit-items > g');
      expect(rafQueue.length).toBeGreaterThan(0);

      // Fired synchronously by NodeCanvas's pan/zoom mutators. NodeCanvas now
      // freezes the canvas raster and scales it on the compositor rather than
      // re-rastering per tick, so the default 'full' mode sheds nothing and the
      // overlay stays on screen through the gesture. The rotation loop still
      // stops writing: its writes are SVG mutations inside the frozen content
      // group and would invalidate the raster being scaled.
      act(() => { window.dispatchEvent(new Event('canvas-transform-change')); });
      expect(root.style.visibility).toBe('');
      expect(root.hasAttribute('data-canvas-gesture')).toBe(false);

      const frozen = item.getAttribute('transform');
      flushFrames(3); // the already-scheduled frame stands down without writing
      expect(item.getAttribute('transform')).toBe(frozen);
      expect(rafQueue.length).toBe(0);

      act(() => { vi.advanceTimersByTime(300); });
      expect(rafQueue.length).toBeGreaterThan(0); // rotation restarted
      flushFrames(6); // > one steady-write interval
      expect(item.getAttribute('transform')).not.toBe(frozen);

      // 'lod' keeps geometry visible and sheds text/images through the
      // stylesheet's [data-canvas-gesture] rules.
      window.__orbitZoomMode = 'lod';
      act(() => { window.dispatchEvent(new Event('canvas-transform-change')); });
      expect(root.style.visibility).toBe('');
      expect(root.hasAttribute('data-canvas-gesture')).toBe(true);
      const sheet = container.querySelector('.orbit-overlay style').textContent;
      expect(sheet).toContain('[data-canvas-gesture] text');
      expect(sheet).toContain('[data-canvas-gesture] image');
      act(() => { vi.advanceTimersByTime(300); });
      expect(root.hasAttribute('data-canvas-gesture')).toBe(false);

      // 'hide' remains available as the pre-compositor fallback.
      window.__orbitZoomMode = 'hide';
      act(() => { window.dispatchEvent(new Event('canvas-transform-change')); });
      expect(root.style.visibility).toBe('hidden');
      act(() => { vi.advanceTimersByTime(300); });
      expect(root.style.visibility).toBe('');
    } finally {
      delete window.__orbitZoomMode;
      delete window.__orbitGesturePause;
      vi.useRealTimers();
    }
  });

  it('stops the animation loop when unmounted', () => {
    const { unmount } = renderOverlay();
    flushFrames(3);
    expect(rafQueue.length).toBeGreaterThan(0);

    unmount();
    rafQueue = [];
    flushFrames(3);
    expect(rafQueue.length).toBe(0);
  });
});

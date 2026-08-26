import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import OrbitOverlay from '../../src/components/OrbitOverlay.jsx';
import { EDGE_LABEL_BASE_FONT_SIZE } from '../../src/services/layoutGeometry.js';
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

const renderOverlay = (props = {}) => {
  const spy = vi.fn();
  const Counting = (p) => { spy(); return <OrbitOverlay {...p} />; };
  const utils = render(
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
          {...props}
        />
      </svg>
    </DndProvider>
  );
  return { ...utils, spy };
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

  it('drops group opacity after entrance so nothing needs an isolation surface', () => {
    const { container } = renderOverlay();
    const item = container.querySelector('.orbit-items > g');
    const conn = container.querySelector('.orbit-connection');

    flushFrames(3); // mid-entrance: fading in via inline group opacity
    const mid = Number(item.style.opacity);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);

    flushFrames(40); // entrance complete
    expect(item.style.opacity).toBe('');
    expect(conn.style.opacity).toBe('');
  });

  it('sheds text/image detail and freezes rotation while the canvas transform changes', () => {
    // Fake only the timeout clock — faking rAF would displace the manual
    // rafQueue stub the frame accounting in these tests is built on.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { container } = renderOverlay();
      flushFrames(40); // entrances done, rotation running
      const root = container.querySelector('.orbit-overlay');
      const item = container.querySelector('.orbit-items > g');
      expect(rafQueue.length).toBeGreaterThan(0);

      // Fired synchronously by NodeCanvas's pan/zoom mutators. In the default
      // 'hide' mode the overlay sits the gesture out entirely — the only mode
      // measured quiet against the GPU tile budget — and the rotation loop
      // stops writing.
      act(() => { window.dispatchEvent(new Event('canvas-transform-change')); });
      expect(root.style.visibility).toBe('hidden');
      expect(root.hasAttribute('data-canvas-gesture')).toBe(false);

      const frozen = item.getAttribute('transform');
      flushFrames(3); // the already-scheduled frame stands down without writing
      expect(item.getAttribute('transform')).toBe(frozen);
      expect(rafQueue.length).toBe(0);

      act(() => { vi.advanceTimersByTime(300); });
      expect(root.style.visibility).toBe(''); // restored
      expect(rafQueue.length).toBeGreaterThan(0); // rotation restarted
      flushFrames(6); // > one steady-write interval
      expect(item.getAttribute('transform')).not.toBe(frozen);

      // 'lod' mode keeps geometry visible and sheds text/images through the
      // stylesheet's [data-canvas-gesture] rules instead.
      window.__orbitZoomMode = 'lod';
      act(() => { window.dispatchEvent(new Event('canvas-transform-change')); });
      expect(root.style.visibility).toBe('');
      expect(root.hasAttribute('data-canvas-gesture')).toBe(true);
      const sheet = container.querySelector('.orbit-overlay style').textContent;
      expect(sheet).toContain('[data-canvas-gesture] text');
      expect(sheet).toContain('[data-canvas-gesture] image');
      act(() => { vi.advanceTimersByTime(300); });
      expect(root.hasAttribute('data-canvas-gesture')).toBe(false);
    } finally {
      delete window.__orbitZoomMode;
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

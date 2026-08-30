import { describe, it, expect, afterEach } from 'vitest';
import { sampleColorAt } from './screenColorSample.js';

const SVG = 'http://www.w3.org/2000/svg';
const svgTags = new Set(['svg','g','rect','line','path','image','text']);
const BOX = { left: 0, top: 0, right: 100, bottom: 100 };

const make = (tag, opts = {}, parent) => {
  const { styles = {}, rect = BOX, hit } = opts;
  const el = svgTags.has(tag)
    ? document.createElementNS(SVG, tag)
    : document.createElement(tag);
  el.__styles = styles;
  if (styles.fill) el.setAttribute('fill', styles.fill);
  if (styles.stroke) el.setAttribute('stroke', styles.stroke);
  el.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
  // Stand in for isPointInFill/isPointInStroke, which jsdom has no geometry for.
  if (hit) {
    el.getScreenCTM = () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
    el.isPointInStroke = () => hit === 'stroke';
    el.isPointInFill = () => hit === 'fill';
  }
  // A horizontal stroke of half-width `halfWidth` centred on y=50: models a real
  // connection, so the tolerance ring in svgHitKind is actually exercised.
  if (typeof opts.halfWidth === 'number') {
    el.getScreenCTM = () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
    el.isPointInStroke = (p) => Math.abs(p.y - 50) <= opts.halfWidth;
    el.isPointInFill = () => false;
  }
  (parent || document.body).appendChild(el);
  return el;
};

const withStack = (stack, fn) => {
  document.elementsFromPoint = () => stack;
  const real = window.getComputedStyle;
  window.getComputedStyle = (el) => ({
    fill: el.__styles?.fill ?? 'rgb(0, 0, 0)',
    stroke: el.__styles?.stroke ?? 'none',
    backgroundColor: el.__styles?.backgroundColor ?? 'rgba(0, 0, 0, 0)',
    backgroundImage: el.__styles?.backgroundImage ?? 'none',
    visibility: el.__styles?.visibility ?? 'visible',
    display: el.__styles?.display ?? 'block',
    opacity: el.__styles?.opacity ?? '1',
  });
  try { return fn(); } finally { window.getComputedStyle = real; }
};

// The point sampled in every test.
const at = (stack) => withStack(stack, () => sampleColorAt(50, 50));

afterEach(() => { document.body.innerHTML = ''; });

describe('what the canvas actually renders', () => {
  it('Thing: <rect fill> under a hit <g> (pointer-events: none in real life)', () => {
    const svg = make('svg');
    const g = make('g', {}, svg);
    make('rect', { styles: { fill: 'rgb(139, 0, 0)' } }, g);
    expect(at([svg])).toBe('#8b0000');
  });

  it('Thing-group box: fill on a pointer-events:none rect, reached by descent', () => {
    // <rect fill={nodeGroupColor} stroke="none" pointerEvents="none" /> — the
    // browser hit test never sees it, so the stack only has the svg root.
    const svg = make('svg');
    const g = make('g', {}, svg);
    make('rect', { styles: { fill: 'rgb(32, 64, 96)', stroke: 'none' } }, g);
    expect(at([svg])).toBe('#204060');
  });

  it('Group boundary: dashed rect whose colour is its stroke, fill none', () => {
    const svg = make('svg');
    const g = make('g', {}, svg);
    make('path', { styles: { fill: 'none', stroke: 'rgb(0, 100, 200)' }, hit: 'stroke' }, g);
    expect(at([svg])).toBe('#0064c8');
  });

  it('Group title tag: group colour on the ring', () => {
    // <rect fill={theme.canvas.bg} stroke={groupColor} strokeWidth={6} />
    const svg = make('svg');
    const tag = make('rect', { styles: { fill: 'rgb(189, 181, 181)', stroke: 'rgb(139, 0, 0)' }, hit: 'stroke' }, svg);
    expect(at([tag])).toBe('#8b0000');
  });

  it('Group title tag: canvas colour inside the ring', () => {
    const svg = make('svg');
    const tag = make('rect', { styles: { fill: 'rgb(189, 181, 181)', stroke: 'rgb(139, 0, 0)' }, hit: 'fill' }, svg);
    expect(at([tag])).toBe('#bdb5b5');
  });

  it('Connection: nothing along the empty part of a diagonal bounding box', () => {
    const svg = make('svg');
    const line = make('line', { styles: { stroke: 'rgb(1, 2, 3)' }, hit: 'none' }, svg);
    expect(at([svg, line])).toBe(null);
  });

  it('Connection: the stroke where the line actually is', () => {
    const svg = make('svg');
    const line = make('line', { styles: { stroke: 'rgb(1, 2, 3)' }, hit: 'stroke' }, svg);
    expect(at([line])).toBe('#010203');
  });

  it('<text> label fill', () => {
    const svg = make('svg');
    const t = make('text', { styles: { fill: 'rgb(38, 0, 0)' }, hit: 'fill' }, svg);
    expect(at([t])).toBe('#260000');
  });
});

describe('connections: visible stroke vs the wider transparent hit path', () => {
  // NodeCanvas draws a 27-wide coloured stroke, then lays a transparent
  // data-edge-hit path of >=50 over it. The browser reports you as "on the
  // connection" across the wider one.
  const edge = (pointerY) => {
    const svg = make('svg');
    const g = make('g', {}, svg);
    const visible = make('path', { styles: { fill: 'none', stroke: 'rgb(0, 100, 200)' }, halfWidth: 13.5 }, g);
    const hitPath = make('path', { styles: { fill: 'none', stroke: 'rgba(0, 0, 0, 0)' }, halfWidth: 25 }, g);
    hitPath.setAttribute('data-edge-hit', '');
    const bg = make('rect', { styles: { fill: 'rgb(189, 181, 181)' }, hit: 'fill' }, svg);
    // Stack as the browser reports it: the transparent hit path is on top.
    return withStack([hitPath, g, bg, svg], () => sampleColorAt(50, pointerY));
  };

  it('dead centre on the line', () => {
    expect(edge(50)).toBe('#0064c8');
  });

  it('inside the visible stroke, off centre', () => {
    expect(edge(60)).toBe('#0064c8');
  });

  it('in the band the hit path covers but the visible stroke does not', () => {
    // 19px off: outside the 13.5 stroke, inside the 25 hit path. This is what
    // used to come back as the canvas background.
    expect(edge(69)).toBe('#0064c8');
  });

  it('well outside the connection falls through to the canvas', () => {
    expect(edge(95)).toBe('#bdb5b5');
  });
});

describe('ordering and pruning', () => {
  it('takes the topmost of stacked siblings', () => {
    const svg = make('svg');
    make('rect', { styles: { fill: 'rgb(1, 1, 1)' } }, svg);
    make('rect', { styles: { fill: 'rgb(2, 2, 2)' } }, svg);
    expect(at([svg])).toBe('#020202');
  });

  it('prunes subtrees whose box misses the point', () => {
    const svg = make('svg');
    const far = make('g', { rect: { left: 500, top: 500, right: 600, bottom: 600 } }, svg);
    make('rect', { styles: { fill: 'rgb(9, 9, 9)' }, rect: { left: 500, top: 500, right: 600, bottom: 600 } }, far);
    make('rect', { styles: { fill: 'rgb(4, 4, 4)' } }, svg);
    expect(at([svg])).toBe('#040404');
  });

  it('falls through a transparent label to the pill behind it', () => {
    const pill = make('div', { styles: { backgroundColor: 'rgb(222, 218, 218)' } });
    make('span', {}, pill);
    expect(at([pill])).toBe('#dedada');
  });

  it('reads a CSS gradient by its first stop', () => {
    const el = make('div', { styles: { backgroundImage: 'linear-gradient(to right, rgb(10, 20, 30), rgb(40, 50, 60))' } });
    expect(at([el])).toBe('#0a141e');
  });

  it('does not report a bare <g> as black', () => {
    const svg = make('svg');
    make('g', {}, svg);
    expect(at([svg])).toBe(null);
  });

  it('skips hidden and fully transparent elements', () => {
    const svg = make('svg');
    make('rect', { styles: { fill: 'rgb(7, 7, 7)', opacity: '0' } }, svg);
    make('rect', { styles: { fill: 'rgb(8, 8, 8)', visibility: 'hidden' } }, svg);
    expect(at([svg])).toBe(null);
  });

  it('looks through ignored subtrees, children included', () => {
    const overlay = make('div', { styles: { backgroundColor: 'rgb(255, 255, 255)' } });
    make('div', { styles: { backgroundColor: 'rgb(200, 200, 200)' } }, overlay);
    const behind = make('div', { styles: { backgroundColor: 'rgb(10, 20, 30)' } });
    expect(withStack([overlay, behind], () => sampleColorAt(50, 50, [overlay]))).toBe('#0a141e');
  });

  it('returns null over bare page ground', () => {
    expect(at([document.body, document.documentElement])).toBe(null);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  /**
   * A gradient is EVALUATED where the pointer is, not answered with its first
   * stop. The first stop is the right answer at exactly one edge of the box and
   * wrong across the whole rest of it — and a scroll fade, which is the shape
   * this turns up in most, is transparent at one end by construction.
   */
  it('reads a CSS gradient at the point, not at its first stop', () => {
    const el = make('div', { styles: { backgroundImage: 'linear-gradient(to right, rgb(10, 20, 30), rgb(40, 50, 60))' } });
    const along = (x) => withStack([el], () => sampleColorAt(x, 50));
    expect(along(0)).toBe('#0a141e');
    expect(along(50)).toBe('#19232d');
    expect(along(100)).toBe('#28323c');
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

// ---------------------------------------------------------------------------
// The suites below use the REAL getComputedStyle rather than the stub above,
// because what they are about — alpha, element opacity, gradient stops — is
// exactly what a hand-written style object would have to invent. They build the
// styles inline and let jsdom compute them, and supply the two things jsdom has
// no answer for: a box (it gives everything a zero-size rect) and a hit stack.
// ---------------------------------------------------------------------------

const VIEWPORT = { width: 1000, height: 800 };

const sized = (el, rect) => {
  el.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() {},
  });
  return el;
};

const full = (el) => sized(el, { top: 0, left: 0, ...VIEWPORT });

/**
 * The real elementsFromPoint returns the hit-testable elements under a point,
 * deepest first — so these hand over exactly that, in that order.
 */
const hitStack = (...els) => {
  document.elementsFromPoint = () => [...els, document.body, document.documentElement];
};

/** A plain HTML box with a background, at a known place. */
const box = (background, rect = { top: 0, left: 0, width: 200, height: 200 }) => {
  const el = document.createElement('div');
  el.style.backgroundColor = background;
  document.body.appendChild(sized(el, rect));
  return el;
};

beforeEach(() => {
  window.innerWidth = VIEWPORT.width;
  window.innerHeight = VIEWPORT.height;
  full(document.body);
  full(document.documentElement);
  hitStack();
});

/**
 * The bug this file exists for. The sampler used to take the topmost paint's rgb
 * and drop its alpha, so anything under a translucent layer read as that layer's
 * colour at full strength — and the unified selector lays an rgba(0,0,0,0.3)
 * sheet over the entire canvas.
 */
describe('sampleColorAt — compositing', () => {
  it('blends a translucent layer over what is behind it', () => {
    const behind = box('rgb(200, 0, 0)');
    const front = box('rgba(0, 0, 255, 0.5)');
    hitStack(front, behind);
    // 50% of (0,0,255) over (200,0,0) = (100, 0, 128) after rounding.
    expect(sampleColorAt(50, 50)).toBe('#640080');
  });

  it('composites a stack of them in order', () => {
    const bottom = box('rgb(0, 0, 0)');
    const middle = box('rgba(255, 255, 255, 0.5)');
    const top = box('rgba(255, 255, 255, 0.5)');
    hitStack(top, middle, bottom);
    // Black, half-whitened twice: 128, then 191.
    expect(sampleColorAt(50, 50)).toBe('#bfbfbf');
  });

  it('stops at the first opaque layer', () => {
    const behind = box('rgb(0, 255, 0)');
    const opaque = box('rgb(0, 0, 255)');
    const front = box('rgba(255, 0, 0, 0.5)');
    hitStack(front, opaque, behind);
    expect(sampleColorAt(50, 50)).toBe('#800080'); // red over blue, green unseen
  });

  it('carries element opacity into the layer it contributes', () => {
    const behind = box('rgb(0, 0, 0)');
    const front = box('rgb(255, 255, 255)');
    front.style.opacity = '0.25';
    hitStack(front, behind);
    expect(sampleColorAt(50, 50)).toBe('#404040');
  });

  it('multiplies ancestor opacity down the tree', () => {
    const behind = box('rgb(0, 0, 0)');
    const group = box('rgba(0, 0, 0, 0)');
    group.style.opacity = '0.5';
    const child = document.createElement('div');
    child.style.backgroundColor = 'rgb(255, 255, 255)';
    child.style.opacity = '0.5';
    group.appendChild(sized(child, { top: 0, left: 0, width: 200, height: 200 }));
    hitStack(group, behind);
    // 0.5 × 0.5 of white over black.
    expect(sampleColorAt(50, 50)).toBe('#404040');
  });

  it('paints a child over its parent background, not under it', () => {
    const parent = box('rgb(255, 0, 0)');
    const child = document.createElement('div');
    child.style.backgroundColor = 'rgb(0, 0, 255)';
    parent.appendChild(sized(child, { top: 0, left: 0, width: 200, height: 200 }));
    hitStack(parent);
    expect(sampleColorAt(50, 50)).toBe('#0000ff');
  });

  it('un-premultiplies a stack that never reaches opaque', () => {
    const only = box('rgba(255, 0, 0, 0.25)');
    hitStack(only);
    // Nothing behind it at all: the answer is the colour, not the colour faded
    // toward a ground that was never there.
    expect(sampleColorAt(50, 50)).toBe('#ff0000');
  });
});

describe('sampleColorAt — scrims', () => {
  const scrim = () => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    document.body.appendChild(full(el));
    return el;
  };

  it('reads through a full-screen translucent sheet untinted', () => {
    const behind = box('rgb(139, 0, 0)');
    const sheet = scrim();
    hitStack(sheet, behind);
    expect(sampleColorAt(50, 50)).toBe('#8b0000');
  });

  it('still reads a full-screen OPAQUE layer, which is a page and not a scrim', () => {
    const page = document.createElement('div');
    page.style.position = 'fixed';
    page.style.backgroundColor = 'rgb(189, 181, 181)';
    document.body.appendChild(full(page));
    hitStack(page);
    expect(sampleColorAt(50, 50)).toBe('#bdb5b5');
  });

  it('still reads a translucent layer that is not full-screen', () => {
    const behind = box('rgb(0, 0, 0)');
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
    document.body.appendChild(sized(panel, { top: 0, left: 0, width: 300, height: 800 }));
    hitStack(panel, behind);
    expect(sampleColorAt(50, 50)).toBe('#808080');
  });

  it('keeps walking the scrim\'s own children, which are the dialog on it', () => {
    const sheet = scrim();
    const dialog = document.createElement('div');
    dialog.style.backgroundColor = 'rgb(38, 0, 0)';
    sheet.appendChild(sized(dialog, { top: 0, left: 0, width: 400, height: 300 }));
    hitStack(sheet);
    expect(sampleColorAt(50, 50)).toBe('#260000');
  });
});

/**
 * A gradient used to be answered with its first stop, which for a scroll fade —
 * transparent at one end by construction — is the one answer that is wrong
 * everywhere except at the very edge.
 */
describe('sampleColorAt — CSS gradients', () => {
  const gradient = (image, rect = { top: 0, left: 0, width: 100, height: 100 }) => {
    const el = document.createElement('div');
    el.style.backgroundImage = image;
    document.body.appendChild(sized(el, rect));
    return el;
  };

  it('evaluates a `to bottom` gradient at the point', () => {
    const behind = box('rgb(0, 0, 0)');
    const fade = gradient('linear-gradient(to bottom, rgb(255, 255, 255), rgb(0, 0, 0))');
    hitStack(fade, behind);
    expect(sampleColorAt(50, 0)).toBe('#ffffff');
    expect(sampleColorAt(50, 50)).toBe('#808080');
    expect(sampleColorAt(50, 99)).toBe('#030303');
  });

  it('runs `to top` the other way', () => {
    const behind = box('rgb(0, 0, 0)');
    const fade = gradient('linear-gradient(to top, rgb(255, 255, 255), rgb(0, 0, 0))');
    hitStack(fade, behind);
    expect(sampleColorAt(50, 0)).toBe('#000000');
    expect(sampleColorAt(50, 100)).toBe('#ffffff');
  });

  it('honours an angle', () => {
    const behind = box('rgb(0, 0, 0)');
    // 90deg is `to right`.
    const fade = gradient('linear-gradient(90deg, rgb(255, 255, 255), rgb(0, 0, 0))');
    hitStack(fade, behind);
    expect(sampleColorAt(0, 50)).toBe('#ffffff');
    expect(sampleColorAt(50, 50)).toBe('#808080');
  });

  it('honours explicit stop positions, hard edges included', () => {
    const behind = box('rgb(0, 0, 0)');
    const fade = gradient(
      'linear-gradient(to bottom, rgb(255, 0, 0) 50%, rgb(0, 0, 255) 50%)'
    );
    hitStack(fade, behind);
    expect(sampleColorAt(50, 25)).toBe('#ff0000');
    expect(sampleColorAt(50, 75)).toBe('#0000ff');
  });

  it('fades toward transparent without going grey on the way', () => {
    const behind = box('rgb(0, 0, 0)');
    // Premultiplied interpolation is the difference between this and #7f0000 —
    // a red that fades out stays red, it does not darken.
    const fade = gradient('linear-gradient(to bottom, rgb(255, 0, 0), rgba(255, 0, 0, 0))');
    hitStack(fade, behind);
    expect(sampleColorAt(50, 50)).toBe('#800000'); // half-strength red over black
  });

  it('composites the gradient over the element\'s own background colour', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(0, 0, 255)';
    el.style.backgroundImage = 'linear-gradient(to bottom, rgba(255, 0, 0, 0), rgb(255, 0, 0))';
    document.body.appendChild(sized(el, { top: 0, left: 0, width: 100, height: 100 }));
    hitStack(el);
    expect(sampleColorAt(50, 0)).toBe('#0000ff'); // transparent end: the blue below
    expect(sampleColorAt(50, 100)).toBe('#ff0000'); // solid end: the red above
  });

  it('spreads unpositioned stops evenly between the ones that are placed', () => {
    const behind = box('rgb(0, 0, 0)');
    const fade = gradient(
      'linear-gradient(to bottom, rgb(0, 0, 0), rgb(0, 0, 0), rgb(255, 255, 255))'
    );
    hitStack(fade, behind);
    // The middle stop lands at 50%, so the top half is flat black.
    expect(sampleColorAt(50, 25)).toBe('#000000');
    expect(sampleColorAt(50, 75)).toBe('#808080');
  });
});

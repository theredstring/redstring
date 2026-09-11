import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { paintEdge, paintEdgeList, __testing } from '../paintElementTree.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgHost = () => document.createElementNS(SVG_NS, 'svg');

/**
 * The whole point of the painter is that its output is indistinguishable from
 * React's, because useNodeDrag queries the result by selector and writes to it
 * directly. So the assertion that matters is not "does it look right" but "is it
 * byte-identical to what React produces for the same element tree".
 */
const renderWithReact = async (element) => {
  const host = svgHost();
  document.body.appendChild(host);
  const g = document.createElementNS(SVG_NS, 'g');
  host.appendChild(g);
  const root = createRoot(g);
  await act(async () => { root.render(element); });
  const html = g.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return html;
};

const renderWithPainter = (element) => {
  const g = document.createElementNS(SVG_NS, 'g');
  paintEdge(g, element, null);
  return g.innerHTML;
};

const expectSameAsReact = async (element) => {
  const [reactHtml, painterHtml] = [await renderWithReact(element), renderWithPainter(element)];
  expect(painterHtml).toBe(reactHtml);
  return painterHtml;
};

describe('paintElementTree — attribute naming', () => {
  const { attrNameFor } = __testing;

  it('hyphenates camelCase SVG props the way React does', () => {
    expect(attrNameFor('strokeWidth')).toBe('stroke-width');
    expect(attrNameFor('strokeLinecap')).toBe('stroke-linecap');
    expect(attrNameFor('dominantBaseline')).toBe('dominant-baseline');
    expect(attrNameFor('textAnchor')).toBe('text-anchor');
    expect(attrNameFor('paintOrder')).toBe('paint-order');
    expect(attrNameFor('clipPath')).toBe('clip-path');
    expect(attrNameFor('vectorEffect')).toBe('vector-effect');
    expect(attrNameFor('fillOpacity')).toBe('fill-opacity');
  });

  it('leaves genuinely camelCase SVG attributes alone', () => {
    expect(attrNameFor('preserveAspectRatio')).toBe('preserveAspectRatio');
    expect(attrNameFor('clipPathUnits')).toBe('clipPathUnits');
    expect(attrNameFor('viewBox')).toBe('viewBox');
  });

  it('maps React-specific prop names and passes data/aria through', () => {
    expect(attrNameFor('className')).toBe('class');
    expect(attrNameFor('data-edge-id')).toBe('data-edge-id');
    expect(attrNameFor('data-connection-label')).toBe('data-connection-label');
    expect(attrNameFor('aria-label')).toBe('aria-label');
    expect(attrNameFor('href')).toBe('href');
  });
});

describe('paintElementTree — parity with React', () => {
  it('matches React for a realistic edge subtree', async () => {
    const html = await expectSameAsReact(
      <g data-edge-id="e1">
        <defs>
          <clipPath id="edge-shell-clip-e1" clipPathUnits="userSpaceOnUse">
            <path data-shell-clip="" d="M0 0 L10 10" />
          </clipPath>
        </defs>
        <g clipPath="url(#edge-shell-clip-e1)">
          <line x1={0} y1={0} x2={100} y2={50} stroke="#8B0000" strokeWidth={27} />
          <line data-edge-hit="" x1={0} y1={0} x2={100} y2={50} stroke="transparent" strokeWidth={50} />
          <g data-arrow="source"><polygon points="0,0 5,10 -5,10" fill="#8B0000" /></g>
          <g data-endpoint-dot="dest">
            <circle cx={100} cy={50} r={36} fill="#8B0000" />
            <circle cx={100} cy={50} r={30} fill="#fff" style={{ pointerEvents: 'none' }} />
          </g>
        </g>
      </g>
    );
    // Sanity: the contract attributes really are in the output being compared.
    expect(html).toContain('data-edge-id="e1"');
    expect(html).toContain('data-shell-clip');
    expect(html).toContain('data-edge-hit');
    expect(html).toContain('data-arrow="source"');
    expect(html).toContain('data-endpoint-dot="dest"');
  });

  it('matches React for both label forms', async () => {
    await expectSameAsReact(
      <g className="connection-label" data-connection-label="1" data-label-sprite="1" data-label-frame="a|b">
        <image href="data:image/png;base64,AAA" x={-10} y={-5} width={20} height={10} preserveAspectRatio="xMidYMid meet" />
      </g>
    );
    await expectSameAsReact(
      <g>
        <text
          className="connection-label-ring"
          data-connection-label="1"
          data-label-frame="a|b"
          data-label-full="Connection"
          data-label-text="Connect…"
          x={10}
          y={20}
          fontSize={54}
          fontWeight="bold"
          dominantBaseline="middle"
          textAnchor="middle"
          transform="rotate(12, 10, 20)"
          style={{ pointerEvents: 'none', fontFamily: "'EmOne', sans-serif" }}
        >
          Connect…
        </text>
      </g>
    );
  });

  it('matches React for keyed glyph lists and fragments', async () => {
    const glyphs = [0, 1, 2].map((i) => (
      <image key={i} data-gi={i} data-advance={12.5} href={`g${i}`} x={i * 12} y={0} width={12} height={16} />
    ));
    await expectSameAsReact(
      <g data-label-glyph-sprite="1">
        <>
          <g data-glyph-layer="ring">{glyphs}</g>
          <g data-glyph-layer="fill">{glyphs}</g>
        </>
      </g>
    );
  });

  it('omits null and false props exactly as React does', async () => {
    await expectSameAsReact(<g><path d="M0 0" fill={null} stroke={false} opacity={0} /></g>);
  });

  // React treats booleans differently for data-/aria- than for SVG attributes,
  // and the edge renderer relies on it: `data-edge-hit={true}` has to serialise
  // as "true" because that is the string useNodeDrag's selector matches against.
  it('matches React on boolean and zero-valued attributes', async () => {
    const html = await expectSameAsReact(
      <g>
        <path data-t={true} data-f={false} data-zero={0} data-empty={''} />
        <line stroke={true} fill={false} opacity={0} vectorEffect={true} />
      </g>
    );
    expect(html).toContain('data-t="true"');
    expect(html).toContain('data-f="false"');
    expect(html).toContain('data-zero="0"');
    expect(html).toContain('opacity="0"');
    expect(html).not.toContain('stroke=');
    expect(html).not.toContain('vector-effect=');
  });
});

describe('paintElementTree — diffing', () => {
  it('updates attributes in place without replacing the element', () => {
    const g = svgHost();
    let rec = paintEdge(g, <g data-edge-id="e1"><path d="M0 0" stroke="#111" /></g>, null);
    const pathBefore = g.querySelector('path');

    rec = paintEdge(g, <g data-edge-id="e1"><path d="M9 9" stroke="#111" /></g>, rec);
    const pathAfter = g.querySelector('path');

    expect(pathAfter).toBe(pathBefore);            // same node, not rebuilt
    expect(pathAfter.getAttribute('d')).toBe('M9 9');
  });

  it('replaces the element when the tag changes, so d never lands on a line', () => {
    const g = svgHost();
    let rec = paintEdge(g, <g><path d="M0 0" /></g>, null);
    rec = paintEdge(g, <g><line x1={0} y1={0} x2={1} y2={1} /></g>, rec);

    expect(g.querySelector('path')).toBeNull();
    const line = g.querySelector('line');
    expect(line).toBeTruthy();
    expect(line.hasAttribute('d')).toBe(false);
  });

  it('removes attributes that disappear', () => {
    const g = svgHost();
    let rec = paintEdge(g, <g><path d="M0 0" filter="url(#f)" /></g>, null);
    expect(g.querySelector('path').hasAttribute('filter')).toBe(true);
    rec = paintEdge(g, <g><path d="M0 0" /></g>, rec);
    expect(g.querySelector('path').hasAttribute('filter')).toBe(false);
  });

  it('swaps event handlers without stacking listeners', () => {
    const g = svgHost();
    const first = vi.fn();
    const second = vi.fn();

    let rec = paintEdge(g, <g><rect onClick={first} /></g>, null);
    g.querySelector('rect').dispatchEvent(new Event('click'));
    expect(first).toHaveBeenCalledTimes(1);

    rec = paintEdge(g, <g><rect onClick={second} /></g>, rec);
    g.querySelector('rect').dispatchEvent(new Event('click'));
    expect(first).toHaveBeenCalledTimes(1);   // not called again
    expect(second).toHaveBeenCalledTimes(1);

    rec = paintEdge(g, <g><rect /></g>, rec);
    g.querySelector('rect').dispatchEvent(new Event('click'));
    expect(second).toHaveBeenCalledTimes(1);  // detached
  });

  it('reorders a keyed list rather than appending', () => {
    const g = svgHost();
    const item = (k) => <image key={k} data-gi={k} href={`g${k}`} />;
    let rec = paintEdge(g, <g>{[item('a'), item('b'), item('c')]}</g>, null);
    const a = g.querySelector('[data-gi="a"]');

    rec = paintEdge(g, <g>{[item('c'), item('a'), item('b')]}</g>, rec);
    const order = Array.from(g.querySelectorAll('image')).map(e => e.getAttribute('data-gi'));

    expect(order).toEqual(['c', 'a', 'b']);
    expect(g.querySelector('[data-gi="a"]')).toBe(a);  // reused, not rebuilt
  });

  it('refuses component elements loudly instead of dropping them', () => {
    const Thing = () => <g />;
    expect(() => paintEdge(svgHost(), <g><Thing /></g>, null))
      .toThrow(/component elements are not supported/);
  });
});

describe('paintEdgeList', () => {
  const edge = (id) => ({ id, element: <g data-edge-id={id}><path d={`M${id}`} /></g> });

  it('paints in order and prunes edges that go away', () => {
    const container = svgHost();
    const records = new Map();

    paintEdgeList(container, [edge('e1'), edge('e2'), edge('e3')], records);
    expect(Array.from(container.children).map(e => e.getAttribute('data-edge-id')))
      .toEqual(['e1', 'e2', 'e3']);

    paintEdgeList(container, [edge('e3'), edge('e1')], records);
    expect(Array.from(container.children).map(e => e.getAttribute('data-edge-id')))
      .toEqual(['e3', 'e1']);
    expect(records.has('e2')).toBe(false);
    expect(container.querySelector('[data-edge-id="e2"]')).toBeNull();
  });

  it('reuses the same DOM element for an unchanged edge', () => {
    const container = svgHost();
    const records = new Map();
    paintEdgeList(container, [edge('e1')], records);
    const before = container.querySelector('[data-edge-id="e1"]');
    paintEdgeList(container, [edge('e1')], records);
    expect(container.querySelector('[data-edge-id="e1"]')).toBe(before);
  });
});

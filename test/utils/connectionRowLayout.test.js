import { describe, it, expect, beforeEach } from 'vitest';

import { layoutConnectionRow, layoutPanelConnection } from '../../src/utils/connectionRowLayout.js';
import {
  PREVIEW_TEXT,
  PREVIEW_FLOOR,
  PREVIEW_NODE_BASE_FONT_PX,
  layoutNodeChips,
  previewScaleFor
} from '../../src/utils/connectionPreview.js';
import { CONNECTION_LABEL_BASE_FONT_SIZE } from '../../src/UniversalNodeRenderer.presets.js';

/**
 * The one rule every off-canvas preview follows: text draws at the platform's
 * fixed size, and a row that does not fit gives up gap width and then name
 * length — never font size. These pin that order of concessions.
 */

// jsdom has no 2D context and the measurement layer needs one. A fixed
// per-character advance is enough: nothing here asserts exact glyph widths.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    let font = '';
    return {
      get font() { return font; },
      set font(v) { font = v; },
      measureText: (text) => ({
        width: text.length * (Number((font.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16) * 0.55,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 4,
      }),
    };
  };
});

const desktop = PREVIEW_TEXT.desktop;
const desktopScale = desktop.nodeFontPx / PREVIEW_NODE_BASE_FONT_PX;
const two = () => [
  { id: 'a', name: 'Ada Lovelace', color: '#8B0000' },
  { id: 'b', name: 'Charles Babbage', color: '#00008B' }
];
const onScreenWidth = (row) => row.nodes.reduce((sum, n) => sum + n.width * row.scale, 0)
  + (row.nodes.length - 1) * row.spacing;
const drawnLabelPx = (row) => CONNECTION_LABEL_BASE_FONT_SIZE * row.scale * row.labelFontScale;

describe('layoutConnectionRow — text size is the fixed point', () => {
  it('draws names and the label at the target sizes when the row has room', () => {
    const row = layoutConnectionRow({ nodes: two(), labels: ['created'], maxWidth: 1200, text: desktop });

    expect(row.scale).toBeCloseTo(desktopScale, 6);
    expect(drawnLabelPx(row)).toBeCloseTo(desktop.labelFontPx, 6);
    expect(row.nodes.map(n => n.name)).toEqual(['Ada Lovelace', 'Charles Babbage']);
    expect(row.labels).toEqual(['created']);
  });

  it('sizes the container to the content, never past maxWidth', () => {
    const roomy = layoutConnectionRow({ nodes: two(), labels: ['created'], maxWidth: 1200, text: desktop });
    expect(roomy.containerWidth).toBeLessThan(1200);
    expect(roomy.containerWidth).toBeGreaterThanOrEqual(onScreenWidth(roomy));

    const tight = layoutConnectionRow({ nodes: two(), labels: ['created'], maxWidth: 300, text: desktop });
    expect(tight.containerWidth).toBeLessThanOrEqual(300);
    expect(tight.containerWidth).toBeGreaterThanOrEqual(onScreenWidth(tight));
  });

  it('gives the label its width first, and never past the gap cap', () => {
    const short = layoutConnectionRow({ nodes: two(), labels: ['is'], maxWidth: 1200, text: desktop });
    const long = layoutConnectionRow({ nodes: two(), labels: ['is composed of'], maxWidth: 1200, text: desktop });
    const absurd = layoutConnectionRow({
      nodes: two(), labels: ['pneumonoultramicroscopicsilicovolcanoconiosis'], maxWidth: 1200, text: desktop
    });

    expect(long.spacing).toBeGreaterThan(short.spacing);
    // 16em of label span at 15px, plus the two arrowheads and their clearance.
    expect(absurd.spacing).toBeLessThanOrEqual(240 + 2 * 60);
    expect(absurd.labels[0].endsWith('…')).toBe(true);
  });

  it('narrows the gap before it touches a name', () => {
    const roomy = layoutConnectionRow({ nodes: two(), labels: ['created'], maxWidth: 1200, text: desktop });
    // Just under what the roomy row asked for: the boxes still fit whole, so the
    // gap is what gives.
    const squeezed = layoutConnectionRow({
      nodes: two(), labels: ['created'], maxWidth: roomy.containerWidth - 10, text: desktop
    });

    expect(squeezed.scale).toBeCloseTo(desktopScale, 6);
    expect(squeezed.nodes.map(n => n.name)).toEqual(['Ada Lovelace', 'Charles Babbage']);
    expect(squeezed.spacing).toBeLessThan(roomy.spacing);
    expect(squeezed.containerWidth).toBeLessThanOrEqual(roomy.containerWidth - 10);
  });

  it('truncates the longest name under pressure and keeps the text size', () => {
    const row = layoutConnectionRow({ nodes: two(), labels: ['created'], maxWidth: 300, text: desktop });

    expect(row.scale).toBeCloseTo(desktopScale, 6);
    expect(drawnLabelPx(row)).toBeCloseTo(desktop.labelFontPx, 6);
    expect(row.nodes[1].name.endsWith('…')).toBe(true);
    expect(row.nodes[1].name.length).toBeLessThan('Charles Babbage'.length);
    // The names give before the label does: it is still whole here.
    expect(row.labels).toEqual(['created']);
  });

  it('clips the label only once the boxes are already at the floor', () => {
    // Narrow enough that two floor boxes plus the label's own span overrun it,
    // but not so narrow that floor boxes with a floor gap do (which would be
    // the scale's turn to give).
    const row = layoutConnectionRow({ nodes: two(), labels: ['is composed of'], maxWidth: 262, text: desktop });

    expect(row.scale).toBeCloseTo(desktopScale, 6);
    row.nodes.forEach(n => expect(n.width).toBeCloseTo(PREVIEW_FLOOR.width, 3));
    expect(row.labels[0].endsWith('…')).toBe(true);
  });

  it('lets a short name keep its box while the long one is capped', () => {
    const row = layoutConnectionRow({
      nodes: [
        { id: 'a', name: 'Ada', color: '#8B0000' },
        { id: 'b', name: 'Charles Babbage', color: '#00008B' }
      ],
      labels: ['created'],
      maxWidth: 300,
      text: desktop
    });

    expect(row.nodes[0].name).toBe('Ada');
    expect(row.nodes[1].name.endsWith('…')).toBe(true);
  });

  it('drops the scale only when floor boxes with floor gaps cannot fit', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id.toUpperCase(), color: '#8B0000' }));
    const row = layoutConnectionRow({ nodes: many, labels: ['x', 'x', 'x', 'x'], maxWidth: 260, text: desktop });

    expect(row.scale).toBeLessThan(desktopScale);
    expect(row.scale).toBeGreaterThanOrEqual(0.3);
    expect(row.containerWidth).toBeLessThanOrEqual(260);
    // Even then the label holds its target size; it is clipped to its span instead.
    expect(drawnLabelPx(row)).toBeCloseTo(desktop.labelFontPx, 6);
  });

  it('budgets a second box for a self-loop', () => {
    const one = [{ id: 'a', name: 'Ada Lovelace', color: '#8B0000' }];
    const plain = layoutConnectionRow({ nodes: one, labels: ['knows'], maxWidth: 1200, text: desktop });
    const loop = layoutConnectionRow({
      nodes: one, labels: ['knows'], maxWidth: 1200, text: desktop, duplicateNodeIds: ['a']
    });

    expect(loop.containerWidth).toBeGreaterThan(plain.containerWidth);
    expect(loop.spacing).toBeGreaterThan(0);
  });

  it('takes the mobile targets as readily as the desktop ones', () => {
    const row = layoutConnectionRow({ nodes: two(), labels: ['created'], maxWidth: 340, text: PREVIEW_TEXT.mobile });

    expect(row.scale).toBeCloseTo(previewScaleFor(PREVIEW_TEXT.mobile), 6);
    expect(drawnLabelPx(row)).toBeCloseTo(PREVIEW_TEXT.mobile.labelFontPx, 6);
    expect(row.containerWidth).toBeLessThanOrEqual(340);
  });

  it('makes the container tall enough for the boxes at scale plus padding', () => {
    const row = layoutConnectionRow({ nodes: two(), labels: ['created'], maxWidth: 1200, text: desktop, padding: 6 });
    expect(row.containerHeight).toBeGreaterThanOrEqual(PREVIEW_FLOOR.height * row.scale + 12);
  });
});

describe('layoutPanelConnection', () => {
  it('is the same row at the column width', () => {
    const panel = layoutPanelConnection({
      nodes: two(),
      predicate: 'created',
      containerWidth: 280,
      hasArrows: true,
      text: desktop
    });

    expect(panel.scale).toBeCloseTo(desktopScale, 6);
    expect(panel.predicate).toBe('created');
    expect(panel.height).toBeGreaterThan(0);
    expect(panel.nodes.some(n => n.name.endsWith('…'))).toBe(true);
  });
});

describe('layoutNodeChips', () => {
  const chips = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, name: `Thing ${i}`, color: '#8B0000' }));

  it('pins the renderer to the target scale for one chip', () => {
    const grid = layoutNodeChips({ nodes: chips(1), text: desktop, maxRowWidth: 600, padding: 8 });

    expect(grid.scale).toBeCloseTo(desktopScale, 6);
    expect(grid.nodes).toHaveLength(1);
    expect(grid.containerWidth).toBe(Math.ceil(grid.nodes[0].width * desktopScale + 16));
    expect(grid.containerHeight).toBe(Math.ceil(grid.nodes[0].height * desktopScale + 16));
  });

  it('wraps chips into rows rather than shrinking them', () => {
    const grid = layoutNodeChips({ nodes: chips(8), text: desktop, maxRowWidth: 300, padding: 8 });

    expect(grid.scale).toBeCloseTo(desktopScale, 6);
    expect(grid.containerWidth).toBeLessThanOrEqual(300);
    expect(new Set(grid.nodes.map(n => n.y)).size).toBeGreaterThan(1);
  });

  it('truncates a name wider than the chip cap', () => {
    const grid = layoutNodeChips({
      nodes: [{ id: 'x', name: 'A remarkably long name for one node', color: '#8B0000' }],
      text: desktop,
      maxRowWidth: 600,
      maxChipWidth: 120
    });

    expect(grid.nodes[0].name.endsWith('…')).toBe(true);
    expect(grid.nodes[0].width * grid.scale).toBeLessThanOrEqual(121);
  });

  it('gives up the scale only when the rows outgrow the height cap', () => {
    const grid = layoutNodeChips({ nodes: chips(12), text: desktop, maxRowWidth: 300, maxHeight: 80, padding: 8 });

    expect(grid.scale).toBeLessThan(desktopScale);
    expect(grid.containerHeight).toBe(80);
  });
});

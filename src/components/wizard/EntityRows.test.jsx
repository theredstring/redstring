import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import useGraphStore from '../../store/graphStore.js';
import CreatedEntities from './EntityRows.jsx';

vi.mock('../../services/haptics.js', () => ({ haptic: vi.fn() }));
// jsdom has no canvas to measure text with.
vi.mock('../../services/textMeasurement.js', async (importOriginal) => ({
  ...(await importOriginal()),
  measureTextWidth: (text, fontString) => {
    if (!text) return 0;
    const px = Number((/([\d.]+)px/.exec(fontString) || [])[1]) || 16;
    return text.length * px * 0.6;
  }
}));

// ...and the renderer's text wrapping measures through a 2D context of its own.
HTMLCanvasElement.prototype.getContext = function getContext() {
  return { font: '', measureText: (text) => ({ width: String(text).length * 9 }) };
};

const openRightPanelNodeTab = vi.fn();
const openGraphTabAndBringToTop = vi.fn();

beforeEach(() => {
  openRightPanelNodeTab.mockClear();
  openGraphTabAndBringToTop.mockClear();
  useGraphStore.setState({
    activeGraphId: 'g-other',
    graphs: new Map([
      ['g-web', {
        id: 'g-web', name: 'Solar System', definingNodeIds: ['p-sun'], edgeIds: ['e-1'],
        instances: new Map([
          ['i-sun', { id: 'i-sun', prototypeId: 'p-sun' }],
          ['i-earth', { id: 'i-earth', prototypeId: 'p-earth' }]
        ])
      }]
    ]),
    nodePrototypes: new Map([
      ['p-sun', { id: 'p-sun', name: 'Sun', color: '#800000', definitionGraphIds: ['g-web'] }],
      ['p-earth', { id: 'p-earth', name: 'Earth', color: '#225522', definitionGraphIds: [] }],
      ['p-orbits', { id: 'p-orbits', name: 'Orbits', color: '#333333', definitionGraphIds: [] }]
    ]),
    edges: new Map([
      ['e-1', { id: 'e-1', sourceId: 'i-earth', destinationId: 'i-sun', definitionNodeIds: ['p-orbits'], directionality: { arrowsToward: new Set(['i-sun']) } }]
    ]),
    openRightPanelNodeTab,
    openGraphTabAndBringToTop
  });
});

describe('CreatedEntities', () => {
  const created = { webs: ['g-web'], things: ['p-earth'], connections: [{ id: 'e-1', graphId: 'g-web' }] };

  it('draws a row per Web, Thing and Connection, each with its two buttons', () => {
    const { container, getByTitle } = render(<CreatedEntities created={created} />);
    expect(container.querySelectorAll('.entity-row')).toHaveLength(3);
    expect(getByTitle('Open Earth in panel')).toBeTruthy();
    expect(getByTitle('Open Solar System as a Web')).toBeTruthy();
    // A Connection's buttons act on its type
    expect(getByTitle('Open Orbits in panel')).toBeTruthy();
  });

  it('opens a Thing in the panel and a Connection as its type', () => {
    const { getByTitle } = render(<CreatedEntities created={created} />);
    fireEvent.click(getByTitle('Open Earth in panel'));
    expect(openRightPanelNodeTab).toHaveBeenCalledWith('p-earth', 'Earth');
    fireEvent.click(getByTitle('Open Orbits in panel'));
    expect(openRightPanelNodeTab).toHaveBeenCalledWith('p-orbits', 'Orbits');
  });

  it('opens a Web on the canvas, and says so when it already is', () => {
    const { getByTitle, rerender } = render(<CreatedEntities created={created} />);
    fireEvent.click(getByTitle('Open Solar System as a Web'));
    expect(openGraphTabAndBringToTop).toHaveBeenCalledWith('g-web', 'p-sun');

    act(() => { useGraphStore.setState({ activeGraphId: 'g-web' }); });
    rerender(<CreatedEntities created={created} />);
    expect(getByTitle("Solar System's Web is open")).toBeTruthy();
  });

  it('drops what has since been deleted, and draws nothing when all of it is gone', () => {
    const { container } = render(<CreatedEntities created={{ webs: ['gone'], things: ['also-gone'], connections: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});

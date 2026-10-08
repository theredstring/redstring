import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, fireEvent, act } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import useGraphStore from '../../store/graphStore.js';
import CreatedEntities from './EntityRows.jsx';

// The cards are drag sources, as they are inside the app's DndProvider.
const withDnd = (ui) => <DndProvider backend={HTML5Backend}>{ui}</DndProvider>;
const render = (ui) => {
  const utils = rtlRender(withDnd(ui));
  return { ...utils, rerender: (next) => utils.rerender(withDnd(next)) };
};

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
  // The same Thing and Connection, added to a Web the call didn't make.
  const addedToExisting = { webs: [], things: ['p-earth'], connections: [{ id: 'e-1', graphId: 'g-web' }] };

  it('draws a made Web as a live card holding what the call put in it', () => {
    const { container, getByTitle, queryByTitle } = render(<CreatedEntities created={created} />);
    expect(container.querySelectorAll('.entity-web')).toHaveLength(1);
    // Earth and the Orbits connection are inside the card, not rows of their own
    expect(container.querySelectorAll('.entity-row')).toHaveLength(0);
    expect(queryByTitle('Open Earth in panel')).toBeNull();
    expect(getByTitle('Open Solar System as a Web')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('opens a made Web in the panel as its own tab', () => {
    const openRightPanelGraphTab = vi.fn();
    act(() => { useGraphStore.setState({ openRightPanelGraphTab, rightPanelExpanded: true }); });
    const { getByTitle } = render(<CreatedEntities created={created} />);
    fireEvent.click(getByTitle('Open Solar System in panel'));
    expect(openRightPanelGraphTab).toHaveBeenCalledWith('g-web', 'p-sun');
  });

  it('draws a row per Thing and Connection added to a Web that already existed', () => {
    const { container, getByTitle } = render(<CreatedEntities created={addedToExisting} />);
    expect(container.querySelectorAll('.entity-row')).toHaveLength(2);
    // A Connection's buttons act on its type
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

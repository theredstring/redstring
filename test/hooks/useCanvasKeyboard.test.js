import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasKeyboard } from '../../src/hooks/useCanvasKeyboard.js';

/**
 * P1.11 / F-14 — the shortcut listener attaches once per mount and reads the
 * latest params at event time.
 *
 * It used to re-attach whenever any of ~22 dependencies changed, and one of
 * them (NodeCanvas's onDeleteNodes) is a fresh function every render, so in
 * practice it was torn down and re-added on every NodeCanvas render.
 */

function makeParams(overrides = {}) {
  return {
    activeGraphId: 'g1',
    storeActions: {
      removeMultipleNodeInstances: vi.fn(),
      removeEdge: vi.fn(),
      clearSelectedEdgeIds: vi.fn(),
    },
    graphsMap: new Map([['g1', { id: 'g1', instances: new Map(), edgeIds: [] }]]),
    nodePrototypesMap: new Map(),
    edgesMap: new Map(),
    selectedInstanceIds: new Set(),
    setSelectedInstanceIds: vi.fn(),
    selectedEdgeId: null,
    selectedEdgeIds: new Set(),
    clipboardRef: { current: null },
    onClipboardChange: vi.fn(),
    keysPressed: { current: {} },
    mousePositionRef: { current: null },
    panOffset: { x: 0, y: 0 },
    panOffsetRef: { current: { x: 0, y: 0 } },
    setPanOffset: vi.fn(),
    zoomLevel: 1,
    zoomLevelRef: { current: 1 },
    setZoomLevel: vi.fn(),
    applyTransform: vi.fn(),
    flushSettle: vi.fn(),
    syncLabelsForGesture: vi.fn(),
    onTransformChange: vi.fn(),
    isPanningOrZoomingRef: { current: false },
    canvasSize: { width: 1000, height: 1000, offsetX: 0, offsetY: 0 },
    viewportSize: { width: 800, height: 600 },
    viewportBounds: { x: 0, y: 0, width: 800, height: 600 },
    draggingNodeInfo: null,
    draggingNodeInfoRef: { current: null },
    performDragUpdateRef: { current: null },
    drawingConnectionFromRef: { current: null },
    reprojectConnectionEndRef: { current: null },
    onPanTravelRef: { current: null },
    isAnimatingZoomRef: { current: false },
    minZoom: 0.1,
    maxZoom: 3,
    gamepadTickRef: { current: null },
    nodeNamePrompt: { visible: false },
    connectionNamePrompt: { visible: false },
    abstractionPrompt: { visible: false },
    newWebPrompt: { visible: false },
    isHeaderEditing: false,
    abstractionCarouselVisible: false,
    keyboardSettings: {},
    onDeleteNodes: vi.fn(),
    ...overrides,
  };
}

const pressOn = (target, key) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

describe('useCanvasKeyboard shortcut listener (P1.11)', () => {
  let addSpy;
  let removeSpy;
  const keydownAdds = () => addSpy.mock.calls.filter(([type]) => type === 'keydown').length;
  const keydownRemoves = () => removeSpy.mock.calls.filter(([type]) => type === 'keydown').length;

  beforeEach(() => {
    // Keep the movement rAF loop from running; it is not what is under test.
    vi.useFakeTimers();
    addSpy = vi.spyOn(window, 'addEventListener');
    removeSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('attaches once per mount, however the params change', () => {
    const { rerender, unmount } = renderHook((p) => useCanvasKeyboard(p), {
      initialProps: makeParams(),
    });
    const addsAtMount = keydownAdds();
    expect(addsAtMount).toBeGreaterThan(0);
    expect(keydownRemoves()).toBe(0);

    // Every dependency the old effect listed, changed, plus a fresh
    // onDeleteNodes on every render the way NodeCanvas passes it.
    for (let i = 1; i <= 5; i++) {
      rerender(makeParams({
        selectedInstanceIds: new Set([`i${i}`]),
        selectedEdgeId: `e${i}`,
        selectedEdgeIds: new Set([`e${i}`]),
        isHeaderEditing: i % 2 === 0,
        nodeNamePrompt: { visible: i === 3 },
        connectionNamePrompt: { visible: i === 4 },
        abstractionCarouselVisible: i === 5,
        activeGraphId: `g${i}`,
        graphsMap: new Map(),
        nodePrototypesMap: new Map(),
        edgesMap: new Map(),
        panOffset: { x: i, y: i },
        zoomLevel: 1 + i / 10,
        canvasSize: { width: 1000 + i, height: 1000, offsetX: 0, offsetY: 0 },
        onClipboardChange: vi.fn(),
        setSelectedInstanceIds: vi.fn(),
        onDeleteNodes: vi.fn(),
      }));
    }

    expect(keydownAdds()).toBe(addsAtMount);
    expect(keydownRemoves()).toBe(0);

    unmount();
    expect(keydownRemoves()).toBe(addsAtMount);
  });

  it('the handler sees the latest params', () => {
    const first = makeParams();
    const { rerender } = renderHook((p) => useCanvasKeyboard(p), { initialProps: first });

    const latest = makeParams({ selectedInstanceIds: new Set(['i1', 'i2']) });
    rerender(latest);

    act(() => { pressOn(document.body, 'Delete'); });

    expect(first.onDeleteNodes).not.toHaveBeenCalled();
    expect(latest.onDeleteNodes).toHaveBeenCalledTimes(1);
    expect([...latest.onDeleteNodes.mock.calls[0][0]]).toEqual(['i1', 'i2']);
    expect(latest.setSelectedInstanceIds).toHaveBeenCalledWith(new Set());
    expect(first.setSelectedInstanceIds).not.toHaveBeenCalled();
  });

  it('uses the latest edge selection and store actions', () => {
    const { rerender } = renderHook((p) => useCanvasKeyboard(p), { initialProps: makeParams() });

    const latest = makeParams({ selectedEdgeIds: new Set(['e1', 'e2']) });
    rerender(latest);

    act(() => { pressOn(document.body, 'Backspace'); });

    expect(latest.storeActions.removeEdge).toHaveBeenCalledWith('e1');
    expect(latest.storeActions.removeEdge).toHaveBeenCalledWith('e2');
    expect(latest.storeActions.clearSelectedEdgeIds).toHaveBeenCalledTimes(1);
  });

  it('is still suppressed while the header title is being edited, using the latest flag', () => {
    const { rerender } = renderHook((p) => useCanvasKeyboard(p), {
      initialProps: makeParams({ selectedInstanceIds: new Set(['i1']) }),
    });

    const focused = makeParams({ selectedInstanceIds: new Set(['i1']), isHeaderEditing: true });
    rerender(focused);
    act(() => { pressOn(document.body, 'Delete'); });
    expect(focused.onDeleteNodes).not.toHaveBeenCalled();

    const unfocused = makeParams({ selectedInstanceIds: new Set(['i1']) });
    rerender(unfocused);
    act(() => { pressOn(document.body, 'Delete'); });
    expect(unfocused.onDeleteNodes).toHaveBeenCalledTimes(1);
  });

  it('is still suppressed while a text field has focus', () => {
    const params = makeParams({ selectedInstanceIds: new Set(['i1']) });
    renderHook((p) => useCanvasKeyboard(p), { initialProps: params });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => { pressOn(input, 'Backspace'); });
    expect(params.onDeleteNodes).not.toHaveBeenCalled();

    input.blur();
    input.remove();
    act(() => { pressOn(document.body, 'Backspace'); });
    expect(params.onDeleteNodes).toHaveBeenCalledTimes(1);
  });

  it('is still suppressed while the node name prompt is open', () => {
    const { rerender } = renderHook((p) => useCanvasKeyboard(p), {
      initialProps: makeParams({ selectedInstanceIds: new Set(['i1']) }),
    });
    const prompt = makeParams({ selectedInstanceIds: new Set(['i1']), nodeNamePrompt: { visible: true } });
    rerender(prompt);

    act(() => { pressOn(document.body, 'Delete'); });

    expect(prompt.onDeleteNodes).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import useCanvasUIStore, {
  createCanvasUIDefaults,
  selectIsTextEntryActive,
  setsEqual,
  mapsEqual,
  shallowEqual,
} from '../../src/store/canvasUIStore.js';

/**
 * P2.01: canvasUIStore scaffold (pre-staged, not wired).
 *
 * The store has to be a drop-in for the NodeCanvas `useState` pairs it will
 * replace (value or updater), and it has to be cheaper: a write that changes
 * nothing must not notify anyone.
 */

const st = () => useCanvasUIStore.getState();

/**
 * Every plain setter: [setter, field, a distinct non-default value, an updater
 * that derives a new value from prev]. Fields with special equality get their
 * own tests below as well.
 */
const SETTERS = [
  ['setSelectedInstanceIds', 'selectedInstanceIds', new Set(['a', 'b']), (prev) => new Set([...prev, 'z'])],
  ['setSelectedGroupId', 'selectedGroupId', 'g1', (prev) => `${prev}-next`],
  ['setLastSelectedGroupId', 'lastSelectedGroupId', 'g2', (prev) => `${prev}-next`],
  ['setSelectedNodeIdForPieMenu', 'selectedNodeIdForPieMenu', 'inst-1', (prev) => `${prev}-next`],
  ['setIsTransitioningPieMenu', 'isTransitioningPieMenu', true, (prev) => !prev],
  ['setIsPieMenuRendered', 'isPieMenuRendered', true, (prev) => !prev],
  ['setCarouselPieMenuStage', 'carouselPieMenuStage', 2, (prev) => (prev === 1 ? 2 : 1)],
  ['setIsCarouselStageTransition', 'isCarouselStageTransition', true, (prev) => !prev],
  ['setPendingAbstractionNodeId', 'pendingAbstractionNodeId', 'inst-5', (prev) => `${prev}-next`],
  ['setPendingDecomposeNodeId', 'pendingDecomposeNodeId', 'inst-6', (prev) => `${prev}-next`],
  ['setCurrentPieMenuData', 'currentPieMenuData', { node: { id: 'n' }, buttons: [], nodeDimensions: {} }, (prev) => ({ ...prev, buttons: [1] })],
  ['setPreviewingNodeId', 'previewingNodeId', 'inst-2', (prev) => `${prev}-next`],
  ['setNodeDefinitionIndices', 'nodeDefinitionIndices', new Map([['n-g', 1]]), (prev) => new Map(prev).set('x-g', 2)],
  ['setAbstractionCarouselVisible', 'abstractionCarouselVisible', true, (prev) => !prev],
  ['setAbstractionCarouselNode', 'abstractionCarouselNode', { id: 'inst-3' }, (prev) => ({ ...prev, id: 'other' })],
  ['setCarouselAnimationState', 'carouselAnimationState', 'entering', (prev) => (prev === 'hidden' ? 'entering' : 'exiting')],
  ['setJustCompletedCarouselExit', 'justCompletedCarouselExit', true, (prev) => !prev],
  ['setSemanticOrbitActive', 'semanticOrbitActive', true, (prev) => !prev],
  ['setNodeNamePrompt', 'nodeNamePrompt', { visible: true, name: 'A', color: '#800000' }, (prev) => ({ ...prev, name: `${prev.name}!` })],
  ['setConnectionNamePrompt', 'connectionNamePrompt', { visible: true, name: '', color: null, edgeId: 'e1' }, (prev) => ({ ...prev, visible: !prev.visible })],
  ['setAbstractionPrompt', 'abstractionPrompt', { visible: true, name: '', color: null, direction: 'below', nodeId: 'n', carouselLevel: null }, (prev) => ({ ...prev, visible: !prev.visible })],
  ['setNodeGroupPrompt', 'nodeGroupPrompt', { visible: true, name: '', color: null, groupId: 'g' }, (prev) => ({ ...prev, visible: !prev.visible })],
  ['setSwapPrompt', 'swapPrompt', { visible: true, instanceId: 'i', name: 'n', color: null }, (prev) => ({ ...prev, visible: !prev.visible })],
  ['setNewWebPrompt', 'newWebPrompt', { visible: true }, (prev) => ({ visible: !prev.visible })],
  ['setHeaderSearchVisible', 'headerSearchVisible', true, (prev) => !prev],
  ['setHeaderAllThingsSearchVisible', 'headerAllThingsSearchVisible', true, (prev) => !prev],
  ['setShowHelpModal', 'showHelpModal', true, (prev) => !prev],
  ['setShowSettingsModal', 'showSettingsModal', true, (prev) => !prev],
  ['setShowMergeThingsModal', 'showMergeThingsModal', true, (prev) => !prev],
  ['setShowStorageSetupModal', 'showStorageSetupModal', true, (prev) => !prev],
  ['setUniverseReconnect', 'universeReconnect', { mode: 'load', slug: 's', name: 'U', repoLabel: 'o/r' }, (prev) => prev || { mode: 'sync' }],
  ['setUniverseReconnectTarget', 'universeReconnectTarget', { slug: 's', name: 'U', repoLabel: null }, (prev) => prev || { slug: 't', name: 'T', repoLabel: null }],
  ['setUniverseReconnectDismissed', 'universeReconnectDismissed', true, (prev) => !prev],
  ['setLeftPanelWidth', 'leftPanelWidth', 321, (prev) => prev + 1],
  ['setRightPanelWidth', 'rightPanelWidth', 322, (prev) => prev + 1],
  ['setLayoutProgress', 'layoutProgress', { progress: 0.5, nodeCount: 10, estimatedMs: 400 }, (prev) => prev || { progress: 0, nodeCount: 1, estimatedMs: 1 }],
  ['setAutoGraphModalVisible', 'autoGraphModalVisible', true, (prev) => !prev],
  ['setForceSimModalVisible', 'forceSimModalVisible', true, (prev) => !prev],
  ['setIsHeaderEditing', 'isHeaderEditing', true, (prev) => !prev],
  ['setEditingNodeIdOnCanvas', 'editingNodeIdOnCanvas', 'inst-4', (prev) => `${prev}-next`],
  ['setHoveredNodeForVision', 'hoveredNodeForVision', { id: 'n' }, (prev) => ({ ...prev, id: 'm' })],
  ['setHoveredConnectionForVision', 'hoveredConnectionForVision', { id: 'e' }, (prev) => ({ ...prev, id: 'f' })],
  ['setActivePieMenuItemForVision', 'activePieMenuItemForVision', { id: 'b' }, (prev) => ({ ...prev, id: 'c' })],
  ['setGamepadMode', 'gamepadMode', 'node', (prev) => (prev === 'canvas' ? 'edge' : 'canvas')],
  ['setGamepadPieFocusedIndex', 'gamepadPieFocusedIndex', 3, (prev) => prev + 1],
  ['setGamepadHeaderFocusedGraphId', 'gamepadHeaderFocusedGraphId', 'graph-1', (prev) => `${prev}-next`],
  ['setClipboardVersion', 'clipboardVersion', 5, (prev) => prev + 1],
  ['setTrackpadZoomEnabled', 'trackpadZoomEnabled', true, (prev) => !prev],
];

describe('canvasUIStore (P2.01)', () => {
  let notifications;
  let unsubscribe;

  beforeEach(() => {
    useCanvasUIStore.setState(createCanvasUIDefaults());
    notifications = 0;
    unsubscribe = useCanvasUIStore.subscribe(() => { notifications++; });
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
  });

  describe('defaults', () => {
    it('match the NodeCanvas useState initial values they replace', () => {
      const s = st();
      expect(s.selectedInstanceIds).toBeInstanceOf(Set);
      expect(s.selectedInstanceIds.size).toBe(0);
      expect(s.nodeDefinitionIndices).toBeInstanceOf(Map);
      expect(s.nodeDefinitionIndices.size).toBe(0);
      expect(s.selectedNodeIdForPieMenu).toBeNull();
      expect(s.isTransitioningPieMenu).toBe(false);
      expect(s.carouselAnimationState).toBe('hidden');
      expect(s.abstractionPrompt).toEqual({ visible: false, name: '', color: null, direction: 'above', nodeId: null, carouselLevel: null });
      expect(s.newWebPrompt).toEqual({ visible: false });
      expect(s.gamepadMode).toBe('canvas');
      expect(s.gamepadPieFocusedIndex).toBe(-1);
      expect(s.clipboardVersion).toBe(0);
      expect(s.trackpadZoomEnabled).toBe(false);
      expect(s.leftPanelViewRequest).toBeNull();
    });

    it('createCanvasUIDefaults returns fresh collections every call', () => {
      const a = createCanvasUIDefaults();
      const b = createCanvasUIDefaults();
      expect(a.selectedInstanceIds).not.toBe(b.selectedInstanceIds);
      expect(a.nodeDefinitionIndices).not.toBe(b.nodeDefinitionIndices);
      expect(a.nodeNamePrompt).not.toBe(b.nodeNamePrompt);
    });

    it('every setter in the table exists on the store', () => {
      for (const [setter, field] of SETTERS) {
        expect(typeof st()[setter], setter).toBe('function');
        expect(field in createCanvasUIDefaults(), field).toBe(true);
      }
    });
  });

  describe.each(SETTERS)('%s', (setter, field, value, updater) => {
    it('accepts a value', () => {
      st()[setter](value);
      expect(st()[field]).toBe(value);
      expect(notifications).toBe(1);
    });

    it('accepts an updater, called once with the current value', () => {
      const prevValue = st()[field];
      const spy = vi.fn(updater);
      st()[setter](spy);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(prevValue);
      expect(st()[field]).toEqual(updater(prevValue));
      expect(notifications).toBe(1);
    });

    it('does not notify when the updater returns prev', () => {
      const before = st();
      st()[setter]((prev) => prev);
      expect(st()).toBe(before);
      expect(notifications).toBe(0);
    });

    it('does not notify when writing the current value again', () => {
      st()[setter](value);
      const after = st();
      notifications = 0;
      st()[setter](value);
      expect(st()).toBe(after);
      expect(notifications).toBe(0);
    });

    it('writes only its own field', () => {
      const before = st();
      st()[setter](value);
      const after = st();
      for (const key of Object.keys(before)) {
        if (key === field) continue;
        expect(after[key], key).toBe(before[key]);
      }
    });
  });

  describe('selection uses Set equality', () => {
    it('skips a new Set with the same members, in any order', () => {
      st().setSelectedInstanceIds(new Set(['a', 'b']));
      const kept = st().selectedInstanceIds;
      notifications = 0;

      st().setSelectedInstanceIds(new Set(['b', 'a']));

      expect(st().selectedInstanceIds).toBe(kept);
      expect(notifications).toBe(0);
    });

    it('skips clearing an already-empty selection', () => {
      const before = st();
      st().setSelectedInstanceIds(new Set());
      expect(st()).toBe(before);
      expect(notifications).toBe(0);
    });

    it('writes when a member changes, even at the same size', () => {
      st().setSelectedInstanceIds(new Set(['a', 'b']));
      notifications = 0;
      st().setSelectedInstanceIds(new Set(['a', 'c']));
      expect([...st().selectedInstanceIds]).toEqual(['a', 'c']);
      expect(notifications).toBe(1);
    });

    it('writes when the size changes', () => {
      st().setSelectedInstanceIds(new Set(['a']));
      notifications = 0;
      st().setSelectedInstanceIds((prev) => new Set([...prev, 'b']));
      expect(st().selectedInstanceIds.size).toBe(2);
      expect(notifications).toBe(1);
    });

    it('turns a non-Set iterable (or null) into a Set', () => {
      st().setSelectedInstanceIds(['x', 'y', 'x']);
      expect(st().selectedInstanceIds).toBeInstanceOf(Set);
      expect([...st().selectedInstanceIds]).toEqual(['x', 'y']);

      notifications = 0;
      st().setSelectedInstanceIds(['y', 'x']);
      expect(notifications).toBe(0);

      st().setSelectedInstanceIds(null);
      expect(st().selectedInstanceIds).toBeInstanceOf(Set);
      expect(st().selectedInstanceIds.size).toBe(0);
    });
  });

  describe('definition indices use Map equality', () => {
    it('skips a new Map with the same entries', () => {
      st().setNodeDefinitionIndices(new Map([['n1-g', 0], ['n2-g', 2]]));
      const kept = st().nodeDefinitionIndices;
      notifications = 0;

      st().setNodeDefinitionIndices(new Map([['n2-g', 2], ['n1-g', 0]]));

      expect(st().nodeDefinitionIndices).toBe(kept);
      expect(notifications).toBe(0);
    });

    it('writes when a value changes or a key is added', () => {
      st().setNodeDefinitionIndices(new Map([['n1-g', 0]]));
      notifications = 0;

      st().setNodeDefinitionIndices(new Map([['n1-g', 1]]));
      expect(st().nodeDefinitionIndices.get('n1-g')).toBe(1);
      st().setNodeDefinitionIndices((prev) => new Map(prev).set('n2-g', 0));
      expect(st().nodeDefinitionIndices.size).toBe(2);

      expect(notifications).toBe(2);
    });

    it('setNodeDefinitionIndex sets one key without mutating the previous Map', () => {
      const original = st().nodeDefinitionIndices;
      st().setNodeDefinitionIndex('n1-g', 3);

      expect(st().nodeDefinitionIndices.get('n1-g')).toBe(3);
      expect(st().nodeDefinitionIndices).not.toBe(original);
      expect(original.size).toBe(0);
      expect(notifications).toBe(1);
    });

    it('setNodeDefinitionIndex skips when the key already holds that index', () => {
      st().setNodeDefinitionIndex('n1-g', 3);
      const after = st();
      notifications = 0;

      st().setNodeDefinitionIndex('n1-g', 3);

      expect(st()).toBe(after);
      expect(notifications).toBe(0);
    });

    it('setNodeDefinitionIndex writes index 0 for a missing key', () => {
      st().setNodeDefinitionIndex('n1-g', 0);
      expect(st().nodeDefinitionIndices.has('n1-g')).toBe(true);
      expect(notifications).toBe(1);
    });
  });

  describe('prompts use shallow equality', () => {
    it('skips a new object with the same fields', () => {
      const before = st();
      st().setNodeNamePrompt({ visible: false, name: '', color: null });
      expect(st()).toBe(before);
      expect(notifications).toBe(0);
    });

    it('writes when a field changes', () => {
      st().setNodeNamePrompt((prev) => ({ ...prev, color: '#800000' }));
      expect(st().nodeNamePrompt.color).toBe('#800000');
      expect(notifications).toBe(1);
    });

    it('writes when the shape changes, as useState would', () => {
      // NodeCanvas's graph-change cleanup resets with `{ visible: false, name: '' }`,
      // which drops `color`. That is a different object, so it is written.
      st().setNodeNamePrompt({ visible: false, name: '' });
      expect(st().nodeNamePrompt).toEqual({ visible: false, name: '' });
      expect(notifications).toBe(1);
    });
  });

  describe('object snapshots use identity', () => {
    it('writes a new object even when its fields match', () => {
      const node = { id: 'n' };
      st().setHoveredNodeForVision(node);
      notifications = 0;
      st().setHoveredNodeForVision({ id: 'n' });
      expect(notifications).toBe(1);
    });
  });

  describe('openLeftPanelView', () => {
    it('fires a fresh request every call, even for the same view', () => {
      st().openLeftPanelView('federation');
      const first = st().leftPanelViewRequest;
      st().openLeftPanelView('federation');
      const second = st().leftPanelViewRequest;

      expect(first.view).toBe('federation');
      expect(second.view).toBe('federation');
      expect(second.nonce).toBe(first.nonce + 1);
      expect(second).not.toBe(first);
      expect(notifications).toBe(2);
    });
  });

  describe('markClipboardChanged', () => {
    it('bumps clipboardVersion every call', () => {
      st().markClipboardChanged();
      st().markClipboardChanged();
      expect(st().clipboardVersion).toBe(2);
      expect(notifications).toBe(2);
    });
  });

  describe('selectIsTextEntryActive', () => {
    it('is false by default', () => {
      expect(selectIsTextEntryActive(st())).toBe(false);
    });

    it.each([
      ['setIsHeaderEditing'],
    ])('is true while %s(true)', (setter) => {
      st()[setter](true);
      expect(selectIsTextEntryActive(st())).toBe(true);
      st()[setter](false);
      expect(selectIsTextEntryActive(st())).toBe(false);
    });

    it('ignores prompt visibility (that is a separate check)', () => {
      st().setNodeNamePrompt({ visible: true, name: '', color: null });
      expect(selectIsTextEntryActive(st())).toBe(false);
    });
  });

  describe('equality helpers', () => {
    it('setsEqual', () => {
      expect(setsEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
      expect(setsEqual(new Set([1]), new Set([1, 2]))).toBe(false);
      expect(setsEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
      expect(setsEqual(new Set(), [])).toBe(false);
    });

    it('mapsEqual', () => {
      expect(mapsEqual(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true);
      expect(mapsEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
      expect(mapsEqual(new Map([['a', undefined]]), new Map([['b', undefined]]))).toBe(false);
      expect(mapsEqual(new Map([['a', NaN]]), new Map([['a', NaN]]))).toBe(true);
    });

    it('shallowEqual', () => {
      expect(shallowEqual({ a: 1, b: null }, { b: null, a: 1 })).toBe(true);
      expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
      expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
      expect(shallowEqual([], {})).toBe(false);
      expect(shallowEqual(null, {})).toBe(false);
    });
  });

  describe('no middleware (D-04)', () => {
    it('writes never touch graphStore', async () => {
      const { default: useGraphStore } = await import('../../src/store/graphStore.js');
      let graphNotifications = 0;
      const unsub = useGraphStore.subscribe(() => { graphNotifications++; });
      try {
        st().setSelectedInstanceIds(new Set(['a']));
        st().setSelectedNodeIdForPieMenu('a');
        st().setNodeDefinitionIndex('a-g', 1);
        expect(graphNotifications).toBe(0);
      } finally {
        unsub();
      }
    });
  });

  describe('React subscribers', () => {
    it('re-render only when their own slice changes', () => {
      let renders = 0;
      function PreviewProbe() {
        renders++;
        const previewingNodeId = useCanvasUIStore((s) => s.previewingNodeId);
        return React.createElement('span', null, previewingNodeId ?? 'none');
      }

      const { container } = render(React.createElement(PreviewProbe));
      const base = renders;

      // Another slice: no render.
      act(() => { st().setSelectedInstanceIds(new Set(['a'])); });
      // Equal value: no render.
      act(() => { st().setPreviewingNodeId(null); });
      expect(renders).toBe(base);

      act(() => { st().setPreviewingNodeId('a'); });
      expect(renders).toBe(base + 1);
      expect(container.textContent).toBe('a');
    });

    it('setters are referentially stable across writes', () => {
      const before = st().setSelectedInstanceIds;
      st().setSelectedInstanceIds(new Set(['a']));
      expect(st().setSelectedInstanceIds).toBe(before);
    });
  });

  describe('deletion ghosts (P2.07)', () => {
    const ghost = (id) => ({ id, x: 0, y: 0, width: 10, height: 10, rx: 2, color: '#800000', delay: 0 });

    it('adds ghosts and removes them one at a time', () => {
      st().addDeletionGhosts([ghost('a'), ghost('b')]);
      expect(st().deletionGhosts.map((g) => g.id)).toEqual(['a', 'b']);
      st().removeDeletionGhost('a');
      expect(st().deletionGhosts.map((g) => g.id)).toEqual(['b']);
    });

    it('adding nothing or removing an unknown ghost writes nothing', () => {
      const before = st().deletionGhosts;
      st().addDeletionGhosts([]);
      st().removeDeletionGhost('nope');
      expect(st().deletionGhosts).toBe(before);
    });
  });
});

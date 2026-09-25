/**
 * canvasUIStore — shared canvas UI state (the "spine").
 *
 * **Pre-staged in P2.01; not wired. P2.02+ migrate consumers.**
 * Nothing imports this store yet. Until a P2 card wires a slice in, the
 * NodeCanvas `useState` of the same name is still the live source of truth.
 *
 * WHY A SEPARATE STORE (DECISION D-04, FINDING F-47)
 * This state is read across the canvas, the shell (Header, Panels, TypeList)
 * and the input hooks, so it has to live outside NodeCanvas before those parts
 * can leave it. It does NOT go in graphStore: every graphStore `set` runs the
 * SaveCoordinator middleware (collapse tripwire, patch capture, a debounced
 * save-worker hash) and none of this state is a document edit. So this is a
 * plain zustand store with no middleware, like `useImageCache` and
 * `useHistoryStore`. It is never saved, hashed, recorded in history, or sent
 * over the MCP bridge (the bridge reads no field held here; see P2.01 report).
 *
 * SETTER CONTRACT (so migrations are drop-in for `useState`)
 * - Field and setter names match the NodeCanvas `useState` pairs they replace,
 *   so a migration binds the same local names:
 *     const selectedInstanceIds = useCanvasUIStore(s => s.selectedInstanceIds);
 *     const setSelectedInstanceIds = useCanvasUIStore(s => s.setSelectedInstanceIds);
 *   Setters are created once, so they are referentially stable, like React's.
 * - A setter takes a value OR an updater `prev => next`, with React semantics.
 *   A function argument is always treated as an updater, so a function can't
 *   be stored as a value (no field here holds one).
 * - Updaters must be pure. Zustand runs an updater exactly once, synchronously,
 *   inside `set`; StrictMode does not double-invoke it, so an impure updater
 *   won't be caught in development the way it would be with `useState`.
 * - A write that changes nothing is skipped: the updater hands zustand back the
 *   same state object, so no subscriber is notified and nothing re-renders.
 *   "Changes nothing" is per field: Set equality for the selection, Map
 *   equality for the definition indices, a shallow compare for the small
 *   prompt objects, and `Object.is` for everything else.
 *   This is stricter than `useState`, which re-renders for every new Set even
 *   when its members are the same. An effect can therefore no longer be
 *   re-triggered by writing an equal selection; see the P2.01 report.
 *
 * TIMING (read before migrating a slice; details in reports/P2.01.md)
 * - `getState()` is updated synchronously by `set`, while render-scope values
 *   update at the next render. Don't mix the two views inside one handler.
 * - Zustand notifies React through `useSyncExternalStore`, which always
 *   schedules a synchronous-lane render. Outside discrete events (setTimeout,
 *   rAF, animation callbacks, CustomEvent listeners) `useState` updates get
 *   the default lane instead. A callback that writes this store AND a
 *   `useState` then renders twice, and the first render sees half of the
 *   change. Move coupled fields together, or wrap the callback in `flushSync`.
 * - Select primitives or stable references. A selector that builds a new
 *   object on every call loops under `useSyncExternalStore` in zustand 5; use
 *   `useShallow` from 'zustand/react/shallow' for multi-field reads.
 *
 * Slices below follow F-47 items 1–15 (item 10 panel widths and item 14 the
 * canvas-busy snapshot are not here: they are P2.12 and later).
 */
import { create } from 'zustand';
import { readPersistedPanelWidth } from '../utils/canvas/panelWidth.js';

// ─── Equality helpers ─────────────────────────────────────────────────────────

/** Same members, regardless of insertion order. */
export function setsEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/** Same keys, each mapped to an `Object.is`-equal value. */
export function mapsEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (!b.has(key) || !Object.is(value, b.get(key))) return false;
  }
  return true;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Same own enumerable keys, each `Object.is`-equal. Meant for small, flat
 * objects (the prompt descriptors); nested values compare by reference.
 */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!hasOwn(b, key) || !Object.is(a[key], b[key])) return false;
  }
  return true;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * Fresh default values for every data field. Each call returns new Set, Map
 * and object instances, so tests can reset the store without sharing
 * references: `useCanvasUIStore.setState(createCanvasUIDefaults())`.
 *
 * The defaults match the NodeCanvas `useState` initial values they replace.
 */
export function createCanvasUIDefaults() {
  return {
    // selection (F-47 #1)
    /** @type {Set<string>} Selected node instance ids in the active graph. */
    selectedInstanceIds: new Set(),
    // Edge selection (P2.03c, D-22): moved from graphStore, whose middleware ran
    // on every edge click. graphStore keeps its five action names as shims.
    selectedEdgeId: null,
    selectedEdgeIds: new Set(),

    // group selection (F-47 #2). Ids, not the object snapshots NodeCanvas holds
    // today: consumers derive the group from graphStore so it can't go stale.
    // P2.03 note: `lastSelectedGroup` feeds the group panel's exit animation. A
    // derived lookup returns null once the group is deleted, so the exit
    // animation needs its own snapshot if that case matters.
    /** @type {string|null} */
    selectedGroupId: null,
    /** @type {string|null} */
    lastSelectedGroupId: null,
    // What the node control panel keeps showing while it animates out. Latched by
    // effects on selection, next to the pie target they're written with (P2.03).
    /** @type {object[]} Prototypes of the last non-empty selection. */
    /** @type {string|null} The last single selected instance (null after a multi-select). */

    // pie menu (F-47 #3)
    /** @type {string|null} Instance id the node pie menu is open on. */
    selectedNodeIdForPieMenu: null,
    /** @type {boolean} Latch held while a pie menu plays its exit animation. */
    isTransitioningPieMenu: false,
    // What the pie is drawing, kept with its target so a write outside a React
    // event can't render the new target over the old menu (P2.01 §4, P2.03).
    /** @type {boolean} Whether the PieMenu is mounted (through its exit animation). */
    isPieMenuRendered: false,
    /** @type {{ node: object, buttons: object[], nodeDimensions: object }|null} */
    currentPieMenuData: null,
    // The pie's transitions, written in the same exit callback as the fields above.
    /** @type {1|2} Carousel pie stage: 1 = main, 2 = position selection. */
    carouselPieMenuStage: 1,
    /** @type {boolean} The pie is shrinking for a carousel stage change, not closing. */
    isCarouselStageTransition: false,
    /** @type {string|null} Opens the carousel on this node once the pie has shrunk. */
    pendingAbstractionNodeId: null,
    /** @type {string|null} Toggles the decompose preview on this node once the pie has shrunk. */
    pendingDecomposeNodeId: null,

    // decompose preview (F-47 #4)
    /** @type {string|null} */
    previewingNodeId: null,

    // definition navigation (F-47 #5)
    /** @type {Map<string, number>} `"nodeId-graphId"` → active definition index. */
    nodeDefinitionIndices: new Map(),

    // modes (F-47 #6): the carousel's PUBLIC flags only. Physics and animation
    // internals stay with the carousel (P5).
    /** @type {boolean} */
    abstractionCarouselVisible: false,
    /** @type {object|null} Node snapshot the carousel is open on. */
    abstractionCarouselNode: null,
    /** @type {'hidden'|'entering'|'visible'|'exiting'} */
    carouselAnimationState: 'hidden',
    /** @type {boolean} */
    justCompletedCarouselExit: false,
    /** @type {boolean} */
    semanticOrbitActive: false,

    // prompts (F-47 #7). Whole descriptors, as NodeCanvas holds them today.
    nodeNamePrompt: { visible: false, name: '', color: null },
    connectionNamePrompt: { visible: false, name: '', color: null, edgeId: null },
    abstractionPrompt: { visible: false, name: '', color: null, direction: 'above', nodeId: null, carouselLevel: null },
    nodeGroupPrompt: { visible: false, name: '', color: null, groupId: null },
    swapPrompt: { visible: false, instanceId: null, name: '', color: null },
    newWebPrompt: { visible: false },

    // modals and header searches (F-47 #7)
    headerSearchVisible: false,
    headerAllThingsSearchVisible: false,
    showHelpModal: false,
    showSettingsModal: false,
    showMergeThingsModal: false,
    showStorageSetupModal: false,
    // GitHub reconnect (P2.06c; shared by UniverseHost's modal and the canvas
    // error card). `universeReconnect` is the open modal:
    // { mode: 'load' | 'sync', slug, name, repoLabel } or null.
    // `universeReconnectTarget` names the active Git universe when its load
    // failed. `universeReconnectDismissed` is "not now" for a load failure.
    universeReconnect: null,
    universeReconnectTarget: null,
    universeReconnectDismissed: false,
    // Auto-layout solver progress, or null when nothing is running (P2.06f):
    // { progress: 0..1, nodeCount, estimatedMs }. Written by useGraphLayout,
    // read by the progress indicator in ForceSimHost.
    layoutProgress: null,
    // Shrink ghosts for just-deleted nodes (P2.07): { id, x, y, width, height,
    // rx, color, delay }. DeletionGhostLayer renders them and removes each one
    // when its animation ends, so cleanup never renders the canvas.
    deletionGhosts: [],
    // Committed side-panel widths (P2.12): the one source for PanelResizers,
    // framing and every useViewportBounds. Updated when a resize ends
    // (panelWidthChanged) and re-clamped on window resize; the live width during
    // a drag goes to the DOM directly.
    leftPanelWidth: readPersistedPanelWidth('left'),
    rightPanelWidth: readPersistedPanelWidth('right'),
    autoGraphModalVisible: false,
    forceSimModalVisible: false,

    // text entry (F-47 #8). Only keyboard suppression reads this. The panels'
    // focus flags were never set (F-50) and were dropped in P2.04 (D-19): the
    // DOM check in utils/textEntry.js covers every panel field.
    isHeaderEditing: false,
    /** @type {string|null} Node whose name is being edited on the canvas (P2.03). */
    editingNodeIdOnCanvas: null,

    // left-panel view request (F-47 #9). Replaces `leftPanelInitialView` and
    // the imperative `leftPanelRef.setActiveView` calls (P2.05).
    /** @type {{ view: string, nonce: number }|null} */
    leftPanelViewRequest: null,

    // hover / vision aid (F-47 #11). Moved by P2.13.
    /** @type {object|null} */
    hoveredNodeForVision: null,
    /** @type {object|null} */
    hoveredConnectionForVision: null,
    /** @type {object|null} */
    activePieMenuItemForVision: null,

    // gamepad focus outputs (F-47 #13). 'canvas' is `MODE.CANVAS` in
    // useGamepad; the literal avoids importing a hook module into a store.
    /** @type {'canvas'|'node'|'edge'|'bottom'} */
    gamepadMode: 'canvas',
    /** @type {number} -1 when no pie bubble has gamepad focus. */
    gamepadPieFocusedIndex: -1,
    /** @type {string|null} */
    gamepadHeaderFocusedGraphId: null,

    // clipboard (F-47 #15). Bumped so paste affordances re-read the clipboard.
    clipboardVersion: 0,

    // input settings (F-47 #12)
    trackpadZoomEnabled: false,
  };
}

// ─── Setter factory ─────────────────────────────────────────────────────────

const resolveNext = (valueOrUpdater, prev) => (
  typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater
);

/**
 * Build a `useState`-style setter for one field.
 *
 * @param {Function} set zustand `set`
 * @param {string} key field name
 * @param {(prev: any, next: any) => boolean} isEqual skip the write when true
 * @param {(next: any) => any} [normalize] applied to the resolved value
 */
function fieldSetter(set, key, isEqual = Object.is, normalize) {
  return (valueOrUpdater) => set((state) => {
    const prev = state[key];
    let next = resolveNext(valueOrUpdater, prev);
    if (normalize) next = normalize(next);
    // Returning `state` itself tells zustand nothing changed: no notification.
    return isEqual(prev, next) ? state : { [key]: next };
  });
}

/**
 * The selection is a Set everywhere it is read (`.has`, `.size`). Callers pass
 * Sets today; any other iterable (or null) is turned into one rather than
 * stored as-is and crashing the first `.has`.
 */
const toSet = (value) => (value instanceof Set ? value : new Set(value ?? []));

// ─── Store ───────────────────────────────────────────────────────────────────

const useCanvasUIStore = create((set) => ({
  ...createCanvasUIDefaults(),

  // selection
  setSelectedInstanceIds: fieldSetter(set, 'selectedInstanceIds', setsEqual, toSet),
  // edge selection (P2.03c)
  setSelectedEdgeId: fieldSetter(set, 'selectedEdgeId'),
  // Always stores a copy, never the caller's Set.
  setSelectedEdgeIds: (edgeIds) => set((state) => {
    const next = new Set(typeof edgeIds === 'function' ? edgeIds(state.selectedEdgeIds) : edgeIds);
    return setsEqual(state.selectedEdgeIds, next) ? state : { selectedEdgeIds: next };
  }),
  addSelectedEdgeId: (edgeId) => set((state) => (
    state.selectedEdgeIds.has(edgeId) ? state : { selectedEdgeIds: new Set(state.selectedEdgeIds).add(edgeId) }
  )),
  removeSelectedEdgeId: (edgeId) => set((state) => {
    if (!state.selectedEdgeIds.has(edgeId)) return state;
    const next = new Set(state.selectedEdgeIds);
    next.delete(edgeId);
    return { selectedEdgeIds: next };
  }),
  clearSelectedEdgeIds: () => set((state) => (state.selectedEdgeIds.size === 0 ? state : { selectedEdgeIds: new Set() })),

  // group selection
  setSelectedGroupId: fieldSetter(set, 'selectedGroupId'),
  setLastSelectedGroupId: fieldSetter(set, 'lastSelectedGroupId'),

  // pie menu
  setSelectedNodeIdForPieMenu: fieldSetter(set, 'selectedNodeIdForPieMenu'),
  setIsTransitioningPieMenu: fieldSetter(set, 'isTransitioningPieMenu'),
  setIsPieMenuRendered: fieldSetter(set, 'isPieMenuRendered'),
  setCurrentPieMenuData: fieldSetter(set, 'currentPieMenuData'),
  setCarouselPieMenuStage: fieldSetter(set, 'carouselPieMenuStage'),
  setIsCarouselStageTransition: fieldSetter(set, 'isCarouselStageTransition'),
  setPendingAbstractionNodeId: fieldSetter(set, 'pendingAbstractionNodeId'),
  setPendingDecomposeNodeId: fieldSetter(set, 'pendingDecomposeNodeId'),

  // decompose preview
  setPreviewingNodeId: fieldSetter(set, 'previewingNodeId'),

  // definition navigation
  setNodeDefinitionIndices: fieldSetter(set, 'nodeDefinitionIndices', mapsEqual),
  /**
   * Set one context's definition index. Replaces the call-site pattern
   * `setNodeDefinitionIndices(prev => new Map(prev).set(key, i))` and skips
   * the write when that key already holds `index`.
   * @param {string} contextKey `"nodeId-graphId"`
   * @param {number} index
   */
  setNodeDefinitionIndex: (contextKey, index) => set((state) => {
    const prev = state.nodeDefinitionIndices;
    if (prev.has(contextKey) && Object.is(prev.get(contextKey), index)) return state;
    const next = new Map(prev);
    next.set(contextKey, index);
    return { nodeDefinitionIndices: next };
  }),

  // modes
  setAbstractionCarouselVisible: fieldSetter(set, 'abstractionCarouselVisible'),
  setAbstractionCarouselNode: fieldSetter(set, 'abstractionCarouselNode'),
  setCarouselAnimationState: fieldSetter(set, 'carouselAnimationState'),
  setJustCompletedCarouselExit: fieldSetter(set, 'justCompletedCarouselExit'),
  setSemanticOrbitActive: fieldSetter(set, 'semanticOrbitActive'),

  // prompts
  setNodeNamePrompt: fieldSetter(set, 'nodeNamePrompt', shallowEqual),
  setConnectionNamePrompt: fieldSetter(set, 'connectionNamePrompt', shallowEqual),
  setAbstractionPrompt: fieldSetter(set, 'abstractionPrompt', shallowEqual),
  setNodeGroupPrompt: fieldSetter(set, 'nodeGroupPrompt', shallowEqual),
  setSwapPrompt: fieldSetter(set, 'swapPrompt', shallowEqual),
  setNewWebPrompt: fieldSetter(set, 'newWebPrompt', shallowEqual),

  // modals and header searches
  setHeaderSearchVisible: fieldSetter(set, 'headerSearchVisible'),
  setHeaderAllThingsSearchVisible: fieldSetter(set, 'headerAllThingsSearchVisible'),
  setShowHelpModal: fieldSetter(set, 'showHelpModal'),
  setShowSettingsModal: fieldSetter(set, 'showSettingsModal'),
  setShowMergeThingsModal: fieldSetter(set, 'showMergeThingsModal'),
  setShowStorageSetupModal: fieldSetter(set, 'showStorageSetupModal'),
  setUniverseReconnect: fieldSetter(set, 'universeReconnect'),
  setUniverseReconnectTarget: fieldSetter(set, 'universeReconnectTarget'),
  setUniverseReconnectDismissed: fieldSetter(set, 'universeReconnectDismissed'),
  setLayoutProgress: fieldSetter(set, 'layoutProgress'),
  setLeftPanelWidth: fieldSetter(set, 'leftPanelWidth'),
  setRightPanelWidth: fieldSetter(set, 'rightPanelWidth'),
  setAutoGraphModalVisible: fieldSetter(set, 'autoGraphModalVisible'),
  setForceSimModalVisible: fieldSetter(set, 'forceSimModalVisible'),

  // text entry
  setIsHeaderEditing: fieldSetter(set, 'isHeaderEditing'),
  setEditingNodeIdOnCanvas: fieldSetter(set, 'editingNodeIdOnCanvas'),

  /**
   * Ask the left panel to show `view`.
   *
   * Deliberately NOT equality-skipped: this is a request, not a value. Asking
   * for the view that is already requested must fire again (the user may have
   * switched away since). The nonce makes every call a distinct request, and
   * Panel switches on each one (F18).
   * @param {string} view e.g. 'federation', 'ai'
   */
  /** Add shrink ghosts for nodes being deleted (P2.07). */
  addDeletionGhosts: (ghosts) => {
    if (!ghosts?.length) return;
    set((state) => ({ deletionGhosts: [...state.deletionGhosts, ...ghosts] }));
  },
  /** Drop one ghost once its animation has ended. */
  removeDeletionGhost: (id) => set((state) => (
    state.deletionGhosts.some((g) => g.id === id)
      ? { deletionGhosts: state.deletionGhosts.filter((g) => g.id !== id) }
      : state
  )),

  openLeftPanelView: (view) => set((state) => ({
    leftPanelViewRequest: { view, nonce: (state.leftPanelViewRequest?.nonce ?? 0) + 1 },
  })),

  // hover / vision aid
  setHoveredNodeForVision: fieldSetter(set, 'hoveredNodeForVision'),
  setHoveredConnectionForVision: fieldSetter(set, 'hoveredConnectionForVision'),
  setActivePieMenuItemForVision: fieldSetter(set, 'activePieMenuItemForVision'),

  // gamepad focus
  setGamepadMode: fieldSetter(set, 'gamepadMode'),
  setGamepadPieFocusedIndex: fieldSetter(set, 'gamepadPieFocusedIndex'),
  setGamepadHeaderFocusedGraphId: fieldSetter(set, 'gamepadHeaderFocusedGraphId'),

  // clipboard
  setClipboardVersion: fieldSetter(set, 'clipboardVersion'),
  /** Same as NodeCanvas's `markClipboardChanged`: always a change. */
  markClipboardChanged: () => set((state) => ({ clipboardVersion: state.clipboardVersion + 1 })),

  // input settings
  setTrackpadZoomEnabled: fieldSetter(set, 'trackpadZoomEnabled'),
}));

// ─── Selectors ───────────────────────────────────────────────────────────────

/**
 * True while a text field that reports its focus to the canvas is active, so
 * keyboard shortcuts must stand down. Only the header's title editor reports
 * its focus (D-19).
 *
 * This covers only the store flags. `isTextEntryActive(event)` in
 * `src/utils/textEntry.js` is a different thing: it asks the DOM, which also
 * catches fields that never report focus. Keyboard suppression uses both today
 * (`useCanvasKeyboard`), and should keep doing so.
 *
 * @param {ReturnType<typeof createCanvasUIDefaults>} state
 * @returns {boolean}
 */
export const selectIsTextEntryActive = (state) => Boolean(state.isHeaderEditing);

export { useCanvasUIStore };
export default useCanvasUIStore;

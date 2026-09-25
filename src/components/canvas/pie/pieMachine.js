/**
 * pieMachine — the node pie menu / abstraction carousel lifecycle as one pure
 * reducer (P5.02b step 2; design in reports/P5.02a.md §6).
 *
 * **Built, not wired.** Nothing dispatches to it yet; NodeCanvas still runs the
 * effects and callbacks this replaces. The store slice that runs it is
 * `dispatchPie` in canvasUIStore.
 *
 *   reducePie(state, event, env) → { patch, commands }
 *
 * PHASE 1 = BEHAVIOUR-EXACT. This reproduces what the code does today, bugs
 * included (NEW-2…NEW-8 in P5.02a §5). Fixes are separate B-commits. Where the
 * P5.02a doc and the code disagreed, the code was followed; see
 * reports/P5.02b-steps2-3.md.
 *
 * HOW IT STAYS EXACT: A COMMIT LOOP
 * Today the lifecycle is a set of NodeCanvas effects that re-run when their
 * deps change, read the values of the render they belong to, and write state
 * that lands in the NEXT render. That order is load-bearing: the graph-change
 * cleanup (E-cleanup) runs before the selection→pie effect (E-sel) in the same
 * flush and so judges its "keep the restored pie" guard on the target as it
 * was BEFORE E-sel re-targets. Calling a reconcile() and then a reset on the
 * post-reconcile state would get that wrong.
 * So the reducer applies the event's own writes as one "commit", then replays
 * the effects as commits until nothing changes:
 *   - each effect runs only when one of its deps changed from the previous
 *     commit (`Object.is`, as React compares deps);
 *   - each reads the current commit's values, never another effect's writes;
 *   - writes merge in declaration order, the later one winning, and a write
 *     equal to the current value is skipped (as the store setters skip it).
 * The loop mirrors the effects listed in RUN ORDER below; camera effects only
 * emit `frame` commands.
 *
 * STATE: phase 1 keeps the existing flat canvasUIStore field names (P5.02a
 * §6.2 "phase-1 mapping"), so no reader changes. `isTransitioningPieMenu` plus
 * the pending ids and the stage flag stand in for the doc's `intent`.
 *
 * COMMANDS (plain data; `runPieCommands` in canvasUIStore executes them):
 *   { type: 'after', ms, event, key? }
 *       Dispatch `event` after `ms`. With a `key`, replaces a pending timer of
 *       the same key (only the watchdog has one). Without, it is never
 *       cancelled: today's guard timers aren't (NEW-6).
 *   { type: 'cancel', key }
 *       Clear the pending timer with that key.
 *   { type: 'frame', kind, nodeId }
 *       A camera framing the camera effects would do now. kinds:
 *       'carouselOpen' (E-cxFrame), 'decomposeOpen' (E-decomposeFrame),
 *       'recompose' (E-recompose), 'focusOnSelect' (E-focus), 'returnFocus'
 *       (E-return). The reducer applies the guards it can see in its state;
 *       the handler applies the rest (drag in progress, multi-select, the
 *       focus-on-select setting, node still present).
 *   { type: 'graph', action: 'applyCarouselSwap', args: { swap, graphId } }
 *       The carousel Swap, as onCarouselExitAnimationComplete does it: move the
 *       instance to the focused prototype, keeping its centre.
 *   { type: 'local', action, args? }
 *       Writes to NodeCanvas locals that haven't moved to the store:
 *       'fullReset'        E-cleanup's local list: editingGroupId=null,
 *                          tempGroupName='', plusSign=null, selectionStart +
 *                          selectionStartRef=null, drawingConnectionFrom=null,
 *                          pie colour picker closed (visible=false, node=null),
 *                          carousel focused scale=1.2 / dims=null /
 *                          node=null, abstraction panel CUT (visible and
 *                          shouldShow false). The store's `resetNonce` is
 *                          bumped in the same patch as an alternative hook.
 *       'closeAllPanels'   E-closeAll: node, connection, abstraction and group
 *                          panels `visible=false` (they animate out).
 *       'closePieColorPicker'  E-colorPicker: visible=false, node id=null.
 *       'clearCarouselFocus'   teardown: focused node=null, dims=null.
 *       'carouselFocusPrototypeRequest'  args: { prototypeId }.
 *
 * ENV (explicit, minimal):
 *   findNode(id) → node | null   PIE_EXITED rows 1–2 (the hydrated node of the
 *                                active graph, as `nodes.find` returns it).
 *   activeGraphId                CAROUSEL_EXITED's swap command.
 * Timer-fired events need no env.
 */

export const PIE_WATCHDOG_MS = 1200;
export const PIE_CLICK_GUARD_MS = 100;
export const PIE_EXIT_GUARD_MS = 300;
export const PIE_WATCHDOG_KEY = 'watchdog';

/** Enough for the longest cascade (four commits); more means a loop. */
const MAX_COMMITS = 12;

/** The descriptor the prompt's close and submit paths write today. */
export const hiddenAbstractionPrompt = () => ({
  visible: false, name: '', color: null, direction: 'above', nodeId: null, carouselLevel: null,
});

// ─── Field equality (same rules as the canvasUIStore setters) ────────────────
// Kept local rather than imported: the store imports this module.

function setsEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
}

const FIELD_EQUAL = {
  selectedInstanceIds: setsEqual,
  abstractionPrompt: shallowEqual,
  nodeNamePrompt: shallowEqual,
  hoveredEdgeInfo: (a, b) => (a?.edgeId ?? null) === (b?.edgeId ?? null),
};
const fieldEqual = (key, a, b) => (FIELD_EQUAL[key] ?? Object.is)(a, b);

const toSet = (value) => (value instanceof Set ? value : new Set(value ?? []));

/** Apply `writes` to `state`, skipping equal values. Returns `state` itself when nothing changed. */
function mergeWrites(state, writes) {
  let next = state;
  for (const key of Object.keys(writes)) {
    if (fieldEqual(key, state[key], writes[key])) continue;
    if (next === state) next = { ...state };
    next[key] = writes[key];
  }
  return next;
}

// ─── Rules shared by several events ──────────────────────────────────────────

/**
 * E-sel (selection → pie target), verbatim. Returns its writes. A click on
 * another node while a transition plays is applied when the transition ends,
 * because `isTransitioningPieMenu` is a dep (P5.02a §4.1).
 */
export function reconcileWrites(s) {
  if (s.marqueeActive) return {}; // the marquee is still being dragged
  if (s.selectedInstanceIds.size === 1) {
    if (s.isTransitioningPieMenu) return {}; // re-runs when the flag falls
    return { selectedNodeIdForPieMenu: [...s.selectedInstanceIds][0] };
  }
  // 0 or ≥2 selected
  if (s.abstractionPrompt.visible && s.abstractionCarouselVisible) return {};
  if (s.carouselAnimationState === 'exiting') return {};
  if (s.justCompletedCarouselExit) return {};
  // Losing the selection under the carousel starts its exit without shrinking
  // the pie first (T13, A-4); onCarouselExitAnimationComplete then re-selects
  // the carousel's node (NEW-7).
  if (s.abstractionCarouselVisible && s.selectedNodeIdForPieMenu) return { carouselAnimationState: 'exiting' };
  return { selectedNodeIdForPieMenu: null };
}

/** The guards that keep E-cleanup from resetting. Each alone blocks it. */
export function fullResetBlocked(s) {
  return Boolean(
    s.abstractionCarouselVisible
    || s.justCompletedCarouselExit
    || s.isTransitioningPieMenu
    || s.carouselExitInProgress
    || (s.selectedInstanceIds.size === 1 && s.selectedNodeIdForPieMenu && !s.abstractionCarouselVisible)
  );
}

/**
 * E-cleanup's store writes (P5.02a §4.9), in the code's order. Its NodeCanvas
 * locals go out as the 'fullReset' command. Note it resets
 * `pendingAbstractionNodeId` but not `pendingDecomposeNodeId`, as today.
 */
export function fullResetWrites(s) {
  return {
    selectedInstanceIds: new Set(),
    previewingNodeId: null,
    editingNodeIdOnCanvas: null,
    // Exactly what the code writes: no `color` key, unlike the default.
    nodeNamePrompt: { visible: false, name: '' },
    marqueeActive: false, // mirrors selectionStart, which the local reset clears
    hoveredEdgeInfo: null,
    selectedNodeIdForPieMenu: null,
    currentPieMenuData: null,
    isPieMenuRendered: false,
    carouselPieMenuStage: 1,
    isCarouselStageTransition: false,
    isTransitioningPieMenu: false,
    abstractionCarouselVisible: false,
    abstractionCarouselNode: null,
    pendingAbstractionNodeId: null,
    carouselAnimationState: 'hidden',
    pendingSwapOperation: null,
    resetNonce: s.resetNonce + 1,
  };
}

const after = (ms, event, key) => (key ? { type: 'after', ms, event, key } : { type: 'after', ms, event });
const clickGuardTimer = () => after(PIE_CLICK_GUARD_MS, { type: 'CLICK_GUARD_ELAPSED' });
const frame = (kind, nodeId) => ({ type: 'frame', kind, nodeId });
const local = (action, args) => (args === undefined ? { type: 'local', action } : { type: 'local', action, args });

/** Pie actions refuse to start while a carousel exit is finishing (builders' guard). */
const exitingWithoutCarousel = (s) => !s.abstractionCarouselVisible && s.carouselAnimationState === 'exiting';

/** The requestCarouselClose / handleCanvasClick teardown: no exit animation. */
function teardownWrites(out) {
  out.commands.push(local('clearCarouselFocus'));
  return {
    abstractionCarouselVisible: false,
    abstractionCarouselNode: null,
    carouselAnimationState: 'hidden',
    carouselPieMenuStage: 1,
  };
}

/** onCarouselClose: the same exit as stage-1 Back, from Escape / click-away / panel dismiss. */
function carouselCloseWrites(out) {
  out.commands.push(clickGuardTimer());
  return {
    isCarouselStageTransition: false, // resolve as a carousel exit, not a stage swap
    justCompletedCarouselExit: true,
    isPieMenuActionInProgress: true,
    isTransitioningPieMenu: true,
  };
}

// ─── Events ──────────────────────────────────────────────────────────────────
// Each returns its own writes (one commit), or `null` to ignore the event.

const EVENTS = {
  /**
   * The selection changed. With `ids`, this writes the selection too (one set);
   * without, the caller already wrote it. Either way E-sel re-runs.
   */
  SELECTION_CHANGED: (s, e) => (e.ids === undefined ? {} : { selectedInstanceIds: toSet(e.ids) }),

  /** Marquee started (`active`) or committed; mirrors `selectionStart != null`. */
  MARQUEE: (s, e) => ({ marqueeActive: Boolean(e.active) }),

  /**
   * A direct target write: Wizard select, touch deferred tap / tap-off / drag
   * start, Duplicate, Delete, context-menu Delete / Color / Decompose.
   */
  PIE_TARGET: (s, e) => ({
    selectedNodeIdForPieMenu: e.id ?? null,
    ...(e.selection !== undefined ? { selectedInstanceIds: toSet(e.selection) } : {}),
  }),

  /** E-rebuild: the pie's data for its target (null when the node is gone). */
  PIE_DATA: (s, e) => (e.data
    ? { currentPieMenuData: e.data, isPieMenuRendered: true }
    // Node gone: data cleared, `isPieMenuRendered` left as it is (A-3).
    : { currentPieMenuData: null }),

  /** E-buttonsSync: new buttons into the menu being drawn, even mid-shrink. Always a new object, as today. */
  PIE_BUTTONS: (s, e) => (s.currentPieMenuData ? { currentPieMenuData: { ...s.currentPieMenuData, buttons: e.buttons } } : {}),

  /** 'abstraction' pie action: shrink, then open the carousel on `nodeId` (row 1). */
  PIE_TO_CAROUSEL: (s, e) => (exitingWithoutCarousel(s) ? null
    : { pendingAbstractionNodeId: e.nodeId, isTransitioningPieMenu: true }),

  /** 'decompose-preview' pie action: shrink, then toggle the preview on `nodeId` (row 2). */
  PIE_TO_DECOMPOSE: (s, e) => (exitingWithoutCarousel(s) ? null
    : { pendingDecomposeNodeId: e.nodeId, isTransitioningPieMenu: true }),

  /** 'compose-preview' pie action: shrink, then row 4 (toggles the SELECTED node: NEW-5). */
  PIE_COMPOSE: (s) => (exitingWithoutCarousel(s) ? null : { isTransitioningPieMenu: true }),

  /** 'carousel-plus' / 'carousel-back-stage2': shrink, then swap stage (row 3a). */
  STAGE_REQUEST: () => ({ isCarouselStageTransition: true, isTransitioningPieMenu: true }),

  /**
   * Stage-1 'carousel-back'. Leaves the stage flag alone, so after a cancelled
   * Add Above/Below it resolves as a stage swap instead of an exit (NEW-2).
   */
  CAROUSEL_BACK: (s, e, env, out) => {
    out.commands.push(clickGuardTimer());
    return { justCompletedCarouselExit: true, isPieMenuActionInProgress: true, isTransitioningPieMenu: true };
  },

  /** onCarouselClose: Escape, mouse click-away, AbstractionControlPanel dismiss. */
  CAROUSEL_CLOSE: (s, e, env, out) => carouselCloseWrites(out),

  /** requestCarouselClose (touch tap on empty space). Idempotent per carousel showing. */
  CAROUSEL_TOUCH_CLOSE: (s, e, env, out) => {
    if (!s.abstractionCarouselVisible) return null;
    if (s.carouselCloseRequested) return null;
    const rest = s.selectedNodeIdForPieMenu ? carouselCloseWrites(out) : teardownWrites(out);
    return { carouselCloseRequested: true, ...rest };
  },

  /** A click-guarded carousel action with no other lifecycle write (Delete; Swap/Expand before they act). */
  CLICK_GUARD: (s, e, env, out) => {
    out.commands.push(clickGuardTimer());
    return { isPieMenuActionInProgress: true };
  },

  /**
   * 'carousel-swap' / '-expand' / '-ask-wizard': clear the target, then the
   * carousel exits (row 3b). The exit guard is NOT raised on this path.
   * `raiseClickGuard: false` for Expand's delayed (50 ms) path, which raised
   * it at click time with CLICK_GUARD.
   */
  CAROUSEL_LEAVE: (s, e, env, out) => {
    const writes = {
      selectedNodeIdForPieMenu: null,
      isTransitioningPieMenu: true,
      ...(e.swap !== undefined ? { pendingSwapOperation: e.swap } : {}),
    };
    if (e.raiseClickGuard === false) return writes;
    out.commands.push(clickGuardTimer());
    return { isPieMenuActionInProgress: true, ...writes };
  },

  /** handleCanvasClick / groupInput defensive branch: carousel up with no pie target. */
  CAROUSEL_TEARDOWN: (s, e, env, out) => teardownWrites(out),

  /**
   * Context-menu "Generalize / Specify" and the node panel's abstraction
   * button: open the carousel directly, no pie shrink (T6b). The context menu
   * has the builders' exiting guard; the panel does not (`guard: false`).
   */
  CAROUSEL_OPEN_DIRECT: (s, e) => {
    if (e.guard !== false && exitingWithoutCarousel(s)) return null;
    return {
      abstractionCarouselNode: e.node,
      carouselAnimationState: 'entering',
      abstractionCarouselVisible: true,
      selectedNodeIdForPieMenu: e.node.id,
      selectedInstanceIds: new Set([e.node.id]),
    };
  },

  /** The carousel's 200 ms entrance timer. Unconditional, as onCarouselAnimationStateChange is. */
  CAROUSEL_ENTERED: () => ({ carouselAnimationState: 'visible' }),

  /** onCarouselExitAnimationComplete (P5.02a §4.5). */
  CAROUSEL_EXITED: (s, e, env, out) => {
    const nodeId = s.abstractionCarouselNode?.id;
    const writes = {};
    if (s.pendingSwapOperation) {
      out.commands.push({ type: 'graph', action: 'applyCarouselSwap', args: { swap: s.pendingSwapOperation, graphId: env.activeGraphId } });
      // The code also sets the carousel node to a swapped copy here; the null
      // below overwrites it in the same batch, so only the null is written.
      writes.pendingSwapOperation = null;
    }
    writes.carouselExitInProgress = true;
    writes.abstractionCarouselVisible = false;
    writes.abstractionCarouselNode = null;
    writes.carouselAnimationState = 'hidden';
    writes.isTransitioningPieMenu = false;
    // Restored unconditionally (the click-away flag is dead, NEW-1), even if the
    // node is gone (NEW-7) or the web changed under the exit (NEW-3). Stage and
    // focused-node state are NOT reset (NEW-4).
    if (nodeId) {
      writes.selectedInstanceIds = new Set([nodeId]);
      writes.selectedNodeIdForPieMenu = nodeId;
      writes.pendingCarouselReturnFocusId = nodeId;
    }
    // Never cancelled: a later exit's guards can be lowered by this one (NEW-6).
    out.commands.push(after(PIE_EXIT_GUARD_MS, { type: 'EXIT_GUARD_ELAPSED' }));
    return writes;
  },

  /**
   * The 300 ms guard timer. Lowering an exit guard that was never raised
   * (T10/T13) changes nothing, so E-cleanup doesn't re-run (NEW-3).
   */
  EXIT_GUARD_ELAPSED: () => ({ justCompletedCarouselExit: false, carouselExitInProgress: false }),

  CLICK_GUARD_ELAPSED: () => ({ isPieMenuActionInProgress: false }),

  /** Stuck-transition recovery. Pending ids are left as they are, as today. */
  WATCHDOG: () => ({ isTransitioningPieMenu: false, isCarouselStageTransition: false }),

  /** 'carousel-add-above/below': show the prompt; the pie stays open. */
  PROMPT_OPEN: (s, e) => ({ abstractionPrompt: e.prompt }),

  /** submitAbstraction's tail: back to stage 1 in place, focus the new level. */
  PROMPT_SUBMITTED: (s, e, env, out) => {
    out.commands.push(local('carouselFocusPrototypeRequest', { prototypeId: e.newNodeId }));
    return {
      abstractionPrompt: hiddenAbstractionPrompt(),
      abstractionCarouselVisible: true,
      carouselPieMenuStage: 1,
      isCarouselStageTransition: false,
      ...(s.abstractionCarouselNode ? { selectedNodeIdForPieMenu: s.abstractionCarouselNode.id } : {}),
    };
  },

  /** The prompt's onClose. Raises the stage flag with no transition running (NEW-2). */
  PROMPT_CANCELLED: (s) => ({
    abstractionPrompt: hiddenAbstractionPrompt(),
    carouselPieMenuStage: 1,
    isCarouselStageTransition: true,
    ...(s.abstractionCarouselNode && !s.selectedNodeIdForPieMenu
      ? { selectedNodeIdForPieMenu: s.abstractionCarouselNode.id } : {}),
  }),

  /**
   * Preview set directly, with no pie shrink: control panel Compose / Decompose
   * (T5b/T5c, A-7), 'decomp-further(-empty)' (`endTransition: true`, it writes
   * `isTransitioningPieMenu=false`; `selection: []`), node-group conversion.
   */
  PREVIEW_SET: (s, e) => ({
    previewingNodeId: e.id ?? null,
    ...(e.endTransition ? { isTransitioningPieMenu: false } : {}),
    ...(e.selection !== undefined ? { selectedInstanceIds: toSet(e.selection) } : {}),
  }),

  /**
   * Orbit on/off. The pie's own Orbit keeps the target (the menu hides via
   * isVisible and keeps its page); context-menu and panel Orbit clear it
   * (`clearTarget`), which E-sel then puts back when one node is selected.
   * Node-panel and orbit-data writes stay with the caller.
   */
  ORBIT: (s, e) => ({
    semanticOrbitActive: Boolean(e.active),
    ...(e.clearTarget ? { selectedNodeIdForPieMenu: null } : {}),
    ...(e.selection !== undefined ? { selectedInstanceIds: toSet(e.selection) } : {}),
  }),

  /** The active graph changed: E-cleanup's graph trigger and E-closeAll run in the loop. */
  GRAPH_CHANGED: () => ({}),

  /** PieMenu's onExitAnimationComplete (P5.02a §4.2 decision table). */
  PIE_EXITED: (s, e, env) => {
    const writes = {
      isPieMenuRendered: false,
      currentPieMenuData: null,
      pendingAbstractionNodeId: null,
      pendingDecomposeNodeId: null,
    };
    const lastActiveNodeId = s.selectedNodeIdForPieMenu;
    const findNode = (id) => env.findNode?.(id) ?? null;

    if (s.isTransitioningPieMenu && s.pendingAbstractionNodeId) {
      // Row 1: pie → carousel.
      writes.isTransitioningPieMenu = false;
      const node = findNode(s.pendingAbstractionNodeId);
      if (node) {
        writes.abstractionCarouselNode = node;
        writes.carouselAnimationState = 'entering';
        writes.abstractionCarouselVisible = true;
        writes.selectedNodeIdForPieMenu = s.pendingAbstractionNodeId;
      }
    } else if (s.isTransitioningPieMenu && s.pendingDecomposeNodeId) {
      // Row 2: pie → decompose preview (toggle).
      writes.isTransitioningPieMenu = false;
      if (findNode(s.pendingDecomposeNodeId)) {
        writes.previewingNodeId = s.previewingNodeId === s.pendingDecomposeNodeId ? null : s.pendingDecomposeNodeId;
        writes.selectedNodeIdForPieMenu = s.pendingDecomposeNodeId;
      }
    } else if (s.isTransitioningPieMenu && s.abstractionCarouselVisible) {
      if (s.isCarouselStageTransition) {
        // Row 3a: carousel stage swap.
        writes.isCarouselStageTransition = false;
        writes.isTransitioningPieMenu = false;
        if (s.carouselPieMenuStage === 1) writes.carouselPieMenuStage = 2;
        else if (s.carouselPieMenuStage === 2) writes.carouselPieMenuStage = 1;
        if (lastActiveNodeId) writes.selectedNodeIdForPieMenu = lastActiveNodeId;
      } else {
        // Row 3b: carousel exit, phase 1. The transition stays up until
        // CAROUSEL_EXITED, so the watchdog budget covers both animations.
        writes.carouselAnimationState = 'exiting';
      }
    } else if (s.isTransitioningPieMenu) {
      // Row 4: Compose and any other generic transition. Acts on whatever is
      // selected NOW, not the node Compose was pressed on (NEW-5).
      writes.isTransitioningPieMenu = false;
      const selectedId = [...s.selectedInstanceIds][0];
      if (selectedId) {
        writes.previewingNodeId = s.previewingNodeId === selectedId ? null : selectedId;
        writes.selectedNodeIdForPieMenu = selectedId;
      } else {
        writes.previewingNodeId = null;
      }
    } else {
      // Row 5: plain dismiss / orbit / drag / retarget away.
      writes.isTransitioningPieMenu = false;
    }
    return writes;
  },
};

/** Every event type the reducer accepts. */
export const PIE_EVENT_TYPES = Object.freeze(Object.keys(EVENTS));

// ─── The effect replay ───────────────────────────────────────────────────────

/**
 * One commit's effects, in NodeCanvas declaration order (RUN ORDER):
 *   E-cxFrame, E-closeReq, E-promptStage, E-decomposeFrame, E-focus,
 *   E-recompose, E-return, E-cleanup, E-closeAll, E-page, E-colorPicker, E-sel,
 *   [E-rebuild: outside, it dispatches PIE_DATA], E-vision, E-watchdog.
 * `prev` is the previous commit, `cur` this one. Returns the merged writes.
 */
function runEffects(prev, cur, flags, commands) {
  const w = {};
  const changed = (key) => !Object.is(prev[key], cur[key]);
  const promptVisibleChanged = prev.abstractionPrompt.visible !== cur.abstractionPrompt.visible;
  const visibleChanged = changed('abstractionCarouselVisible');
  const targetChanged = changed('selectedNodeIdForPieMenu');
  const previewChanged = changed('previewingNodeId');

  // E-cxFrame: carousel opened → frame its node.
  if (visibleChanged && cur.abstractionCarouselVisible) {
    commands.push(frame('carouselOpen', cur.abstractionCarouselNode?.id ?? null));
  }

  // E-closeReq: the touch close request is per showing.
  if (visibleChanged && !cur.abstractionCarouselVisible) w.carouselCloseRequested = false;

  // E-promptStage: "prompt visible ⇒ stage 2" (defensive; no path found that needs it).
  if (promptVisibleChanged || changed('carouselPieMenuStage') || targetChanged || changed('abstractionCarouselNode')) {
    if (cur.abstractionPrompt.visible && cur.carouselPieMenuStage !== 2) {
      w.carouselPieMenuStage = 2;
      if (!cur.selectedNodeIdForPieMenu && cur.abstractionCarouselNode) {
        w.selectedNodeIdForPieMenu = cur.abstractionCarouselNode.id;
      }
    }
  }

  // E-decomposeFrame: preview null → id.
  if (previewChanged && !prev.previewingNodeId && cur.previewingNodeId) {
    commands.push(frame('decomposeOpen', cur.previewingNodeId));
  }

  // E-focus: a fresh target, with no other framing owner active.
  if (targetChanged && cur.selectedNodeIdForPieMenu
    && !cur.abstractionCarouselVisible && !cur.previewingNodeId && !cur.isTransitioningPieMenu) {
    commands.push(frame('focusOnSelect', cur.selectedNodeIdForPieMenu));
  }

  // E-recompose: preview id → null.
  if (previewChanged && prev.previewingNodeId && !cur.previewingNodeId
    && !cur.abstractionCarouselVisible && !cur.isTransitioningPieMenu) {
    commands.push(frame('recompose', prev.previewingNodeId));
  }

  // E-return: carousel hidden with a return target → consume it and frame.
  if (visibleChanged && !cur.abstractionCarouselVisible && cur.pendingCarouselReturnFocusId) {
    w.pendingCarouselReturnFocusId = null;
    commands.push(frame('returnFocus', cur.pendingCarouselReturnFocusId));
  }

  // E-cleanup ("Graph Change Cleanup"): four triggers, five guards.
  if (flags.graphChanged || visibleChanged || changed('justCompletedCarouselExit') || changed('isTransitioningPieMenu')) {
    if (!fullResetBlocked(cur)) {
      Object.assign(w, fullResetWrites(cur));
      commands.push(local('fullReset'));
    }
  }

  // E-closeAll: always on a graph change, after E-cleanup.
  if (flags.graphChanged) {
    commands.push(local('closeAllPanels'));
    w.selectedGroupId = null;
    w.previewingNodeId = null;
    w.selectedInstanceIds = new Set();
    w.selectedNodeIdForPieMenu = null;
  }

  // E-page: back to page 0 whenever the target changes (including to null).
  if (targetChanged) w.pieMenuPage = 0;

  // E-colorPicker: no data or no target → close the pie colour picker. Its dep
  // is `hasPieMenuData` (a boolean), not the data object.
  const hasData = cur.currentPieMenuData != null;
  if ((hasData !== (prev.currentPieMenuData != null) || targetChanged)
    && (!hasData || !cur.selectedNodeIdForPieMenu)) {
    commands.push(local('closePieColorPicker'));
  }

  // E-sel.
  if (flags.forceReconcile || changed('selectedInstanceIds') || changed('isTransitioningPieMenu')
    || promptVisibleChanged || visibleChanged || targetChanged || changed('carouselAnimationState')
    || changed('justCompletedCarouselExit') || changed('marqueeActive')) {
    Object.assign(w, reconcileWrites(cur));
  }

  // E-vision: the hover chip goes when the menu unmounts.
  if (changed('isPieMenuRendered') && !cur.isPieMenuRendered) w.activePieMenuItemForVision = null;

  // E-watchdog: armed when a transition starts, cancelled when it ends.
  if (changed('isTransitioningPieMenu')) {
    commands.push(cur.isTransitioningPieMenu
      ? after(PIE_WATCHDOG_MS, { type: 'WATCHDOG' }, PIE_WATCHDOG_KEY)
      : { type: 'cancel', key: PIE_WATCHDOG_KEY });
  }

  return w;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

/**
 * @param {object} state canvasUIStore state (only the lifecycle fields are read)
 * @param {{ type: string }} event one of PIE_EVENT_TYPES, with its payload
 * @param {{ findNode?: (id: string) => object|null, activeGraphId?: string }} [env]
 * @returns {{ patch: object, commands: object[] }} `patch` holds only fields
 *   whose value changed; `commands` run in order after the patch is applied.
 */
export function reducePie(state, event, env = {}) {
  const handler = EVENTS[event?.type];
  if (!handler) throw new Error(`reducePie: unknown event type ${event?.type}`);

  const out = { commands: [] };
  const writes = handler(state, event, env, out);
  if (writes === null) return { patch: {}, commands: [] };

  let prev = state;
  let cur = mergeWrites(state, writes);
  let flags = {
    graphChanged: event.type === 'GRAPH_CHANGED',
    forceReconcile: event.type === 'SELECTION_CHANGED',
  };
  let settled = false;
  for (let commit = 0; commit < MAX_COMMITS; commit++) {
    const next = mergeWrites(cur, runEffects(prev, cur, flags, out.commands));
    flags = {};
    if (next === cur) { settled = true; break; }
    prev = cur;
    cur = next;
  }
  if (!settled) console.error(`[pieMachine] ${event.type} did not settle in ${MAX_COMMITS} commits`);

  // A field can change and change back across commits; only net changes go out.
  const patch = {};
  for (const key of Object.keys(cur)) {
    if (!fieldEqual(key, state[key], cur[key])) patch[key] = cur[key];
  }
  return { patch, commands: out.commands };
}

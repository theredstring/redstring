import { describe, it, expect, vi } from 'vitest';
import { createCanvasUIDefaults } from '../../../../store/canvasUIStore.js';
import {
  reducePie,
  reconcileWrites,
  fullResetBlocked,
  PIE_EVENT_TYPES,
  PIE_WATCHDOG_MS,
  PIE_WATCHDOG_KEY,
  PIE_CLICK_GUARD_MS,
  PIE_EXIT_GUARD_MS,
} from '../pieMachine.js';

/**
 * P5.02b step 2: the pie / carousel lifecycle reducer, phase 1 (behaviour-
 * exact). Tests marked CURRENT BEHAVIOUR pin bugs as they are today (P5.02a
 * §5); a B-commit that fixes one updates its test on purpose.
 */

const nodeA = { id: 'A', prototypeId: 'pA', x: 0, y: 0, name: 'A' };
const nodeB = { id: 'B', prototypeId: 'pB', x: 100, y: 0, name: 'B' };
const findNode = (id) => ({ A: nodeA, B: nodeB })[id] ?? null;
const env = { findNode, activeGraphId: 'g1' };
const pieData = (node = nodeA) => ({ node, buttons: [{ id: 'x' }], nodeDimensions: {} });

/** A state with defaults plus overrides; `selection` is a shorthand. */
function S({ selection, ...overrides } = {}) {
  return {
    ...createCanvasUIDefaults(),
    ...(selection ? { selectedInstanceIds: new Set(selection) } : {}),
    ...overrides,
  };
}

/** Run one event; `next` is the state after its patch. */
function run(state, event, e = env) {
  const { patch, commands } = reducePie(state, event, e);
  return { patch, commands, next: { ...state, ...patch } };
}

/** Run events in order, threading the state; returns the last result and all commands. */
function runAll(state, events, e = env) {
  let cur = state;
  const all = [];
  let last;
  for (const event of events) {
    last = run(cur, event, e);
    cur = last.next;
    all.push(...last.commands);
  }
  return { ...last, next: cur, all };
}

const has = (commands, match) => commands.some((c) => Object.entries(match).every(([k, v]) => (
  typeof v === 'object' && v !== null ? JSON.stringify(c[k]) === JSON.stringify(v) : c[k] === v
)));
const armsWatchdog = (commands) => has(commands, { type: 'after', ms: PIE_WATCHDOG_MS, key: PIE_WATCHDOG_KEY, event: { type: 'WATCHDOG' } });
const cancelsWatchdog = (commands) => has(commands, { type: 'cancel', key: PIE_WATCHDOG_KEY });
const didFullReset = (commands) => has(commands, { type: 'local', action: 'fullReset' });

/** A single node selected with its default pie open. */
const pieOpenOnA = (o = {}) => S({
  selection: ['A'], selectedNodeIdForPieMenu: 'A', isPieMenuRendered: true, currentPieMenuData: pieData(), ...o,
});

/** The carousel up on A with its stage-1 pie. */
const carouselOnA = (o = {}) => pieOpenOnA({
  abstractionCarouselVisible: true, abstractionCarouselNode: nodeA, carouselAnimationState: 'visible', ...o,
});

describe('reducePie basics', () => {
  it('throws on an unknown event', () => {
    expect(() => reducePie(S(), { type: 'NOPE' })).toThrow(/unknown event/);
  });

  it('returns only changed fields, and an empty patch for a no-op', () => {
    const { patch, commands } = reducePie(S(), { type: 'CLICK_GUARD_ELAPSED' });
    expect(patch).toEqual({});
    expect(commands).toEqual([]);
  });

  it('lists its event types', () => {
    expect(PIE_EVENT_TYPES).toContain('PIE_EXITED');
    expect(PIE_EVENT_TYPES).toContain('CAROUSEL_EXITED');
  });

  it('does not mutate the state it is given', () => {
    const state = pieOpenOnA({ isTransitioningPieMenu: true });
    const frozen = JSON.stringify({ ...state, selectedInstanceIds: [...state.selectedInstanceIds] });
    reducePie(state, { type: 'PIE_EXITED' }, env);
    expect(JSON.stringify({ ...state, selectedInstanceIds: [...state.selectedInstanceIds] })).toBe(frozen);
  });
});

describe('reconcile (E-sel), all branches', () => {
  it('does nothing while a marquee is being dragged', () => {
    const { next } = run(S({ marqueeActive: true }), { type: 'SELECTION_CHANGED', ids: ['A'] });
    expect(next.selectedNodeIdForPieMenu).toBeNull();
  });

  it('targets the single selected node', () => {
    const { next } = run(S(), { type: 'SELECTION_CHANGED', ids: ['A'] });
    expect(next.selectedNodeIdForPieMenu).toBe('A');
  });

  it('waits while a transition plays, then applies the click when it ends', () => {
    const state = pieOpenOnA({ isTransitioningPieMenu: true });
    const clicked = run(state, { type: 'SELECTION_CHANGED', ids: ['B'] });
    expect(clicked.next.selectedNodeIdForPieMenu).toBe('A');
    // Whatever lowers the flag, E-sel re-runs on it and takes B.
    const ended = run(clicked.next, { type: 'WATCHDOG' });
    expect(ended.next.selectedNodeIdForPieMenu).toBe('B');
  });

  it('keeps the target while the abstraction prompt is up over the carousel', () => {
    const state = carouselOnA({ abstractionPrompt: { ...S().abstractionPrompt, visible: true }, carouselPieMenuStage: 2 });
    const { next } = run(state, { type: 'SELECTION_CHANGED', ids: [] });
    expect(next.selectedNodeIdForPieMenu).toBe('A');
    expect(next.carouselAnimationState).toBe('visible');
  });

  it('keeps the target while the carousel is exiting', () => {
    const { next } = run(carouselOnA({ carouselAnimationState: 'exiting' }), { type: 'SELECTION_CHANGED', ids: [] });
    expect(next.selectedNodeIdForPieMenu).toBe('A');
  });

  it('keeps the target under the exit guard', () => {
    const { next } = run(pieOpenOnA({ justCompletedCarouselExit: true }), { type: 'SELECTION_CHANGED', ids: [] });
    expect(next.selectedNodeIdForPieMenu).toBe('A');
  });

  it('starts the carousel exit, without a pie shrink, when the selection is lost under it (T13)', () => {
    const { next } = run(carouselOnA(), { type: 'SELECTION_CHANGED', ids: [] });
    expect(next.carouselAnimationState).toBe('exiting');
    expect(next.selectedNodeIdForPieMenu).toBe('A');
    expect(next.isTransitioningPieMenu).toBe(false);
  });

  it('clears the target otherwise (0 or ≥2 selected)', () => {
    expect(run(pieOpenOnA(), { type: 'SELECTION_CHANGED', ids: [] }).next.selectedNodeIdForPieMenu).toBeNull();
    expect(run(pieOpenOnA(), { type: 'SELECTION_CHANGED', ids: ['A', 'B'] }).next.selectedNodeIdForPieMenu).toBeNull();
  });

  it('runs on SELECTION_CHANGED even when the caller already wrote the selection', () => {
    const state = S({ selection: ['A'] }); // written by a plain setter, target not yet set
    expect(run(state, { type: 'SELECTION_CHANGED' }).next.selectedNodeIdForPieMenu).toBe('A');
  });

  it('re-runs when the marquee commits', () => {
    const state = S({ selection: ['A'], marqueeActive: true });
    expect(run(state, { type: 'MARQUEE', active: false }).next.selectedNodeIdForPieMenu).toBe('A');
  });

  it('reconcileWrites is the pure rule', () => {
    expect(reconcileWrites(S({ selection: ['A'] }))).toEqual({ selectedNodeIdForPieMenu: 'A' });
    expect(reconcileWrites(S())).toEqual({ selectedNodeIdForPieMenu: null });
  });
});

describe('PIE_EXITED (H-pieExit decision table)', () => {
  it('always unmounts the menu, drops both pendings and clears the hover chip', () => {
    const state = pieOpenOnA({ selection: [], selectedNodeIdForPieMenu: null, activePieMenuItemForVision: { id: 'x' } });
    const { next, commands } = run(state, { type: 'PIE_EXITED' });
    expect(next.isPieMenuRendered).toBe(false);
    expect(next.currentPieMenuData).toBeNull();
    expect(next.pendingAbstractionNodeId).toBeNull();
    expect(next.pendingDecomposeNodeId).toBeNull();
    expect(next.activePieMenuItemForVision).toBeNull(); // E-vision
    expect(has(commands, { type: 'local', action: 'closePieColorPicker' })).toBe(true); // E-colorPicker
  });

  it('row 1: pie → carousel', () => {
    const state = pieOpenOnA({ isTransitioningPieMenu: true, pendingAbstractionNodeId: 'A' });
    const { next, commands } = run(state, { type: 'PIE_EXITED' });
    expect(next.isTransitioningPieMenu).toBe(false);
    expect(next.abstractionCarouselNode).toBe(nodeA);
    expect(next.carouselAnimationState).toBe('entering');
    expect(next.abstractionCarouselVisible).toBe(true);
    expect(next.selectedNodeIdForPieMenu).toBe('A');
    expect(has(commands, { type: 'frame', kind: 'carouselOpen', nodeId: 'A' })).toBe(true);
    expect(cancelsWatchdog(commands)).toBe(true);
    expect(didFullReset(commands)).toBe(false); // E-cleanup re-runs, blocked by the carousel
  });

  it('row 1 with the node gone: transition ends, no carousel', () => {
    const state = pieOpenOnA({ isTransitioningPieMenu: true, pendingAbstractionNodeId: 'gone' });
    const { next } = run(state, { type: 'PIE_EXITED' });
    expect(next.isTransitioningPieMenu).toBe(false);
    expect(next.abstractionCarouselVisible).toBe(false);
  });

  it('row 2: pie → decompose, toggling the preview', () => {
    const open = run(pieOpenOnA({ isTransitioningPieMenu: true, pendingDecomposeNodeId: 'A' }), { type: 'PIE_EXITED' });
    expect(open.next.previewingNodeId).toBe('A');
    expect(open.next.selectedNodeIdForPieMenu).toBe('A');
    expect(open.next.isTransitioningPieMenu).toBe(false);
    expect(has(open.commands, { type: 'frame', kind: 'decomposeOpen', nodeId: 'A' })).toBe(true);

    const close = run(pieOpenOnA({ isTransitioningPieMenu: true, pendingDecomposeNodeId: 'A', previewingNodeId: 'A' }), { type: 'PIE_EXITED' });
    expect(close.next.previewingNodeId).toBeNull();
    expect(has(close.commands, { type: 'frame', kind: 'recompose', nodeId: 'A' })).toBe(true);
  });

  it('row 3a: carousel stage swap, both directions', () => {
    const up = run(carouselOnA({ isTransitioningPieMenu: true, isCarouselStageTransition: true }), { type: 'PIE_EXITED' });
    expect(up.next.carouselPieMenuStage).toBe(2);
    expect(up.next.isCarouselStageTransition).toBe(false);
    expect(up.next.isTransitioningPieMenu).toBe(false);
    expect(up.next.selectedNodeIdForPieMenu).toBe('A');
    expect(up.next.abstractionCarouselVisible).toBe(true);

    const down = run(carouselOnA({ isTransitioningPieMenu: true, isCarouselStageTransition: true, carouselPieMenuStage: 2 }), { type: 'PIE_EXITED' });
    expect(down.next.carouselPieMenuStage).toBe(1);
  });

  it('row 3b: carousel exit phase 1 keeps the transition (and the watchdog) up', () => {
    const { next, commands } = run(carouselOnA({ isTransitioningPieMenu: true }), { type: 'PIE_EXITED' });
    expect(next.carouselAnimationState).toBe('exiting');
    expect(next.isTransitioningPieMenu).toBe(true);
    expect(next.abstractionCarouselVisible).toBe(true);
    expect(cancelsWatchdog(commands)).toBe(false);
  });

  it('row 4: a generic transition toggles the preview of the selected node', () => {
    const { next } = run(pieOpenOnA({ isTransitioningPieMenu: true, previewingNodeId: 'A' }), { type: 'PIE_EXITED' });
    expect(next.previewingNodeId).toBeNull();
    expect(next.selectedNodeIdForPieMenu).toBe('A');
    expect(next.isTransitioningPieMenu).toBe(false);
  });

  it('row 4 with nothing selected clears the preview', () => {
    const state = pieOpenOnA({ selection: [], selectedNodeIdForPieMenu: null, isTransitioningPieMenu: true, previewingNodeId: 'A' });
    expect(run(state, { type: 'PIE_EXITED' }).next.previewingNodeId).toBeNull();
  });

  it('row 5: a plain dismiss only unmounts', () => {
    const state = pieOpenOnA({ selection: [], selectedNodeIdForPieMenu: null });
    const { patch } = run(state, { type: 'PIE_EXITED' });
    expect(Object.keys(patch).sort()).toEqual(['currentPieMenuData', 'isPieMenuRendered']);
  });
});

describe('pie events', () => {
  it('PIE_TO_CAROUSEL / PIE_TO_DECOMPOSE / PIE_COMPOSE start a transition and arm the watchdog', () => {
    for (const event of [{ type: 'PIE_TO_CAROUSEL', nodeId: 'A' }, { type: 'PIE_TO_DECOMPOSE', nodeId: 'A' }, { type: 'PIE_COMPOSE' }]) {
      const { next, commands } = run(pieOpenOnA(), event);
      expect(next.isTransitioningPieMenu, event.type).toBe(true);
      expect(armsWatchdog(commands), event.type).toBe(true);
    }
    expect(run(pieOpenOnA(), { type: 'PIE_TO_CAROUSEL', nodeId: 'A' }).next.pendingAbstractionNodeId).toBe('A');
    expect(run(pieOpenOnA(), { type: 'PIE_TO_DECOMPOSE', nodeId: 'A' }).next.pendingDecomposeNodeId).toBe('A');
  });

  it('pie actions are ignored while a carousel exit finishes (carousel hidden, still exiting)', () => {
    const state = pieOpenOnA({ carouselAnimationState: 'exiting' });
    for (const event of [{ type: 'PIE_TO_CAROUSEL', nodeId: 'A' }, { type: 'PIE_TO_DECOMPOSE', nodeId: 'A' }, { type: 'PIE_COMPOSE' }]) {
      expect(reducePie(state, event, env)).toEqual({ patch: {}, commands: [] });
    }
  });

  it('STAGE_REQUEST raises the stage flag and the transition', () => {
    const { next, commands } = run(carouselOnA(), { type: 'STAGE_REQUEST' });
    expect(next.isCarouselStageTransition).toBe(true);
    expect(next.isTransitioningPieMenu).toBe(true);
    expect(armsWatchdog(commands)).toBe(true);
  });

  it('PIE_TARGET writes the target (and the selection when given)', () => {
    const { next } = run(S(), { type: 'PIE_TARGET', id: 'B', selection: ['B'] });
    expect(next.selectedNodeIdForPieMenu).toBe('B');
    expect([...next.selectedInstanceIds]).toEqual(['B']);
  });

  it('PIE_DATA mounts the menu; a missing node clears the data but leaves it "rendered" (A-3)', () => {
    const mounted = run(S({ selection: ['A'], selectedNodeIdForPieMenu: 'A' }), { type: 'PIE_DATA', data: pieData() });
    expect(mounted.next.isPieMenuRendered).toBe(true);
    const gone = run(mounted.next, { type: 'PIE_DATA', data: null });
    expect(gone.next.currentPieMenuData).toBeNull();
    expect(gone.next.isPieMenuRendered).toBe(true);
    expect(has(gone.commands, { type: 'local', action: 'closePieColorPicker' })).toBe(true);
  });

  it('PIE_BUTTONS patches the buttons of the drawn menu only', () => {
    expect(run(S(), { type: 'PIE_BUTTONS', buttons: [] }).patch).toEqual({});
    const { next } = run(pieOpenOnA(), { type: 'PIE_BUTTONS', buttons: [{ id: 'y' }] });
    expect(next.currentPieMenuData.buttons).toEqual([{ id: 'y' }]);
    expect(next.currentPieMenuData.node).toBe(nodeA);
  });

  it('PREVIEW_SET sets the preview directly; decomp-further also ends the transition', () => {
    expect(run(pieOpenOnA(), { type: 'PREVIEW_SET', id: 'A', selection: ['A'] }).next.previewingNodeId).toBe('A');
    const { next } = run(pieOpenOnA({ previewingNodeId: 'A', isTransitioningPieMenu: true }),
      { type: 'PREVIEW_SET', id: null, endTransition: true, selection: [] });
    expect(next.previewingNodeId).toBeNull();
    expect(next.isTransitioningPieMenu).toBe(false);
    expect(next.selectedNodeIdForPieMenu).toBeNull();
  });

  it('ORBIT from the pie keeps the target and page; context-menu orbit clears it and E-sel puts it back on page 0', () => {
    const pie = run(pieOpenOnA({ pieMenuPage: 1 }), { type: 'ORBIT', active: true });
    expect(pie.next.selectedNodeIdForPieMenu).toBe('A');
    expect(pie.next.pieMenuPage).toBe(1);
    const ctx = run(pieOpenOnA({ pieMenuPage: 1 }), { type: 'ORBIT', active: true, clearTarget: true, selection: ['A'] });
    expect(ctx.next.semanticOrbitActive).toBe(true);
    expect(ctx.next.selectedNodeIdForPieMenu).toBe('A');
    expect(ctx.next.pieMenuPage).toBe(0);
  });
});

describe('carousel events', () => {
  it('CAROUSEL_BACK raises both guards and the transition; the stage flag is untouched', () => {
    const { next, commands } = run(carouselOnA({ isCarouselStageTransition: true }), { type: 'CAROUSEL_BACK' });
    expect(next.justCompletedCarouselExit).toBe(true);
    expect(next.isPieMenuActionInProgress).toBe(true);
    expect(next.isTransitioningPieMenu).toBe(true);
    expect(next.isCarouselStageTransition).toBe(true);
    expect(has(commands, { type: 'after', ms: PIE_CLICK_GUARD_MS, event: { type: 'CLICK_GUARD_ELAPSED' } })).toBe(true);
    expect(commands.find((c) => c.event?.type === 'CLICK_GUARD_ELAPSED').key).toBeUndefined();
    expect(armsWatchdog(commands)).toBe(true);
  });

  it('CAROUSEL_CLOSE is Back plus clearing the stage flag', () => {
    const { next } = run(carouselOnA({ isCarouselStageTransition: true }), { type: 'CAROUSEL_CLOSE' });
    expect(next.isCarouselStageTransition).toBe(false);
    expect(next.justCompletedCarouselExit).toBe(true);
    expect(next.isTransitioningPieMenu).toBe(true);
  });

  it('CAROUSEL_TOUCH_CLOSE: no-op when hidden or already requested', () => {
    expect(reducePie(pieOpenOnA(), { type: 'CAROUSEL_TOUCH_CLOSE' }).patch).toEqual({});
    expect(reducePie(carouselOnA({ carouselCloseRequested: true }), { type: 'CAROUSEL_TOUCH_CLOSE' }).patch).toEqual({});
  });

  it('CAROUSEL_TOUCH_CLOSE with a pie target runs the close', () => {
    const { next } = run(carouselOnA(), { type: 'CAROUSEL_TOUCH_CLOSE' });
    expect(next.carouselCloseRequested).toBe(true);
    expect(next.isTransitioningPieMenu).toBe(true);
    expect(next.justCompletedCarouselExit).toBe(true);
  });

  it('CAROUSEL_TOUCH_CLOSE without a target tears down, and E-cleanup then full-resets', () => {
    const state = carouselOnA({ selectedNodeIdForPieMenu: null, carouselPieMenuStage: 2, pendingSwapOperation: { x: 1 } });
    const { next, commands } = run(state, { type: 'CAROUSEL_TOUCH_CLOSE' });
    expect(next.abstractionCarouselVisible).toBe(false);
    expect(next.carouselAnimationState).toBe('hidden');
    expect(next.carouselPieMenuStage).toBe(1);
    expect(next.carouselCloseRequested).toBe(false); // E-closeReq resets it once hidden
    expect(has(commands, { type: 'local', action: 'clearCarouselFocus' })).toBe(true);
    expect(didFullReset(commands)).toBe(true);
    expect(next.selectedInstanceIds.size).toBe(0);
    expect(next.pendingSwapOperation).toBeNull();
    expect(next.resetNonce).toBe(1);
  });

  it('CAROUSEL_TEARDOWN is the same teardown (mouse defensive branch)', () => {
    const { next, commands } = run(carouselOnA({ selectedNodeIdForPieMenu: null }), { type: 'CAROUSEL_TEARDOWN' });
    expect(next.abstractionCarouselVisible).toBe(false);
    expect(next.abstractionCarouselNode).toBeNull();
    expect(didFullReset(commands)).toBe(true);
  });

  it('CAROUSEL_LEAVE clears the target without raising the exit guard', () => {
    const swap = { originalNodeId: 'A', focusedPrototypeId: 'pB' };
    const { next, commands } = run(carouselOnA({ pieMenuPage: 1 }), { type: 'CAROUSEL_LEAVE', swap });
    expect(next.selectedNodeIdForPieMenu).toBeNull();
    expect(next.isTransitioningPieMenu).toBe(true);
    expect(next.pendingSwapOperation).toBe(swap);
    expect(next.isPieMenuActionInProgress).toBe(true);
    expect(next.justCompletedCarouselExit).toBe(false);
    expect(next.pieMenuPage).toBe(0);
    expect(armsWatchdog(commands)).toBe(true);
    expect(didFullReset(commands)).toBe(false); // carousel visible
  });

  it('CAROUSEL_LEAVE keeps a pending swap it is not given, and can skip the click guard', () => {
    const swap = { originalNodeId: 'A' };
    const { next, commands } = run(carouselOnA({ pendingSwapOperation: swap }), { type: 'CAROUSEL_LEAVE', raiseClickGuard: false });
    expect(next.pendingSwapOperation).toBe(swap);
    expect(next.isPieMenuActionInProgress).toBe(false);
    expect(commands.some((c) => c.event?.type === 'CLICK_GUARD_ELAPSED')).toBe(false);
  });

  it('CLICK_GUARD raises only the click guard', () => {
    const { patch, commands } = run(carouselOnA(), { type: 'CLICK_GUARD' });
    expect(patch).toEqual({ isPieMenuActionInProgress: true });
    expect(commands).toEqual([{ type: 'after', ms: PIE_CLICK_GUARD_MS, event: { type: 'CLICK_GUARD_ELAPSED' } }]);
  });

  it('CAROUSEL_OPEN_DIRECT opens without a shrink; guarded unless guard:false', () => {
    const { next, commands } = run(pieOpenOnA(), { type: 'CAROUSEL_OPEN_DIRECT', node: nodeA });
    expect(next.abstractionCarouselVisible).toBe(true);
    expect(next.carouselAnimationState).toBe('entering');
    expect(next.selectedNodeIdForPieMenu).toBe('A');
    expect(has(commands, { type: 'frame', kind: 'carouselOpen', nodeId: 'A' })).toBe(true);

    const exiting = pieOpenOnA({ carouselAnimationState: 'exiting' });
    expect(reducePie(exiting, { type: 'CAROUSEL_OPEN_DIRECT', node: nodeA }).patch).toEqual({});
    expect(reducePie(exiting, { type: 'CAROUSEL_OPEN_DIRECT', node: nodeA, guard: false }).patch.abstractionCarouselVisible).toBe(true);
  });

  it('CAROUSEL_ENTERED sets visible', () => {
    expect(run(carouselOnA({ carouselAnimationState: 'entering' }), { type: 'CAROUSEL_ENTERED' }).next.carouselAnimationState).toBe('visible');
  });

  it('CAROUSEL_EXITED hides the carousel and restores the pie on its node', () => {
    const state = carouselOnA({
      selection: [], carouselAnimationState: 'exiting', isTransitioningPieMenu: true, justCompletedCarouselExit: true,
    });
    const { next, commands } = run(state, { type: 'CAROUSEL_EXITED' });
    expect(next.abstractionCarouselVisible).toBe(false);
    expect(next.abstractionCarouselNode).toBeNull();
    expect(next.carouselAnimationState).toBe('hidden');
    expect(next.isTransitioningPieMenu).toBe(false);
    expect([...next.selectedInstanceIds]).toEqual(['A']);
    expect(next.selectedNodeIdForPieMenu).toBe('A');
    expect(next.carouselExitInProgress).toBe(true);
    // E-return consumes the return target in the same pass.
    expect(next.pendingCarouselReturnFocusId).toBeNull();
    expect(has(commands, { type: 'frame', kind: 'returnFocus', nodeId: 'A' })).toBe(true);
    expect(has(commands, { type: 'after', ms: PIE_EXIT_GUARD_MS, event: { type: 'EXIT_GUARD_ELAPSED' } })).toBe(true);
    expect(cancelsWatchdog(commands)).toBe(true);
    expect(didFullReset(commands)).toBe(false);
  });

  it('CAROUSEL_EXITED applies a pending swap through a graph command', () => {
    const swap = { originalNodeId: 'A', focusedPrototypeId: 'pB' };
    const state = carouselOnA({ selectedNodeIdForPieMenu: null, carouselAnimationState: 'exiting', isTransitioningPieMenu: true, pendingSwapOperation: swap });
    const { next, commands } = run(state, { type: 'CAROUSEL_EXITED' });
    expect(commands[0]).toEqual({ type: 'graph', action: 'applyCarouselSwap', args: { swap, graphId: 'g1' } });
    expect(next.pendingSwapOperation).toBeNull();
    expect(next.abstractionCarouselNode).toBeNull();
    expect(next.selectedNodeIdForPieMenu).toBe('A');
  });

  it('EXIT_GUARD_ELAPSED lowers both exit latches; CLICK_GUARD_ELAPSED the click guard', () => {
    const { next } = run(pieOpenOnA({ justCompletedCarouselExit: true, carouselExitInProgress: true }), { type: 'EXIT_GUARD_ELAPSED' });
    expect(next.justCompletedCarouselExit).toBe(false);
    expect(next.carouselExitInProgress).toBe(false);
    expect(run(S({ isPieMenuActionInProgress: true }), { type: 'CLICK_GUARD_ELAPSED' }).next.isPieMenuActionInProgress).toBe(false);
  });

  it('a full Back round trip (T9): shrink, fade, pie back on the node', () => {
    const { next, all } = runAll(carouselOnA(), [
      { type: 'CAROUSEL_BACK' }, { type: 'PIE_EXITED' }, { type: 'CAROUSEL_EXITED' },
    ]);
    expect(next.abstractionCarouselVisible).toBe(false);
    expect(next.selectedNodeIdForPieMenu).toBe('A');
    expect(next.isTransitioningPieMenu).toBe(false);
    expect(next.justCompletedCarouselExit).toBe(true); // until EXIT_GUARD_ELAPSED
    expect(armsWatchdog(all)).toBe(true);
    expect(cancelsWatchdog(all)).toBe(true);
  });
});

describe('prompt events', () => {
  const prompt = { visible: true, name: '', color: null, direction: 'above', nodeId: 'pA', carouselLevel: null };

  it('E-promptStage: an open prompt forces stage 2 and a target', () => {
    const { next } = run(carouselOnA({ selectedNodeIdForPieMenu: null, selection: [] }), { type: 'PROMPT_OPEN', prompt });
    expect(next.abstractionPrompt.visible).toBe(true);
    expect(next.carouselPieMenuStage).toBe(2);
    expect(next.selectedNodeIdForPieMenu).toBe('A');
  });

  it('PROMPT_SUBMITTED: stage 1 in place, flag cleared, focus request for the new level', () => {
    const { next, commands } = run(carouselOnA({ abstractionPrompt: prompt, carouselPieMenuStage: 2 }), { type: 'PROMPT_SUBMITTED', newNodeId: 'pNew' });
    expect(next.abstractionPrompt.visible).toBe(false);
    expect(next.carouselPieMenuStage).toBe(1);
    expect(next.isCarouselStageTransition).toBe(false);
    expect(next.isTransitioningPieMenu).toBe(false); // no shrink: buttons swap in place
    expect(commands).toContainEqual({ type: 'local', action: 'carouselFocusPrototypeRequest', args: { prototypeId: 'pNew' } });
  });

  it('PROMPT_CANCELLED: stage 1 with the stage flag RAISED and no transition (NEW-2 source)', () => {
    const { next, commands } = run(carouselOnA({ abstractionPrompt: prompt, carouselPieMenuStage: 2 }), { type: 'PROMPT_CANCELLED' });
    expect(next.abstractionPrompt.visible).toBe(false);
    expect(next.carouselPieMenuStage).toBe(1);
    expect(next.isCarouselStageTransition).toBe(true);
    expect(next.isTransitioningPieMenu).toBe(false);
    expect(armsWatchdog(commands)).toBe(false);
  });
});

describe('maybeFullReset (E-cleanup)', () => {
  // With nothing selected and no carousel, a graph change resets.
  const idle = () => S({ isPieMenuRendered: true, currentPieMenuData: pieData(), carouselPieMenuStage: 2, pendingAbstractionNodeId: 'A', pendingDecomposeNodeId: 'A' });

  it('resets on a graph change when no guard holds (§4.9 list)', () => {
    const state = { ...idle(), previewingNodeId: 'A', editingNodeIdOnCanvas: 'A', hoveredEdgeInfo: { edgeId: 'e' }, marqueeActive: true };
    const { next, commands } = run(state, { type: 'GRAPH_CHANGED' });
    expect(didFullReset(commands)).toBe(true);
    expect(next.currentPieMenuData).toBeNull();
    expect(next.isPieMenuRendered).toBe(false);
    expect(next.carouselPieMenuStage).toBe(1);
    expect(next.pendingAbstractionNodeId).toBeNull();
    expect(next.pendingDecomposeNodeId).toBe('A'); // not in the reset list, as today
    expect(next.editingNodeIdOnCanvas).toBeNull();
    expect(next.hoveredEdgeInfo).toBeNull();
    expect(next.marqueeActive).toBe(false);
    expect(next.nodeNamePrompt).toEqual({ visible: false, name: '' });
    expect(next.resetNonce).toBe(1);
    expect(commands).toContainEqual({ type: 'local', action: 'closeAllPanels' });
  });

  it.each([
    ['the carousel is visible', { abstractionCarouselVisible: true }],
    ['the exit guard is up', { justCompletedCarouselExit: true }],
    ['a transition is running', { isTransitioningPieMenu: true }],
    ['the carousel exit is settling', { carouselExitInProgress: true }],
    ['one node is selected with its pie', { selectedInstanceIds: new Set(['A']), selectedNodeIdForPieMenu: 'A' }],
  ])('is blocked when %s (that guard alone)', (_label, guard) => {
    expect(fullResetBlocked({ ...idle(), ...guard })).toBe(true);
    const { commands } = run({ ...idle(), ...guard }, { type: 'GRAPH_CHANGED' });
    expect(didFullReset(commands)).toBe(false);
  });

  it('is not blocked by a single selection without a target', () => {
    expect(fullResetBlocked({ ...idle(), selectedInstanceIds: new Set(['A']) })).toBe(false);
  });

  it('web switch with the pie open: no reset, E-closeAll clears the target, the data stays so the shrink plays (§4.9)', () => {
    const { next, commands } = run(pieOpenOnA(), { type: 'GRAPH_CHANGED' });
    expect(didFullReset(commands)).toBe(false);
    expect(next.selectedNodeIdForPieMenu).toBeNull();
    expect(next.selectedInstanceIds.size).toBe(0);
    expect(next.currentPieMenuData).not.toBeNull();
    expect(next.isPieMenuRendered).toBe(true);
  });

  it('runs on its other triggers: the exit guard falling', () => {
    const { commands } = run({ ...idle(), justCompletedCarouselExit: true }, { type: 'EXIT_GUARD_ELAPSED' });
    expect(didFullReset(commands)).toBe(true);
  });

  it('CURRENT BEHAVIOUR (NEW-3): lowering an exit guard that was never raised does not re-run it', () => {
    // T10/T13: only carouselExitInProgress was up. Lowering it is not an
    // E-cleanup dep, so no reset even though no guard holds afterwards.
    const { next, commands } = run({ ...idle(), carouselExitInProgress: true }, { type: 'EXIT_GUARD_ELAPSED' });
    expect(next.carouselExitInProgress).toBe(false);
    expect(didFullReset(commands)).toBe(false);
  });

  it('CURRENT BEHAVIOUR (order, NEW-9): E-cleanup judges its guard before E-sel re-targets', () => {
    // A stuck transition with one node selected but no target (e.g. the target
    // was cleared mid-transition). When the watchdog lowers the flag, E-cleanup
    // (declared first) sees target=null and resets; E-sel in the same flush
    // sets target=A from the old selection, and the next pass clears it again.
    // Reconciling first would instead keep {A} selected with its pie.
    const state = S({ selection: ['A'], isTransitioningPieMenu: true });
    const { next, commands } = run(state, { type: 'WATCHDOG' });
    expect(didFullReset(commands)).toBe(true);
    expect(next.selectedInstanceIds.size).toBe(0);
    expect(next.selectedNodeIdForPieMenu).toBeNull();
  });
});

describe('watchdog (E-watchdog)', () => {
  it('arms when the transition starts and cancels when it ends', () => {
    const start = run(pieOpenOnA(), { type: 'PIE_COMPOSE' });
    expect(armsWatchdog(start.commands)).toBe(true);
    const end = run(start.next, { type: 'PIE_EXITED' });
    expect(cancelsWatchdog(end.commands)).toBe(true);
  });

  it('does not re-arm while the transition stays up', () => {
    const state = carouselOnA({ isTransitioningPieMenu: true });
    expect(armsWatchdog(run(state, { type: 'STAGE_REQUEST' }).commands)).toBe(false);
  });

  it('WATCHDOG ends the transition and drops the stage flag, leaving the pendings', () => {
    const state = pieOpenOnA({ isTransitioningPieMenu: true, isCarouselStageTransition: true, pendingDecomposeNodeId: 'A' });
    const { next, commands } = run(state, { type: 'WATCHDOG' });
    expect(next.isTransitioningPieMenu).toBe(false);
    expect(next.isCarouselStageTransition).toBe(false);
    expect(next.pendingDecomposeNodeId).toBe('A');
    expect(cancelsWatchdog(commands)).toBe(true);
  });
});

describe('side rules', () => {
  it('a target change resets the page (E-page), including to null', () => {
    expect(run(pieOpenOnA({ pieMenuPage: 2 }), { type: 'SELECTION_CHANGED', ids: ['B'] }).next.pieMenuPage).toBe(0);
    expect(run(pieOpenOnA({ pieMenuPage: 2 }), { type: 'SELECTION_CHANGED', ids: [] }).next.pieMenuPage).toBe(0);
    expect(run(pieOpenOnA({ pieMenuPage: 2 }), { type: 'SELECTION_CHANGED', ids: ['A'] }).next.pieMenuPage).toBe(2);
  });

  it('closes the pie colour picker when the target goes null, not on a retarget', () => {
    expect(has(run(pieOpenOnA(), { type: 'SELECTION_CHANGED', ids: [] }).commands, { action: 'closePieColorPicker' })).toBe(true);
    expect(has(run(pieOpenOnA(), { type: 'SELECTION_CHANGED', ids: ['B'] }).commands, { action: 'closePieColorPicker' })).toBe(false);
  });

  it('clears the vision hover when the menu unmounts, not before', () => {
    const state = pieOpenOnA({ activePieMenuItemForVision: { id: 'x' } });
    expect(run(state, { type: 'SELECTION_CHANGED', ids: [] }).next.activePieMenuItemForVision).toEqual({ id: 'x' });
    expect(run(state, { type: 'PIE_EXITED' }).next.activePieMenuItemForVision).toBeNull();
  });

  it('emits focus-on-select framing for a fresh target only', () => {
    expect(has(run(S(), { type: 'SELECTION_CHANGED', ids: ['A'] }).commands, { type: 'frame', kind: 'focusOnSelect', nodeId: 'A' })).toBe(true);
    expect(has(run(pieOpenOnA(), { type: 'SELECTION_CHANGED', ids: ['A'] }).commands, { type: 'frame' })).toBe(false);
  });
});

describe('CURRENT BEHAVIOUR: bugs reproduced on purpose (P5.02a §5)', () => {
  it('NEW-2: Back after a cancelled Add Above/Below swaps to stage 2 instead of closing the carousel', () => {
    const prompt = { visible: true, name: '', color: null, direction: 'above', nodeId: 'pA', carouselLevel: null };
    const { next } = runAll(carouselOnA({ abstractionPrompt: prompt, carouselPieMenuStage: 2 }), [
      { type: 'PROMPT_CANCELLED' }, // stage 1, flag left up
      { type: 'CAROUSEL_BACK' }, // stage-1 Back does not clear the flag
      { type: 'PIE_EXITED' }, // → row 3a, not 3b
    ]);
    expect(next.abstractionCarouselVisible).toBe(true);
    expect(next.carouselAnimationState).toBe('visible');
    expect(next.carouselPieMenuStage).toBe(2);
    expect(next.isCarouselStageTransition).toBe(false);
  });

  it('NEW-4: closing the carousel from stage 2 leaves the stage at 2 for the next open', () => {
    const { next } = runAll(carouselOnA({ carouselPieMenuStage: 2 }), [
      { type: 'CAROUSEL_CLOSE' }, { type: 'PIE_EXITED' }, { type: 'CAROUSEL_EXITED' },
    ]);
    expect(next.abstractionCarouselVisible).toBe(false);
    expect(next.carouselPieMenuStage).toBe(2);
    const reopened = run(next, { type: 'CAROUSEL_OPEN_DIRECT', node: nodeA });
    expect(reopened.next.carouselPieMenuStage).toBe(2);
  });

  it('NEW-5: Compose acts on whatever is selected when the shrink ends', () => {
    // A is decomposed; Compose pressed on A; B clicked during the shrink.
    const { next } = runAll(pieOpenOnA({ previewingNodeId: 'A' }), [
      { type: 'PIE_COMPOSE' },
      { type: 'SELECTION_CHANGED', ids: ['B'] }, // held: transition running
      { type: 'PIE_EXITED' },
    ]);
    expect(next.previewingNodeId).toBe('B'); // B gets decomposed, A is not composed
    expect(next.selectedNodeIdForPieMenu).toBe('B');
  });

  it('NEW-7: the carousel re-selects its node after the selection was lost under it', () => {
    const { next } = runAll(carouselOnA(), [
      { type: 'SELECTION_CHANGED', ids: [] }, // e.g. Cmd+X removed the node
      { type: 'CAROUSEL_EXITED' },
    ]);
    expect([...next.selectedInstanceIds]).toEqual(['A']);
    expect(next.selectedNodeIdForPieMenu).toBe('A');
  });
});

describe('purity', () => {
  it('never calls env for events that do not need it', () => {
    const spy = vi.fn(findNode);
    run(pieOpenOnA(), { type: 'SELECTION_CHANGED', ids: ['B'] }, { findNode: spy });
    expect(spy).not.toHaveBeenCalled();
  });
});

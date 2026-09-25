import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useCanvasUIStore, {
  createCanvasUIDefaults,
  resetPieRunner,
  runPieCommands,
  setPieCommandHandler,
} from '../../src/store/canvasUIStore.js';

/**
 * P5.02b step 3: the dispatchPie slice and its command runner (not wired).
 * The reducer's rules are tested in src/components/canvas/pie/__tests__.
 */

const st = () => useCanvasUIStore.getState();
const nodeA = { id: 'A', prototypeId: 'pA', x: 0, y: 0 };
const env = { findNode: (id) => (id === 'A' ? nodeA : null), activeGraphId: 'g1' };

const carouselOnA = () => useCanvasUIStore.setState({
  selectedInstanceIds: new Set(['A']),
  selectedNodeIdForPieMenu: 'A',
  isPieMenuRendered: true,
  currentPieMenuData: { node: nodeA, buttons: [], nodeDimensions: {} },
  abstractionCarouselVisible: true,
  abstractionCarouselNode: nodeA,
  carouselAnimationState: 'visible',
});

describe('canvasUIStore pie slice (P5.02b)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPieRunner();
    useCanvasUIStore.setState(createCanvasUIDefaults());
  });

  afterEach(() => {
    resetPieRunner();
    vi.useRealTimers();
  });

  describe('fields', () => {
    it('adds the moved fields with NodeCanvas initial values', () => {
      const s = createCanvasUIDefaults();
      expect(s.pieMenuPage).toBe(0);
      expect(s.isPieMenuActionInProgress).toBe(false);
      expect(s.pendingSwapOperation).toBeNull();
      expect(s.carouselExitInProgress).toBe(false);
      expect(s.carouselCloseRequested).toBe(false);
      expect(s.pendingCarouselReturnFocusId).toBeNull();
      expect(s.marqueeActive).toBe(false);
      expect(s.resetNonce).toBe(0);
    });

    it('setPieMenuPage is a plain setter (layer and gamepad page flips)', () => {
      st().setPieMenuPage(2);
      expect(st().pieMenuPage).toBe(2);
      st().setPieMenuPage((p) => p - 1);
      expect(st().pieMenuPage).toBe(1);
    });
  });

  describe('dispatchPie', () => {
    it('applies the whole patch in one set', () => {
      let notifications = 0;
      const unsubscribe = useCanvasUIStore.subscribe(() => { notifications++; });
      st().dispatchPie({ type: 'SELECTION_CHANGED', ids: ['A'] });
      unsubscribe();
      expect(notifications).toBe(1);
      expect([...st().selectedInstanceIds]).toEqual(['A']);
      expect(st().selectedNodeIdForPieMenu).toBe('A');
    });

    it('does not notify for an ignored event', () => {
      let notifications = 0;
      const unsubscribe = useCanvasUIStore.subscribe(() => { notifications++; });
      st().dispatchPie({ type: 'CAROUSEL_TOUCH_CLOSE' }); // carousel hidden → no-op
      unsubscribe();
      expect(notifications).toBe(0);
    });

    it('returns what it applied', () => {
      const result = st().dispatchPie({ type: 'PIE_COMPOSE' });
      expect(result.patch).toEqual({ isTransitioningPieMenu: true });
      expect(result.commands[0]).toMatchObject({ type: 'after', key: 'watchdog' });
    });
  });

  describe('timers', () => {
    it('the click guard falls after 100 ms', () => {
      carouselOnA();
      st().dispatchPie({ type: 'CAROUSEL_BACK' });
      expect(st().isPieMenuActionInProgress).toBe(true);
      vi.advanceTimersByTime(99);
      expect(st().isPieMenuActionInProgress).toBe(true);
      vi.advanceTimersByTime(1);
      expect(st().isPieMenuActionInProgress).toBe(false);
    });

    it('the exit guards fall 300 ms after the carousel has faded (T9)', () => {
      carouselOnA();
      st().dispatchPie({ type: 'CAROUSEL_BACK' });
      st().dispatchPie({ type: 'PIE_EXITED' }, env);
      expect(st().carouselAnimationState).toBe('exiting');
      st().dispatchPie({ type: 'CAROUSEL_EXITED' }, env);
      expect(st().justCompletedCarouselExit).toBe(true);
      expect(st().carouselExitInProgress).toBe(true);
      vi.advanceTimersByTime(299);
      expect(st().justCompletedCarouselExit).toBe(true);
      vi.advanceTimersByTime(1);
      expect(st().justCompletedCarouselExit).toBe(false);
      expect(st().carouselExitInProgress).toBe(false);
      // The restored pie survives the exit guard falling (E-cleanup guard).
      expect(st().selectedNodeIdForPieMenu).toBe('A');
      expect(st().isTransitioningPieMenu).toBe(false);
    });

    it('the watchdog fires after 1200 ms of a stuck transition', () => {
      useCanvasUIStore.setState({ selectedInstanceIds: new Set(['A']), selectedNodeIdForPieMenu: 'A' });
      st().dispatchPie({ type: 'STAGE_REQUEST' });
      vi.advanceTimersByTime(1199);
      expect(st().isTransitioningPieMenu).toBe(true);
      vi.advanceTimersByTime(1);
      expect(st().isTransitioningPieMenu).toBe(false);
      expect(st().isCarouselStageTransition).toBe(false);
    });

    it('the watchdog is cancelled when the transition ends', () => {
      useCanvasUIStore.setState({ selectedInstanceIds: new Set(['A']), selectedNodeIdForPieMenu: 'A', isPieMenuRendered: true });
      st().dispatchPie({ type: 'PIE_COMPOSE' });
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(500);
      st().dispatchPie({ type: 'PIE_EXITED' }, env);
      expect(vi.getTimerCount()).toBe(0);
      const dispatch = vi.spyOn(st(), 'dispatchPie');
      vi.advanceTimersByTime(2000);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('re-arming restarts the watchdog from the new start', () => {
      useCanvasUIStore.setState({ selectedInstanceIds: new Set(['A']), selectedNodeIdForPieMenu: 'A', isPieMenuRendered: true });
      st().dispatchPie({ type: 'PIE_COMPOSE' });
      vi.advanceTimersByTime(1000);
      st().dispatchPie({ type: 'PIE_EXITED' }, env); // cancel
      st().dispatchPie({ type: 'PIE_COMPOSE' }); // arm again at t=1000
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(1199);
      expect(st().isTransitioningPieMenu).toBe(true);
      vi.advanceTimersByTime(1);
      expect(st().isTransitioningPieMenu).toBe(false);
    });

    it('a keyed timer replaces a pending one with the same key', () => {
      const dispatch = vi.fn();
      runPieCommands([{ type: 'after', ms: 100, key: 'k', event: { type: 'ONE' } }], dispatch);
      runPieCommands([{ type: 'after', ms: 100, key: 'k', event: { type: 'TWO' } }], dispatch);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(100);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({ type: 'TWO' });
    });

    it('cancel clears a keyed timer and ignores an unknown key', () => {
      const dispatch = vi.fn();
      runPieCommands([{ type: 'after', ms: 100, key: 'k', event: { type: 'ONE' } }, { type: 'cancel', key: 'k' }, { type: 'cancel', key: 'none' }], dispatch);
      vi.advanceTimersByTime(200);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('CURRENT BEHAVIOUR (NEW-6): unkeyed guard timers are never cancelled', () => {
      // A second click guard raised at 60 ms is lowered by the first timer at 100 ms.
      st().dispatchPie({ type: 'CLICK_GUARD' });
      vi.advanceTimersByTime(60);
      st().dispatchPie({ type: 'CLICK_GUARD' });
      expect(vi.getTimerCount()).toBe(2);
      vi.advanceTimersByTime(40);
      expect(st().isPieMenuActionInProgress).toBe(false);
    });
  });

  describe('external commands', () => {
    const swap = { originalNodeId: 'A', focusedPrototypeId: 'pB' };
    const exitingWithSwap = () => {
      carouselOnA();
      useCanvasUIStore.setState({ selectedNodeIdForPieMenu: null, carouselAnimationState: 'exiting', isTransitioningPieMenu: true, pendingSwapOperation: swap });
    };

    it('hands frame, graph and local commands to the registered handler, in order', () => {
      const handler = vi.fn();
      setPieCommandHandler(handler);
      exitingWithSwap();
      st().dispatchPie({ type: 'CAROUSEL_EXITED' }, env);
      expect(handler.mock.calls.map(([c]) => c)).toEqual([
        { type: 'graph', action: 'applyCarouselSwap', args: { swap, graphId: 'g1' } },
        // The target goes null → A on this path (T10), so focus-on-select frames
        // too, before the return framing: both effects fire today.
        { type: 'frame', kind: 'focusOnSelect', nodeId: 'A' },
        { type: 'frame', kind: 'returnFocus', nodeId: 'A' },
      ]);
    });

    it('queues graph commands until a handler registers, and drops frame / local ones', () => {
      exitingWithSwap();
      st().dispatchPie({ type: 'CAROUSEL_EXITED' }, env);
      const handler = vi.fn();
      setPieCommandHandler(handler);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'graph', action: 'applyCarouselSwap' }));
    });

    it('the unregister function only removes its own handler', () => {
      const first = vi.fn();
      const second = vi.fn();
      const unregisterFirst = setPieCommandHandler(first);
      setPieCommandHandler(second);
      unregisterFirst();
      st().dispatchPie({ type: 'GRAPH_CHANGED' });
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith({ type: 'local', action: 'fullReset' });
    });

    it('timer-fired events reach the handler too', () => {
      const handler = vi.fn();
      setPieCommandHandler(handler);
      // Exit guard falls with nothing selected → E-cleanup full reset → local command.
      useCanvasUIStore.setState({ justCompletedCarouselExit: true });
      runPieCommands([{ type: 'after', ms: 300, event: { type: 'EXIT_GUARD_ELAPSED' } }], (e) => st().dispatchPie(e));
      vi.advanceTimersByTime(300);
      expect(handler).toHaveBeenCalledWith({ type: 'local', action: 'fullReset' });
      expect(st().resetNonce).toBe(1);
    });
  });
});

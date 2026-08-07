import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyOffscreenLayout } from './offscreenLayout.js';
import {
  scheduleGraphLayout,
  scheduleEnrichment,
  configureToolResultApplier
} from './toolResultApplier.js';

vi.mock('./offscreenLayout.js', () => ({ applyOffscreenLayout: vi.fn() }));

// A wizard build used to schedule one uncaptured 600ms layout timer per layer
// (recursively, at every depth) and one 1000ms enrichment timer per level. None
// was cleared, so they all survived abort/tab-switch/unmount and all landed in
// the same queue drain — N synchronous layout passes over the same few graphs,
// and N /api/enrich POSTs each cloning the whole prototype Map.
describe('wizard follow-up timers', () => {
  let dispatched;
  const record = (e) => dispatched.push(e.detail?.graphId);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    dispatched = [];
    window.addEventListener('rs-trigger-auto-layout', record);
  });

  afterEach(() => {
    window.removeEventListener('rs-trigger-auto-layout', record);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('scheduleGraphLayout', () => {
    it('collapses a burst for one graph into a single dispatch', () => {
      for (let i = 0; i < 5; i++) scheduleGraphLayout('graph-a');
      vi.advanceTimersByTime(2000);
      expect(dispatched).toEqual(['graph-a']);
    });

    it('does the immediate offscreen pass only once per burst', () => {
      // The first request lays the graph out now (headless hosts have no canvas
      // listening); the rest ride the dispatch that is already scheduled.
      for (let i = 0; i < 5; i++) scheduleGraphLayout('graph-a');
      expect(applyOffscreenLayout).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2000);
      expect(applyOffscreenLayout).toHaveBeenCalledTimes(1);
    });

    it('keeps different graphs independent', () => {
      scheduleGraphLayout('graph-a');
      scheduleGraphLayout('graph-b');
      scheduleGraphLayout('graph-a');
      vi.advanceTimersByTime(2000);
      expect(dispatched.sort()).toEqual(['graph-a', 'graph-b']);
    });

    it('starts a fresh burst once the previous one has fired', () => {
      scheduleGraphLayout('graph-a');
      vi.advanceTimersByTime(2000);
      scheduleGraphLayout('graph-a');
      vi.advanceTimersByTime(2000);
      expect(dispatched).toEqual(['graph-a', 'graph-a']);
      expect(applyOffscreenLayout).toHaveBeenCalledTimes(2);
    });

    it('ignores a missing graph id instead of scheduling a dud timer', () => {
      scheduleGraphLayout(null);
      vi.advanceTimersByTime(2000);
      expect(dispatched).toEqual([]);
      expect(applyOffscreenLayout).not.toHaveBeenCalled();
    });
  });

  describe('scheduleEnrichment', () => {
    let enrichMultiple;

    beforeEach(() => {
      enrichMultiple = vi.fn(async () => []);
      configureToolResultApplier({ enrichMultiple });
    });

    it('merges a burst into one call carrying every name', () => {
      scheduleEnrichment(['Alpha', 'Beta'], 'graph-a');
      scheduleEnrichment(['Beta', 'Gamma'], 'graph-a');
      vi.advanceTimersByTime(2000);

      expect(enrichMultiple).toHaveBeenCalledTimes(1);
      const [names, graphId] = enrichMultiple.mock.calls[0];
      expect([...names].sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
      expect(graphId).toBe('graph-a');
    });

    it('keeps different graphs independent', () => {
      scheduleEnrichment(['Alpha'], 'graph-a');
      scheduleEnrichment(['Beta'], 'graph-b');
      vi.advanceTimersByTime(2000);
      expect(enrichMultiple).toHaveBeenCalledTimes(2);
    });

    // Overwriting is the stronger intent: a burst where any caller asked for it
    // must not have that dropped by a later caller that didn't.
    it('keeps overwriteDescription once any request in the burst asks for it', () => {
      scheduleEnrichment(['Alpha'], 'graph-a', { overwriteDescription: true });
      scheduleEnrichment(['Beta'], 'graph-a', { overwriteDescription: false });
      vi.advanceTimersByTime(2000);
      expect(enrichMultiple.mock.calls[0][2]).toEqual({ overwriteDescription: true });
    });

    it('does nothing for an empty name list', () => {
      scheduleEnrichment([], 'graph-a');
      scheduleEnrichment(undefined, 'graph-a');
      vi.advanceTimersByTime(2000);
      expect(enrichMultiple).not.toHaveBeenCalled();
    });
  });
});

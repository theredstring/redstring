/**
 * The save worker's hand-off to the local file write, which matters most for a
 * big universe (an imported ontology): the worker's string is what reaches the
 * file, so it must match a main-thread export of the same state; only the
 * string comes back, not a second copy as an object; and a worker that needs
 * seconds for a big universe isn't treated as stalled.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';
import { importOntologyText } from '../../src/formats/ontology/importOntology.js';

const ZOO = fs.readFileSync(path.resolve(__dirname, '../fixtures/ontology/zoo.ttl'), 'utf8');

let state;
beforeAll(async () => {
  const built = await importOntologyText(ZOO, 'zoo.ttl');
  const folderId = built.plan.source.folderWebId;
  state = {
    ...built.state,
    _universeSlug: 'zoo',
    universeCreatedAt: '2026-10-09T00:00:00.000Z',
    // Moved since load: the live viewport lives here, not on the web.
    graphViews: new Map([[folderId, { panOffset: { x: 120, y: -40 }, zoomLevel: 0.5 }]]),
    // Quarantined from a newer format; must ride back out.
    _preserved: { '9.9.9': { futureField: 'kept' } },
  };
});

const capturePosted = (stateToSend) => {
  const postMessage = vi.fn();
  saveCoordinator.saveWorker = { postMessage, terminate: () => {} };
  saveCoordinator.nextStateToProcess = stateToSend;
  saveCoordinator.sendToWorker();
  return postMessage.mock.calls[0][0];
};

afterEach(() => {
  if (saveCoordinator.workerWatchdogTimer) clearTimeout(saveCoordinator.workerWatchdogTimer);
  saveCoordinator.workerWatchdogTimer = null;
  saveCoordinator.workerProcessing = false;
  saveCoordinator.saveWorker = null;
  saveCoordinator.nextStateToProcess = null;
  saveCoordinator.lastWorkerMs = 0;
  vi.useRealTimers();
});

describe('the save worker hand-off', () => {
  it('serializes exactly what a main-thread export writes, viewports and preserved fields included', () => {
    // The export stamps the time it ran; hold the clock so only content can differ.
    vi.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z'), toFake: ['Date'] });
    const posted = capturePosted(state);
    const fromWorker = JSON.stringify(exportToRedstring(structuredClone(posted.state), posted.userDomain), null, 2);
    const onMainThread = JSON.stringify(exportToRedstring(state), null, 2);
    expect(fromWorker).toBe(onMainThread);
    expect(fromWorker).toContain('"x": 120');
    expect(fromWorker).toContain('futureField');
  });

  it('sends back only the string, not the universe again as an object', async () => {
    const sent = [];
    const original = self.postMessage;
    self.postMessage = (msg) => sent.push(msg);
    try {
      await import('../../src/services/save.worker.js');
      self.onmessage({ data: { type: 'process_save', state: structuredClone(capturePosted(state).state), userDomain: null } });
    } finally {
      self.postMessage = original;
      self.onmessage = null;
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'save_processed', success: true });
    expect(typeof sent[0].jsonString).toBe('string');
    expect(sent[0]).not.toHaveProperty('redstringData');
  });

  it('gives a big universe time before calling the worker stalled', () => {
    vi.useFakeTimers();
    const big = { ...state, nodePrototypes: new Map(Array.from({ length: 30000 }, (_, i) => [`p${i}`, { id: `p${i}`, name: `P${i}` }])) };
    const stall = vi.spyOn(saveCoordinator, '_handleWorkerStall').mockImplementation(() => {});
    try {
      capturePosted(big);
      vi.advanceTimersByTime(5000);
      expect(stall).not.toHaveBeenCalled(); // a 3 s limit would have fired
      vi.advanceTimersByTime(10000);
      expect(stall).toHaveBeenCalledWith('timeout');
    } finally {
      stall.mockRestore();
    }
  });

  it('allows for how long the last pass took', () => {
    vi.useFakeTimers();
    saveCoordinator.lastWorkerMs = 8000;
    const stall = vi.spyOn(saveCoordinator, '_handleWorkerStall').mockImplementation(() => {});
    try {
      capturePosted(state);
      vi.advanceTimersByTime(20000);
      expect(stall).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5000);
      expect(stall).toHaveBeenCalled();
    } finally {
      stall.mockRestore();
    }
  });
});

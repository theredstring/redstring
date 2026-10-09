/**
 * The save worker's hand-off, which matters most for a big universe (an
 * imported ontology), where every full copy of it costs a frozen main thread:
 *
 *  - the worker keeps its own copy: the first message is the whole state,
 *    later ones only what changed, and what it writes always matches a
 *    main-thread export of the current state;
 *  - the file comes back as bytes in a transferred buffer, nothing else;
 *  - a worker that lost its copy is sent the whole state again;
 *  - a worker that needs seconds for a big universe isn't called stalled.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';
import { importOntologyText } from '../../src/formats/ontology/importOntology.js';

const ZOO = fs.readFileSync(path.resolve(__dirname, '../fixtures/ontology/zoo.ttl'), 'utf8');

let base;
let workerOnMessage;
beforeAll(async () => {
  const built = await importOntologyText(ZOO, 'zoo.ttl');
  const folderId = built.plan.source.folderWebId;
  base = {
    ...built.state,
    _universeSlug: 'zoo',
    universeCreatedAt: '2026-10-09T00:00:00.000Z',
    // Moved since load: the live viewport lives here, not on the web.
    graphViews: new Map([[folderId, { panOffset: { x: 120, y: -40 }, zoomLevel: 0.5 }]]),
    // Quarantined from a newer format; must ride back out.
    _preserved: { '9.9.9': { futureField: 'kept' } },
  };
  // The real worker, run in-process: keep its handler, give `self` back.
  const before = self.onmessage;
  await import('../../src/services/save.worker.js');
  workerOnMessage = self.onmessage;
  self.onmessage = before;
});

/** Post a message through structured clone, as a real worker would get it, and return its reply. */
const runWorker = (message) => {
  const replies = [];
  const original = self.postMessage;
  self.postMessage = (reply, transfer) => replies.push({ reply, transfer });
  try {
    workerOnMessage({ data: structuredClone(message) });
  } finally {
    self.postMessage = original;
  }
  return replies[0];
};

/** What sendToWorker posts for this state. */
const capturePosted = (state) => {
  const postMessage = vi.fn();
  saveCoordinator.saveWorker = { postMessage, terminate: () => {} };
  saveCoordinator.nextStateToProcess = state;
  saveCoordinator.sendToWorker();
  if (saveCoordinator.workerWatchdogTimer) clearTimeout(saveCoordinator.workerWatchdogTimer);
  saveCoordinator.workerProcessing = false;
  return postMessage.mock.calls[0][0];
};

/** Save through the worker: post, run, decode the file it sends back. */
const saveViaWorker = (state) => {
  const posted = capturePosted(state);
  const { reply, transfer } = runWorker(posted);
  return { posted, reply, transfer, text: reply.jsonBytes ? new TextDecoder().decode(reply.jsonBytes) : null };
};

const mainThreadText = (state) => JSON.stringify(exportToRedstring(state), null, 2);

const renamed = (state, id, name) => {
  const nodePrototypes = new Map(state.nodePrototypes);
  nodePrototypes.set(id, { ...nodePrototypes.get(id), name });
  return { ...state, nodePrototypes };
};

beforeEach(() => {
  // A fresh worker copy each test: the coordinator's next message is whole.
  saveCoordinator.mirrorSender?.reset();
  // The export stamps the time it ran; hold the clock so only content can differ.
  vi.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z'), toFake: ['Date'] });
});

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
  it('writes exactly what a main-thread export writes, viewports and preserved fields included', () => {
    const { posted, text } = saveViaWorker(base);
    expect(posted.full).toBe(true);
    expect(text).toBe(mainThreadText(base));
    expect(text).toContain('"x": 120');
    expect(text).toContain('futureField');
  });

  it('sends the file back as bytes in a transferred buffer, and nothing else', () => {
    const { reply, transfer } = saveViaWorker(base);
    expect(reply).toMatchObject({ type: 'save_processed', success: true });
    // (Uint8Array from the test environment's own realm, so check by shape.)
    expect(ArrayBuffer.isView(reply.jsonBytes) && reply.jsonBytes.BYTES_PER_ELEMENT === 1).toBe(true);
    expect(transfer).toEqual([reply.jsonBytes.buffer]);
    expect(reply).not.toHaveProperty('jsonString');
    expect(reply).not.toHaveProperty('redstringData');
  });

  it('after the first save, sends only what changed, and still writes the whole universe', () => {
    saveViaWorker(base);
    const thingId = [...base.nodePrototypes.keys()][3];
    const next = renamed(base, thingId, 'Renamed');
    const { posted, text } = saveViaWorker(next);
    expect(posted.full).toBe(false);
    expect(posted).not.toHaveProperty('state');
    expect(posted.delta.nodePrototypes.set.map(([id]) => id)).toEqual([thingId]);
    expect(posted.delta.nodePrototypes.del).toEqual([]);
    expect(posted.delta).not.toHaveProperty('graphs');
    expect(text).toBe(mainThreadText(next));
  });

  it('sends removals, and the file loses what was removed', () => {
    saveViaWorker(base);
    const goneId = [...base.nodePrototypes.keys()][5];
    const nodePrototypes = new Map(base.nodePrototypes);
    nodePrototypes.delete(goneId);
    const next = { ...base, nodePrototypes };
    const { posted, text } = saveViaWorker(next);
    expect(posted.delta.nodePrototypes).toEqual({ set: [], del: [goneId] });
    expect(text).toBe(mainThreadText(next));
    expect(Object.keys(JSON.parse(text).prototypeSpace.prototypes)).not.toContain(goneId);
  });

  it('sends the whole state again for a different universe', () => {
    saveViaWorker(base);
    const { posted } = saveViaWorker({ ...base, _universeSlug: 'other' });
    expect(posted.full).toBe(true);
  });

  it('sends the whole state again when the worker has lost its copy', () => {
    saveViaWorker(base);
    const next = renamed(base, [...base.nodePrototypes.keys()][2], 'Again');
    const postMessage = vi.fn();
    saveCoordinator.saveWorker = { postMessage, terminate: () => {} };
    saveCoordinator.lastState = next;
    saveCoordinator.handleWorkerMessage({ data: { type: 'error', code: 'no-mirror', success: false } });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].full).toBe(true);
  });

  it('a worker with no copy says so rather than writing a partial universe', () => {
    saveViaWorker(base);
    const delta = capturePosted(renamed(base, [...base.nodePrototypes.keys()][1], 'X'));
    // A restarted worker: run a fresh module instance's handler.
    return import('../../src/services/save.worker.js?fresh').then(() => {
      const fresh = self.onmessage;
      self.onmessage = null;
      const replies = [];
      const original = self.postMessage;
      self.postMessage = (reply) => replies.push(reply);
      try { fresh({ data: structuredClone(delta) }); } finally { self.postMessage = original; }
      expect(replies[0]).toMatchObject({ type: 'error', code: 'no-mirror' });
    });
  });

  it('gives the worker its copy when a universe loads, so the first save sends only a change', () => {
    const postMessage = vi.fn();
    saveCoordinator.saveWorker = { postMessage, terminate: () => {} };
    saveCoordinator.isEnabled = true;
    saveCoordinator._primeWorker(base);
    expect(postMessage.mock.calls[0][0]).toMatchObject({ type: 'prime', full: true });
    // The worker takes the copy and says nothing.
    expect(runWorker(postMessage.mock.calls[0][0])).toBeUndefined();
    const next = renamed(base, [...base.nodePrototypes.keys()][6], 'First edit');
    const { posted, text } = saveViaWorker(next);
    expect(posted.full).toBe(false);
    expect(text).toBe(mainThreadText(next));
  });

  it('a failed copy at load just means the next save sends the whole state', () => {
    saveViaWorker(base);
    saveCoordinator.handleWorkerMessage({ data: { type: 'prime-failed' } });
    expect(capturePosted(renamed(base, [...base.nodePrototypes.keys()][7], 'Y')).full).toBe(true);
  });

  it('leaves auto-enriched Wikipedia images out of what it sends', () => {
    const id = [...base.nodePrototypes.keys()][4];
    const nodePrototypes = new Map(base.nodePrototypes);
    nodePrototypes.set(id, { ...nodePrototypes.get(id), imageSrc: 'data:image/png;base64,AAAA', semanticMetadata: { autoEnriched: true, wikipediaThumbnail: 'https://x/y.png' } });
    const posted = capturePosted({ ...base, nodePrototypes });
    expect(posted.state.nodePrototypes.get(id)).not.toHaveProperty('imageSrc');
  });

  it('gives a big universe time before calling the worker stalled', () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    const big = { ...base, nodePrototypes: new Map(Array.from({ length: 30000 }, (_, i) => [`p${i}`, { id: `p${i}`, name: `P${i}` }])) };
    const stall = vi.spyOn(saveCoordinator, '_handleWorkerStall').mockImplementation(() => {});
    try {
      const postMessage = vi.fn();
      saveCoordinator.saveWorker = { postMessage, terminate: () => {} };
      saveCoordinator.nextStateToProcess = big;
      saveCoordinator.sendToWorker();
      vi.advanceTimersByTime(5000);
      expect(stall).not.toHaveBeenCalled(); // a 3 s limit would have fired
      vi.advanceTimersByTime(10000);
      expect(stall).toHaveBeenCalledWith('timeout');
    } finally {
      stall.mockRestore();
    }
  });

  it('allows for how long the last pass took', () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    saveCoordinator.lastWorkerMs = 8000;
    const stall = vi.spyOn(saveCoordinator, '_handleWorkerStall').mockImplementation(() => {});
    try {
      const postMessage = vi.fn();
      saveCoordinator.saveWorker = { postMessage, terminate: () => {} };
      saveCoordinator.nextStateToProcess = base;
      saveCoordinator.sendToWorker();
      vi.advanceTimersByTime(20000);
      expect(stall).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5000);
      expect(stall).toHaveBeenCalled();
    } finally {
      stall.mockRestore();
    }
  });
});

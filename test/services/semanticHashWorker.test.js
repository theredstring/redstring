/**
 * The slot comparison hashes each side in a worker, and falls back to the
 * main thread when a worker cannot help. jsdom has no Worker, so these tests
 * stand one in that runs the worker's handler in-process.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { slotsHaveEqualKnowledge } from '../../src/services/semanticHash.js';
import { semanticHash } from '../../src/services/semanticHashCore.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

const buildState = (names) => {
  const nodePrototypes = new Map(
    names.map((n) => [n, { id: n, name: n, description: '', definitionGraphIds: [], abstractionChains: {} }]),
  );
  const graphs = new Map([
    ['g1', { id: 'g1', name: 'Main', description: '', instances: new Map(), edgeIds: [], definingNodeIds: [] }],
  ]);
  const state = {
    graphs, nodePrototypes, edges: new Map(),
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false,
  };
  return importFromRedstring(exportToRedstring(state), {}).storeState;
};

describe('semanticHash.worker.js', () => {
  // The real worker module, run against a stand-in `self`. It reads `self`
  // again when it replies, so the stand-in stays until these tests finish.
  let scope;
  let realSelf;
  beforeAll(async () => {
    scope = { postMessage: vi.fn() };
    realSelf = globalThis.self;
    globalThis.self = scope;
    await import('../../src/services/semanticHash.worker.js');
  });
  afterAll(() => {
    globalThis.self = realSelf;
  });

  it('replies with the same hash the main thread computes', async () => {
    const doc = exportToRedstring(buildState(['dog']), null, { emitV4: false });
    const json = JSON.stringify(doc);
    await scope.onmessage({ data: { id: 7, json } });
    expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 7, hash: await semanticHash(JSON.parse(json)) });
  });

  it('replies with an error rather than throwing', async () => {
    await scope.onmessage({ data: { id: 8, json: '{not json' } });
    const reply = scope.postMessage.mock.lastCall[0];
    expect(reply.id).toBe(8);
    expect(typeof reply.error).toBe('string');
  });
});

/** A Worker stand-in that answers the way semanticHash.worker.js does. */
const installFakeWorker = ({ behaviour = 'hash' } = {}) => {
  const spawned = [];
  class FakeWorker {
    constructor() {
      this.terminated = false;
      spawned.push(this);
    }
    terminate() { this.terminated = true; }
    postMessage({ id, json }) {
      queueMicrotask(async () => {
        if (behaviour === 'crash') {
          this.onerror?.({ message: 'boom', preventDefault() {} });
        } else if (behaviour === 'error-reply') {
          this.onmessage?.({ data: { id, error: 'canonize failed' } });
        } else {
          this.onmessage?.({ data: { id, hash: await semanticHash(JSON.parse(json)) } });
        }
      });
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return spawned;
};

describe('slotsHaveEqualKnowledge off the main thread', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hashes each side in its own worker and reports equal knowledge', async () => {
    const spawned = installFakeWorker();
    expect(await slotsHaveEqualKnowledge(buildState(['dog']), buildState(['dog']))).toBe(true);
    expect(spawned).toHaveLength(2);
    expect(spawned.every((w) => w.terminated)).toBe(true);
  });

  it('tells different knowledge apart', async () => {
    installFakeWorker();
    expect(await slotsHaveEqualKnowledge(buildState(['dog']), buildState(['cat']))).toBe(false);
  });

  it('falls back to the main thread when the worker crashes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spawned = installFakeWorker({ behaviour: 'crash' });
    expect(await slotsHaveEqualKnowledge(buildState(['dog']), buildState(['dog']))).toBe(true);
    expect(await slotsHaveEqualKnowledge(buildState(['dog']), buildState(['cat']))).toBe(false);
    expect(spawned.every((w) => w.terminated)).toBe(true);
  });

  it('falls back to the main thread when the worker reports an error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFakeWorker({ behaviour: 'error-reply' });
    expect(await slotsHaveEqualKnowledge(buildState(['dog']), buildState(['cat']))).toBe(false);
  });
});

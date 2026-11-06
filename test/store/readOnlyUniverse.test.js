import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import useReadOnlyUniverse, { currentReadOnlyVisit, setReadOnlyUniverse } from '../../src/store/readOnlyUniverse.js';
import saveCoordinator from '../../src/services/SaveCoordinator.js';
import { resolveHeldWizardChanges } from '../../src/services/toolResultApplier.js';
import { holdForConfirmation, useWizardConfirmationStore, _resetWizardConfirmationGate } from '../../src/services/wizardConfirmationGate.js';
import { canvasDropSpec } from '../../src/components/canvas/actions/canvasDrop.js';
import { createDaemonCoexistence } from '../../src/services/daemonCoexistence.js';
import { exportToRedstring, PERSISTED_STORE_KEYS } from '../../src/formats/redstringFormat.js';

const graph = (id) => ({ id, name: id, instances: new Map(), edgeIds: [], definingNodeIds: [] });

const seed = () => {
  useGraphStore.getState().loadUniverseFromFile({
    graphs: new Map([['g1', graph('g1')], ['g2', graph('g2')]]),
    nodePrototypes: new Map([['p1', { id: 'p1', name: 'One', color: '#800000', definitionGraphIds: [] }]]),
    edges: new Map(),
    edgePrototypes: new Map(),
    openGraphIds: ['g1', 'g2'],
    activeGraphId: 'g1',
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    _universeSlug: 'visit',
  });
};

// A universe with something in every kind of place an action might reach for.
const seedWithContents = () => {
  const first = graph('g1');
  first.instances.set('i1', { id: 'i1', prototypeId: 'p1', x: 10, y: 10, scale: 1 });
  first.instances.set('i2', { id: 'i2', prototypeId: 'p2', x: 300, y: 10, scale: 1 });
  first.edgeIds = ['e1'];
  first.groups = new Map([['grp1', { id: 'grp1', name: 'G', color: '#800000', memberInstanceIds: ['i1'] }]]);
  useGraphStore.getState().loadUniverseFromFile({
    graphs: new Map([['g1', first], ['g2', graph('g2')]]),
    nodePrototypes: new Map([
      ['p1', { id: 'p1', name: 'One', color: '#800000', definitionGraphIds: ['g2'] }],
      ['p2', { id: 'p2', name: 'Two', color: '#800000', definitionGraphIds: [] }],
    ]),
    edges: new Map([['e1', {
      id: 'e1', sourceId: 'i1', destinationId: 'i2', name: 'c', typeNodeId: 'base-connection-prototype',
      definitionNodeIds: [], directionality: { arrowsToward: new Set() },
    }]]),
    edgePrototypes: new Map([['base-connection-prototype', { id: 'base-connection-prototype', name: 'Connection', color: '#000' }]]),
    openGraphIds: ['g1', 'g2'],
    activeGraphId: 'g1',
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    _universeSlug: 'visit',
  });
};

const NOT_THE_DOCUMENT = new Set(['openGraphIds', 'activeGraphId', 'activeDefinitionNodeId', 'expandedGraphIds', 'rightPanelTabs', 'showConnectionNames']);

/** The document, down to the leaves, so a change made in place shows too. */
const documentOf = () => {
  const state = useGraphStore.getState();
  return JSON.stringify(
    PERSISTED_STORE_KEYS.filter((key) => !NOT_THE_DOCUMENT.has(key)).map((key) => [key, state[key]]),
    (_, value) => {
      if (value instanceof Map) return { map: [...value.entries()] };
      if (value instanceof Set) return { set: [...value] };
      return value;
    },
  );
};

const paramsOf = (action) => {
  const source = action.toString();
  const found = source.match(/^(?:async\s*)?\(([^)]*)\)/) || source.match(/^(?:async\s+)?[\w$]+\s*\(([^)]*)\)/) || source.match(/^(?:async\s+)?([\w$]+)\s*=>/);
  return found ? found[1].split(',').map((param) => param.trim()).filter(Boolean) : [];
};

/** A real id or a plausible value, going by the parameter's name. */
const argumentFor = (param) => {
  const name = param.toLowerCase().replace(/[={}[\].\s]/g, '');
  if (/contextoptions|options|opts|context/.test(name)) return {};
  if (/recipe|updater|updatefn|fn$|callback/.test(name)) {
    return (draft) => { if (draft && typeof draft === 'object') { draft.name = 'Changed'; draft.x = 999; draft.color = '#123456'; } };
  }
  if (/instanceids|nodeids|ids$/.test(name)) return ['i1', 'i2'];
  if (/graphid|webid/.test(name)) return 'g1';
  if (/instanceid/.test(name)) return 'i1';
  if (/prototypeid|protoid|nodeid|thingid|survivorid|primaryid|^id$/.test(name)) return 'p1';
  if (/loserid|secondaryid/.test(name)) return 'p2';
  if (/edgeid/.test(name)) return 'e1';
  if (/groupid/.test(name)) return 'grp1';
  if (/position|point|coords/.test(name)) return { x: 500, y: 500 };
  if (/^x$|^y$|index|scale|count/.test(name)) return 1;
  if (/name|title|text|color|label/.test(name)) return 'Changed';
  if (/data|proto|graph|node|edge|group|updates|patch|payload|entry/.test(name)) {
    return { id: `made-${name}`, name: 'Changed', color: '#123456', definitionGraphIds: [], instances: new Map(), edgeIds: [], memberInstanceIds: ['i1'], sourceId: 'i1', destinationId: 'i2' };
  }
  return 'p1';
};

/** Every store action, each from a fresh universe, and what it did. */
const sweepActions = async (readOnly) => {
  const quiet = ['log', 'warn', 'error'].map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  const failures = [];
  const changedBy = [];
  const actions = Object.keys(useGraphStore.getState())
    .filter((name) => typeof useGraphStore.getState()[name] === 'function');
  try {
    for (const name of actions) {
      setReadOnlyUniverse(null);
      seedWithContents();
      setReadOnlyUniverse(readOnly);
      const before = documentOf();
      const action = useGraphStore.getState()[name];
      try {
        const result = action(...paramsOf(action).map(argumentFor));
        if (result?.then) await Promise.race([result.catch(() => {}), new Promise((done) => setTimeout(done, 50))]);
      } catch { /* An action that can't take these arguments changed nothing either. */ }
      const after = useGraphStore.getState();
      if (documentOf() !== before) {
        changedBy.push(name);
        failures.push(`${name} changed the document`);
      }
      if (!after.graphs.has(after.activeGraphId)) failures.push(`${name} left the canvas on a web that isn't there`);
      if (after.openGraphIds.some((id) => !after.graphs.has(id))) failures.push(`${name} opened a tab for a web that isn't there`);
    }
  } finally {
    quiet.forEach((spy) => spy.mockRestore());
  }
  return { failures, changedBy, actions: actions.length };
};

beforeEach(() => {
  setReadOnlyUniverse(null);
  seed();
});
afterEach(() => setReadOnlyUniverse(null));

describe('a universe open read-only', () => {
  beforeEach(() => setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://x/f.redstring' }));

  it('refuses edits', () => {
    const before = useGraphStore.getState();
    before.updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });
    const after = useGraphStore.getState();
    expect(after.nodePrototypes).toBe(before.nodePrototypes);
    expect(after.nodePrototypes.get('p1').name).toBe('One');
  });

  it('records nothing to undo', () => {
    useHistoryStore.getState().clearHistory();
    useGraphStore.getState().updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });
    useGraphStore.getState().flushHistoryBatch?.();
    expect(useHistoryStore.getState().history?.length ?? 0).toBe(0);
  });

  it('still lets you look around', () => {
    const before = useGraphStore.getState();
    before.setActiveGraph('g2');
    const after = useGraphStore.getState();
    expect(after.activeGraphId).toBe('g2');
    expect(after.graphs).toBe(before.graphs);
  });

  it('takes a load of its own, and no other', () => {
    const load = (slug) => useGraphStore.getState().loadUniverseFromFile({
      graphs: new Map([['g9', graph('g9')]]),
      nodePrototypes: new Map(),
      edges: new Map(),
      edgePrototypes: new Map(),
      ...(slug ? { _universeSlug: slug } : {}),
    });
    expect(load('other')).toBe(false);
    expect(load(null)).toBe(false);
    expect(useGraphStore.getState().graphs.has('g9')).toBe(false);
    expect(load('visit')).toBe(true);
    expect(useGraphStore.getState().graphs.has('g9')).toBe(true);
  });

  it('names the visit, so a run started in one can tell when it has ended', () => {
    expect(currentReadOnlyVisit()).toBe('visit');
    setReadOnlyUniverse(null);
    expect(currentReadOnlyVisit()).toBe(null);
  });

  it('merges nothing in', () => {
    const incoming = {
      graphs: new Map([['g9', graph('g9')]]),
      nodePrototypes: new Map([['p9', { id: 'p9', name: 'Nine', color: '#800000', definitionGraphIds: [] }]]),
      edges: new Map(),
      edgePrototypes: new Map(),
    };
    expect(useGraphStore.getState().mergeUniverseState(incoming)).toBeNull();
    expect(useGraphStore.getState().nodePrototypes.has('p9')).toBe(false);
  });

  it('refuses a write whole: no going to the web it would have made', () => {
    const before = useGraphStore.getState();
    before.createNewGraph({ name: 'New' });
    const after = useGraphStore.getState();
    expect(after.graphs).toBe(before.graphs);
    expect(after.activeGraphId).toBe('g1');
    expect(after.openGraphIds).toEqual(['g1', 'g2']);
  });

  it('holds against every action in the store, called with real ids', async () => {
    const { failures, actions } = await sweepActions({ slug: 'visit', name: 'Visit', sourceUrl: 'https://x/f.redstring' });
    expect(actions).toBeGreaterThan(150);
    expect(failures).toEqual([]);
  }, 60_000);

  it('that sweep does reach the document when nothing is read only', async () => {
    const { changedBy } = await sweepActions(null);
    expect(changedBy.length).toBeGreaterThan(20);
    expect(changedBy).toContain('addNodePrototype');
    expect(changedBy).toContain('deleteGraph');
  }, 60_000);

  it('still lets you go through what is there', () => {
    const store = () => useGraphStore.getState();
    store().closeGraphTab('g2');
    expect(store().openGraphIds).toEqual(['g1']);
    store().openGraphTab('g2');
    expect(store().openGraphIds).toContain('g2');
    expect(store().activeGraphId).toBe('g2');
    store().openRightPanelNodeTab('p1');
    expect(store().rightPanelTabs.some((tab) => tab.nodeId === 'p1')).toBe(true);
  });

  it('writes nothing, however a save is asked for', async () => {
    const write = { saved: 0 };
    const wasEnabled = saveCoordinator.isEnabled;
    saveCoordinator.isEnabled = true;
    saveCoordinator.fileStorage = { saveUniverse: () => { write.saved += 1; } };
    try {
      saveCoordinator.hasLoadedFromFile = true;
      saveCoordinator.onStateChange(useGraphStore.getState(), { type: 'node_update' });
      expect(saveCoordinator.pendingHash).toBeFalsy();
      expect(saveCoordinator.saveTimer).toBeFalsy();
      saveCoordinator.executeSave();
      expect(await saveCoordinator.flush('test')).toBe(false);
      await expect(saveCoordinator.forceSave(useGraphStore.getState())).rejects.toThrow(/read only/);
      expect(write.saved).toBe(0);
    } finally {
      saveCoordinator.isEnabled = wasEnabled;
      saveCoordinator.fileStorage = null;
    }
  });
});

describe('with a headless daemon engaged', () => {
  it('forwards nothing of a read-only universe, and carries on after', async () => {
    const posted = [];
    const respond = (body) => ({ ok: true, status: 200, json: async () => body });
    const controller = createDaemonCoexistence({
      useGraphStore,
      exportToRedstring,
      isReadOnly: () => useReadOnlyUniverse.getState().active !== null,
      bridgeFetch: async (path, options) => {
        if (path === '/api/bridge/health') return respond({ headless: true, stateVersion: 1 });
        if (path === '/api/store/export') return respond(exportToRedstring(useGraphStore.getState()));
        if (path === '/api/store/import') { posted.push(options); return respond({ stateVersion: 2 }); }
        return respond({});
      },
    });
    await controller.tick();
    expect(controller.isEngaged()).toBe(true);

    setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://x/f.redstring' });
    await controller.forwardNow();
    expect(posted).toHaveLength(0);

    setReadOnlyUniverse(null);
    await controller.forwardNow();
    expect(posted).toHaveLength(1);
    controller.stop();
  });
});

describe('with nothing open read-only', () => {
  it('edits as usual', () => {
    useGraphStore.getState().updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe('Changed');
  });
});

describe('answering a refused edit', () => {
  const edit = () => useGraphStore.getState().updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });

  beforeEach(() => setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://x/f.redstring' }));
  afterEach(() => vi.unstubAllGlobals());

  it('stays quiet for a write outside anything the person is doing', () => {
    const nudges = useReadOnlyUniverse.getState().nudge;
    edit();
    expect(useReadOnlyUniverse.getState().nudge).toBe(nudges);
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe('One');
  });

  it('speaks up for an edit inside their click or key press', () => {
    for (const type of ['click', 'keydown']) {
      vi.stubGlobal('event', { type });
      const nudges = useReadOnlyUniverse.getState().nudge;
      edit();
      expect(useReadOnlyUniverse.getState().nudge).toBe(nudges + 1);
    }
  });

  it('stays quiet during a pan or the wheel, whatever writes then', () => {
    for (const type of ['wheel', 'pointermove', 'mousemove']) {
      vi.stubGlobal('event', { type });
      const nudges = useReadOnlyUniverse.getState().nudge;
      edit();
      expect(useReadOnlyUniverse.getState().nudge).toBe(nudges);
    }
  });

  it('stays quiet for positions, even inside a click', () => {
    setReadOnlyUniverse(null);
    seedWithContents();
    setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://x/f.redstring' });
    vi.stubGlobal('event', { type: 'click' });
    const nudges = useReadOnlyUniverse.getState().nudge;
    useGraphStore.getState().updateMultipleNodeInstancePositions('g1', [{ instanceId: 'i1', x: 500, y: 500 }], { phase: 'end' });
    expect(useReadOnlyUniverse.getState().nudge).toBe(nudges);
    expect(useGraphStore.getState().graphs.get('g1').instances.get('i1').x).toBe(10);
  });
});

describe('what a visit leaves behind', () => {
  const visit = { slug: 'visit', name: 'Visit', sourceUrl: 'https://files.example.test/visit.redstring' };
  const held = () => holdForConfirmation({
    toolName: 'removeDefinitionGraph',
    result: { action: 'removeDefinitionGraph', graphId: 'g1', graphName: 'One' },
    toolCallId: 't1',
    conversationId: 'c1',
    kind: 'graph',
  });

  afterEach(() => {
    setReadOnlyUniverse(null);
    _resetWizardConfirmationGate();
  });

  it('a held Wizard change never waits past a visit opening', () => {
    held();
    setReadOnlyUniverse(visit);
    expect(useWizardConfirmationStore.getState().pending).toEqual([]);
  });

  it('a held Wizard change never waits past a visit closing', () => {
    setReadOnlyUniverse(visit);
    held();
    setReadOnlyUniverse(null);
    expect(useWizardConfirmationStore.getState().pending).toEqual([]);
  });

  it('nothing else lets go of a held change', () => {
    held();
    setReadOnlyUniverse(null);
    expect(useWizardConfirmationStore.getState().pending).toHaveLength(1);
    resolveHeldWizardChanges(useWizardConfirmationStore.getState().pending.map((entry) => entry.id), false);
    expect(useWizardConfirmationStore.getState().pending).toEqual([]);
  });

  it('a Thing let go on the canvas lands only outside a visit', () => {
    const spec = canvasDropSpec(() => ({}));
    expect(spec.canDrop()).toBe(true);
    setReadOnlyUniverse(visit);
    expect(spec.canDrop()).toBe(false);
  });
});

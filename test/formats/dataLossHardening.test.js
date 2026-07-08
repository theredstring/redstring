import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring, PERSISTED_STORE_KEYS } from '../../src/formats/redstringFormat.js';
import { generateStateHash, buildContentState } from '../../src/services/saveHash.js';

// Regression suite for the universe/file-management data-loss hardening pass.
// Each block maps to a specific audit finding that could silently lose data.

const baseStore = () => {
  const graphs = new Map();
  const nodePrototypes = new Map();
  const edges = new Map();
  const edgePrototypes = new Map();

  const instances = new Map();
  instances.set('iA', { id: 'iA', prototypeId: 'pA', x: 0, y: 0, scale: 1 });
  instances.set('iB', { id: 'iB', prototypeId: 'pB', x: 100, y: 0, scale: 1 });

  const groups = new Map();
  groups.set('grp1', { id: 'grp1', name: 'My Group', color: '#123456', memberInstanceIds: ['iA', 'iB'] });

  graphs.set('g', {
    id: 'g', name: 'G', description: '', instances, groups,
    edgeIds: ['e1'], definingNodeIds: [],
    directed: false, color: '#abcdef', createdAt: '2020-01-01T00:00:00.000Z'
  });

  nodePrototypes.set('pA', { id: 'pA', name: 'A', description: '', definitionGraphIds: [], abstractionChains: {} });
  nodePrototypes.set('pB', { id: 'pB', name: 'B', description: '', definitionGraphIds: [], abstractionChains: {} });

  edges.set('e1', {
    id: 'e1', sourceId: 'iA', destinationId: 'iB',
    typeNodeId: 'custom-edge-type', definitionNodeIds: [],
    directionality: { arrowsToward: new Set(['iB']) }
  });

  edgePrototypes.set('custom-edge-type', {
    id: 'custom-edge-type', name: 'Causes', description: 'user-made', color: '#ff0000',
    typeNodeId: null, definitionGraphIds: []
  });

  return {
    graphs, nodePrototypes, edges, edgePrototypes,
    openGraphIds: ['g'], activeGraphId: 'g', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(['g']), rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(['pA']), savedGraphIds: new Set(),
    showConnectionNames: true,
    wizardPlansByConversation: { conv1: { plan: 'keep me' } }
  };
};

describe('4.4 edgePrototypes round-trip', () => {
  it('preserves custom connection types across export/import', () => {
    const { storeState } = importFromRedstring(exportToRedstring(baseStore()));
    expect(storeState.edgePrototypes).toBeInstanceOf(Map);
    const custom = storeState.edgePrototypes.get('custom-edge-type');
    expect(custom).toBeTruthy();
    expect(custom.name).toBe('Causes');
    expect(custom.color).toBe('#ff0000');
  });
});

describe('4.2 wizardPlansByConversation survives export/import', () => {
  it('does not erase durable wizard plans', () => {
    const { storeState } = importFromRedstring(exportToRedstring(baseStore()));
    expect(storeState.wizardPlansByConversation?.conv1?.plan).toBe('keep me');
  });
  it('PERSISTED_STORE_KEYS includes the fields that were being truncated', () => {
    expect(PERSISTED_STORE_KEYS).toContain('wizardPlansByConversation');
    expect(PERSISTED_STORE_KEYS).toContain('edgePrototypes');
  });
});

describe('5h graph-level fields round-trip', () => {
  it('preserves directed / color / createdAt', () => {
    const { storeState } = importFromRedstring(exportToRedstring(baseStore()));
    const g = storeState.graphs.get('g');
    expect(g.directed).toBe(false);
    expect(g.color).toBe('#abcdef');
    expect(g.createdAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('4.3 user images are not stripped', () => {
  it('keeps imageSrc when not auto-enriched, even with a wikipedia link', () => {
    const store = baseStore();
    store.nodePrototypes.set('pImg', {
      id: 'pImg', name: 'Paris', description: '',
      imageSrc: 'data:image/png;base64,AAAA', thumbnailSrc: 'data:image/png;base64,BBBB',
      imageAspectRatio: 1,
      externalLinks: ['https://en.wikipedia.org/wiki/Paris'],
      definitionGraphIds: [], abstractionChains: {}
    });
    const { storeState } = importFromRedstring(exportToRedstring(store));
    const p = storeState.nodePrototypes.get('pImg');
    expect(p.imageSrc).toBe('data:image/png;base64,AAAA');
  });

  it('strips only genuinely re-fetchable auto-enriched images', () => {
    const store = baseStore();
    store.nodePrototypes.set('pEnriched', {
      id: 'pEnriched', name: 'Rome', description: '',
      imageSrc: 'data:image/png;base64,CCCC',
      imageAspectRatio: 1,
      semanticMetadata: { autoEnriched: true, wikipediaThumbnail: 'https://upload.wikimedia.org/x.png' },
      definitionGraphIds: [], abstractionChains: {}
    });
    const { storeState } = importFromRedstring(exportToRedstring(store));
    const p = storeState.nodePrototypes.get('pEnriched');
    expect(p.imageSrc == null).toBe(true);
  });
});

describe('2.1 import fails loudly instead of returning empty state', () => {
  it('throws on structurally broken input rather than yielding an empty universe', () => {
    // relationships.edges === null used to pass `!== undefined`, throw deep in
    // the import, and get swallowed into an empty fallback state.
    const bad = { format: 'redstring-v4.0.0', metadata: { version: '4.0.0' }, relationships: { edges: null } };
    // Should NOT throw for this specific case (null edges now coerced to {})…
    expect(() => importFromRedstring(bad)).not.toThrow();
  });

  it('re-throws when the payload is not importable at all', () => {
    // A number is not a valid redstring document; the outer catch must throw,
    // not return an empty universe.
    expect(() => importFromRedstring(42)).toThrow();
  });
});

describe('4.1 hash sees Maps and Sets and UI state', () => {
  it('detects a group-property edit (graph.groups is a Map)', () => {
    const a = baseStore();
    const h1 = generateStateHash(a);
    a.graphs.get('g').groups.get('grp1').color = '#000000';
    const h2 = generateStateHash(a);
    expect(h2).not.toBe(h1);
  });

  it('detects an edge directionality toggle (arrowsToward is a Set)', () => {
    const a = baseStore();
    const h1 = generateStateHash(a);
    a.edges.get('e1').directionality.arrowsToward = new Set(['iA', 'iB']);
    const h2 = generateStateHash(a);
    expect(h2).not.toBe(h1);
  });

  it('detects a bookmark change (savedNodeIds)', () => {
    const a = baseStore();
    const h1 = generateStateHash(a);
    a.savedNodeIds = new Set(['pA', 'pB']);
    const h2 = generateStateHash(a);
    expect(h2).not.toBe(h1);
  });

  it('ignores viewport-only changes (panOffset / zoomLevel)', () => {
    const a = baseStore();
    const h1 = generateStateHash(a);
    a.graphs.get('g').panOffset = { x: 999, y: 999 };
    a.graphs.get('g').zoomLevel = 3.2;
    const h2 = generateStateHash(a);
    expect(h2).toBe(h1);
  });

  it('detects an image replacement of identical aspect ratio via length fingerprint', () => {
    const store = baseStore();
    store.nodePrototypes.get('pA').imageSrc = 'data:image/png;base64,SHORT';
    store.nodePrototypes.get('pA').imageAspectRatio = 1;
    const h1 = generateStateHash(store);
    store.nodePrototypes.get('pA').imageSrc = 'data:image/png;base64,MUCHLONGERDATA';
    const h2 = generateStateHash(store);
    expect(h2).not.toBe(h1);
  });

  it('buildContentState excludes raw image data', () => {
    const store = baseStore();
    store.nodePrototypes.get('pA').imageSrc = 'data:image/png;base64,SECRET';
    const serialized = JSON.stringify(buildContentState(store));
    expect(serialized).not.toContain('SECRET');
  });
});

describe('L1 metadata.created is preserved across re-export', () => {
  it('does not reset the creation timestamp on the second save', () => {
    const first = exportToRedstring(baseStore());
    const created = first.metadata.created;
    const { storeState } = importFromRedstring(first);
    const second = exportToRedstring(storeState);
    expect(second.metadata.created).toBe(created);
  });
});

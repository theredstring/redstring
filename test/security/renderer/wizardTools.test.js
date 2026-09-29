/**
 * S-43 / S-42 — the Wizard can't be talked into storing an unsafe link or
 * colour, and deleting a web (or a lot of Things in one reply) waits for the
 * person's OK.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/identifierSearch.js', () => ({
  describeIdentifier: vi.fn(async () => null),
  searchWorks: vi.fn(),
}));

import useGraphStore from '../../../src/store/graphStore.js';
import {
  applyToolResultToStore,
  sanitizeToolResult,
  resolveHeldWizardChanges,
} from '../../../src/services/toolResultApplier.js';
import {
  useWizardConfirmationStore,
  beginWizardTurn,
  buildConfirmationQuestion,
  NODE_CHANGE_THRESHOLD,
  _resetWizardConfirmationGate,
} from '../../../src/services/wizardConfirmationGate.js';
import { linkIdentifier, normalizeIdentifier } from '../../../src/wizard/tools/linkIdentifier.js';
import { updateNode } from '../../../src/wizard/tools/updateNode.js';

const st = () => useGraphStore.getState();

const resetStore = () => {
  useGraphStore.setState({
    graphs: new Map(),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
  }, false, 'test_reset');
};

const makeGraphWith = (names) => {
  st().createNewGraph({ name: 'Web', typeNodeId: null, color: '#333' });
  const graphId = st().activeGraphId;
  st().applyBulkGraphUpdates(graphId, { nodes: names.map((name, i) => ({ name, color: '#8B0000', x: i * 10, y: 0 })) });
  return graphId;
};

const protoNamed = (name) => [...st().nodePrototypes.values()].filter((p) => p.name === name).pop();
const instanceCount = (graphId) => st().graphs.get(graphId).instances.size;

beforeEach(() => {
  resetStore();
  _resetWizardConfirmationGate();
});

describe('linkIdentifier refuses unsafe schemes (tool side)', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'smb://attacker/share',
  ])('normalizeIdentifier(%j) is null', (value) => {
    expect(normalizeIdentifier(value)).toBeNull();
  });

  it('fails the call rather than linking an unsafe identifier', async () => {
    await expect(linkIdentifier(
      { nodeName: 'Alpha', identifier: 'javascript:alert(1)' },
      { nodePrototypes: [{ id: 'p1', name: 'Alpha' }], graphs: [], activeGraphId: 'g' }
    )).rejects.toThrow(/is not a link or a DOI/);
  });

  it('links only the safe half of a mixed batch', async () => {
    const out = await linkIdentifier(
      { links: [
        { nodeName: 'Alpha', identifier: 'data:text/html,<script>alert(1)</script>' },
        { nodeName: 'Alpha', identifier: 'https://example.org/alpha' },
      ] },
      { nodePrototypes: [{ id: 'p1', name: 'Alpha' }], graphs: [], activeGraphId: 'g' }
    );
    expect(out.links.map((l) => l.url)).toEqual(['https://example.org/alpha']);
  });
});

describe('the applier refuses unsafe links and colours (store side)', () => {
  it('drops a javascript: link arriving in a linkIdentifier result (e.g. over the MCP bridge)', () => {
    makeGraphWith(['Alpha']);
    applyToolResultToStore('linkIdentifier', {
      action: 'linkIdentifier',
      links: [
        { nodeName: 'Alpha', url: 'javascript:alert(1)' },
        { nodeName: 'Alpha', url: 'https://www.wikidata.org/wiki/Q42' },
      ],
    });
    expect(protoNamed('Alpha').externalLinks).toEqual(['https://www.wikidata.org/wiki/Q42']);
  });

  it('ignores an unsafe colour in updateNode', () => {
    makeGraphWith(['Alpha']);
    applyToolResultToStore('updateNode', {
      action: 'updateNode',
      originalName: 'Alpha',
      updates: { color: 'red;background:url(https://evil.example/x)', description: 'kept' },
    });
    expect(protoNamed('Alpha').color).toBe('#8B0000');
    expect(protoNamed('Alpha').description).toBe('kept');
  });

  it('sanitizeToolResult drops unsafe colours at any depth and prototype-polluting keys', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"spec":{"nodes":[{"name":"A","color":"url(x)","typeColor":"#fff"}]},"nodeColor":"expression(1)"}');
    const out = sanitizeToolResult(polluted);
    expect(out.spec.nodes[0].color).toBeUndefined();
    expect(out.spec.nodes[0].typeColor).toBe('#fff');
    expect('nodeColor' in out).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
    expect(({}).polluted).toBeUndefined();
  });

  it('the updateNode tool itself never emits an unsafe colour', async () => {
    const out = await updateNode(
      { nodeName: 'Alpha', color: 'url(https://evil.example/x)' },
      { nodePrototypes: [{ id: 'p1', name: 'Alpha' }], graphs: [{ id: 'g', instances: [] }], activeGraphId: 'g' }
    );
    expect(out.updates.color).toBeUndefined();
  });
});

describe('destructive changes wait for the person (S-43)', () => {
  it('holds removeDefinitionGraph until allowed', () => {
    const graphId = makeGraphWith(['Owner']);
    const owner = protoNamed('Owner');
    st().createNewGraph({ name: 'Definition', typeNodeId: null, color: '#333' });
    const defId = st().activeGraphId;
    st().updateNodePrototype(owner.id, (draft) => { draft.definitionGraphIds = [defId]; });
    st().setActiveGraph?.(graphId);

    applyToolResultToStore('removeDefinitionGraph', { action: 'removeDefinitionGraph', nodeName: 'Owner', graphId: defId }, 'call-1', 'conv-1');
    expect(st().graphs.has(defId)).toBe(true);
    const pending = useWizardConfirmationStore.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('graph');
    expect(buildConfirmationQuestion(pending)).toContain('"Definition"');

    resolveHeldWizardChanges(pending.map((p) => p.id), true);
    expect(st().graphs.has(defId)).toBe(false);
    expect(useWizardConfirmationStore.getState().pending).toHaveLength(0);
  });

  it('drops a held change when declined, and says so', () => {
    makeGraphWith(['Owner']);
    const failed = vi.fn();
    window.addEventListener('rs-wizard-tool-failed', failed);
    applyToolResultToStore('mergeGraphs', { action: 'mergeGraphs', pairs: [], sourceGraphId: 'x', targetGraphId: 'y' }, 'c', 'conv-1');
    const ids = useWizardConfirmationStore.getState().pending.map((p) => p.id);
    resolveHeldWizardChanges(ids, false);
    window.removeEventListener('rs-wizard-tool-failed', failed);
    expect(useWizardConfirmationStore.getState().pending).toHaveLength(0);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0].detail.reason).toMatch(/chose not to allow/);
  });

  it(`applies the first ${NODE_CHANGE_THRESHOLD} deletes in a turn and holds the rest`, () => {
    const names = Array.from({ length: 14 }, (_, i) => `N${i}`);
    const graphId = makeGraphWith(names);
    beginWizardTurn('conv-1');
    for (const name of names) {
      applyToolResultToStore('deleteNode', { action: 'deleteNode', graphId, name }, `c-${name}`, 'conv-1');
    }
    expect(instanceCount(graphId)).toBe(14 - NODE_CHANGE_THRESHOLD);
    const pending = useWizardConfirmationStore.getState().pending;
    expect(pending).toHaveLength(14 - NODE_CHANGE_THRESHOLD);
    expect(pending.every((p) => p.kind === 'bulk')).toBe(true);

    resolveHeldWizardChanges(pending.map((p) => p.id), true);
    expect(instanceCount(graphId)).toBe(0);
  });

  it('a new turn starts the count again', () => {
    const names = Array.from({ length: 12 }, (_, i) => `M${i}`);
    const graphId = makeGraphWith(names);
    beginWizardTurn('conv-2');
    names.slice(0, 8).forEach((name) => applyToolResultToStore('deleteNode', { action: 'deleteNode', graphId, name }, null, 'conv-2'));
    beginWizardTurn('conv-2');
    names.slice(8).forEach((name) => applyToolResultToStore('deleteNode', { action: 'deleteNode', graphId, name }, null, 'conv-2'));
    expect(instanceCount(graphId)).toBe(0);
    expect(useWizardConfirmationStore.getState().pending).toHaveLength(0);
  });

  it('ordinary edits are never held', () => {
    const graphId = makeGraphWith(['Alpha']);
    applyToolResultToStore('createNode', { action: 'createNode', graphId, name: 'Beta', enrich: false }, null, 'conv-3');
    expect(protoNamed('Beta')).toBeTruthy();
    expect(useWizardConfirmationStore.getState().pending).toHaveLength(0);
  });
});

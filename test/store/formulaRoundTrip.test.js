import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { projectGraphView, openGroupId } from '../../src/core/openDefinitions.js';
import { buildFormulaInWeb } from '../../src/components/canvas/formats/formula/buildFormula.js';
import { readGroupFormula } from '../../src/components/canvas/formats/formatCandidates.js';
import { showAsThings, showFormatInPlace } from '../../src/components/canvas/formats/formatsStore.js';
import { computeFormulaObjects } from '../../src/components/canvas/formats/formula/formulaObjects.js';
import { restoreFormulaParts } from '../../src/components/canvas/formats/formula/formulaParts.js';
import { readFormulaGroup } from '../../src/components/canvas/formats/formula/formulaChain.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

// An equation shown as its formula keeps being one through the group's whole
// life: Thing-group, folded into its node, opened again (in place or as a copy).
// How it is shown is the placement's (the node's), not the Thing's.

const st = () => useGraphStore.getState();

const reset = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([['main', { id: 'main', name: 'main', description: '', instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds: [] }]]),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
};

const TEXT = 'a * (b + c)';
/** The formula drawn for a group, or null. */
const text = (groupId) => computeFormulaObjects(st()).objects.find(o => o.groupId === groupId)?.text ?? null;

/** Builds the equation, shown as its formula; returns its group and Thing. */
const buildEquation = () => {
  const { groupId, equationProtoId } = buildFormulaInWeb(TEXT, 'main', { x: 0, y: 0 });
  expect(st().graphs.get('main').groups.get(groupId).format).toBe('formula');
  return { groupId, equationProtoId, drawn: text(groupId) };
};

describe('an equation through fold and open', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  it('its definition holds its parentheses', () => {
    const { equationProtoId } = buildEquation();
    const def = st().graphs.get(st().nodePrototypes.get(equationProtoId).definitionGraphIds[0]);
    expect(def.groups.size).toBe(1);
    const [part] = def.groups.values();
    expect(def.instances.get(part.anchorInstanceId).isGroupAnchor).toBe(true);
    expect(part.memberInstanceIds).toHaveLength(2);
  });

  it('folded, its node keeps the formula; opened in place, it is the formula again', () => {
    const { groupId, drawn } = buildEquation();
    expect(drawn).toBeTruthy();
    const nodeId = st().collapseNodeGroupIntoDefinition('main', groupId);
    expect(st().graphs.get('main').instances.get(nodeId).format).toBe('formula');

    st().openDefinitionInPlace('main', nodeId);
    const boxId = openGroupId(nodeId);
    expect(projectGraphView(st(), 'main').groups.get(boxId).format).toBe('formula');
    expect(text(boxId)).toBe(drawn);
  });

  it('opened as a copy, the group takes the formula back from its node', () => {
    const { groupId, equationProtoId, drawn } = buildEquation();
    const nodeId = st().collapseNodeGroupIntoDefinition('main', groupId);
    const copyId = st().decomposeNodeToGroup('main', equationProtoId, 0, nodeId);
    expect(st().graphs.get('main').groups.get(copyId).format).toBe('formula');
    expect(st().graphs.get('main').instances.get(nodeId).format).toBeUndefined();
    expect(text(copyId)).toBe(drawn);
  });

  it('switching an open box between Things and its formula is saved on its node', () => {
    const { groupId } = buildEquation();
    const nodeId = st().collapseNodeGroupIntoDefinition('main', groupId);
    st().openDefinitionInPlace('main', nodeId);
    const boxId = openGroupId(nodeId);

    showAsThings('main', boxId);
    const node = () => st().graphs.get('main').instances.get(nodeId);
    expect(node().format).toBeUndefined();
    expect(node().linkedFormat).toBe('formula');
    expect(text(boxId)).toBeNull();

    showFormatInPlace({ source: 'group', sourceId: boxId, graphId: 'main', format: 'formula' });
    expect(node().format).toBe('formula');
    expect(node().linkedFormat).toBeUndefined();
  });

  it('is per placement: another node of the same Thing opens as its Things', () => {
    const { groupId, equationProtoId } = buildEquation();
    st().collapseNodeGroupIntoDefinition('main', groupId);
    st().addNodeInstance('main', equationProtoId, { x: 900, y: 0 }, 'other');
    st().openDefinitionInPlace('main', 'other');
    expect(projectGraphView(st(), 'main').groups.get(openGroupId('other')).format).toBeUndefined();
    // Still an equation: the panel offers to show it as one.
    expect(readGroupFormula(st(), 'main', openGroupId('other'))).toBeTruthy();
  });

  it('a folded node keeps its formula through save and load', () => {
    const { groupId } = buildEquation();
    const nodeId = st().collapseNodeGroupIntoDefinition('main', groupId);
    const { storeState } = importFromRedstring(exportToRedstring(st()));
    expect(storeState.graphs.get('main').instances.get(nodeId).format).toBe('formula');
  });
});

describe('restoreFormulaParts (upgrade)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  /** The equation's definition as older builds left it: the part's Thing beside its own parts. */
  const withoutParts = (equationProtoId) => {
    const defId = st().nodePrototypes.get(equationProtoId).definitionGraphIds[0];
    const def = st().graphs.get(defId);
    const instances = new Map([...def.instances].map(([id, inst]) => {
      const plain = { ...inst };
      delete plain.isGroupAnchor;
      delete plain.anchorForGroupId;
      return [id, plain];
    }));
    const graphs = new Map(st().graphs);
    graphs.set(defId, { ...def, instances, groups: new Map() });
    return { state: { ...st(), graphs }, defId };
  };

  it('puts a lost part back, so the definition reads as the formula again', () => {
    const { equationProtoId } = buildEquation();
    const { state, defId } = withoutParts(equationProtoId);
    const whole = (s) => {
      const def = s.graphs.get(defId);
      return readFormulaGroup(s, def, { id: '__web__', memberInstanceIds: [...def.instances.keys()] });
    };
    expect(whole(state)).toBeNull();

    expect(restoreFormulaParts(state)).toBe(1);
    const def = state.graphs.get(defId);
    expect(def.groups.size).toBe(1);
    const [part] = def.groups.values();
    expect(def.instances.get(part.anchorInstanceId).isGroupAnchor).toBe(true);
    expect(whole(state)).toBeTruthy();
    // Run again, nothing more to do.
    expect(restoreFormulaParts(state)).toBe(0);
  });

  it('leaves a web that is not an equation alone', () => {
    st().addNodePrototype({ id: 'p-box', name: 'Box', color: '#8B0000', definitionGraphIds: [] });
    st().addNodePrototype({ id: 'p-a', name: 'A', color: '#8B0000', definitionGraphIds: [] });
    st().addNodeInstance('main', 'p-a', { x: 0, y: 0 }, 'a');
    const gid = st().createGroup('main', { memberInstanceIds: ['a'] });
    st().convertGroupToNodeGroup('main', gid, 'p-box', false);
    // A web defining something, holding Box beside a copy of Box's own contents.
    const boxDef = st().nodePrototypes.get('p-box').definitionGraphIds[0];
    const web = { id: 'w', name: 'w', instances: new Map([
      ['box2', { id: 'box2', prototypeId: 'p-box', x: 500, y: 0 }],
      ['a2', { id: 'a2', prototypeId: 'p-a', x: st().graphs.get(boxDef).instances.values().next().value.x, y: 0 }],
    ]), edgeIds: [], groups: new Map(), definingNodeIds: ['p-a'] };
    const state = { ...st(), graphs: new Map([...st().graphs, ['w', web]]) };
    expect(restoreFormulaParts(state)).toBe(0);
    expect(state.graphs.get('w')).toBe(web);
  });
});

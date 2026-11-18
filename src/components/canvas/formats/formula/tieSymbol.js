/**
 * Tying a symbol of an equation to the Thing it stands for (P to Pressure),
 * from the Symbols card in an equation's About. Every instance of the symbol
 * in the equation is pointed at the Thing, and the equation reads as it did:
 * the Thing takes the symbol as how it is written when it has no label of its
 * own, else the instances keep it as theirs. A bare letter left with nothing
 * using it goes.
 */
import useGraphStore from '../../../../store/graphStore.js';
import { formulaLabelOf } from './formulaChain.js';
import { isBareSymbol } from './formulaEquations.js';

/** Whether anything in the universe still uses this Thing. */
function inUse(state, protoId) {
  for (const graph of state.graphs.values()) {
    for (const inst of graph.instances?.values() || []) if (inst.prototypeId === protoId) return true;
    if (graph.definingNodeIds?.includes(protoId)) return true;
  }
  for (const proto of state.nodePrototypes.values()) if (proto.typeNodeId === protoId) return true;
  for (const edge of state.edges.values()) {
    if (edge.typeNodeId === protoId || edge.definitionNodeIds?.includes(protoId)) return true;
  }
  return false;
}

/**
 * Point a symbol row of symbolsOf at the Thing `protoId`.
 * @returns {boolean} Whether anything changed.
 */
export function tieSymbol(row, protoId) {
  const store = useGraphStore.getState();
  const thing = store.nodePrototypes.get(protoId);
  if (!row || !thing || row.protoId === protoId) return false;
  const wasBare = isBareSymbol(store.nodePrototypes.get(row.protoId));
  store.withHistoryTransaction(`Tied ${row.symbol} to ${thing.name || 'a Thing'}`, () => {
    if (!thing.labels?.formula && row.symbol !== thing.name) {
      store.updateNodePrototype(protoId, (draft) => {
        draft.labels = { ...(draft.labels || {}), formula: row.symbol };
      });
    }
    const written = formulaLabelOf(useGraphStore.getState().nodePrototypes.get(protoId));
    for (const instanceId of row.instanceIds) {
      store.updateNodeInstance(row.graphId, instanceId, (inst) => {
        inst.prototypeId = protoId;
        if (!inst.labels?.formula && written !== row.symbol) {
          inst.labels = { ...(inst.labels || {}), formula: row.symbol };
        }
      }, { finalize: true });
    }
    if (wasBare && !inUse(useGraphStore.getState(), row.protoId)) store.deleteNodePrototype(row.protoId);
  });
  return true;
}

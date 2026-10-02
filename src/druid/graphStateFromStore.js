/**
 * The agent's view of the store, shaped as LeftAIView builds it for an ask.
 *
 * The panel builds this inline from React state; the Druid runs with no panel,
 * so it builds the same plain shape from the store directly. Same fields the
 * end-to-end wizard test uses (test/wizard/wizardEndToEnd.test.js), which is
 * what proves a second ask sees what the first one made.
 */

const toArray = (m) => (m instanceof Map ? Array.from(m.values()) : Array.isArray(m) ? m : Object.values(m || {}));

export function graphStateFromStore(st) {
  const graphs = Array.from(st.graphs.values());
  const protoIds = new Set();
  const edgeIds = new Set();
  for (const g of graphs) {
    for (const inst of toArray(g.instances)) protoIds.add(inst.prototypeId);
    for (const id of g.definingNodeIds || []) protoIds.add(id);
    for (const id of g.edgeIds || []) {
      edgeIds.add(id);
      for (const d of st.edges.get(id)?.definitionNodeIds || []) protoIds.add(d);
    }
  }
  return {
    graphs: graphs.map(g => ({
      id: g.id,
      name: g.name,
      description: g.description || '',
      instances: toArray(g.instances),
      edgeIds: g.edgeIds || [],
      definingNodeIds: g.definingNodeIds || [],
      groups: toArray(g.groups)
    })),
    nodePrototypes: [...protoIds].map(id => st.nodePrototypes.get(id)).filter(Boolean).map(p => ({
      id: p.id,
      name: p.name || '',
      color: p.color || '',
      description: p.description || '',
      typeNodeId: p.typeNodeId || null,
      definitionGraphIds: p.definitionGraphIds || []
    })),
    edges: [...edgeIds].map(id => st.edges.get(id)).filter(Boolean).map(e => ({
      id: e.id,
      sourceId: e.sourceId,
      destinationId: e.destinationId,
      name: e.name || '',
      definitionNodeIds: e.definitionNodeIds || [],
      type: e.type || ''
    })),
    activeGraphId: st.activeGraphId || null,
    openGraphIds: [...(st.openGraphIds || [])]
  };
}

export default graphStateFromStore;

/**
 * Test webs for formulas, in the store's shape: Things in a row, operations as
 * connections defined by operator Things, parts as nested Thing-groups.
 *
 *   formulaWeb({
 *     things: [['a', 'a', 0], ['b', 'b', 200]],            // [instanceId, name, x]
 *     ops: [['a', 'b', 'Addition']],                       // [from, to, operation] (arrow from -> to)
 *     parts: [{ id: 'g', anchor: 'pa', name: 'a + b', type: 'Square Root', members: ['a', 'b'] }],
 *     top: ['a', 'b', 'pa'],                                // the formula group's members
 *   })
 */
export function formulaWeb({ things = [], ops = [], parts = [], top = null, extra = [], arrows = 'forward', format } = {}) {
  const nodePrototypes = new Map();
  const protoNamed = (name) => {
    for (const p of nodePrototypes.values()) if (p.name === name) return p;
    const p = { id: `p-${name}`, name, color: '#8B0000', typeNodeId: null };
    nodePrototypes.set(p.id, p);
    return p;
  };
  const instances = new Map();
  for (const [id, name, x, y = 0] of things) instances.set(id, { id, prototypeId: protoNamed(name).id, x, y });
  const groups = new Map();
  for (const part of parts) {
    const proto = { id: `p-part-${part.id}`, name: part.name, color: '#8B0000', typeNodeId: part.type ? protoNamed(part.type).id : null };
    nodePrototypes.set(proto.id, proto);
    instances.set(part.anchor, { id: part.anchor, prototypeId: proto.id, x: part.x ?? 0, y: -80, isGroupAnchor: true, anchorForGroupId: part.id });
    groups.set(part.id, {
      id: part.id, name: part.name, memberInstanceIds: part.members,
      linkedNodePrototypeId: proto.id, anchorInstanceId: part.anchor,
    });
  }
  const edgeList = [];
  ops.forEach(([from, to, opName], i) => {
    const def = opName ? protoNamed(opName) : null;
    const arrowsToward = arrows === 'forward' ? [to] : arrows === 'back' ? [from] : [];
    edgeList.push({
      id: `e${i}`, sourceId: from, destinationId: to,
      typeNodeId: 'base-connection-prototype', definitionNodeIds: def ? [def.id] : [],
      directionality: { arrowsToward: new Set(arrowsToward) },
    });
  });
  for (const [id, name, x, y = 0] of extra) instances.set(id, { id, prototypeId: protoNamed(name).id, x, y });
  if (top) groups.set('top', { id: 'top', name: 'Formula', color: '#8B0000', memberInstanceIds: top, ...(format ? { format } : {}) });
  const edges = new Map(edgeList.map(e => [e.id, e]));
  return {
    activeGraphId: 'web',
    graphs: new Map([['web', { id: 'web', name: 'Web', instances, edgeIds: edgeList.map(e => e.id), groups }]]),
    nodePrototypes, edges, edgePrototypes: new Map(),
  };
}

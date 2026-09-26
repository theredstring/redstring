/**
 * Open definitions: a node shown open in place, its definition's own nodes drawn
 * inside it.
 *
 * Nothing is copied. A node instance carries `openDefinition: { index, offset }`
 * and the definition graph at that index is projected into whatever graph is being
 * viewed, its positions shifted by `offset`. Editing inside the box edits the
 * definition itself, so every place that definition appears (its own tab, other
 * open boxes) shows the same thing with nothing to keep in sync.
 *
 * This module is pure: it reads `graphs` and `nodePrototypes` Maps and returns
 * views. The store routes writes through `resolveOwner`; the canvas draws
 * `projectGraphView`.
 *
 * Terms:
 * - view graph: the graph being looked at (the root of the projection).
 * - box: an instance with an open definition. Its `anchorId` is that instance.
 * - owner: the graph an instance really lives in, and the chain of boxes (`path`)
 *   the view reaches it through. `path[i]` is `{ anchorId, graphId }`: the anchor
 *   lives in the graph before it, and `graphId` is the definition it opens.
 * - via: on a connection, the anchors from the connection's own graph down to one of
 *   its ends (`sourceVia` / `destinationVia`). A connection from a node inside Box
 *   to a node outside it lives in the outer graph with `sourceVia: [box]`. When Box
 *   is closed it is drawn to Box; open, to the node itself. Nothing is rewritten.
 *
 * A definition opens at most once per view. A second box of the same definition,
 * or a definition opened inside itself, shows closed. That keeps every drawn
 * instance id unique, so the canvas needs no per-path ids.
 */

export const OPEN_GROUP_PREFIX = 'open:';

/** The synthetic group id the view gives an open box. */
export const openGroupId = (anchorId) => `${OPEN_GROUP_PREFIX}${anchorId}`;

/** The anchor instance behind an open-box group id, or null for an ordinary group. */
export const anchorIdFromOpenGroupId = (groupId) =>
  (typeof groupId === 'string' && groupId.startsWith(OPEN_GROUP_PREFIX))
    ? groupId.slice(OPEN_GROUP_PREFIX.length)
    : null;

/** The definition graph id an instance's `openDefinition` points at, or null. */
export const openDefinitionGraphId = (instance, nodePrototypes) => {
  const open = instance?.openDefinition;
  if (!open) return null;
  const prototype = nodePrototypes?.get(instance.prototypeId);
  const ids = Array.isArray(prototype?.definitionGraphIds) ? prototype.definitionGraphIds : [];
  return ids[open.index ?? 0] || null;
};

const ZERO = Object.freeze({ x: 0, y: 0 });

const addOffset = (a, b) => ({ x: (a?.x ?? 0) + (b?.x ?? 0), y: (a?.y ?? 0) + (b?.y ?? 0) });

/**
 * Walks the view graph and every definition opened inside it.
 *
 * @returns {{ boxes: Map<string, Object>, owners: Map<string, Object> }}
 *   boxes: anchorId → { anchorId, prototypeId, index, ownerGraphId, defGraphId, path, offset }
 *     where `offset` maps the definition's coordinates to the view's.
 *   owners: instanceId → { graphId, path, offset } for every instance inside a box.
 *     Instances of the view graph itself are not listed.
 */
export const mapOpenDefinitions = (graphs, nodePrototypes, viewGraphId) => {
  const boxes = new Map();
  const owners = new Map();
  const root = graphs?.get(viewGraphId);
  if (!root?.instances) return { boxes, owners };

  const opened = new Set([viewGraphId]);
  const walk = (graph, graphId, path, offset) => {
    for (const instance of graph.instances.values()) {
      if (path.length > 0) owners.set(instance.id, { graphId, path, offset });
      if (!instance.openDefinition) continue;
      const defGraphId = openDefinitionGraphId(instance, nodePrototypes);
      if (!defGraphId || opened.has(defGraphId)) continue;
      const defGraph = graphs.get(defGraphId);
      if (!defGraph?.instances) continue;
      opened.add(defGraphId);
      const boxOffset = addOffset(offset, instance.openDefinition.offset);
      const boxPath = [...path, { anchorId: instance.id, graphId: defGraphId }];
      boxes.set(instance.id, {
        anchorId: instance.id,
        prototypeId: instance.prototypeId,
        index: instance.openDefinition.index ?? 0,
        ownerGraphId: graphId,
        defGraphId,
        path,
        offset: boxOffset,
      });
      walk(defGraph, defGraphId, boxPath, boxOffset);
    }
  };
  walk(root, viewGraphId, [], ZERO);
  return { boxes, owners };
};

/**
 * Where an instance seen in `viewGraphId` really lives.
 *
 * @returns {{ graphId: string, path: Array, offset: {x,y} }|null} null when the
 *   instance is not visible in the view. Instances of the view graph itself come
 *   back with an empty path and a zero offset.
 */
export const resolveOwner = (graphs, nodePrototypes, viewGraphId, instanceId, map = null) => {
  if (graphs?.get(viewGraphId)?.instances?.has(instanceId)) {
    return { graphId: viewGraphId, path: [], offset: ZERO };
  }
  const { owners } = map || mapOpenDefinitions(graphs, nodePrototypes, viewGraphId);
  return owners.get(instanceId) || null;
};

/**
 * The graph a new connection between two visible instances belongs in, and the via
 * chain for each end: the innermost graph both ends can be reached from.
 *
 * @param {{graphId, path}} a - Owner of one end (from resolveOwner).
 * @param {{graphId, path}} b - Owner of the other end.
 * @param {string} viewGraphId
 */
export const connectionHome = (a, b, viewGraphId) => {
  const chainA = [viewGraphId, ...a.path.map(step => step.graphId)];
  const chainB = [viewGraphId, ...b.path.map(step => step.graphId)];
  let shared = 0;
  while (shared < chainA.length && shared < chainB.length && chainA[shared] === chainB[shared]) shared++;
  const homeGraphId = chainA[shared - 1];
  return {
    homeGraphId,
    viaA: a.path.slice(shared - 1).map(step => step.anchorId),
    viaB: b.path.slice(shared - 1).map(step => step.anchorId),
  };
};

// ─── The view ─────────────────────────────────────────────────────────────────

// instance object → { ox, oy, flags, value }: an instance drawn at the same offset
// with the same flags keeps its projected object, so memoized nodes don't re-render.
const projectedInstances = new WeakMap();
const projectInstance = (instance, offset, anchorGroupId) => {
  const ox = offset?.x ?? 0;
  const oy = offset?.y ?? 0;
  if (ox === 0 && oy === 0 && !anchorGroupId) return instance;
  const cached = projectedInstances.get(instance);
  if (cached && cached.ox === ox && cached.oy === oy && cached.anchorGroupId === anchorGroupId) return cached.value;
  const value = {
    ...instance,
    x: (instance.x ?? 0) + ox,
    y: (instance.y ?? 0) + oy,
    ...(anchorGroupId ? { isGroupAnchor: true, anchorForGroupId: anchorGroupId } : {}),
  };
  projectedInstances.set(instance, { ox, oy, anchorGroupId, value });
  return value;
};

// edge object → { sourceId, destinationId, value }
const displayedEdges = new WeakMap();
const displayEdge = (edge, sourceId, destinationId) => {
  if (sourceId === edge.sourceId && destinationId === edge.destinationId) return edge;
  const cached = displayedEdges.get(edge);
  if (cached && cached.sourceId === sourceId && cached.destinationId === destinationId) return cached.value;
  const arrows = edge.directionality?.arrowsToward;
  const arrowList = arrows instanceof Set ? Array.from(arrows) : (Array.isArray(arrows) ? arrows : []);
  const arrowsToward = new Set(arrowList.map(id => (
    id === edge.sourceId ? sourceId : id === edge.destinationId ? destinationId : id
  )));
  const value = {
    ...edge,
    sourceId,
    destinationId,
    directionality: { ...(edge.directionality || {}), arrowsToward },
  };
  displayedEdges.set(edge, { sourceId, destinationId, value });
  return value;
};

// graphs Map → Map<instanceId, graphId> across the whole universe. Only needed for
// connections with no via (files from before open definitions), so built lazily.
const universeOwners = new WeakMap();
const ownerGraphIdOf = (graphs, instanceId) => {
  let index = universeOwners.get(graphs);
  if (!index) {
    index = new Map();
    graphs.forEach((graph, graphId) => graph.instances?.forEach((_, id) => index.set(id, graphId)));
    universeOwners.set(graphs, index);
  }
  return index.get(instanceId) || null;
};

/**
 * The instance a connection end is drawn to in the view: the end itself when it is
 * visible, otherwise the closed box that holds it. Null when neither is on screen.
 */
const displayEnd = (instanceId, via, visible, boxes, graphs, nodePrototypes, instancesInView) => {
  if (visible(instanceId)) return instanceId;
  if (Array.isArray(via) && via.length > 0) {
    let deepestVisible = null;
    for (const anchorId of via) {
      if (!visible(anchorId)) break;
      deepestVisible = anchorId;
      if (!boxes.has(anchorId)) break; // closed: everything below is hidden inside it
    }
    if (deepestVisible) return deepestVisible;
  }
  // No via (or a stale one): any closed node on screen whose definition holds it.
  const ownerGraphId = ownerGraphIdOf(graphs, instanceId);
  if (!ownerGraphId) return null;
  for (const candidate of instancesInView) {
    if (boxes.has(candidate.id)) continue;
    const ids = nodePrototypes?.get(candidate.prototypeId)?.definitionGraphIds;
    if (Array.isArray(ids) && ids.includes(ownerGraphId)) return candidate.id;
  }
  return null;
};

const buildOpenGroup = (box, members, nodePrototypes) => {
  const prototype = nodePrototypes?.get(box.prototypeId);
  return {
    id: openGroupId(box.anchorId),
    name: prototype?.name || 'Thing',
    description: '',
    color: prototype?.color || '#8B0000',
    memberInstanceIds: members,
    linkedNodePrototypeId: box.prototypeId,
    linkedDefinitionIndex: box.index,
    anchorInstanceId: box.anchorId,
    isOpenDefinition: true,
    // An empty box holds itself open where the definition's origin lands.
    ...(members.length === 0 ? { emptyPlaceholderOrigin: { x: box.offset.x, y: box.offset.y } } : {}),
    semanticMetadata: { type: 'Group', relationships: [] },
  };
};

// viewGraphId → { deps, view }: rebuilt only when something it read changed.
const viewCache = new Map();

/**
 * The view graph with its open definitions projected in. Returns the raw graph
 * untouched when nothing in it is open and none of its connections reach into a
 * closed box.
 *
 * @param {{ graphs: Map, nodePrototypes: Map, edges: Map }} state - Store state (or
 *   anything shaped like it).
 * @param {string} viewGraphId
 *
 * The view has the raw graph's fields plus:
 * - `instances`: its own instances, then every open definition's, at view positions.
 *   An open box's anchor is flagged `isGroupAnchor` so it hides behind its shell.
 * - `edgeIds`: the connections drawn: its own plus every open definition's, less any
 *   with an end that is nowhere on screen.
 * - `groups`: its own groups, every open definition's, and one group per open box
 *   (`isOpenDefinition: true`, id from `openGroupId`).
 * - `openView`: `{ boxes, owners, edges }`. `edges` maps an edge id to the version
 *   drawn in this view when an end is hidden inside a closed box.
 */
export const projectGraphView = (state, viewGraphId) => {
  const { graphs, nodePrototypes, edges: edgesMap } = state || {};
  const raw = graphs?.get(viewGraphId);
  if (!raw?.instances) return raw;
  const { boxes, owners } = mapOpenDefinitions(graphs, nodePrototypes, viewGraphId);

  const reachesInside = (edgeId) => {
    const edge = edgesMap?.get(edgeId);
    return !!edge && (!raw.instances.has(edge.sourceId) || !raw.instances.has(edge.destinationId));
  };
  if (boxes.size === 0 && !(raw.edgeIds || []).some(reachesInside)) {
    viewCache.delete(viewGraphId);
    return raw;
  }

  const deps = [raw, nodePrototypes, edgesMap];
  boxes.forEach(box => deps.push(graphs.get(box.defGraphId)));
  const cached = viewCache.get(viewGraphId);
  if (cached && cached.deps.length === deps.length && cached.deps.every((d, i) => d === deps[i])) {
    return cached.view;
  }

  const instances = new Map();
  raw.instances.forEach((instance, id) => {
    instances.set(id, projectInstance(instance, ZERO, boxes.has(id) ? openGroupId(id) : null));
  });
  const edgeIds = [...(raw.edgeIds || [])];
  const groups = new Map(raw.groups || []);
  const membersByBox = new Map();
  boxes.forEach((box) => membersByBox.set(box.anchorId, []));

  boxes.forEach((box) => {
    const defGraph = graphs.get(box.defGraphId);
    defGraph.instances.forEach((instance, id) => {
      instances.set(id, projectInstance(instance, box.offset, boxes.has(id) ? openGroupId(id) : null));
    });
    edgeIds.push(...(defGraph.edgeIds || []));
    defGraph.groups?.forEach((group, groupId) => groups.set(groupId, group));
  });

  // Every box counts everything nested inside it as a member, nested anchors
  // included, the way nested node-groups are expressed (strict-subset membership).
  owners.forEach((owner, instanceId) => {
    for (const step of owner.path) membersByBox.get(step.anchorId)?.push(instanceId);
  });
  boxes.forEach((box) => {
    const group = buildOpenGroup(box, membersByBox.get(box.anchorId), nodePrototypes);
    groups.set(group.id, group);
  });

  const visible = (id) => instances.has(id);
  const instancesInView = Array.from(instances.values());
  const shownEdges = new Map();
  const shownEdgeIds = [];
  for (const edgeId of edgeIds) {
    const edge = edgesMap?.get(edgeId);
    if (!edge) continue;
    const sourceId = displayEnd(edge.sourceId, edge.sourceVia, visible, boxes, graphs, nodePrototypes, instancesInView);
    const destinationId = displayEnd(edge.destinationId, edge.destinationVia, visible, boxes, graphs, nodePrototypes, instancesInView);
    if (!sourceId || !destinationId) continue;
    if (sourceId === destinationId && edge.sourceId !== edge.destinationId) continue; // folded into one box
    const shown = displayEdge(edge, sourceId, destinationId);
    if (shown !== edge) shownEdges.set(edgeId, shown);
    shownEdgeIds.push(edgeId);
  }

  const view = {
    ...raw,
    instances,
    edgeIds: shownEdgeIds,
    groups,
    openView: { boxes, owners, edges: shownEdges },
  };
  viewCache.set(viewGraphId, { deps, view });
  return view;
};

/**
 * Where to put an open box's definition so its top-left sits on the anchor, the
 * same placement expanding a node into a group has always used.
 */
export const initialOpenOffset = (anchor, defGraph) => {
  const defInstances = defGraph?.instances ? Array.from(defGraph.instances.values()) : [];
  if (defInstances.length === 0) return { x: anchor.x ?? 0, y: anchor.y ?? 0 };
  const minX = Math.min(...defInstances.map(i => i.x ?? 0));
  const minY = Math.min(...defInstances.map(i => i.y ?? 0));
  return { x: (anchor.x ?? 0) - minX, y: (anchor.y ?? 0) - minY };
};

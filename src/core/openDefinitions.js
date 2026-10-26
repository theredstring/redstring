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
 * A definition can be open in several boxes of one view. The first box it opens
 * in shows its instances under their own ids; a box that repeats it shows them
 * under view ids, its anchor's view id joined to theirs (`box/node`, see
 * `viewIdOf`), so every drawn id stays unique. Everything inside a repeated box is
 * addressed that way, nested boxes included (their `scope`). View ids exist only
 * in the view: the store reads the stored id back off the end (`storedIdOf`), and
 * nothing saved ever holds one. A definition opened inside itself shows closed.
 */

export const OPEN_GROUP_PREFIX = 'open:';

/** Joins a repeated box's scope to an id inside it. */
export const VIEW_ID_SEPARATOR = '/';

/** How an instance, connection or group inside a box with `scope` is addressed in the view. */
export const viewIdOf = (scope, id) => (scope ? `${scope}${VIEW_ID_SEPARATOR}${id}` : id);

/**
 * The stored id behind a view id: an instance, connection or group's own id. Ids
 * that aren't view ids come back as they are. Not for `open:` group ids, whose
 * anchor is a view id (anchorIdFromOpenGroupId).
 */
export const storedIdOf = (viewId) => {
  if (typeof viewId !== 'string') return viewId;
  const at = viewId.lastIndexOf(VIEW_ID_SEPARATOR);
  return at < 0 ? viewId : viewId.slice(at + 1);
};

/** A group id as stored: an `open:` id stays as it is (its anchor names the box). */
export const storedGroupIdOf = (groupId) => (anchorIdFromOpenGroupId(groupId) ? groupId : storedIdOf(groupId));

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
 *   boxes: anchor view id → { anchorId, instanceId, prototypeId, index, format, linkedFormat, ownerGraphId, defGraphId, path, offset, scope, repeat }
 *     where `offset` maps the definition's coordinates to the view's, `instanceId`
 *     is the anchor's stored id, `scope` prefixes the view ids of everything inside
 *     (empty unless the box or one around it repeats a definition open before it),
 *     and `repeat` marks a box whose definition opened earlier in the walk.
 *   owners: instance view id → { graphId, path, offset, instanceId } for every
 *     instance inside a box (`instanceId` is its stored id). Path steps name
 *     anchors by view id. Instances of the view graph itself are not listed.
 */
export const mapOpenDefinitions = (graphs, nodePrototypes, viewGraphId) => {
  const boxes = new Map();
  const owners = new Map();
  const root = graphs?.get(viewGraphId);
  if (!root?.instances) return { boxes, owners };

  const opened = new Set();
  const walk = (graph, graphId, path, offset, scope) => {
    const around = [viewGraphId, ...path.map(step => step.graphId)];
    for (const [instanceId, instance] of graph.instances) {
      const id = viewIdOf(scope, instanceId);
      if (path.length > 0) owners.set(id, { graphId, path, offset, instanceId });
      if (!instance.openDefinition) continue;
      const defGraphId = openDefinitionGraphId(instance, nodePrototypes);
      if (!defGraphId || around.includes(defGraphId)) continue;
      const defGraph = graphs.get(defGraphId);
      if (!defGraph?.instances) continue;
      const repeat = opened.has(defGraphId);
      opened.add(defGraphId);
      const innerScope = repeat ? id : scope;
      const boxOffset = addOffset(offset, instance.openDefinition.offset);
      const boxPath = [...path, { anchorId: id, graphId: defGraphId }];
      boxes.set(id, {
        anchorId: id,
        instanceId,
        prototypeId: instance.prototypeId,
        index: instance.openDefinition.index ?? 0,
        // How this node shows its definition (formats/), kept on the node.
        format: instance.format || null,
        linkedFormat: instance.linkedFormat || null,
        // Its formula is drawn at the node's own size (graphStore moveFormat).
        formulaSize: instance.sizeMul > 0 && instance.sizeMul !== 1 ? instance.sizeMul : null,
        ownerGraphId: graphId,
        defGraphId,
        path,
        offset: boxOffset,
        scope: innerScope,
        repeat,
      });
      walk(defGraph, defGraphId, boxPath, boxOffset, innerScope);
    }
  };
  walk(root, viewGraphId, [], ZERO, '');
  return { boxes, owners };
};

/**
 * Where an instance seen in `viewGraphId` (by its view id) really lives.
 *
 * @returns {{ graphId: string, path: Array, offset: {x,y}, instanceId: string }|null}
 *   null when the instance is not visible in the view. `instanceId` is its stored
 *   id. Instances of the view graph itself come back with an empty path and a
 *   zero offset.
 */
export const resolveOwner = (graphs, nodePrototypes, viewGraphId, instanceId, map = null) => {
  if (graphs?.get(viewGraphId)?.instances?.has(instanceId)) {
    return { graphId: viewGraphId, path: [], offset: ZERO, instanceId };
  }
  const { owners } = map || mapOpenDefinitions(graphs, nodePrototypes, viewGraphId);
  return owners.get(instanceId) || null;
};

/**
 * The graph a new connection between two visible instances belongs in, and the via
 * chain for each end: the innermost box both ends are inside (or the view graph).
 * Boxes are told apart by anchor, so two boxes of one definition are two places:
 * a connection between them lives around both.
 *
 * @param {{graphId, path}} a - Owner of one end (from resolveOwner).
 * @param {{graphId, path}} b - Owner of the other end.
 * @param {string} viewGraphId
 */
export const connectionHome = (a, b, viewGraphId) => {
  let shared = 0;
  while (shared < a.path.length && shared < b.path.length
    && a.path[shared].anchorId === b.path[shared].anchorId) shared++;
  const homeGraphId = shared === 0 ? viewGraphId : a.path[shared - 1].graphId;
  // Path steps name anchors by view id; a via holds stored ids.
  return {
    homeGraphId,
    viaA: a.path.slice(shared).map(step => storedIdOf(step.anchorId)),
    viaB: b.path.slice(shared).map(step => storedIdOf(step.anchorId)),
  };
};

/**
 * Why a node seen in `viewGraphId` (by its view id) can't open definition
 * `definitionIndex` in place, or null when it can (a definition not made yet
 * always can). 'inside': the node sits in that definition, so it would open
 * inside itself. A definition open in another box here doesn't block it.
 *
 * @returns {'inside'|null}
 */
export const openInPlaceBlock = (graphs, nodePrototypes, viewGraphId, instanceId, definitionIndex = 0, map = null) => {
  const own = graphs?.get(viewGraphId)?.instances?.get(instanceId);
  const owner = own
    ? { graphId: viewGraphId, path: [], instanceId }
    : (map || mapOpenDefinitions(graphs, nodePrototypes, viewGraphId)).owners.get(instanceId);
  if (!owner) return null;
  const instance = own || graphs.get(owner.graphId)?.instances?.get(owner.instanceId);
  const defGraphId = nodePrototypes?.get(instance?.prototypeId)?.definitionGraphIds?.[definitionIndex];
  if (!defGraphId || !graphs.has(defGraphId)) return null;
  if ([viewGraphId, ...owner.path.map(step => step.graphId)].includes(defGraphId)) return 'inside';
  return null;
};

// ─── The view ─────────────────────────────────────────────────────────────────

// instance object → view id → { ox, oy, flags, value }: an instance drawn at the
// same offset with the same flags keeps its projected object, so memoized nodes
// don't re-render. Keyed by view id too, since a repeated box draws it again.
const projectedInstances = new WeakMap();
// `viewId`: set for an instance in a repeated box, null for one under its own id.
const projectInstance = (instance, offset, anchorGroupId, viewId = null) => {
  const ox = offset?.x ?? 0;
  const oy = offset?.y ?? 0;
  if (ox === 0 && oy === 0 && !anchorGroupId && !viewId) return instance;
  let byView = projectedInstances.get(instance);
  if (!byView) { byView = new Map(); projectedInstances.set(instance, byView); }
  const cached = byView.get(viewId || '');
  if (cached && cached.ox === ox && cached.oy === oy && cached.anchorGroupId === anchorGroupId) return cached.value;
  const value = {
    ...instance,
    ...(viewId ? { id: viewId } : {}),
    x: (instance.x ?? 0) + ox,
    y: (instance.y ?? 0) + oy,
    ...(anchorGroupId ? { isGroupAnchor: true, anchorForGroupId: anchorGroupId } : {}),
  };
  byView.set(viewId || '', { ox, oy, anchorGroupId, value });
  return value;
};

// edge object → view id → { sourceId, destinationId, value }. `viewId`: set for a
// connection in a repeated box, null for one under its own id.
const displayedEdges = new WeakMap();
const displayEdge = (edge, viewId, sourceId, destinationId) => {
  if (!viewId && sourceId === edge.sourceId && destinationId === edge.destinationId) return edge;
  let byView = displayedEdges.get(edge);
  if (!byView) { byView = new Map(); displayedEdges.set(edge, byView); }
  const cached = byView.get(viewId || '');
  if (cached && cached.sourceId === sourceId && cached.destinationId === destinationId) return cached.value;
  const arrows = edge.directionality?.arrowsToward;
  const arrowList = arrows instanceof Set ? Array.from(arrows) : (Array.isArray(arrows) ? arrows : []);
  const arrowsToward = new Set(arrowList.map(id => (
    id === edge.sourceId ? sourceId : id === edge.destinationId ? destinationId : id
  )));
  const value = {
    ...edge,
    ...(viewId ? { id: viewId } : {}),
    sourceId,
    destinationId,
    directionality: { ...(edge.directionality || {}), arrowsToward },
  };
  byView.set(viewId || '', { sourceId, destinationId, value });
  return value;
};

// group object → scope → value: a group inside a repeated box, under view ids.
const scopedGroups = new WeakMap();
const scopeGroup = (group, groupId, scope) => {
  if (!scope) return group;
  let byScope = scopedGroups.get(group);
  if (!byScope) { byScope = new Map(); scopedGroups.set(group, byScope); }
  let value = byScope.get(scope);
  if (!value) {
    value = {
      ...group,
      id: viewIdOf(scope, groupId),
      memberInstanceIds: (group.memberInstanceIds || []).map(id => viewIdOf(scope, id)),
      ...(group.anchorInstanceId ? { anchorInstanceId: viewIdOf(scope, group.anchorInstanceId) } : {}),
    };
    byScope.set(scope, value);
  }
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
 * The view id a connection end is drawn to: the end itself when it is visible,
 * otherwise the closed box that holds it. Null when neither is on screen. `scope`
 * is the box the connection is drawn in (its own graph's scope), so its ends and
 * via are read from there.
 */
const displayEnd = (instanceId, via, scope, visible, boxes, owners, graphs, nodePrototypes, instancesInView) => {
  const own = viewIdOf(scope, instanceId);
  if (Array.isArray(via) && via.length > 0) {
    // Follow the via box by box: which box it goes through decides which copy of
    // a repeated definition the end is in.
    let at = scope;
    let deepestVisible = null;
    let through = true;
    for (const anchorId of via) {
      const shown = viewIdOf(at, anchorId);
      if (!visible(shown)) { through = false; break; }
      deepestVisible = shown;
      const box = boxes.get(shown);
      if (!box) { through = false; break; } // closed: everything below is hidden inside it
      at = box.scope;
    }
    const end = through ? viewIdOf(at, instanceId) : null;
    if (end && visible(end)) return end;
    // Drawn to the closed box on its way, unless the end sits in the web itself
    // (a via left over from before it moved out).
    if (deepestVisible && !(visible(own) && !owners.has(own))) return deepestVisible;
  }
  if (visible(own)) return own;
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
    ...(box.format ? { format: box.format } : {}),
    ...(box.linkedFormat ? { linkedFormat: box.linkedFormat } : {}),
    ...(box.formulaSize ? { formulaSize: box.formulaSize } : {}),
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
 * - `instances`: its own instances, then every open definition's, at view positions,
 *   keyed by view id (a repeated box's carry it as `id` too). An open box's anchor is
 *   flagged `isGroupAnchor` so it hides behind its shell.
 * - `edgeIds`: the connections drawn, by view id: its own plus every open
 *   definition's, less any with an end that is nowhere on screen.
 * - `groups`: its own groups, every open definition's (by view id), and one group
 *   per open box (`isOpenDefinition: true`, id from `openGroupId`).
 * - `openView`: `{ boxes, owners, edges }`. `edges` maps a connection's view id to
 *   the version drawn in this view when an end is hidden inside a closed box or the
 *   connection is in a repeated box (ends, arrows and `id` as view ids).
 */
export const projectGraphView = (state, viewGraphId) => {
  const { graphs, nodePrototypes, edges } = state || {};
  // Called from store selectors on every write, so an unchanged state answers
  // without walking anything.
  const last = lastProjection.get(viewGraphId);
  if (last && last.graphs === graphs && last.nodePrototypes === nodePrototypes && last.edges === edges) {
    return last.result;
  }
  const result = buildGraphView(graphs, nodePrototypes, edges, viewGraphId);
  lastProjection.set(viewGraphId, { graphs, nodePrototypes, edges, result });
  return result;
};

// viewGraphId → the inputs and result of the last projection.
const lastProjection = new Map();

/**
 * projectGraphView for a state that isn't the store's (the wizard's snapshot,
 * read as the store's shape): worked out fresh, and nothing cached, so the
 * canvas's own projections stay as they were.
 */
export const projectGraphViewOf = (state, viewGraphId) => {
  const { graphs, nodePrototypes, edges } = state || {};
  return buildGraphView(graphs, nodePrototypes, edges, viewGraphId, null);
};

const buildGraphView = (graphs, nodePrototypes, edgesMap, viewGraphId, cache = viewCache) => {
  const raw = graphs?.get(viewGraphId);
  if (!raw?.instances) return raw;
  const { boxes, owners } = mapOpenDefinitions(graphs, nodePrototypes, viewGraphId);

  const reachesInside = (edgeId) => {
    const edge = edgesMap?.get(edgeId);
    return !!edge && (!raw.instances.has(edge.sourceId) || !raw.instances.has(edge.destinationId));
  };
  if (boxes.size === 0 && !(raw.edgeIds || []).some(reachesInside)) {
    cache?.delete(viewGraphId);
    return raw;
  }

  const deps = [raw, nodePrototypes, edgesMap];
  boxes.forEach(box => deps.push(graphs.get(box.defGraphId)));
  const cached = cache?.get(viewGraphId);
  if (cached && cached.deps.length === deps.length && cached.deps.every((d, i) => d === deps[i])) {
    return cached.view;
  }

  const instances = new Map();
  raw.instances.forEach((instance, id) => {
    instances.set(id, projectInstance(instance, ZERO, boxes.has(id) ? openGroupId(id) : null));
  });
  // [edgeId, scope]: each connection with the scope of the box it is drawn in.
  const edgeEntries = (raw.edgeIds || []).map(edgeId => [edgeId, '']);
  const groups = new Map(raw.groups || []);
  const membersByBox = new Map();
  boxes.forEach((box) => membersByBox.set(box.anchorId, []));

  boxes.forEach((box) => {
    const defGraph = graphs.get(box.defGraphId);
    defGraph.instances.forEach((instance, id) => {
      const viewId = viewIdOf(box.scope, id);
      instances.set(viewId, projectInstance(instance, box.offset, boxes.has(viewId) ? openGroupId(viewId) : null, box.scope ? viewId : null));
    });
    (defGraph.edgeIds || []).forEach(edgeId => edgeEntries.push([edgeId, box.scope]));
    defGraph.groups?.forEach((group, groupId) => {
      const shown = scopeGroup(group, groupId, box.scope);
      groups.set(viewIdOf(box.scope, groupId), shown);
    });
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
  for (const [edgeId, scope] of edgeEntries) {
    const edge = edgesMap?.get(edgeId);
    if (!edge) continue;
    const sourceId = displayEnd(edge.sourceId, edge.sourceVia, scope, visible, boxes, owners, graphs, nodePrototypes, instancesInView);
    const destinationId = displayEnd(edge.destinationId, edge.destinationVia, scope, visible, boxes, owners, graphs, nodePrototypes, instancesInView);
    if (!sourceId || !destinationId) continue;
    if (sourceId === destinationId && edge.sourceId !== edge.destinationId) continue; // folded into one box
    const viewEdgeId = viewIdOf(scope, edgeId);
    const shown = displayEdge(edge, scope ? viewEdgeId : null, sourceId, destinationId);
    if (shown !== edge) shownEdges.set(viewEdgeId, shown);
    shownEdgeIds.push(viewEdgeId);
  }

  const view = {
    ...raw,
    instances,
    edgeIds: shownEdgeIds,
    groups,
    openView: { boxes, owners, edges: shownEdges },
  };
  cache?.set(viewGraphId, { deps, view });
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

// ─── For the canvas ───────────────────────────────────────────────────────────

/**
 * The other copies of instances being dragged in a view: an instance moved within
 * its definition is moved in every box that shows that definition, so a drag
 * carries its copies along (view ids). None for an instance whose whole box moves
 * with it (then the box moves, not the definition), or one outside any box.
 *
 * @param {Object} view - projectGraphView's result.
 * @param {Iterable<string>} ids - View ids being dragged.
 * @returns {string[]}
 */
export const dragCopiesOf = (view, ids) => {
  const owners = view?.openView?.owners;
  if (!owners || owners.size === 0) return [];
  const moving = new Set(ids);
  const insideBox = new Map();
  owners.forEach((owner, id) => owner.path.forEach((step) => {
    if (!insideBox.has(step.anchorId)) insideBox.set(step.anchorId, []);
    insideBox.get(step.anchorId).push(id);
  }));
  const stored = new Set();
  moving.forEach((id) => {
    const owner = owners.get(id);
    if (!owner) return;
    const boxId = owner.path[owner.path.length - 1].anchorId;
    if ((insideBox.get(boxId) || []).every(m => moving.has(m))) return;
    stored.add(owner.instanceId);
  });
  if (stored.size === 0) return [];
  const copies = [];
  owners.forEach((owner, id) => { if (stored.has(owner.instanceId) && !moving.has(id)) copies.push(id); });
  return copies;
};

/**
 * A read-only graphs Map whose `get` returns each graph as viewed, with its open
 * definitions projected in. Iteration yields the raw graphs. Reads the state on
 * every call, like createLiveMapView, so callbacks never hold a stale graph.
 *
 * @param {() => {graphs: Map, nodePrototypes: Map, edges: Map}} getState
 */
export const createGraphViewMap = (getState) => ({
  get: (key) => projectGraphView(getState(), key),
  has: (key) => getState().graphs.has(key),
  get size() { return getState().graphs.size; },
  forEach: (fn, thisArg) => getState().graphs.forEach(fn, thisArg),
  keys: () => getState().graphs.keys(),
  values: () => getState().graphs.values(),
  entries: () => getState().graphs.entries(),
  [Symbol.iterator]: () => getState().graphs[Symbol.iterator](),
});

// edges Map → { overrides, result }
const viewEdgesCache = new WeakMap();

/**
 * The edges Map as the canvas should read it while viewing `viewGraphId`: the raw
 * Map itself, except that a connection reaching into a closed box names the box as
 * its end. The same Map comes back until the edges or the view change, so it is
 * safe to return from a store selector.
 */
export const viewEdges = (state, viewGraphId) => {
  const edges = state?.edges;
  if (!edges) return edges;
  const overrides = projectGraphView(state, viewGraphId)?.openView?.edges;
  if (!overrides || overrides.size === 0) return edges;
  const cached = viewEdgesCache.get(edges);
  if (cached && cached.overrides === overrides) return cached.result;
  const result = new Map(edges);
  overrides.forEach((edge, edgeId) => result.set(edgeId, edge));
  viewEdgesCache.set(edges, { overrides, result });
  return result;
};

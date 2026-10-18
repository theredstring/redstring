/**
 * Formats: other ways a piece of a web can be shown. The formula is the first.
 *
 * A candidate is a piece of the web in view that reads as a format: the
 * selection, a group, or the whole web. Nothing about it is saved; it is
 * worked out from the web each time, so a format can never disagree with the
 * Things and connections it shows.
 */
import { projectGraphView } from '../../../core/openDefinitions.js';
import { readFormula, formulaToText } from './formula/formulaNotation.js';

const MAX_WEB_FORMULA = 200;

/** What a connection's name says, for reading which side an operand is on. */
function connectionRole(edge, state) {
  const defId = edge.definitionNodeIds?.[0];
  if (defId) return state.nodePrototypes.get(defId)?.name || '';
  if (edge.name) return edge.name;
  if (edge.typeNodeId && edge.typeNodeId !== 'base-connection-prototype') {
    return state.edgePrototypes?.get(edge.typeNodeId)?.name || '';
  }
  return '';
}

/** The nodes and connections among `instanceIds`, in the shape readFormula takes. */
export function sliceOfView(state, view, instanceIds) {
  const ids = new Set(instanceIds);
  const nodes = [];
  for (const id of ids) {
    const inst = view.instances.get(id);
    if (!inst) return null;
    const proto = state.nodePrototypes.get(inst.prototypeId);
    if (!proto) return null;
    const typeName = proto.typeNodeId ? state.nodePrototypes.get(proto.typeNodeId)?.name : undefined;
    nodes.push({ id, name: proto.name, x: inst.x, y: inst.y, typeName });
  }
  const edges = [];
  for (const edgeId of view.edgeIds || []) {
    const stored = state.edges.get(edgeId);
    const edge = view.openView?.edges?.get(edgeId) || stored;
    if (!edge || !ids.has(edge.sourceId) || !ids.has(edge.destinationId)) continue;
    edges.push({
      id: edgeId,
      sourceId: edge.sourceId,
      destinationId: edge.destinationId,
      arrowsToward: edge.directionality?.arrowsToward || [],
      role: connectionRole(edge, state),
    });
  }
  return { nodes, edges };
}

function formulaCandidate(state, view, graphId, source, sourceId, label, instanceIds) {
  if (instanceIds.length < 3) return null;
  const slice = sliceOfView(state, view, instanceIds);
  if (!slice) return null;
  const tree = readFormula(slice);
  if (!tree) return null;
  const text = formulaToText(tree);
  return {
    // Dismissals are kept by this key, so changing the formula asks again.
    key: `formula|${graphId}|${source}:${sourceId}|${text}`,
    format: 'formula',
    graphId,
    source,
    sourceId,
    label,
    instanceIds,
    tree,
    text,
  };
}

/**
 * The format to offer for what is in front of the user, or null.
 * Order: the selection, then the selected group, then any group, then the web.
 */
export function findFormatCandidate(state, { selectedInstanceIds, selectedGroupId, dismissed }) {
  const graphId = state.activeGraphId;
  if (!graphId) return null;
  const view = projectGraphView(state, graphId);
  if (!view?.instances || view.instances.size === 0) return null;
  const graphName = state.graphs.get(graphId)?.name || 'Web';
  // Things already shown as a format aren't offered again.
  const shownIds = new Set();
  view.groups?.forEach(g => { if (g.format) (g.memberInstanceIds || []).forEach(id => shownIds.add(id)); });
  const open = (c) => (c && !dismissed?.has(c.key) && !c.instanceIds.every(id => shownIds.has(id)) ? c : null);

  if (selectedInstanceIds && selectedInstanceIds.size >= 3) {
    // A selection is a deliberate ask: it is the only thing offered while it stands.
    return open(formulaCandidate(state, view, graphId, 'selection', 'selection', 'Selection', [...selectedInstanceIds]));
  }

  const groups = view.groups ? [...view.groups.values()] : [];
  const fromGroup = (g) => formulaCandidate(state, view, graphId, 'group', g.id, g.name || 'Group', g.memberInstanceIds || []);
  if (selectedGroupId && view.groups?.has(selectedGroupId)) {
    const c = open(fromGroup(view.groups.get(selectedGroupId)));
    if (c) return c;
  }
  for (const g of groups) {
    const c = open(fromGroup(g));
    if (c) return c;
  }

  // The whole web, when it is one formula and small enough to be one. A tree has
  // one connection fewer than it has Things, which turns most webs away at once.
  if (view.instances.size > MAX_WEB_FORMULA || (view.edgeIds || []).length !== view.instances.size - 1) return null;
  const everyThing = [];
  view.instances.forEach((inst, id) => { if (!inst.isGroupAnchor) everyThing.push(id); });
  return open(formulaCandidate(state, view, graphId, 'web', graphId, graphName, everyThing));
}

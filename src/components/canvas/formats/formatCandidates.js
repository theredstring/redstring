/**
 * Formats: other ways a piece of a web can be shown. The formula is the first.
 *
 * A candidate is a piece of the web in view that reads as a format: the
 * selection, a group, or the whole web. It is worked out from the web each
 * time, so a format can never disagree with the Things and connections it shows.
 */
import { projectGraphView } from '../../../core/openDefinitions.js';
import { isGroupInsideGroup } from '../../../services/groupLayout.js';
import { readFormulaGroup, chainText, operationOf } from './formula/formulaChain.js';

const MAX_WEB_FORMULA = 200;

function formulaCandidate(state, view, graphId, source, sourceId, label, container) {
  const instanceIds = (container.memberInstanceIds || []).filter(id => view.instances.has(id));
  if (instanceIds.length < 2) return null;
  const chain = readFormulaGroup(state, view, container);
  if (!chain) return null;
  const text = chainText(chain);
  return {
    // Dismissals are kept by this key, so changing the formula asks again.
    key: `formula|${graphId}|${source}:${sourceId}|${text}`,
    format: 'formula',
    graphId,
    source,
    sourceId,
    label,
    instanceIds,
    chain,
    text,
  };
}

/**
 * Whether a Thing-group is a part of a larger formula, not a formula of its own:
 * an operation joins its Thing to something outside it.
 */
function isPartOf(state, view, g) {
  if (!g?.anchorInstanceId) return false;
  const members = new Set(g.memberInstanceIds || []);
  return (view.edgeIds || []).some((edgeId) => {
    const e = view.openView?.edges?.get(edgeId) || state.edges.get(edgeId);
    if (!e || (e.sourceId !== g.anchorInstanceId && e.destinationId !== g.anchorInstanceId)) return false;
    const other = e.sourceId === g.anchorInstanceId ? e.destinationId : e.sourceId;
    return !members.has(other) && !!operationOf(e, state);
  });
}

/**
 * Whether a group is an equation, shown as a formula or not: shown as one, or
 * linked to one while shown as its Things, or a Thing-group (or a Thing opened
 * in place) that reads as a whole formula (an equation is its Thing).
 */
function isEquationGroup(state, view, g) {
  if (g.format || g.linkedFormat) return true;
  return !!g.linkedNodePrototypeId && !isPartOf(state, view, g) && !!readFormulaGroup(state, view, g);
}

/** Whether a web is the definition of an equation's Thing (its formula, as Things). */
function definesEquation(state, graphId) {
  const defines = state.graphs.get(graphId)?.definingNodeIds;
  if (!defines?.length) return false;
  for (const [otherId, other] of state.graphs) {
    // A node folded from an equation keeps how it was shown (graphStore.moveFormat).
    for (const inst of other.instances?.values() || []) {
      if ((inst.format || inst.linkedFormat) && defines.includes(inst.prototypeId)) return true;
    }
    for (const g of other.groups?.values() || []) {
      if (!defines.includes(g.linkedNodePrototypeId)) continue;
      if (g.format || g.linkedFormat) return true;
      const view = projectGraphView(state, otherId);
      const projected = view?.groups?.get(g.id);
      if (projected && isEquationGroup(state, view, projected)) return true;
    }
  }
  return false;
}

/**
 * The format to offer for what is in front of the user, or null.
 * Order: the selection, then the selected group, then any group (outermost
 * first, since a formula's parts are groups too), then the web.
 */
export function findFormatCandidate(state, { selectedInstanceIds, selectedGroupId, dismissed }) {
  const graphId = state.activeGraphId;
  if (!graphId) return null;
  const view = projectGraphView(state, graphId);
  if (!view?.instances || view.instances.size === 0) return null;
  const graphName = state.graphs.get(graphId)?.name || 'Web';
  // An equation's Things aren't offered as one again: its own panel switches
  // it. Nor is the web that defines an equation's Thing, as a whole.
  const shownIds = new Set();
  view.groups?.forEach(g => { if (isEquationGroup(state, view, g)) (g.memberInstanceIds || []).forEach(id => shownIds.add(id)); });
  const definition = definesEquation(state, graphId);
  const whole = (c) => definition && c.instanceIds.length >= view.instances.size;
  const open = (c) => (c && !dismissed?.has(c.key) && !c.instanceIds.every(id => shownIds.has(id)) && !whole(c) ? c : null);

  if (selectedInstanceIds && selectedInstanceIds.size >= 2) {
    // A selection is a deliberate ask: it is the only thing offered while it stands.
    return open(formulaCandidate(state, view, graphId, 'selection', 'selection', 'Selection',
      { id: '__selection__', memberInstanceIds: [...selectedInstanceIds] }));
  }

  const isPart = (g) => isPartOf(state, view, g);
  const groups = view.groups ? [...view.groups.values()].filter(g => !g.isOpenDefinition && !isPart(g)) : [];
  const fromGroup = (g) => formulaCandidate(state, view, graphId, 'group', g.id, g.name || 'Group', g);
  if (selectedGroupId && view.groups?.has(selectedGroupId)) {
    const c = open(fromGroup(view.groups.get(selectedGroupId)));
    if (c) return c;
  }
  const outermostFirst = groups
    .filter(g => !groups.some(o => o !== g && isGroupInsideGroup(g, o)))
    .sort((a, b) => (b.memberInstanceIds?.length || 0) - (a.memberInstanceIds?.length || 0));
  for (const g of outermostFirst) {
    const c = open(fromGroup(g));
    if (c) return c;
  }

  // The whole web, when it is one formula and small enough to be one.
  if (view.instances.size > MAX_WEB_FORMULA) return null;
  const everyThing = [];
  view.instances.forEach((inst, id) => everyThing.push(id));
  return open(formulaCandidate(state, view, graphId, 'web', graphId, graphName,
    { id: '__web__', memberInstanceIds: everyThing }));
}

/**
 * The formula a group reads as, or null: what the group control panel's format
 * mode swaps to. A Thing opened in place reads as its definition does.
 */
export function readGroupFormula(state, graphId, groupId) {
  if (!graphId || !groupId) return null;
  const view = projectGraphView(state, graphId);
  const group = view?.groups?.get(groupId);
  if (!group) return null;
  return readFormulaGroup(state, view, group);
}

/** Whether a group of the web is a part inside a larger formula (its parentheses), not one of its own. */
export function isFormulaPart(state, graphId, groupId) {
  if (!graphId || !groupId) return false;
  const view = projectGraphView(state, graphId);
  return isPartOf(state, view, view?.groups?.get(groupId));
}

/**
 * Upgrade: an equation's definition gets its parentheses back.
 *
 * A formula's parentheses are Thing-groups inside the equation's. Making a
 * group into a Thing-group used to copy only its Things and connections into
 * the new definition, never the groups inside it, so an equation with
 * parentheses was defined as each part's Thing sitting beside its own parts.
 * That definition no longer reads as the formula, and opening the equation
 * showed loose Things.
 *
 * Each part's Thing has the part's contents as its own definition, copied from
 * the same Things at the same places. So a lost part is found by laying the
 * part's definition over the web: the same Things, at the same places (or all
 * moved together). A web is only changed when it reads as one whole formula
 * with its parts back and didn't before, so nothing that isn't an equation is
 * touched. Run on load (graphStore.loadUniverseFromFile).
 */
import { readFormulaGroup } from './formulaChain.js';

const MAX_WEB = 200;  // as formatCandidates' MAX_WEB_FORMULA: past this it isn't one formula
const TOLERANCE = 1;  // canvas units: copies sit exactly where their originals did

/** Where `want`'s Things are in `pool`, all moved by (dx, dy): their ids, or null. */
function placedAt(want, pool, dx, dy) {
  const used = new Set();
  for (const d of want) {
    const hit = pool.find(i => !used.has(i.id) && i.prototypeId === d.prototypeId
      && Math.abs((i.x ?? 0) - (d.x ?? 0) - dx) <= TOLERANCE
      && Math.abs((i.y ?? 0) - (d.y ?? 0) - dy) <= TOLERANCE);
    if (!hit) return null;
    used.add(hit.id);
  }
  return [...used];
}

/** The instances of `pool` that are `definition`'s contents: in place, else moved together if only one way fits. */
function findContents(definition, pool) {
  const want = [...definition.instances.values()];
  const inPlace = placedAt(want, pool, 0, 0);
  if (inPlace) return inPlace;
  const first = want[0];
  const fits = [];
  for (const i of pool) {
    if (i.prototypeId !== first.prototypeId) continue;
    const ids = placedAt(want, pool, (i.x ?? 0) - (first.x ?? 0), (i.y ?? 0) - (first.y ?? 0));
    if (ids) fits.push(ids);
    if (fits.length > 1) return null;
  }
  return fits[0] || null;
}

const wholeWeb = (instances) => ({ id: '__web__', memberInstanceIds: [...instances.keys()] });

/** The parts a definition web lost, as groups, when putting them back makes it read as one formula; else null. */
function lostParts(state, graphId, graph) {
  const anchored = new Set();
  graph.groups?.forEach(g => { if (g.anchorInstanceId) anchored.add(g.anchorInstanceId); });
  const candidates = [];
  graph.instances.forEach((inst) => {
    if (inst.isGroupAnchor || inst.openDefinition || anchored.has(inst.id)) return;
    const defIds = state.nodePrototypes.get(inst.prototypeId)?.definitionGraphIds;
    if (Array.isArray(defIds) && defIds.length > 0) candidates.push(inst);
  });
  if (candidates.length === 0) return null;
  if (readFormulaGroup(state, graph, wholeWeb(graph.instances))) return null; // reads already

  const pool = [...graph.instances.values()];
  const groups = new Map(graph.groups || []);
  const instances = new Map(graph.instances);
  for (const inst of candidates) {
    const prototype = state.nodePrototypes.get(inst.prototypeId);
    prototype.definitionGraphIds.some((defGraphId, index) => {
      const definition = state.graphs.get(defGraphId);
      if (!definition?.instances?.size || defGraphId === graphId) return false;
      const memberIds = findContents(definition, pool.filter(i => i.id !== inst.id));
      if (!memberIds) return false;
      const groupId = `part-${inst.id}`;
      groups.set(groupId, {
        id: groupId,
        name: prototype.name || 'Untitled',
        color: prototype.color,
        memberInstanceIds: memberIds,
        linkedNodePrototypeId: prototype.id,
        linkedDefinitionIndex: index,
        hasCustomLayout: false,
        anchorInstanceId: inst.id,
        semanticMetadata: {
          type: 'Group',
          relationships: memberIds.map(memberId => ({ predicate: 'memberOf', subject: memberId, object: groupId, source: 'redstring-grouping' })),
        },
      });
      instances.set(inst.id, { ...inst, isGroupAnchor: true, anchorForGroupId: groupId });
      return true;
    });
  }
  if (groups.size === (graph.groups?.size || 0)) return null;
  const upgraded = { ...graph, instances, groups };
  return readFormulaGroup(state, upgraded, wholeWeb(instances)) ? upgraded : null;
}

/**
 * Puts the lost parts back into every equation's definition: each web upgraded
 * is replaced in `state.graphs` (a deserialized store state) by a new one.
 *
 * @returns {number} How many webs were upgraded.
 */
export function restoreFormulaParts(state) {
  if (!(state?.graphs instanceof Map) || !(state.nodePrototypes instanceof Map)) return 0;
  let upgradedCount = 0;
  for (const [graphId, graph] of state.graphs) {
    if (!graph?.definingNodeIds?.length || !(graph.instances instanceof Map)) continue;
    if (graph.instances.size < 2 || graph.instances.size > MAX_WEB) continue;
    try {
      const upgraded = lostParts(state, graphId, graph);
      if (!upgraded) continue;
      state.graphs.set(graphId, upgraded);
      upgradedCount++;
    } catch (error) {
      console.warn(`[restoreFormulaParts] Left web ${graphId} as it was:`, error);
    }
  }
  return upgradedCount;
}

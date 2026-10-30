/**
 * The current web the user switched off as context (its chip in the wizard).
 *
 * Off means "don't use this web", not "you are nowhere": the wizard is still
 * told which web is on screen, only not what is in it. And because every
 * build tool falls back to the active web when it gets no targetGraphId, a
 * wizard that didn't know where it was dumped a new subject into that web.
 * So an add with no target that would land there is refused, and the refusal
 * says how to do it on purpose.
 */

/**
 * @param {Object} graphState
 * @param {Array} contextItems - the chips, each { type, id, enabled }
 * @returns {string|null} the id of the switched-off web, or null when its chip is on
 */
export function switchedOffWebId(graphState, contextItems = []) {
  const item = (contextItems || []).find(i => i?.type === 'activeGraph');
  if (!item || item.enabled !== false) return null;
  return item.id || graphState?.activeGraphId || null;
}

/**
 * Tools that add to a web, falling back to the active web when no
 * targetGraphId is given. createPopulatedGraph is not here: without a target
 * it makes a web of its own, which is the way out.
 */
export const ADDS_TO_A_WEB = new Set([
  'createNode',
  'createEdge',
  'createGroup',
  'expandGraph',
  'buildComposition',
  'addFormula',
  'formula',
  'importKnowledgeCluster',
  'materializeSemanticEntities',
  'mergeGraphs'
]);

/**
 * @returns {Object|null} a refusal when this call would add to the
 *   switched-off web by default, else null
 */
export function switchedOffWebRefusal(toolName, args, graphState, offWebId) {
  if (!offWebId || !ADDS_TO_A_WEB.has(toolName)) return null;
  const target = args?.targetGraphId;
  if (target != null && String(target).trim() !== '') return null;
  if (graphState?.activeGraphId !== offWebId) return null;
  const name = (graphState.graphs || []).find(g => g?.id === offWebId)?.name || 'the current web';
  return {
    locked: true,
    message: `Nothing was added. "${name}" is switched off as context, and with no targetGraphId this would have gone into it. Start a web of its own with createPopulatedGraph. Add to "${name}" only if the user asked for that, passing targetGraphId="${offWebId}".`
  };
}

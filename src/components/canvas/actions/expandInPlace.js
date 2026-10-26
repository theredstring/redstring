/**
 * Expanding a node in place ("Decompose"), shared by the pie menu and the node
 * control panel.
 *
 * The node opens onto its definition itself: what is built inside is the
 * definition, shown the same everywhere (see src/core/openDefinitions.js). It is
 * never copied into a node-group.
 *
 * Either way the node morphs into the box (groups/boxMorph.js). A node that was
 * a formula opens back into the formula, which grows out of it on its own
 * (formats/formula/formulaSpawn.js).
 *
 * A definition can open in any number of nodes in one web, but never inside
 * itself (src/core/openDefinitions.js); the buttons that offer it grey out then,
 * saying why (expandBlockLabel).
 */
import useGraphStore from '../../../store/graphStore.js';
import { projectGraphView, openInPlaceBlock } from '../../../core/openDefinitions.js';
import { withBoxOpenMorph } from '../groups/boxMorph.js';
import { opensAsFormula, withFormulaOpenMorph } from '../formats/formula/formulaSpawn.js';
import { requestOpenedBoxFrame } from '../groups/openedBoxFrame.js';
import { openBoxOffset } from '../groups/openPlacement.js';

/**
 * @returns {Object|null} The group now shown for the expanded node (as viewed), or null.
 */
export function expandNodeInPlace({ viewGraphId, definitionIndex = 0, instanceId }) {
  const store = useGraphStore.getState();
  if (expandBlockLabel({ viewGraphId, instanceId, definitionIndex })) return null;

  const asFormula = opensAsFormula(viewGraphId, instanceId);
  const withMorph = asFormula ? withFormulaOpenMorph : withBoxOpenMorph;
  // The box opens centred on the node, or at the nearest spot where it fits.
  const offset = asFormula ? null : openBoxOffset({ viewGraphId, instanceId, definitionIndex });
  const groupId = withMorph({ viewGraphId, instanceId },
    () => store.openDefinitionInPlace(viewGraphId, instanceId, definitionIndex, {}, offset));
  if (!groupId) return null;
  // Framed once it has opened: by its title and menu if it is selected, else whole
  // (groups/openedBoxFrame.js). Selecting it after doesn't frame it again.
  requestOpenedBoxFrame(groupId);
  return projectGraphView(useGraphStore.getState(), viewGraphId)?.groups?.get(groupId) || null;
}

const BLOCK_LABELS = {
  inside: "Can't Open Inside Itself",
};

/**
 * What a greyed-out Decompose says instead of its name, or null when the node
 * can expand.
 */
export function expandBlockLabel({ viewGraphId, instanceId, definitionIndex = 0 }) {
  const { graphs, nodePrototypes } = useGraphStore.getState();
  return BLOCK_LABELS[openInPlaceBlock(graphs, nodePrototypes, viewGraphId, instanceId, definitionIndex)] || null;
}

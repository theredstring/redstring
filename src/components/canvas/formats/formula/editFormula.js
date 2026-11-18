/**
 * Edit Formula: an equation shown as its formula, written over from the New
 * Formula box opened on it as it was just before it was made, its text typed
 * and its name in the Name field (FormulaComposer). Saved, it is rewritten in
 * place (rewriteFormulaForWizard: the same equation, its connections from
 * outside, one undo step). A letter tied to a Thing (the Symbols card) stays
 * tied wherever the new text still has it; a loose letter left unused goes.
 * Opened in place, it is put back where it stood.
 */
import useGraphStore from '../../../../store/graphStore.js';
import { projectGraphView, anchorIdFromOpenGroupId } from '../../../../core/openDefinitions.js';
import { formulaCentreOf } from './formulaObjects.js';
import { readFormulaGroup, chainText, chainFromText } from './formulaChain.js';
import { symbolsOf } from './formulaEquations.js';
import { rewriteFormulaForWizard } from './formulaWizard.js';
import { inUse } from './tieSymbol.js';

const compact = (t) => String(t || '').replace(/\s+/g, '');

/**
 * What Edit Formula opens on: { groupId, equationProtoId, text, title }, the
 * title '' when the equation is named by its text. Null unless the group is
 * shown as a formula in the web.
 */
export function formulaEditOf(state, graphId, groupId) {
  const view = graphId ? projectGraphView(state, graphId) : null;
  const group = view?.groups?.get(groupId);
  if (!group || group.format !== 'formula') return null;
  const chain = readFormulaGroup(state, view, group);
  if (!chain) return null;
  const text = chainText(chain);
  const equationProtoId = group.linkedNodePrototypeId || null;
  const name = (equationProtoId && state.nodePrototypes.get(equationProtoId)?.name) || group.name || '';
  return { groupId, equationProtoId, text, title: name && compact(name) !== compact(text) ? name : '' };
}

/**
 * Write the equation `edit` over with `text`, named `title` (by its new text
 * when that is empty).
 */
export function saveFormulaEdit(graphId, edit, text, title, readOptions) {
  const store = useGraphStore.getState();
  const keep = {};
  const loose = [];
  for (const row of edit.equationProtoId ? symbolsOf(store, edit.equationProtoId) : []) {
    if (row.bare) loose.push(row.protoId);
    else keep[row.symbol] = { protoId: row.protoId, label: row.symbol };
  }
  const name = String(title || '').trim() || chainText(chainFromText(text, readOptions));
  // Opened in place, the rewrite closes it and opens it again, somewhere else:
  // where it stood, and the other places it is open, are kept to put it back.
  const opened = !!anchorIdFromOpenGroupId(edit.groupId);
  const before = opened ? formulaCentreOf(store, graphId, edit.groupId) : null;
  const others = new Set(opened ? openGroupsOf(store, graphId, edit.equationProtoId) : []);
  others.delete(edit.groupId);
  store.withHistoryTransaction(`Edited ${name}`, () => {
    rewriteFormulaForWizard({ graphId, ref: edit.groupId, text, title: name, convention: readOptions.convention, keep });
    const st = useGraphStore.getState();
    for (const protoId of loose) if (st.nodePrototypes.has(protoId) && !inUse(useGraphStore.getState(), protoId)) st.deleteNodePrototype(protoId);
    if (before) putBack(graphId, edit.equationProtoId, others, before);
  });
}

/** The groups the equation is open as in the web. */
function openGroupsOf(state, graphId, equationProtoId) {
  const ids = [];
  projectGraphView(state, graphId)?.groups?.forEach((g) => {
    if (g.linkedNodePrototypeId === equationProtoId && g.format === 'formula' && anchorIdFromOpenGroupId(g.id)) ids.push(g.id);
  });
  return ids;
}

/** Move the equation opened again (not one of `others`) so its formula is centred on `at` again. */
function putBack(graphId, equationProtoId, others, at) {
  const st = useGraphStore.getState();
  const groupId = openGroupsOf(st, graphId, equationProtoId).find(id => !others.has(id));
  const now = groupId ? formulaCentreOf(st, graphId, groupId) : null;
  if (!now) return;
  const dx = at.x - now.x;
  const dy = at.y - now.y;
  if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
  st.updateNodeInstance(graphId, anchorIdFromOpenGroupId(groupId), (inst) => {
    const offset = inst.openDefinition?.offset || { x: 0, y: 0 };
    inst.openDefinition = { ...(inst.openDefinition || {}), offset: { x: offset.x + dx, y: offset.y + dy } };
    inst.x = (inst.x ?? 0) + dx;
    inst.y = (inst.y ?? 0) + dy;
  }, { finalize: true });
}

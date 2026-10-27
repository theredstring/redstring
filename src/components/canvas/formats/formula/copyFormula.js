/**
 * Copy a formula (the formula pie's and panel's Copy, and Cmd/Ctrl+C with one
 * selected): its text to the system clipboard, for other apps, and the
 * formula itself to the canvas clipboard, for Paste.
 *
 * Opened in place, a formula is its equation's Thing: copied as that Thing,
 * opened as its formula (copySelection keeps how a placement is shown), so a
 * paste is the same equation placed again, not a copy of its definition. In a
 * web where that definition is open already it lands closed, as any second
 * box of one definition does (core/openDefinitions.js). A formula of the
 * web's own Things copies them, its parts and its connections, groups and all.
 */
import useGraphStore from '../../../../store/graphStore.js';
import { anchorIdFromOpenGroupId, projectGraphView } from '../../../../core/openDefinitions.js';
import { copySelection } from '../../../../utils/clipboard.js';
import { copyText } from '../../../../utils/systemClipboard.js';
import { readFormulaGroup, chainText } from './formulaChain.js';
import { isFormulaPart } from '../formatCandidates.js';

const footprintOf = (g) => [...(g.memberInstanceIds || []), ...(g.anchorInstanceId ? [g.anchorInstanceId] : [])];

/**
 * What a formula of the web's own Things is made of: its Things and anchor,
 * and every group inside it (its parts) with theirs.
 */
function formulaContents(view, group) {
  const ids = new Set(footprintOf(group));
  const inside = new Set([group.id]);
  let grew = true;
  while (grew) {
    grew = false;
    view.groups?.forEach((g) => {
      if (inside.has(g.id) || g.isOpenDefinition || !g.memberInstanceIds?.length) return;
      if (!g.memberInstanceIds.every(id => ids.has(id))) return;
      inside.add(g.id);
      if (g.anchorInstanceId) ids.add(g.anchorInstanceId);
      grew = true;
    });
  }
  const groups = [...inside].map(id => view.groups.get(id)).map(g => ({
    id: g.id,
    name: g.name,
    description: g.description || '',
    color: g.color,
    memberInstanceIds: [...(g.memberInstanceIds || [])],
    ...(g.anchorInstanceId ? { anchorInstanceId: g.anchorInstanceId } : {}),
    ...(g.linkedNodePrototypeId ? { linkedNodePrototypeId: g.linkedNodePrototypeId, linkedDefinitionIndex: g.linkedDefinitionIndex } : {}),
    ...(g.format ? { format: g.format } : {}),
    ...(g.linkedFormat ? { linkedFormat: g.linkedFormat } : {}),
    ...(g.formulaSize ? { formulaSize: g.formulaSize } : {}),
  }));
  return { ids, groups };
}

/**
 * @returns {Object|null} the canvas clipboard's payload (copySelection's, with
 *   `kind: 'formula'` and, for a formula of the web's own Things, its `groups`),
 *   or null when the group isn't a formula shown as one.
 */
export function copyFormula(graphId, groupId) {
  const st = useGraphStore.getState();
  const view = projectGraphView(st, graphId);
  const group = view?.groups?.get(groupId);
  if (!group || group.format !== 'formula' || isFormulaPart(st, graphId, groupId)) return null;
  const chain = readFormulaGroup(st, view, group);
  if (!chain) return null;
  copyText(chainText(chain));

  const anchorId = anchorIdFromOpenGroupId(groupId);
  if (anchorId) {
    const clip = copySelection(new Set([anchorId]), view, st.nodePrototypes, st.edges);
    return clip && { ...clip, kind: 'formula' };
  }
  const { ids, groups } = formulaContents(view, group);
  const clip = copySelection(ids, view, st.nodePrototypes, st.edges);
  return clip && { ...clip, kind: 'formula', groups };
}

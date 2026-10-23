/**
 * The group pie's buttons: the menu a selected Thing-group or equation shows
 * above its title, laid out like the connection pie (PieMenu's line mode,
 * always level).
 *
 * The actions are the group control panel's own handlers (ControlPanelsHost
 * builds them), in the panel's order, so the pie and the panel do the same
 * thing. ControlPanelsHost publishes the list here; GroupPieMenuLayer draws it.
 * A plain group (not a Thing-group, not shown as a formula) gets no pie.
 */
import { create } from 'zustand';
import {
  ArrowUpFromDot, Combine, Edit3, NotebookText, Palette, RefreshCw, Save, Shapes, Sigma, SquarePlus, Superscript,
  Trash2, Ungroup, WholeWord,
} from 'lucide-react';

const NO_BUTTONS = Object.freeze([]);

export const useGroupPieStore = create(() => ({ groupId: null, buttons: NO_BUTTONS }));

/** Publish the selected group's buttons (ControlPanelsHost). Equal writes are skipped. */
export function setGroupPieButtons(groupId, buttons) {
  const next = buttons?.length ? buttons : NO_BUTTONS;
  const cur = useGroupPieStore.getState();
  if (cur.groupId === groupId && cur.buttons === next) return;
  useGroupPieStore.setState({ groupId, buttons: next });
}

// A group about to be selected that should not be framed when it is: a box
// that just opened (its opening frames it, groups/boxMorph + camera/framing),
// or an equation whose symbol was tapped (the tap acts on the symbol in place).
let heldFocusId = null;
/** Don't frame `groupId` on its next selection (Zoom on Select). */
export function holdGroupFocus(groupId) { heldFocusId = groupId ?? null; }
/** Whether `groupId`'s selection was held from framing; clears the hold either way. */
export function takeGroupFocusHold(groupId) {
  const held = heldFocusId !== null && heldFocusId === groupId;
  heldFocusId = null;
  return held;
}

/** A screen rect around where a pie button was pressed, for the hurtle into a definition. */
const rectAt = (pos) => (pos ? { left: pos.x - 20, top: pos.y - 20, width: 40, height: 40 } : null);

/**
 * @param {object} ctx
 * @param {'nodegroup'|'format'|'group'} ctx.mode - the group panel's mode
 * @param {object} ctx.group - the selected group, as viewed
 * @param {string} [ctx.formulaText] - set when the group reads as a formula
 * @param {string} ctx.currentFormat - 'things' | 'formula'
 * @param {boolean} ctx.formulaNames - this formula is written by its Things' names
 * @param {boolean} ctx.standardNotation
 * @param {object} ctx.handlers - the panel's handlers
 */
export function buildGroupPieButtons({ mode, group, formulaText, currentFormat, formulaNames, standardNotation, handlers }) {
  if (!group || (mode !== 'nodegroup' && mode !== 'format')) return NO_BUTTONS;
  const isThingGroup = !!group.linkedNodePrototypeId;
  const h = handlers;
  const buttons = [];

  // Formula, or its Things: the panel's ◀ ▶, as one button (there are two formats).
  if (formulaText) {
    buttons.push(currentFormat === 'formula'
      ? { id: 'group-show-things', label: 'Show as Things', icon: Shapes, action: () => h.swapFormat(1) }
      : { id: 'group-show-formula', label: 'Show as Formula', icon: Sigma, action: () => h.swapFormat(1) });
  }

  if (mode === 'nodegroup') {
    buttons.push(
      { id: 'group-open-def', label: 'Open Definition', icon: ArrowUpFromDot, action: (_id, pos) => h.onDiveIntoDefinition(rectAt(pos)) },
      { id: 'group-open-panel', label: 'Open in Panel', icon: NotebookText, action: () => h.onOpenInPanel() },
      { id: 'group-combine', label: 'Combine Into Thing', icon: Combine, action: () => h.onCombine() },
    );
    // A Thing opened in place already is its definition: nothing to save or refresh.
    if (!group.isOpenDefinition) {
      buttons.push(
        { id: 'group-update-def', label: 'Update Definition', icon: Save, action: () => h.onUpdateDefinition() },
        { id: 'group-refresh-def', label: 'Refresh From Definition', icon: RefreshCw, action: () => h.onRefreshFromDefinition() },
      );
    }
    buttons.push(
      { id: 'group-edit', label: 'Edit Name', icon: Edit3, action: () => h.onEdit() },
      { id: 'group-color', label: 'Change Color', icon: Palette, action: (_id, pos) => h.onColor(pos) },
      { id: 'group-ungroup', label: 'Ungroup', icon: Ungroup, action: () => h.onUngroup() },
      { id: 'group-delete', label: 'Delete', icon: Trash2, action: () => h.onDelete() },
    );
    return buttons;
  }

  // The panel's format mode: an equation shown as its formula (or a plain group
  // that reads as one, shown as Things, which has only the swap and the group's own).
  const shownAsFormula = currentFormat === 'formula';
  if (shownAsFormula) {
    buttons.push({
      id: 'group-names',
      label: formulaNames ? 'Show Symbols' : 'Show Names',
      icon: WholeWord,
      action: () => h.setFormulaNames(!formulaNames),
    });
    if (/[×^]/.test(formulaText || '')) {
      buttons.push({
        id: 'group-notation',
        label: standardNotation ? 'Write Every Operation' : 'Standard Notation',
        icon: Superscript,
        action: () => h.setStandardNotation(!standardNotation),
      });
    }
    if (isThingGroup) buttons.push({ id: 'group-combine', label: 'Combine Into Thing', icon: Combine, action: () => h.onCombine() });
  }
  buttons.push(
    { id: 'group-edit', label: 'Edit Name', icon: Edit3, action: () => h.onEdit() },
    { id: 'group-color', label: 'Change Color', icon: Palette, action: (_id, pos) => h.onColor(pos) },
  );
  if (!isThingGroup) buttons.push({ id: 'group-convert', label: 'Convert to Thing-Group', icon: SquarePlus, action: () => h.onConvertToNodeGroup() });
  buttons.push({ id: 'group-ungroup', label: 'Ungroup', icon: Ungroup, action: () => h.onUngroup() });
  if (shownAsFormula) buttons.push({ id: 'group-delete', label: 'Delete', icon: Trash2, action: () => h.onDelete() });
  return buttons;
}

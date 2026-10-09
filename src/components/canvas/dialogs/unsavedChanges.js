/**
 * "Save changes?" With autosave off (Settings → Data, or a universe past
 * Automatic's limits), unsaved changes aren't on their way to the file, so
 * closing the app or switching universes asks first: Save, Don't Save, or
 * Cancel. With autosave on nothing asks; the save that's coming is written
 * on the way out as before (SaveCoordinator.flush).
 *
 * The dialog is UnsavedChangesDialog, mounted by CanvasOverlaysHost.
 */
import saveCoordinator from '../../../services/SaveCoordinator.js';
import { useCanvasDialogStore, setUnsavedChangesDialog } from './canvasDialogs.js';

// Whether the dialog is mounted to answer. If it isn't, asking would wait
// forever (and a close would never finish), so the changes are saved instead.
let dialogMounted = false;
export const setUnsavedChangesDialogMounted = (mounted) => { dialogMounted = mounted; };

/** Leaving now would lose changes: autosave is off and something is unsaved. */
export function hasChangesOnlyASaveKeeps() {
  try {
    return !saveCoordinator.autoSaveActive() && saveCoordinator.hasUnsavedChanges();
  } catch {
    return false;
  }
}

/**
 * Ask. Resolves with the answer.
 * @param {'quit'|'switch'} action
 * @returns {Promise<'save'|'discard'|'cancel'>}
 */
export function askAboutUnsavedChanges(action) {
  if (!dialogMounted) return Promise.resolve('save');
  const open = useCanvasDialogStore.getState().unsavedChangesDialog;
  // Asked again while it's up (a second close): one dialog, one answer for both.
  if (open) return open.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  setUnsavedChangesDialog({ action, resolve, promise });
  return promise;
}

/** The dialog's buttons. */
export function answerUnsavedChanges(choice) {
  const open = useCanvasDialogStore.getState().unsavedChangesDialog;
  setUnsavedChangesDialog(null);
  open?.resolve(choice);
}

/**
 * Before closing or switching: ask if there's anything only a save keeps, and
 * save if that's the answer.
 *
 * @param {'quit'|'switch'} action
 * @returns {Promise<'none'|'saved'|'discard'|'cancel'>} 'none': nothing to
 *   lose (autosave is on, or everything is saved). 'cancel' also when a
 *   chosen save didn't land, so nothing is left behind.
 */
export async function settleUnsavedChanges(action) {
  if (!hasChangesOnlyASaveKeeps()) return 'none';
  const choice = await askAboutUnsavedChanges(action);
  if (choice !== 'save') return choice;
  const saved = await saveCoordinator.saveNow({ terminal: action === 'quit' });
  return saved ? 'saved' : 'cancel';
}

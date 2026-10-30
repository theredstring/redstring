import useGraphStore from '../store/graphStore.js';
import * as fileStorage from '../store/fileStorage.js';
import { askConfirm, showNotice } from '../components/shared/appDialogs.js';

/**
 * The Redstring menu's file actions (P2.06e, with P2.08). They were inline
 * handlers in NodeCanvas's Header JSX; nothing in them needs the canvas.
 */

const hasWork = () => {
  const state = useGraphStore.getState();
  return state.graphs.size > 0 || state.nodePrototypes.size > 0;
};

export async function newUniverse() {
  const store = useGraphStore.getState();
  try {
    const initialData = await fileStorage.createUniverseFile();
    if (initialData !== null) {
      store.loadUniverseFromFile(initialData);
      fileStorage.enableAutoSave(() => useGraphStore.getState());
      store.setUniverseConnected(true);
    }
  } catch (error) {
    store.setUniverseError(`Failed to create universe: ${error.message}`);
  }
}

export async function openUniverse() {
  const store = useGraphStore.getState();
  try {
    if (hasWork()) {
      const confirmed = await askConfirm({
        title: 'Open Another Universe?',
        message: 'It replaces what is open now. Save your work first.',
        confirmLabel: 'Open',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    const loadedData = await fileStorage.openUniverseFile();
    if (loadedData !== null) {
      store.loadUniverseFromFile(loadedData);
      fileStorage.enableAutoSave(() => useGraphStore.getState());
      store.setUniverseConnected(true);
    }
  } catch (error) {
    store.setUniverseError(`Failed to open universe: ${error.message}`);
  }
}

export async function saveUniverse() {
  try {
    if (fileStorage.canAutoSave()) {
      const saveResult = await fileStorage.forceSave(useGraphStore.getState());
      await showNotice(saveResult
        ? { title: 'Universe Saved' }
        : { title: 'Could Not Save', message: 'The universe was not saved.', variant: 'error' });
    } else {
      await showNotice({ title: 'No Universe Open', message: 'Create or open a universe first.' });
    }
  } catch (error) {
    await showNotice({ title: 'Could Not Save', message: 'The universe was not saved.', details: error?.message, variant: 'error' });
  }
}

export async function openRecentUniverse(recentFileEntry) {
  const store = useGraphStore.getState();
  try {
    if (hasWork()) {
      const confirmed = await askConfirm({
        title: `Open "${recentFileEntry.fileName}"?`,
        message: 'It replaces what is open now. Save your work first.',
        confirmLabel: 'Open',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    const loadedData = await fileStorage.openRecentFile(recentFileEntry);
    if (loadedData !== null) {
      store.loadUniverseFromFile(loadedData);
      fileStorage.enableAutoSave(() => useGraphStore.getState());
      // 'load' context so SaveCoordinator doesn't treat this as a new edit.
      useGraphStore.getState().setChangeContext({ type: 'load' });
      store.setUniverseConnected(true);
    }
  } catch (error) {
    store.setUniverseError(`Failed to open recent file: ${error.message}`);
    await showNotice({ title: 'Could Not Open', message: `"${recentFileEntry.fileName}" did not open.`, details: error?.message, variant: 'error' });
  }
}

/**
 * Export the universe in front of the user.
 *
 * The active store IS the right state here: the menu means "the universe I'm
 * looking at". That is NOT true of the universe panel's export, which is opened
 * on a save slot and must read that slot instead. Both go through
 * formats/exportUniverse.js, which takes the state as a parameter and has no
 * fallback to the store, so the difference between the two callers is stated
 * at the call site rather than hidden in a default.
 * @param {'nquads'|'trig'|'redstring'|'json'|'txt'|'ttl'} formatId
 */
export async function exportActiveUniverse(formatId) {
  try {
    const { exportUniverseAs } = await import('../formats/exportUniverse.js');
    const { default: universeBackend } = await import('./universeBackend.js');
    const universeName = universeBackend.getActiveUniverse?.()?.name;
    await exportUniverseAs(formatId, useGraphStore.getState(), universeName);
  } catch (error) {
    await showNotice({ title: 'Could Not Export', details: error?.message, variant: 'error' });
  }
}

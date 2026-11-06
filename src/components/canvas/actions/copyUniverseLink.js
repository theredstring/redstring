import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useGraphStore from '../../../store/graphStore.js';
import { copyText, sharedLinkForUniverse } from '../../../services/universeShare.js';

/**
 * Copy the open universe's link. With nothing to link to yet, go to the
 * Universes panel, whose Share section says what it needs.
 * @returns {Promise<boolean>} whether a link was copied
 */
export async function copyOpenUniverseLink() {
  const { default: universeBackend } = await import('../../../services/universeBackend.js');
  const link = sharedLinkForUniverse(universeBackend.getActiveUniverse());
  if (link) {
    try {
      await copyText(link);
      return true;
    } catch { /* the panel still has the button */ }
  }
  useGraphStore.getState().setLeftPanelExpanded(true);
  useCanvasUIStore.getState().openLeftPanelView('federation');
  return false;
}

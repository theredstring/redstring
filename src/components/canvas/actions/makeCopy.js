import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useGraphStore from '../../../store/graphStore.js';

/**
 * Make a copy of the open universe and show it in the Universes panel, where
 * its storage can be set up. The bar, the panel and the Redstring menu all do
 * this.
 */
export async function makeCopyOfOpenUniverse() {
  const { default: universeBackend } = await import('../../../services/universeBackend.js');
  try {
    const result = await universeBackend.makeCopyOfActiveUniverse();
    useGraphStore.getState().setLeftPanelExpanded(true);
    useCanvasUIStore.getState().openLeftPanelView('federation');
    return result;
  } catch (error) {
    universeBackend.notifyStatus('error', error?.message || "Couldn't make a copy.");
    return null;
  }
}

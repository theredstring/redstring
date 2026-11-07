import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useCopyHandoff from '../../../store/copyHandoff.js';
import useGraphStore from '../../../store/graphStore.js';

// The panel opens and the row folds (0.2s each) before the copy takes the main
// thread, so neither is caught mid-animation.
const PANEL_SETTLES_MS = 260;
// A small universe copies at once; under this the handoff is only a flicker.
const SHOWN_AT_LEAST_MS = 800;
// CopyHandoff.css: the row opening up.
const LANDING_MS = 450;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Make a copy of the open universe and show it in the Universes panel, where
 * its storage can be set up. The bar, the panel and the Redstring menu all do
 * this, one at a time.
 */
export async function makeCopyOfOpenUniverse() {
  if (useCopyHandoff.getState().phase) return null;
  useCopyHandoff.setState({ phase: 'copying', slug: null });
  const startedAt = performance.now();
  useGraphStore.getState().setLeftPanelExpanded(true);
  useCanvasUIStore.getState().openLeftPanelView('federation');
  try {
    await wait(PANEL_SETTLES_MS);
    const { default: universeBackend } = await import('../../../services/universeBackend.js');
    try {
      const result = await universeBackend.makeCopyOfActiveUniverse();
      await wait(SHOWN_AT_LEAST_MS - (performance.now() - startedAt));
      useCopyHandoff.setState({ phase: 'landing', slug: result.slug });
      // The panel otherwise hears about it from its next poll, up to 5s away.
      window.dispatchEvent(new CustomEvent('redstring:universe-created', { detail: { slug: result.slug, silent: true } }));
      await wait(LANDING_MS);
      return result;
    } catch (error) {
      universeBackend.notifyStatus('error', error?.message || "Couldn't make a copy.");
      return null;
    }
  } finally {
    useCopyHandoff.setState({ phase: null, slug: null });
  }
}

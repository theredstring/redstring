import { describe, it, expect } from 'vitest';
import { computeShouldShowBackToCivilization } from '../../src/components/canvas/data/backToCivilization.js';

// Nothing on screen, nothing else in the way: the button would show.
const lost = {
  isInitialLoadComplete: true, isUniverseLoaded: true, hasUniverseFile: true, activeGraphId: 'g', isViewReady: true,
  nodeNamePrompt: { visible: false }, connectionNamePrompt: { visible: false }, abstractionPrompt: { visible: false },
  abstractionCarouselVisible: false, selectedNodeIdForPieMenu: null, plusSign: null,
  draggingNodeInfo: null, drawingConnectionFrom: null, isPanning: false, selectionStart: null,
  nodes: [{ id: 'a' }], relevantNodesVisibleInStrictViewport: false, selectedGroupId: null,
};

describe('Back to Civilization and a selected group', () => {
  it('shows when no Thing is on screen', () => {
    expect(computeShouldShowBackToCivilization(lost)).toBe(true);
  });

  it('stays down while a group is selected, framed by a title that is no node', () => {
    expect(computeShouldShowBackToCivilization({ ...lost, selectedGroupId: 'grp' })).toBe(false);
  });
});

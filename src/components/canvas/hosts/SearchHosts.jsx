import React, { Profiler, memo, useCallback, useMemo, useState } from 'react';
import UnifiedSelector from '../../../UnifiedSelector.jsx';
import { WebGrid } from '../thingGroupPrompt/ThingGroupPrompt.jsx';
import { websOf } from '../thingGroupPrompt/thingGroupPrompt.js';
import { haptic } from '../../../services/haptics.js';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * The header's two searches and the New Thing prompt, outside NodeCanvas
 * (P2.06d). Each is a UnifiedSelector, which portals itself to <body>, so where
 * this renders doesn't matter to the page. Their open state is in canvasUIStore.
 */

const ui = () => useCanvasUIStore.getState();
const graph = () => useGraphStore.getState();

const closeComponentSearch = () => ui().setHeaderSearchVisible(false);
const closeAllThingsSearch = () => ui().setHeaderAllThingsSearchVisible(false);
const closeNewWeb = () => ui().setNewWebPrompt({ visible: false });

// Search the web in front of you: open the Thing's tab, and fly to its
// instances here if there are any.
const selectComponent = (prototype) => {
  try {
    if (prototype?.id) {
      graph().openRightPanelNodeTab(prototype.id, prototype.name);
      runCanvasCommand('navigateToPrototypeInstances', prototype.id);
    }
  } finally {
    closeComponentSearch();
  }
};

// Search everything: open the Thing's definition (making one if it has none),
// and its tab.
const selectAnyThing = (node) => {
  if (node.id) {
    const store = graph();
    if (node.definitionGraphIds && node.definitionGraphIds.length > 0) {
      store.openGraphTab(node.definitionGraphIds[0], node.id);
    } else {
      store.createAndAssignGraphDefinition(node.id);
    }
    store.openRightPanelNodeTab(node.id, node.name);
  }
  closeAllThingsSearch();
};

// The dialog half: a brand-new Thing, authored here, defines the Web.
// createNewGraph mints the prototype, so passing the name and colour through is
// all it takes.
const submitNewWeb = ({ name, color }) => {
  if (name.trim()) graph().createNewGraph({ name: name.trim(), color });
  closeNewWeb();
};

// The grid half: an existing Thing, then which of its Webs opens, or a new one
// for it (a second or third definition: what the abstraction carousel browses).
// Index `index` among its definitions; one past the end is the New Web card.
const openWebOf = (prototype, index) => {
  const graphId = prototype.definitionGraphIds?.[index];
  if (graphId && graph().graphs.has(graphId)) graph().openGraphTab(graphId, prototype.id);
  else graph().createAndAssignGraphDefinition(prototype.id);
  closeNewWeb();
};

// The plus sign's Add Web pages (thingGroupPrompt/), opening the Web as a tab
// rather than in place. Mounted only while open, so it starts on the Thing.
function NewWebPrompt({ leftPanelExpanded, rightPanelExpanded }) {
  const [prototypeId, setPrototypeId] = useState(null);
  const prototype = useGraphStore(s => (prototypeId ? s.nodePrototypes.get(prototypeId) : null));
  const graphs = useGraphStore(s => s.graphs);
  const webCount = useCallback((thing) => websOf(thing, graphs).length, [graphs]);

  if (prototype) {
    return (
      <UnifiedSelector
        key="web"
        mode="web-creation"
        isVisible={true}
        leftPanelExpanded={leftPanelExpanded}
        rightPanelExpanded={rightPanelExpanded}
        onClose={closeNewWeb}
        onBack={() => setPrototypeId(null)}
        title="Choose a Web to open"
        gridContent={<WebGrid prototype={prototype} onChoose={(index) => { haptic('menuSelect'); openWebOf(prototype, index); }} />}
      />
    );
  }

  return (
    <UnifiedSelector
      key="thing"
      mode="web-creation"
      isVisible={true}
      leftPanelExpanded={leftPanelExpanded}
      rightPanelExpanded={rightPanelExpanded}
      onClose={closeNewWeb}
      onSubmit={submitNewWeb}
      onNodeSelect={(picked) => { if (picked?.id) setPrototypeId(picked.id); }}
      cardBadge={webCount}
      title="Choose the Thing this Web defines"
    />
  );
}

const selectActiveInstances = (s) => s.graphs.get(s.activeGraphId)?.instances;

// Mounted only while open: it follows the active web's instances, which change
// on every node move.
function ComponentSearch({ leftPanelExpanded, rightPanelExpanded }) {
  const instances = useGraphStore(selectActiveInstances);
  const allowedPrototypeIds = useMemo(() => {
    const ids = new Set();
    for (const instance of instances?.values() || []) {
      if (instance?.prototypeId) ids.add(instance.prototypeId);
    }
    return ids;
  }, [instances]);

  return (
    <UnifiedSelector
      mode="node-typing"
      isVisible={true}
      leftPanelExpanded={leftPanelExpanded}
      rightPanelExpanded={rightPanelExpanded}
      onClose={closeComponentSearch}
      onNodeSelect={selectComponent}
      title="Search this Web"
      searchOnly={true}
      allowedPrototypeIds={allowedPrototypeIds}
    />
  );
}

function SearchHosts() {
  const headerSearchVisible = useCanvasUIStore(s => s.headerSearchVisible);
  const headerAllThingsSearchVisible = useCanvasUIStore(s => s.headerAllThingsSearchVisible);
  const newWebPromptVisible = useCanvasUIStore(s => s.newWebPrompt.visible);
  const leftPanelExpanded = useGraphStore(s => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(s => s.rightPanelExpanded);

  return (
    <Profiler id="SearchHosts" onRender={onRenderProbe}>
      {headerSearchVisible && (
        <ComponentSearch leftPanelExpanded={leftPanelExpanded} rightPanelExpanded={rightPanelExpanded} />
      )}
      {headerAllThingsSearchVisible && (
        <UnifiedSelector
          mode="node-selection"
          isVisible={true}
          onClose={closeAllThingsSearch}
          onNodeSelect={selectAnyThing}
          title="Search everything"
          leftPanelExpanded={leftPanelExpanded}
          rightPanelExpanded={rightPanelExpanded}
          searchOnly={true}
        />
      )}
      {newWebPromptVisible && (
        <NewWebPrompt leftPanelExpanded={leftPanelExpanded} rightPanelExpanded={rightPanelExpanded} />
      )}
    </Profiler>
  );
}

export default memo(SearchHosts);

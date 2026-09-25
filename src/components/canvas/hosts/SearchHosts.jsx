import React, { Profiler, memo, useMemo } from 'react';
import UnifiedSelector from '../../../UnifiedSelector.jsx';
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

// The grid half: an existing Thing takes the job. This is a second (or third)
// definition for it where it already had one — legitimate, and what the
// abstraction carousel browses.
const pickNewWebDefiner = (prototype) => {
  if (prototype?.id) graph().createAndAssignGraphDefinition(prototype.id);
  closeNewWeb();
};

const selectActiveInstances = (s) => s.graphs.get(s.activeGraphId)?.instances;

// Mounted only while open: it follows the active web's instances, which change
// on every node move.
function ComponentSearch({ leftPanelExpanded, rightPanelExpanded }) {
  const activeGraphName = useGraphStore(s => s.graphs.get(s.activeGraphId)?.name ?? 'Loading...');
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
      title={`Search ${activeGraphName || 'Components'}`}
      subtitle={null}
      gridTitle="Browse Components in This Thing"
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
          title="Search All Things"
          subtitle="Search through everything in your universe"
          leftPanelExpanded={leftPanelExpanded}
          rightPanelExpanded={rightPanelExpanded}
          searchOnly={true}
          gridTitle="All Things"
        />
      )}
      {newWebPromptVisible && (
        <UnifiedSelector
          mode="web-creation"
          isVisible={true}
          leftPanelExpanded={leftPanelExpanded}
          rightPanelExpanded={rightPanelExpanded}
          onClose={closeNewWeb}
          onSubmit={submitNewWeb}
          onNodeSelect={pickNewWebDefiner}
          title="New Thing"
          subtitle="Name the Thing this Web defines,<br />or pick one that already exists."
          gridTitle="Define With an Existing Thing"
        />
      )}
    </Profiler>
  );
}

export default memo(SearchHosts);

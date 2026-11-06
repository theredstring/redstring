import React, { Profiler, memo, useCallback, useMemo, useRef, useState } from 'react';
import UnifiedSelector from '../../../UnifiedSelector.jsx';
import { WebGrid } from '../thingGroupPrompt/ThingGroupPrompt.jsx';
import { websOf } from '../thingGroupPrompt/thingGroupPrompt.js';
import { haptic } from '../../../services/haptics.js';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useReadOnlyUniverse, { selectReadOnlyOpen } from '../../../store/readOnlyUniverse.js';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * Search and the New Thing prompt, outside NodeCanvas (P2.06d). Each is a
 * UnifiedSelector, which portals itself to <body>, so where this renders doesn't
 * matter to the page. Their open state is in canvasUIStore.
 */

const ui = () => useCanvasUIStore.getState();
const graph = () => useGraphStore.getState();

const closeSearch = () => ui().setSearchScope(null);
const closeNewWeb = () => ui().setNewWebPrompt({ visible: false });

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

const EVERYTHING = 'everything';
const OPEN_WEBS = 'open-webs';
const THIS_WEB = 'this-web';
const SAVED = 'saved';

// A web's name in the title, cut short past this many characters.
const WEB_NAME_LIMIT = 32;
const shortWebName = (name) => {
  const text = name || 'Untitled';
  return text.length > WEB_NAME_LIMIT ? `${text.slice(0, WEB_NAME_LIMIT).trimEnd()}...` : text;
};

// Search this Web: open the Thing's tab and fly to its instances here.
const flyToThing = (thing) => {
  graph().openRightPanelNodeTab(thing.id, thing.name);
  runCanvasCommand('navigateToPrototypeInstances', thing.id);
};

// Already open, it just comes to the front, staying where it is in the strip
// and the Open Webs list (which scrolls to it).
const goToWeb = (graphId, thingId) => {
  const store = graph();
  if (!store.openGraphIds.includes(graphId)) {
    store.openGraphTab(graphId, thingId);
    return;
  }
  store.setActiveGraph(graphId);
  setTimeout(() => {
    document.querySelector(`[data-graph-id="${CSS.escape(graphId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
};

/**
 * Search: the plus sign's pages without what makes things. It only ever finds,
 * so it reads the same in a read-only universe. The title chooses where it
 * looks, starting from where it was opened, and what is typed stays across
 * them. A Thing with several Webs goes on to choose one; a Thing with none opens
 * its tab. Mounted only while open: it follows the universe as it changes.
 */
function Search({ startScope, onClose, leftPanelExpanded, rightPanelExpanded }) {
  const graphs = useGraphStore(s => s.graphs);
  const openGraphIds = useGraphStore(s => s.openGraphIds);
  const activeGraphId = useGraphStore(s => s.activeGraphId);
  const savedNodeIds = useGraphStore(s => s.savedNodeIds);
  const activeWeb = graphs.get(activeGraphId);

  const [chosenScope, setChosenScope] = useState(startScope);
  // Opened again from elsewhere while it's up, it moves to there.
  const [lastStartScope, setLastStartScope] = useState(startScope);
  if (lastStartScope !== startScope) {
    setLastStartScope(startScope);
    setChosenScope(startScope);
  }
  // No web in front of you: nothing for This Web to look through.
  const scope = chosenScope === THIS_WEB && !activeWeb ? EVERYTHING : chosenScope;

  const [thingId, setThingId] = useState(null);
  const prototype = useGraphStore(s => (thingId ? s.nodePrototypes.get(thingId) : null));
  // Kept for coming back from a Thing's Webs.
  const typedRef = useRef('');

  const onlyOpen = useMemo(() => (scope === OPEN_WEBS ? new Set(openGraphIds) : null), [scope, openGraphIds]);
  const websFound = useCallback((thing) => {
    const webs = websOf(thing, graphs);
    return onlyOpen ? webs.filter(({ graphId }) => onlyOpen.has(graphId)) : webs;
  }, [graphs, onlyOpen]);
  const webCount = useCallback((thing) => websFound(thing).length, [websFound]);

  const allowedPrototypeIds = useMemo(() => {
    if (scope === SAVED) return savedNodeIds;
    if (scope === OPEN_WEBS) return new Set(openGraphIds.flatMap(id => graphs.get(id)?.definingNodeIds || []));
    if (scope === THIS_WEB) {
      const ids = new Set();
      for (const instance of activeWeb?.instances?.values() || []) {
        if (instance?.prototypeId) ids.add(instance.prototypeId);
      }
      return ids;
    }
    return null;
  }, [scope, savedNodeIds, openGraphIds, graphs, activeWeb]);

  const activeWebName = activeWeb ? shortWebName(activeWeb.name) : null;
  const titles = useMemo(() => ({
    [EVERYTHING]: 'Search Everything',
    [OPEN_WEBS]: 'Search Open Webs',
    ...(activeWebName ? { [THIS_WEB]: `Search ${activeWebName}` } : {}),
    [SAVED]: 'Search Saved Things',
  }), [activeWebName]);
  // Memoized: the menu re-measures, and re-arms its tap guard, on new options.
  const titleOptions = useMemo(() => (
    Object.entries(titles).map(([value, label]) => ({ value, label, active: value === scope }))
  ), [titles, scope]);

  const openWeb = (thing, graphId) => {
    goToWeb(graphId, thing.id);
    graph().openRightPanelNodeTab(thing.id, thing.name);
    onClose();
  };
  const pickThing = (thing) => {
    if (scope === THIS_WEB) {
      flyToThing(thing);
      onClose();
      return;
    }
    const webs = websFound(thing);
    if (webs.length > 1) {
      setThingId(thing.id);
    } else if (webs.length === 1) {
      openWeb(thing, webs[0].graphId);
    } else {
      graph().openRightPanelNodeTab(thing.id, thing.name);
      onClose();
    }
  };

  if (prototype) {
    return (
      <UnifiedSelector
        key="web"
        mode="node-selection"
        isVisible={true}
        searchOnly={true}
        leftPanelExpanded={leftPanelExpanded}
        rightPanelExpanded={rightPanelExpanded}
        onClose={onClose}
        onBack={() => setThingId(null)}
        title="Choose a Web to open"
        gridContent={(
          <WebGrid
            prototype={prototype}
            newWeb={false}
            only={onlyOpen}
            onChoose={(index) => {
              haptic('menuSelect');
              openWeb(prototype, prototype.definitionGraphIds[index]);
            }}
          />
        )}
      />
    );
  }

  return (
    <UnifiedSelector
      key="thing"
      mode="node-selection"
      isVisible={true}
      searchOnly={true}
      leftPanelExpanded={leftPanelExpanded}
      rightPanelExpanded={rightPanelExpanded}
      onClose={onClose}
      onNodeSelect={pickThing}
      initialName={typedRef.current}
      onNameChange={(text) => { typedRef.current = text; }}
      title={titles[scope]}
      titleOptions={titleOptions}
      onTitleOption={setChosenScope}
      allowedPrototypeIds={allowedPrototypeIds}
      // Its Webs here. This Web goes to the Thing, not to a Web of it.
      cardBadge={scope === THIS_WEB ? null : webCount}
    />
  );
}

function SearchHosts() {
  const searchScope = useCanvasUIStore(s => s.searchScope);
  const newWebPromptVisible = useCanvasUIStore(s => s.newWebPrompt.visible);
  const readOnly = useReadOnlyUniverse(selectReadOnlyOpen);
  const leftPanelExpanded = useGraphStore(s => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(s => s.rightPanelExpanded);

  return (
    <Profiler id="SearchHosts" onRender={onRenderProbe}>
      {searchScope && (
        <Search startScope={searchScope} onClose={closeSearch} leftPanelExpanded={leftPanelExpanded} rightPanelExpanded={rightPanelExpanded} />
      )}
      {/* Whichever way the + was asked for (Cmd+N, the controller): read-only
          there's nothing to make, so it's search. */}
      {newWebPromptVisible && (readOnly ? (
        <Search startScope={EVERYTHING} onClose={closeNewWeb} leftPanelExpanded={leftPanelExpanded} rightPanelExpanded={rightPanelExpanded} />
      ) : (
        <NewWebPrompt leftPanelExpanded={leftPanelExpanded} rightPanelExpanded={rightPanelExpanded} />
      ))}
    </Profiler>
  );
}

export default memo(SearchHosts);

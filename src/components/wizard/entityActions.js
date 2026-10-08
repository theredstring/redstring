import useGraphStore from '../../store/graphStore.js';
import { runCanvasCommand, hasCanvasCommand } from '../../utils/canvas/canvasCommands.js';

/**
 * Open-in-panel and open-as-web for any Thing, Web or Connection shown outside
 * the canvas: the pair the type row, Web Definitions and the edge pie offer.
 * Plain functions over the store, so a chat card can hold them without a
 * callback threaded down from the canvas.
 */

const rectOf = (event) => event?.currentTarget?.getBoundingClientRect?.() || null;

/** The Thing that stands for a Connection: its type. */
export function connectionThingId(edge) {
  if (!edge) return null;
  if (Array.isArray(edge.definitionNodeIds) && edge.definitionNodeIds.length > 0) return edge.definitionNodeIds[0];
  return edge.typeNodeId || null;
}

/** The Thing that stands for a Web: the Thing it defines. */
export function webThingId(graph, nodePrototypes) {
  const id = graph?.definingNodeIds?.[0];
  return id && nodePrototypes?.has?.(id) ? id : null;
}

export function openThingInPanel(thingId) {
  const st = useGraphStore.getState();
  const thing = st.nodePrototypes.get(thingId);
  if (!thing) return;
  st.openRightPanelNodeTab(thingId, thing.name);
}

export function openWebInPanel(graphId) {
  const st = useGraphStore.getState();
  if (!st.graphs.has(graphId)) return;
  // Opens the right panel itself, swapping with this one at narrow widths.
  st.openRightPanelGraphTab?.(graphId, webThingId(st.graphs.get(graphId), st.nodePrototypes));
}

const flyTo = (thingId, graphId, rect) => {
  if (rect && hasCanvasCommand('startHurtleFromPanel')) {
    runCanvasCommand('startHurtleFromPanel', thingId, graphId, thingId, rect);
  } else {
    useGraphStore.getState().openGraphTabAndBringToTop(graphId, thingId);
  }
};

/**
 * Open a Thing as a Web: its first definition, or a new one when it has none.
 * `graphId` opens that definition instead.
 */
export function openThingAsWeb(thingId, event, graphId = null) {
  const st = useGraphStore.getState();
  const thing = st.nodePrototypes.get(thingId);
  if (!thing) return;
  const rect = rectOf(event);
  const defs = Array.isArray(thing.definitionGraphIds) ? thing.definitionGraphIds : [];
  const target = graphId && defs.includes(graphId) ? graphId : defs[0];
  if (target) {
    flyTo(thingId, target, rect);
    return;
  }
  const created = st.createAndAssignGraphDefinitionWithoutActivation?.(thingId);
  if (created) flyTo(thingId, created, rect);
}

/** Open a Web on the canvas, flying from the defining Thing when it has one. */
export function openWebOnCanvas(graphId, event) {
  const st = useGraphStore.getState();
  const graph = st.graphs.get(graphId);
  if (!graph) return;
  const thingId = webThingId(graph, st.nodePrototypes);
  if (thingId) {
    flyTo(thingId, graphId, rectOf(event));
  } else {
    st.openGraphTabAndBringToTop(graphId);
  }
}

import React from 'react';
import { X, XCircle, ArrowRightToLine, ArrowDownToLine, NotebookText, ArrowUpFromDot } from 'lucide-react';
import useGraphStore from '../store/graphStore.js';

/**
 * Right-click menu for one open web — the Open Webs list and the header strip.
 *
 * Both render `openGraphIds` in order, so "below" in the list and "to the right"
 * in the header are the same set of webs; only the wording follows the layout.
 * Mirrors the right panel's tab menu, but every action here is undoable (see
 * `closeGraphs`).
 *
 * Reads the store at call time rather than taking props, so callers can hand a
 * stable handler to memoized items.
 *
 * @param {string} graphId - The web that was right-clicked.
 * @param {'below'|'right'} direction - How the strip is laid out where it was clicked.
 * @param {string[]} [shownOrder] - The order the webs are shown in, when it is
 *   not the open order (the Open Webs list sorted by name, say): "below" is
 *   what is below on screen.
 * @returns {Array} Options for showContextMenu.
 */
export const getOpenWebContextMenuOptions = (graphId, direction = 'below', shownOrder) => {
  const { openGraphIds, graphs, closeGraphs, activeGraphId } = useGraphStore.getState();
  const order = shownOrder || openGraphIds;
  const index = order.indexOf(graphId);
  if (index === -1 || !openGraphIds.includes(graphId)) return [];

  const graph = graphs.get(graphId);
  const name = graph?.name || 'web';
  const others = openGraphIds.filter(id => id !== graphId);
  const after = order.slice(index + 1).filter(id => openGraphIds.includes(id));
  const afterLabel = direction === 'right' ? 'to the right' : 'below';
  const afterMenuLabel = direction === 'right' ? 'to the Right' : 'Below';

  return [
    {
      label: 'Open in Canvas',
      icon: <ArrowUpFromDot size={14} />,
      disabled: activeGraphId === graphId,
      action: () => useGraphStore.getState().setActiveGraph(graphId)
    },
    {
      // The Thing this web defines, as the canvas's Open in Panel does; a web
      // no Thing defines falls back to its Info tab.
      label: 'Open in Panel',
      icon: <NotebookText size={14} />,
      action: () => {
        const st = useGraphStore.getState();
        const definingNodeId = graph?.definingNodeIds?.[0];
        if (definingNodeId && st.nodePrototypes.has(definingNodeId)) {
          st.openRightPanelNodeTab(definingNodeId, name);
        } else {
          if (st.activeGraphId !== graphId) st.setActiveGraph(graphId);
          st.activateRightPanelTab(0);
        }
        if (!useGraphStore.getState().rightPanelExpanded) st.setRightPanelExpanded(true);
      }
    },
    {
      label: 'Close Web',
      icon: <X size={14} />,
      action: () => closeGraphs([graphId], { label: `Close "${name}"` })
    },
    {
      label: 'Close All Others',
      icon: <XCircle size={14} />,
      disabled: others.length === 0,
      action: () => closeGraphs(others, { label: `Close webs other than "${name}"`, activateId: graphId })
    },
    {
      label: `Close All ${afterMenuLabel}`,
      icon: direction === 'right' ? <ArrowRightToLine size={14} /> : <ArrowDownToLine size={14} />,
      disabled: after.length === 0,
      action: () => closeGraphs(after, { label: `Close webs ${afterLabel} "${name}"`, activateId: graphId })
    }
  ];
};

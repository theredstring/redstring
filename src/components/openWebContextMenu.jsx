import React from 'react';
import { X, XCircle, ArrowRightToLine, ArrowDownToLine } from 'lucide-react';
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
 * @returns {Array} Options for showContextMenu.
 */
export const getOpenWebContextMenuOptions = (graphId, direction = 'below') => {
  const { openGraphIds, graphs, closeGraphs } = useGraphStore.getState();
  const index = openGraphIds.indexOf(graphId);
  if (index === -1) return [];

  const name = graphs.get(graphId)?.name || 'web';
  const others = openGraphIds.filter(id => id !== graphId);
  const after = openGraphIds.slice(index + 1);
  const afterLabel = direction === 'right' ? 'to the right' : 'below';

  return [
    {
      label: 'Close web',
      icon: <X size={14} />,
      action: () => closeGraphs([graphId], { label: `Close "${name}"` })
    },
    {
      label: 'Close all others',
      icon: <XCircle size={14} />,
      disabled: others.length === 0,
      action: () => closeGraphs(others, { label: `Close webs other than "${name}"`, activateId: graphId })
    },
    {
      label: `Close all ${afterLabel}`,
      icon: direction === 'right' ? <ArrowRightToLine size={14} /> : <ArrowDownToLine size={14} />,
      disabled: after.length === 0,
      action: () => closeGraphs(after, { label: `Close webs ${afterLabel} "${name}"`, activateId: graphId })
    }
  ];
};

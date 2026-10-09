import React from 'react';
import { ArrowUpFromDot, NotebookText, Bookmark, Copy } from 'lucide-react';
import useGraphStore from '../store/graphStore.js';
import { openThingAsWeb, openThingInPanel } from './wizard/entityActions.js';

/**
 * Right-click menu for one Thing shown outside the canvas — the Saved Things
 * and All Things lists. Mirrors the canvas node menu's Open Web / Save, plus
 * Open in Panel and Duplicate.
 *
 * Reads the store at call time rather than taking props, so callers can hand a
 * stable handler to memoized items.
 *
 * @param {string} thingId - The Thing (node prototype) that was right-clicked.
 * @param {DOMRect} [originRect] - The item that was right-clicked, where Open
 *   Web launches its orb from. Measured at right-click: the menu is over it by
 *   the time an item is chosen.
 * @returns {Array} Options for showContextMenu.
 */
export const getThingContextMenuOptions = (thingId, originRect) => {
  const { nodePrototypes, savedNodeIds } = useGraphStore.getState();
  if (!nodePrototypes.has(thingId)) return [];
  const isSaved = savedNodeIds?.has?.(thingId);

  return [
    {
      label: 'Open Web',
      icon: <ArrowUpFromDot size={14} />,
      action: () => openThingAsWeb(thingId, originRect)
    },
    {
      label: 'Open in Panel',
      icon: <NotebookText size={14} />,
      action: () => openThingInPanel(thingId)
    },
    {
      label: isSaved ? 'Unsave' : 'Save',
      icon: <Bookmark size={14} fill={isSaved ? 'maroon' : 'none'} />,
      action: () => useGraphStore.getState().toggleSavedNode(thingId)
    },
    {
      label: 'Duplicate',
      icon: <Copy size={14} />,
      action: () => useGraphStore.getState().duplicateNodePrototype(thingId)
    }
  ];
};

/**
 * Right panel tabs come in three kinds: the locked home tab, a Thing's tab
 * (`{ type: 'node', nodeId }`) and a Web's tab (`{ type: 'graph', graphId,
 * nodeId }`, nodeId being the Thing it was opened from). A Thing and one of its
 * Webs can both be open, so a tab is identified by its key, never by nodeId.
 */
export const rightPanelTabKey = (tab) => {
  if (!tab) return null;
  if (tab.type === 'graph') return tab.graphId || null;
  if (tab.type === 'node') return tab.nodeId || null;
  return tab.type || null; // 'home'
};

import React from 'react';
import useGraphStore from '../../store/graphStore.js';
import { getTextColor } from '../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR } from '../../constants.js';

/**
 * A Thing pinned to the Wizard's context, in the same chip as the current
 * web's. Named live, so a rename shows here; a pin dragged in from a web's tab
 * reads as that web. Gone from the universe, it draws nothing (the context
 * builder skips it too). Clicking takes it out.
 */
const ContextPinChip = ({ pin, onRemove }) => {
  const thing = useGraphStore(s => s.nodePrototypes.get(pin.id) || null);
  const webName = useGraphStore(s => (pin.graphId ? s.graphs.get(pin.graphId)?.name ?? null : null));
  if (!thing) return null;
  const label = webName || thing.name || 'Thing';
  const color = thing.color || NODE_DEFAULT_COLOR;
  return (
    <button
      className="ai-context-chip active"
      style={{ backgroundColor: color, color: getTextColor(color), borderColor: color }}
      onClick={onRemove}
      title={`Click to take ${label} out of context`}
    >
      <span className="ai-context-chip-label">{label}</span>
      <span className="ai-context-chip-toggle">×</span>
    </button>
  );
};

export default React.memo(ContextPinChip);

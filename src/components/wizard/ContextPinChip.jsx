import React from 'react';
import useGraphStore from '../../store/graphStore.js';
import { getTextColor } from '../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import useSpawnableDrag from './useSpawnableDrag.js';

/**
 * A Thing pinned to the Wizard's context, in the same chip as the current
 * web's. Named live, so a rename shows here; a pin dragged in from a web's tab
 * reads as that web. Gone from the universe, it draws nothing (the context
 * builder skips it too). Clicking takes it out; dragging it is the universal
 * dragged node, carrying its web when it has one.
 */
const ContextPinChip = ({ pin, onRemove }) => {
  const thing = useGraphStore(s => s.nodePrototypes.get(pin.id) || null);
  const webName = useGraphStore(s => (pin.graphId ? s.graphs.get(pin.graphId)?.name ?? null : null));
  const [drag, isDragging] = useSpawnableDrag({ prototypeId: thing ? pin.id : null, nodeName: thing?.name, graphId: pin.graphId });
  if (!thing) return null;
  const label = webName || thing.name || 'Thing';
  const color = thing.color || NODE_DEFAULT_COLOR;
  return (
    <button
      ref={drag}
      className="ai-context-chip active"
      style={{ backgroundColor: color, color: getTextColor(color), borderColor: color, opacity: isDragging ? 0.5 : 1 }}
      onClick={onRemove}
      title={`Click to take ${label} out of context`}
    >
      <span className="ai-context-chip-label">{label}</span>
      <span className="ai-context-chip-toggle">×</span>
    </button>
  );
};

/**
 * The current web's chip: clicking switches it in and out of context; dragging
 * it is the universal dragged node for the Thing that web defines, with the web
 * (drop it back on the Wizard to keep that web pinned after you move on).
 */
export const ActiveWebChip = React.memo(({ item, onToggle }) => {
  const definerId = useGraphStore(s => (item.id ? s.graphs.get(item.id)?.definingNodeIds?.[0] ?? null : null));
  const definerName = useGraphStore(s => (definerId ? s.nodePrototypes.get(definerId)?.name ?? null : null));
  const [drag, isDragging] = useSpawnableDrag({ prototypeId: definerName != null ? definerId : null, nodeName: definerName, graphId: item.id });
  const colored = item.color && item.enabled;
  return (
    <button
      ref={drag}
      className={`ai-context-chip ${item.enabled ? 'active' : 'disabled'}`}
      style={{
        ...(colored ? { backgroundColor: item.color, color: getTextColor(item.color), borderColor: item.color } : {}),
        opacity: isDragging ? 0.5 : 1
      }}
      onClick={onToggle}
      title={item.enabled ? `Click to exclude ${item.label} from context` : `Click to include ${item.label} in context`}
    >
      <span className="ai-context-chip-label">{item.label}</span>
      <span className="ai-context-chip-toggle">{item.enabled ? '×' : '+'}</span>
    </button>
  );
});
ActiveWebChip.displayName = 'ActiveWebChip';

export default React.memo(ContextPinChip);

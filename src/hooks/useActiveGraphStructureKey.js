import useGraphStore from '../store/graphStore.js';
import { projectGraphView } from '../core/openDefinitions.js';

/**
 * A string that changes when the open Web gains or loses an instance or a
 * connection — and not when a node moves. Panel views that only care what's
 * IN the Web subscribe to this instead of `graphs`, which changes on every
 * frame of a drag. Read as the canvas shows it, so opening a box in place, or
 * adding inside one, changes it too.
 */
export default function useActiveGraphStructureKey() {
  return useGraphStore((s) => {
    const g = s.activeGraphId ? projectGraphView(s, s.activeGraphId) : null;
    if (!g) return '';
    return `${s.activeGraphId}|${g.instances?.size || 0}|${(g.edgeIds || []).length}|${(g.edgeIds || []).at?.(-1) || ''}`;
  });
}

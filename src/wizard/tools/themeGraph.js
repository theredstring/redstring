import { resolvePaletteColor, getRandomPalette, PALETTES } from '../../ai/palettes.js';
import { resolveGraphId } from './resolveGraphId.js';

function stringToColor(str, paletteName, baseHex) {
    if (baseHex && !paletteName) {
        return baseHex.startsWith('#') ? baseHex : '#' + baseHex.replace('#', '');
    }
    const pName = paletteName || getRandomPalette();
    const normalizeKey = (s) => s?.toLowerCase().replace(/\s+/g, '-') ?? '';
    const palette = PALETTES[normalizeKey(pName)];
    
    if (!palette) return resolvePaletteColor(pName, str);
    
    const colors = Object.values(palette.colors);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
}

export async function themeGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { palette, baseColor, targetGraphId } = args;
  
  const { activeGraphId, graphs, nodePrototypes, edges = [] } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const targetGraph = graphs.find(g => g.id === graphId);
  if (!targetGraph) throw new Error('Graph not found.');

  const protoIdsToUpdate = new Set();
  
  // Collect the defining nodes for this graph themselves
  if (Array.isArray(targetGraph.definingNodeIds)) {
    for (const defId of targetGraph.definingNodeIds) {
      protoIdsToUpdate.add(defId);
    }
  }
  
  // Collect all instance prototypes
  for (const inst of (targetGraph.instances || [])) {
    protoIdsToUpdate.add(inst.prototypeId);
  }
  
  // Collect all edge definition nodes in the graph
  // (In MCP or predictive state, edges might refer to graph instances)
  const graphEdgeIds = new Set(targetGraph.edgeIds || []);
  for (const edge of edges) {
    // If it's an edge in this graph
    if (graphEdgeIds.has(edge.id) || (
      // Or if it connects instances in this graph
      targetGraph.instances?.some(i => i.id === edge.sourceId || i.id === edge.destinationId)
    )) {
      if (edge.definitionNodeIds) {
        for (const defId of edge.definitionNodeIds) {
          protoIdsToUpdate.add(defId);
        }
      }
    }
  }

  const updates = [];
  const appliedPalette = palette || getRandomPalette();

  for (const protoId of protoIdsToUpdate) {
    const proto = nodePrototypes.find(p => p.id === protoId);
    if (proto) {
        const newColor = stringToColor(proto.name || proto.id, appliedPalette, baseColor);
        updates.push({
            prototypeId: protoId,
            color: newColor
        });
    }
  }

  return {
    action: 'themeGraph',
    graphId,
    palette: appliedPalette,
    updates
  };
}

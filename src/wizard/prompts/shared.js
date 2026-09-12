/**
 * Context helpers shared by every Ask The Wizard prompt builder.
 *
 * Moved verbatim out of NodeCanvas.jsx. These builders were always pure over
 * useGraphStore.getState() — they closed over nothing from the component, which
 * is why every one of them declared an empty useCallback dependency array — so
 * living outside React costs them nothing and makes them testable.
 */

export function buildGraphContextLines(graph, nodePrototypesMap, opts = {}) {
  if (!graph) return [];
  const { excludePrototypeIds = new Set(), maxOtherNodes = 25 } = opts;
  const lines = [];

  const graphName = graph.name || 'Unnamed graph';
  lines.push(`- Graph name: "${graphName}"`);
  if (graph.id) {
    lines.push(`- Graph ID: ${graph.id} (pass this exact value as targetGraphId in tool calls — never guess by name)`);
  }

  const graphDesc = (graph.description || '').trim();
  if (graphDesc) {
    lines.push(`- Graph description: ${graphDesc}`);
  }

  // Parent / defining node — graphs can be definitions of an outer prototype.
  const definingIds = Array.isArray(graph.definingNodeIds) ? graph.definingNodeIds : [];
  if (definingIds.length > 0) {
    const definingProtos = definingIds
      .map((id) => nodePrototypesMap.get(id))
      .filter(Boolean);
    if (definingProtos.length > 0) {
      const parts = definingProtos.map((p) => {
        const desc = (p.description || '').trim();
        return desc
          ? `"${p.name || 'Node'}" (${desc.length > 160 ? desc.slice(0, 160) + '…' : desc})`
          : `"${p.name || 'Node'}"`;
      });
      lines.push(`- This graph is the definition of: ${parts.join(', ')}`);
    }
  }

  // Other nodes present in the graph (deduped by prototype name, optionally excluding callers' focus prototypes)
  const instances = graph.instances;
  const seenProtoNames = new Set();
  const otherNodes = [];
  if (instances) {
    const iter = instances instanceof Map ? instances.values() : Object.values(instances);
    for (const inst of iter) {
      if (!inst) continue;
      if (excludePrototypeIds.has(inst.prototypeId)) continue;
      const proto = nodePrototypesMap.get(inst.prototypeId);
      const name = proto?.name;
      if (!name) continue;
      const key = name.toLowerCase().trim();
      if (seenProtoNames.has(key)) continue;
      seenProtoNames.add(key);
      otherNodes.push(name);
    }
  }
  const instanceCount = instances instanceof Map
    ? instances.size
    : (instances ? Object.keys(instances).length : 0);
  const edgeCount = Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0;
  lines.push(`- Graph size: ${instanceCount} instance${instanceCount === 1 ? '' : 's'}, ${edgeCount} connection${edgeCount === 1 ? '' : 's'}.`);

  if (otherNodes.length > 0) {
    const sample = otherNodes.slice(0, maxOtherNodes);
    const more = otherNodes.length > maxOtherNodes ? ` (+${otherNodes.length - maxOtherNodes} more)` : '';
    lines.push(`- Other prototypes present in the graph: ${sample.map((n) => `"${n}"`).join(', ')}${more}.`);
  }

  return lines;
}

// base Thing. A node's type in Redstring is already a generalization of it, so this
// is a ready-made ladder of broader terms — the strongest evidence in the project
// for what belongs further down a generalization axis.
export function collectTypeAncestry(prototype, nodePrototypesMap) {
  const ancestry = [];
  const seen = new Set([prototype?.id]);
  let cursor = prototype?.typeNodeId ? nodePrototypesMap.get(prototype.typeNodeId) : null;
  while (cursor && !seen.has(cursor.id) && cursor.id !== 'base-thing-prototype') {
    seen.add(cursor.id);
    ancestry.push(cursor);
    cursor = cursor.typeNodeId ? nodePrototypesMap.get(cursor.typeNodeId) : null;
  }
  return ancestry;
}

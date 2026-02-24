/**
 * ContextBuilder - Builds graph state context for LLM
 * Formats graph data into a concise context string for the system prompt
 */

/**
 * Build context string from graph state
 * @param {Object} graphState - Graph state from UI
 * @returns {string} Formatted context string
 */
export function buildContext(graphState) {
  if (!graphState) {
    return 'No graph state available.';
  }

  const { graphs = [], nodePrototypes = [], edges = [], activeGraphId } = graphState;

  let context = '';

  // Active graph info
  const activeGraph = graphs.find(g => g.id === activeGraphId);
  if (activeGraph) {
    context += `\n\nCURRENT WEB: "${activeGraph.name}"`;

    // Extract instances
    const instances = activeGraph.instances instanceof Map
      ? Array.from(activeGraph.instances.values())
      : Array.isArray(activeGraph.instances)
        ? activeGraph.instances
        : Object.values(activeGraph.instances || {});

    const edgeIds = activeGraph.edgeIds || [];
    const nodeCount = instances.length;
    const edgeCount = edgeIds.length;

    if (nodeCount === 0) {
      context += '\nStatus: Empty (perfect for populating!)';
    } else {
      context += `\nStatus: ${nodeCount} Thing${nodeCount !== 1 ? 's' : ''}, ${edgeCount} Connection${edgeCount !== 1 ? 's' : ''}`;

      // Build a prototype map for name + description lookups
      const protoMap = new Map();
      for (const proto of nodePrototypes) {
        if (proto.id) protoMap.set(proto.id, proto);
      }

      // Build instance name lookup (id → name)
      const nodeNameById = new Map();
      for (const inst of instances) {
        const proto = inst.prototypeId ? protoMap.get(inst.prototypeId) : null;
        const name = inst.name || proto?.name || '';
        nodeNameById.set(inst.id, name);
      }

      // List ALL nodes with descriptions
      const nodeLines = instances.map(inst => {
        const proto = inst.prototypeId ? protoMap.get(inst.prototypeId) : null;
        const name = inst.name || proto?.name || inst.id;
        const desc = inst.description || proto?.description || '';
        return desc ? `  - ${name}: ${desc}` : `  - ${name}`;
      });
      context += `\nThings:\n${nodeLines.join('\n')}`;

      // Include ALL connections as triplets, resolving type from definitionNodeIds
      if (edgeCount > 0 && edges && edges.length > 0) {
        const graphEdges = edges.filter(e => edgeIds.includes(e.id) || edgeIds.includes(e.edgeId));
        if (graphEdges.length > 0) {
          const triplets = graphEdges.map(e => {
            const sourceId = e.sourceId || e.source;
            const targetId = e.destinationId || e.targetId || e.target;
            const sourceName = nodeNameById.get(sourceId) || sourceId || '?';
            const targetName = nodeNameById.get(targetId) || targetId || '?';

            // Resolve type from definition node prototype (most accurate)
            let type = 'relates to';
            if (Array.isArray(e.definitionNodeIds) && e.definitionNodeIds.length > 0) {
              const defProto = protoMap.get(e.definitionNodeIds[0]);
              if (defProto?.name) type = defProto.name;
            } else if (e.type) {
              type = e.type;
            } else if (e.connectionType) {
              type = e.connectionType;
            }

            return `  - ${sourceName} --[${type}]--> ${targetName}`;
          });
          context += `\nConnections:\n${triplets.join('\n')}`;
        }
      }

      // Include ALL groups with member names and Thing-Group indicators
      const groups = activeGraph.groups instanceof Map
        ? Array.from(activeGraph.groups.values())
        : Array.isArray(activeGraph.groups)
          ? activeGraph.groups
          : Object.values(activeGraph.groups || {});
      if (groups.length > 0) {
        const groupLines = groups.map(g => {
          const memberIds = g.memberInstanceIds || g.members || [];
          const memberNames = memberIds
            .map(mid => nodeNameById.get(mid))
            .filter(Boolean);

          const memberList = memberNames.length > 0
            ? `: ${memberNames.join(', ')}`
            : '';

          // Check if Thing-Group (backed by a node prototype)
          const isThingGroup = !!g.linkedNodePrototypeId;
          const thingIndicator = isThingGroup
            ? ` [Thing-Group: ${protoMap.get(g.linkedNodePrototypeId)?.name || 'Unknown'}]`
            : '';

          return `  - ${g.name || 'Unnamed'}${thingIndicator} (${memberIds.length} members)${memberList}`;
        });
        context += `\nGroups:\n${groupLines.join('\n')}`;
      }
    }
  } else if (graphs.length > 0) {
    const graphNames = graphs.slice(0, 3).map(g => `"${g.name}"`).join(', ');
    context += `\n\nAVAILABLE WEBS: ${graphs.length} total (${graphNames}${graphs.length > 3 ? '...' : ''})`;
    context += '\nNo active web - create one or open an existing web.';
  } else {
    context += '\n\nNo webs yet - perfect time to create one!';
  }

  // Color palette
  const colors = new Set();
  nodePrototypes.forEach(proto => {
    if (proto.color) colors.add(proto.color);
  });

  if (colors.size > 0) {
    const colorList = Array.from(colors).slice(0, 8).join(', ');
    context += `\n\nColor palette in use: ${colorList}${colors.size > 8 ? '...' : ''}`;
  }

  return context;
}

/**
 * Truncate context if too long (keep under ~8k tokens)
 * @param {string} context - Context string
 * @param {number} maxLength - Maximum length in characters
 * @returns {string} Truncated context
 */
export function truncateContext(context, maxLength = 4000) {
  const suffix = '\n... (truncated)';
  const suffixLength = suffix.length;
  const effectiveMaxLength = maxLength - suffixLength;

  if (context.length <= effectiveMaxLength) return context;

  // Try to truncate at a sentence boundary
  const truncated = context.substring(0, effectiveMaxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = Math.max(lastPeriod, lastNewline);

  if (cutPoint > effectiveMaxLength * 0.8) {
    return truncated.substring(0, cutPoint + 1) + suffix;
  }

  return truncated + suffix;
}


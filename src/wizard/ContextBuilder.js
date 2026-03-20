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
    context += `\n\n## Environment Snapshot`;
    context += `\nCURRENT WEB (open on user's screen): "${activeGraph.name}"`;

    // Check if this graph is a definition graph for any node
    const definingNodes = nodePrototypes.filter(proto =>
      Array.isArray(proto.definitionGraphIds) &&
      proto.definitionGraphIds.includes(activeGraphId)
    );
    if (definingNodes.length > 0) {
      const nodeNames = definingNodes.map(p => p.name).join(', ');
      context += `\n⚡ This web is a DEFINITION GRAPH for: ${nodeNames}`;
      context += '\n   (You are inside a node, viewing/editing what it is made of)';
    }

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

      // List ALL nodes with compact descriptions
      const nodeLines = instances.map(inst => {
        const proto = inst.prototypeId ? protoMap.get(inst.prototypeId) : null;
        const name = inst.name || proto?.name || inst.id;
        const rawDesc = inst.description || proto?.description || '';
        const desc = rawDesc.length > 60 ? rawDesc.substring(0, 60) + '...' : rawDesc;

        // Check if node has definition graphs (expandable)
        const defGraphIds = proto?.definitionGraphIds;
        const hasDefinitions = Array.isArray(defGraphIds) && defGraphIds.length > 0;
        const expandable = hasDefinitions ? ' [has def]' : '';

        let typeStr = '';
        if (proto?.typeNodeId) {
          const typeProto = protoMap.get(proto.typeNodeId);
          if (typeProto) typeStr = ` [Type: ${typeProto.name || proto.typeNodeId}]`;
        }

        const namePart = `${name}${typeStr}${expandable}`;
        return desc ? `  - ${namePart}: ${desc}` : `  - ${namePart}`;
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

    // Lightweight roster of OTHER webs (so LLM knows what else exists)
    const otherGraphs = graphs.filter(g => g.id !== activeGraphId);
    if (otherGraphs.length > 0) {
      const otherNames = otherGraphs.slice(0, 8).map(g => `"${g.name}"`).join(', ');
      context += `\nOther webs available: ${otherNames}${otherGraphs.length > 8 ? ` (+${otherGraphs.length - 8} more)` : ''}`;
    }
  } else if (graphs.length > 0) {
    const graphNames = graphs.slice(0, 3).map(g => `"${g.name}"`).join(', ');
    context += `\n\nAVAILABLE WEBS: ${graphs.length} total (${graphNames}${graphs.length > 3 ? '...' : ''})`;
    context += '\nNo active web - create one or open an existing web.';
  } else {
    context += '\n\nNo webs yet - perfect time to create one!';
  }

  // Type palette
  const types = new Set();
  nodePrototypes.forEach(proto => {
    if (proto.typeNodeId) {
      const typeProto = nodePrototypes.find(p => p.id === proto.typeNodeId);
      if (typeProto) types.add(typeProto.name);
    }
  });

  if (types.size > 0) {
    const typeList = Array.from(types).slice(0, 8).join(', ');
    context += `\nTypes in use: ${typeList}${types.size > 8 ? '...' : ''}`;
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

/**
 * Build plan context string for injection into system prompt
 * @param {Array} plan - Array of { description, status, substeps? } steps
 * @param {number} iteration - Current iteration (0-indexed)
 * @param {number} maxIterations - Max iterations allowed
 * @returns {string} Formatted plan string
 */
export function buildPlanContext(plan, iteration, maxIterations) {
  if (!plan || plan.length === 0) return '';
  const done = plan.filter(s => s.status === 'done').length;
  const iterInfo = typeof iteration === 'number' && typeof maxIterations === 'number'
    ? ` — Iteration ${iteration + 1} of ${maxIterations}`
    : '';
  const lines = plan.map((step, i) => {
    const icon = step.status === 'done' ? '[DONE]'
      : step.status === 'in_progress' ? '[IN PROGRESS]'
      : '[ ]';
    let line = `  ${i + 1}. ${icon} ${step.description}`;

    // Add substep lines if present
    if (step.substeps && step.substeps.length > 0) {
      for (let j = 0; j < step.substeps.length; j++) {
        const sub = step.substeps[j];
        const subIcon = sub.status === 'done' ? '[DONE]'
          : sub.status === 'in_progress' ? '[IN PROGRESS]'
          : '[ ]';
        const letter = String.fromCharCode(97 + j);
        line += `\n    ${letter}. ${subIcon} ${sub.description}`;
      }
    }
    return line;
  });
  return `\n\n## Active Plan (${done}/${plan.length} complete)${iterInfo}\n${lines.join('\n')}\nIMPORTANT: Do NOT respond to the user until ALL steps are marked done.`;
}

/**
 * Build persistent context header respecting UI context toggles
 * @param {Object} graphState - Graph state from UI
 * @param {Array} contextItems - Array of { type, id, label, enabled } from UI context chips
 * @returns {string} Formatted context header for system prompt
 */
export function buildPersistentContextHeader(graphState, contextItems = []) {
  if (!graphState) {
    return 'No graph state available.';
  }

  // Check if 'activeGraph' context is enabled (defaults to true if no items specified)
  const activeGraphItem = contextItems.find(item => item.type === 'activeGraph');
  const includeActiveGraph = !activeGraphItem || activeGraphItem.enabled !== false;

  if (includeActiveGraph) {
    // Use the full buildContext which includes Environment Snapshot framing
    return buildContext(graphState);
  }

  // Active graph context is disabled — provide minimal info
  const { graphs = [] } = graphState;
  let context = '';

  if (graphs.length > 0) {
    const graphNames = graphs.slice(0, 5).map(g => `"${g.name}"`).join(', ');
    context += `\n\nAvailable webs: ${graphs.length} total (${graphNames}${graphs.length > 5 ? '...' : ''})`;
    context += '\n(Active graph context is disabled by user.)';
  } else {
    context += '\n\nNo webs yet - perfect time to create one!';
  }

  return context;
}


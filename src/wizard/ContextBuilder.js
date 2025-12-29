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
    context += `\n\n🎯 CURRENT WEB: "${activeGraph.name}"`;
    
    // Extract instances (handle Map, Array, or Object)
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
      
      // List node names directly from instances (with prototype fallback)
      const nodeNames = [];
      for (const inst of instances) {
        // Try instance name first, then look up prototype
        let name = inst.name;
        if (!name && inst.prototypeId) {
          const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
          name = proto?.name;
        }
        if (name) {
          nodeNames.push(name);
        }
        if (nodeNames.length >= 15) break; // Show more names for better context
      }
      
      if (nodeNames.length > 0) {
        context += `\nExisting Things: ${nodeNames.join(', ')}${nodeCount > 15 ? '...' : ''}`;
      }
    }
    
    // Include groups if present
    const groups = activeGraph.groups || [];
    if (groups.length > 0) {
      const groupNames = groups.slice(0, 5).map(g => g.name || 'Unnamed').join(', ');
      context += `\nGroups: ${groupNames}${groups.length > 5 ? '...' : ''}`;
    }
    
    // Include edge/connection info if available
    if (edgeCount > 0 && edges && edges.length > 0) {
      // Filter edges belonging to this graph
      const graphEdges = edges.filter(e => 
        edgeIds.includes(e.id) || edgeIds.includes(e.edgeId)
      );
      if (graphEdges.length > 0) {
        const edgeDescriptions = graphEdges.slice(0, 10).map(e => {
          const sourceInst = instances.find(i => i.id === e.sourceId || i.id === e.source);
          const targetInst = instances.find(i => i.id === e.targetId || i.id === e.target);
          const sourceName = sourceInst?.name || e.sourceName || 'Unknown';
          const targetName = targetInst?.name || e.targetName || 'Unknown';
          const relType = e.type || e.connectionType || 'relates to';
          return `${sourceName} --[${relType}]--> ${targetName}`;
        });
        context += `\nConnections: ${edgeDescriptions.join('; ')}${graphEdges.length > 10 ? '...' : ''}`;
      }
    }
  } else if (graphs.length > 0) {
    const graphNames = graphs.slice(0, 3).map(g => `"${g.name}"`).join(', ');
    context += `\n\n📚 AVAILABLE WEBS: ${graphs.length} total (${graphNames}${graphs.length > 3 ? '...' : ''})`;
    context += '\nNo active web - create one or open an existing web.';
  } else {
    context += '\n\n📚 No webs yet - perfect time to create one!';
  }

  // Color palette (from node prototypes)
  const colors = new Set();
  nodePrototypes.forEach(proto => {
    if (proto.color) colors.add(proto.color);
  });
  
  if (colors.size > 0) {
    const colorList = Array.from(colors).slice(0, 8).join(', ');
    context += `\n\n🎨 Color palette in use: ${colorList}${colors.size > 8 ? '...' : ''}`;
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


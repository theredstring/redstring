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
    
    // Count nodes and edges in active graph
    const nodeIds = new Set();
    const edgeIds = activeGraph.edgeIds || [];
    
    // Collect node IDs from instances
    if (activeGraph.instances) {
      const instances = Array.isArray(activeGraph.instances) 
        ? activeGraph.instances 
        : Object.values(activeGraph.instances);
      instances.forEach(inst => {
        if (inst.prototypeId) nodeIds.add(inst.prototypeId);
      });
    }

    const nodeCount = nodeIds.size;
    const edgeCount = edgeIds.length;

    if (nodeCount === 0) {
      context += '\nStatus: Empty (perfect for populating!)';
    } else {
      context += `\nStatus: ${nodeCount} Thing${nodeCount !== 1 ? 's' : ''}, ${edgeCount} Connection${edgeCount !== 1 ? 's' : ''}`;
      
      // List some node names
      const nodeNames = [];
      for (const protoId of nodeIds) {
        const proto = nodePrototypes.find(p => p.id === protoId);
        if (proto) nodeNames.push(proto.name);
        if (nodeNames.length >= 10) break;
      }
      
      if (nodeNames.length > 0) {
        context += `\nExisting Things: ${nodeNames.join(', ')}${nodeCount > 10 ? '...' : ''}`;
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
  if (context.length <= maxLength) return context;
  
  // Try to truncate at a sentence boundary
  const truncated = context.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = Math.max(lastPeriod, lastNewline);
  
  if (cutPoint > maxLength * 0.8) {
    return truncated.substring(0, cutPoint + 1) + '\n... (truncated)';
  }
  
  return truncated + '... (truncated)';
}


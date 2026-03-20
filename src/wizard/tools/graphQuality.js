/**
 * graphQuality - Shared graph quality analysis function
 *
 * Analyzes a set of nodes and edges for connectivity, orphans,
 * disconnected components, and density. Used by populateDefinitionGraph,
 * createPopulatedGraph, expandGraph, and sketchGraph to provide
 * automatic quality feedback to the LLM.
 */

/**
 * Analyze the quality of a graph given its nodes and edges
 * @param {Array<{name: string}>} nodes - Node specs (must have .name)
 * @param {Array<{source: string, target: string}>} edges - Edge specs (must have .source, .target)
 * @returns {Object} Quality report
 */
export function analyzeGraphQuality(nodes, edges) {
  if (!nodes || nodes.length === 0) {
    return {
      orphanedNodes: [],
      disconnectedComponents: 0,
      avgConnectionsPerNode: 0,
      weakNodes: [],
      densityScore: 0,
      feedback: 'No nodes to analyze.'
    };
  }

  const nodeNames = nodes.map(n => n.name.toLowerCase().trim());
  const nameSet = new Set(nodeNames);

  // Build adjacency list (case-insensitive)
  const adj = new Map();
  for (const name of nodeNames) {
    adj.set(name, new Set());
  }

  for (const edge of edges) {
    const src = (edge.source || '').toLowerCase().trim();
    const tgt = (edge.target || '').toLowerCase().trim();
    if (nameSet.has(src) && nameSet.has(tgt)) {
      adj.get(src).add(tgt);
      adj.get(tgt).add(src);
    }
  }

  // Find orphans (degree 0) and weak nodes (degree 1)
  const orphanedNodes = [];
  const weakNodes = [];
  const degrees = new Map();

  for (const [name, neighbors] of adj) {
    const degree = neighbors.size;
    degrees.set(name, degree);
    // Find original-case name for display
    const originalName = nodes.find(n => n.name.toLowerCase().trim() === name)?.name || name;
    if (degree === 0) {
      orphanedNodes.push(originalName);
    } else if (degree === 1) {
      weakNodes.push(originalName);
    }
  }

  // Count connected components via BFS
  const visited = new Set();
  let componentCount = 0;

  for (const name of nodeNames) {
    if (visited.has(name)) continue;
    componentCount++;
    const queue = [name];
    visited.add(name);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // Calculate average connections and density
  const totalDegree = Array.from(degrees.values()).reduce((sum, d) => sum + d, 0);
  const avgConnectionsPerNode = nodes.length > 0
    ? Math.round((totalDegree / nodes.length) * 100) / 100
    : 0;

  // Density: actual edges / max possible edges (for undirected graph)
  const maxEdges = nodes.length > 1 ? (nodes.length * (nodes.length - 1)) / 2 : 0;
  const densityScore = maxEdges > 0
    ? Math.round((edges.length / maxEdges) * 100) / 100
    : 0;

  // Build feedback string
  const issues = [];
  if (orphanedNodes.length > 0) {
    issues.push(`${orphanedNodes.length} orphaned node(s) with no connections: ${orphanedNodes.join(', ')}. Connect them to related nodes.`);
  }
  if (componentCount > 1) {
    issues.push(`Graph has ${componentCount} disconnected components — should be 1 connected graph. Add edges to bridge them.`);
  }
  if (avgConnectionsPerNode < 1.5 && nodes.length > 2) {
    issues.push(`Low connectivity (avg ${avgConnectionsPerNode} connections/node). Aim for 2-3 connections per node.`);
  }

  // Check for nodes missing descriptions
  const noDescriptionNodes = nodes
    .filter(n => !n.description || n.description.trim() === '')
    .map(n => n.name);
  if (noDescriptionNodes.length > 0) {
    issues.push(`${noDescriptionNodes.length} node(s) have no description: ${noDescriptionNodes.join(', ')}. Add brief bios.`);
  }

  const feedback = issues.length > 0
    ? 'QUALITY ISSUES: ' + issues.join(' ')
    : `Good structure. ${nodes.length} nodes, ${edges.length} edges, all connected.`;

  return {
    orphanedNodes,
    disconnectedComponents: componentCount,
    avgConnectionsPerNode,
    weakNodes,
    noDescriptionNodes,
    densityScore,
    feedback
  };
}

/**
 * sketchGraph - Lightweight graph ideation tool
 *
 * Accepts a simple structured shorthand format and expands it into
 * a full graph spec with quality analysis. Separates "thinking" (cheap)
 * from "formatting" (mechanical) so the LLM can plan graph structure
 * at low token cost before committing to expensive tool calls.
 *
 * Input format:
 *   nodes: ["Engine Block", "Pistons [Component]", "Oil Pump [System]"]
 *   edges: ["Pistons -> Housed In -> Engine Block", "Oil Pump -> Lubricates -> Engine Block"]
 *   groups: ["Core: Engine Block, Pistons, Crankshaft"]
 *
 * Returns: expanded spec ready for populateDefinitionGraph/createPopulatedGraph,
 *          plus quality analysis (orphans, connectivity, etc.)
 */

import { resolvePaletteColor, getRandomPalette, PALETTES } from '../../ai/palettes.js';
import { analyzeGraphQuality } from './graphQuality.js';

/**
 * Coerce an LLM-provided value to a string.
 * LLMs sometimes send objects ({name: "X"}) instead of plain strings.
 */
function coerceToString(val) {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    if (typeof val.name === 'string') return val.name;
    if (typeof val.source === 'string' && typeof val.target === 'string') {
      const relation = typeof val.relation === 'string' ? val.relation : 'Connected To';
      return `${val.source} -> ${relation} -> ${val.target}`;
    }
    return JSON.stringify(val);
  }
  return String(val || '');
}

/**
 * Parse a node string like "Pistons [Component]" into { name, type }
 */
function parseNodeString(str) {
  const trimmed = coerceToString(str).trim();
  const typeMatch = trimmed.match(/^(.+?)\s*\[([^\]]+)\]\s*$/);
  if (typeMatch) {
    return { name: typeMatch[1].trim(), type: typeMatch[2].trim() };
  }
  return { name: trimmed, type: null };
}

/**
 * Parse an edge string like "Pistons -> Housed In -> Engine Block" into { source, relation, target }
 */
function parseEdgeString(str) {
  const trimmed = coerceToString(str).trim();
  const parts = trimmed.split('->').map(p => p.trim());

  if (parts.length === 3) {
    return { source: parts[0], relation: parts[1], target: parts[2] };
  } else if (parts.length === 2) {
    // "A -> B" with no relation
    return { source: parts[0], relation: 'Connected To', target: parts[1] };
  }
  return null;
}

/**
 * Parse a group string like "Core Components: Engine Block, Pistons, Crankshaft"
 */
function parseGroupString(str) {
  const trimmed = coerceToString(str).trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx < 0) return null;

  const name = trimmed.slice(0, colonIdx).trim();
  const members = trimmed.slice(colonIdx + 1).split(',').map(m => m.trim()).filter(Boolean);

  return { name, memberNames: members };
}

/**
 * Convert string to Title Case
 */
function toTitleCase(str) {
  if (!str) return '';
  const spaced = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Generate a deterministic color from a name
 */
function generateConnectionColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/**
 * Sketch a graph in shorthand and expand it to a full spec
 * @param {Object} args - { name, nodes, edges, groups?, palette? }
 * @param {Object} graphState - Current graph state (for palette context)
 * @returns {Object} Preview with quality analysis and expanded spec
 */
export async function sketchGraph(args) {
  const { name, nodes = [], edges = [], groups = [], palette } = args;

  if (!name) {
    throw new Error('name is required — what graph/node is this sketch for?');
  }
  if (!nodes || nodes.length === 0) {
    throw new Error('At least one node is required in the sketch');
  }

  // Parse shorthand into structured data
  const parsedNodes = nodes.map(parseNodeString);
  const parsedEdges = edges.map(parseEdgeString).filter(Boolean);
  const parsedGroups = (groups || []).map(parseGroupString).filter(Boolean);

  // Validate: check for duplicate node names
  const nodeNameSet = new Set();
  const duplicates = [];
  for (const node of parsedNodes) {
    const lower = node.name.toLowerCase();
    if (nodeNameSet.has(lower)) {
      duplicates.push(node.name);
    }
    nodeNameSet.add(lower);
  }

  // Validate: check edges reference existing nodes
  const invalidEdges = [];
  for (const edge of parsedEdges) {
    const srcExists = nodeNameSet.has(edge.source.toLowerCase());
    const tgtExists = nodeNameSet.has(edge.target.toLowerCase());
    if (!srcExists || !tgtExists) {
      invalidEdges.push({
        edge: `${edge.source} -> ${edge.relation} -> ${edge.target}`,
        reason: !srcExists ? `"${edge.source}" not in nodes` : `"${edge.target}" not in nodes`
      });
    }
  }

  // Validate: check group members reference existing nodes
  const invalidGroupMembers = [];
  for (const group of parsedGroups) {
    for (const member of group.memberNames) {
      if (!nodeNameSet.has(member.toLowerCase())) {
        invalidGroupMembers.push({ group: group.name, member });
      }
    }
  }

  // Expand to full spec format
  const activePalette = palette || getRandomPalette();
  const paletteColors = PALETTES[activePalette]?.colors || {};
  const colorKeys = Object.keys(paletteColors);

  // Assign colors to nodes by cycling through palette
  const expandedNodes = parsedNodes.map((node, i) => ({
    name: node.name,
    color: colorKeys.length > 0
      ? paletteColors[colorKeys[i % colorKeys.length]]
      : resolvePaletteColor(activePalette, null),
    description: '',
    type: node.type || null,
    typeColor: node.type ? resolvePaletteColor(activePalette, '#A0A0A0') : null,
    typeDescription: ''
  }));

  // Expand edges with definitionNode objects
  const expandedEdges = parsedEdges
    .filter(e => {
      // Only include valid edges
      return nodeNameSet.has(e.source.toLowerCase()) && nodeNameSet.has(e.target.toLowerCase());
    })
    .map(edge => {
      const titleCaseName = toTitleCase(edge.relation);
      return {
        source: edge.source,
        target: edge.target,
        directionality: 'unidirectional',
        definitionNode: {
          name: titleCaseName,
          color: generateConnectionColor(titleCaseName),
          description: ''
        }
      };
    });

  // Expand groups
  const expandedGroups = parsedGroups.map(group => ({
    name: group.name,
    color: resolvePaletteColor(activePalette, '#8B0000'),
    memberNames: group.memberNames
  }));

  // Run quality analysis on the expanded spec
  const quality = analyzeGraphQuality(expandedNodes, expandedEdges);

  // Build validation warnings
  const warnings = [];
  if (duplicates.length > 0) {
    warnings.push(`Duplicate node names: ${duplicates.join(', ')}`);
  }
  if (invalidEdges.length > 0) {
    warnings.push(`Invalid edges (referencing non-existent nodes): ${invalidEdges.map(e => e.edge + ' — ' + e.reason).join('; ')}`);
  }
  if (invalidGroupMembers.length > 0) {
    warnings.push(`Invalid group members: ${invalidGroupMembers.map(m => `"${m.member}" in group "${m.group}"`).join(', ')}`);
  }

  const feedback = warnings.length > 0
    ? 'SKETCH ISSUES: ' + warnings.join(' | ') + ' — ' + quality.feedback
    : quality.feedback;

  return {
    action: null, // Read-only tool — no graph mutation
    name,
    palette: activePalette,
    preview: {
      nodeCount: expandedNodes.length,
      edgeCount: expandedEdges.length,
      groupCount: expandedGroups.length,
      orphanedNodes: quality.orphanedNodes,
      disconnectedComponents: quality.disconnectedComponents,
      avgConnections: quality.avgConnectionsPerNode,
      densityScore: quality.densityScore
    },
    expandedSpec: {
      nodes: expandedNodes,
      edges: expandedEdges,
      groups: expandedGroups
    },
    warnings,
    feedback
  };
}

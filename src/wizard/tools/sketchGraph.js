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
 * Parse a group string. Two forms:
 *   "Core Components: Engine Block, Pistons"   → plain visual group
 *   "Engine:: Pistons, Crankshaft"             → LAYER (node-group): a Thing whose
 *                                                web contains those members
 *   "Engine:: Pistons, Crankshaft (collapsed)" → layer that stays closed
 *   "Drivetrain:: use"                         → layer invoking an existing web
 *
 * The double colon is the whole distinction: a layer IS a concept with a web
 * inside it, a plain group is just visual clustering.
 */
function parseGroupString(str) {
  const trimmed = coerceToString(str).trim();

  const layerIdx = trimmed.indexOf('::');
  if (layerIdx >= 0) {
    const name = trimmed.slice(0, layerIdx).trim();
    let rest = trimmed.slice(layerIdx + 2).trim();
    if (!name) return null;

    let display = 'decomposed';
    const collapsedMatch = rest.match(/\((collapsed|closed)\)\s*$/i);
    if (collapsedMatch) {
      display = 'collapsed';
      rest = rest.slice(0, collapsedMatch.index).trim();
    }

    if (/^use$/i.test(rest)) {
      return { kind: 'layer', name, display, use: name, memberNames: [] };
    }

    const members = rest.split(',').map(m => m.trim()).filter(Boolean);
    return { kind: 'layer', name, display, use: null, memberNames: members };
  }

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx < 0) return null;

  const name = trimmed.slice(0, colonIdx).trim();
  const members = trimmed.slice(colonIdx + 1).split(',').map(m => m.trim()).filter(Boolean);

  return { kind: 'group', name, memberNames: members };
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

/** All prototype names in the serialized graphState, for validating `use:` targets. */
function knownPrototypeNames(graphState) {
  const names = new Set();
  const protos = graphState?.nodePrototypes;
  if (!protos) return names;
  const iter = Array.isArray(protos) ? protos : (protos instanceof Map ? protos.values() : Object.values(protos));
  for (const p of iter) if (p?.name) names.add(String(p.name).toLowerCase().trim());
  return names;
}

/**
 * Expand one level of the structured `layers` param (shorthand innards) into
 * normalized LayerSpecs — the exact shape buildComposition consumes.
 */
function expandLayerSpecs(layers, ctx, depth, path) {
  const out = [];
  for (const raw of (layers || [])) {
    if (!raw || !raw.name) {
      ctx.warnings.push(`${path}: dropped a layer with no name.`);
      continue;
    }
    const lPath = `${path} › ${raw.name}`;
    ctx.maxDepth = Math.max(ctx.maxDepth, depth + 1);
    ctx.layerCount += 1;

    const display = raw.display === 'collapsed' ? 'collapsed' : 'decomposed';
    const layer = {
      name: raw.name,
      color: resolvePaletteColor(ctx.palette, raw.color || '#8B0000'),
      description: raw.description || '',
      display
    };

    const useName = typeof raw.use === 'string' && raw.use.trim() ? raw.use.trim() : null;
    if (useName) {
      layer.use = useName;
      if (!ctx.knownPrototypes.has(useName.toLowerCase().trim())) {
        ctx.warnings.push(`${lPath}: use: "${useName}" — no existing Thing with that name. Author a definition instead, or check the spelling.`);
      }
      out.push(layer);
      continue;
    }

    const def = raw.definition || {};
    const defNodes = (def.nodes || []).map(parseNodeString).filter(n => n.name);
    const defNodeNames = new Set(defNodes.map(n => n.name.toLowerCase()));
    const defLayers = expandLayerSpecs(def.layers, ctx, depth + 1, lPath);
    for (const dl of defLayers) defNodeNames.add(dl.name.toLowerCase());

    const defEdges = [];
    for (const e of (def.edges || []).map(parseEdgeString).filter(Boolean)) {
      if (!defNodeNames.has(e.source.toLowerCase()) || !defNodeNames.has(e.target.toLowerCase())) {
        ctx.warnings.push(`${lPath}: dropped edge "${e.source} -> ${e.target}" (endpoint not inside this layer).`);
        continue;
      }
      const titleCaseName = toTitleCase(e.relation);
      defEdges.push({
        source: e.source,
        target: e.target,
        directionality: 'unidirectional',
        definitionNode: { name: titleCaseName, color: generateConnectionColor(titleCaseName), description: '' }
      });
    }

    const defGroups = [];
    for (const g of (def.groups || []).map(parseGroupString).filter(Boolean)) {
      if (g.kind === 'layer') {
        ctx.warnings.push(`${lPath}: nested "::" shorthand inside a definition is ignored — use the definition's own "layers" array for deeper nesting.`);
        continue;
      }
      const members = g.memberNames.filter(m => defNodeNames.has(m.toLowerCase()));
      if (members.length > 0) {
        defGroups.push({ name: g.name, color: resolvePaletteColor(ctx.palette, '#8B0000'), memberNames: members });
      }
    }

    layer.definition = {
      nodes: defNodes.map((n, i) => ({
        name: n.name,
        color: ctx.colorFor(i + depth),
        description: '',
        type: n.type || null,
        typeColor: n.type ? resolvePaletteColor(ctx.palette, '#A0A0A0') : null,
        typeDescription: ''
      })),
      edges: defEdges,
      groups: defGroups,
      layers: defLayers
    };

    const innerCount = layer.definition.nodes.length + defLayers.length;
    if (innerCount === 0) {
      ctx.warnings.push(`${lPath}: definition is empty — give it 3-8 sub-components, or make it a plain node instead of a layer.`);
    } else if (innerCount < 2) {
      ctx.warnings.push(`${lPath}: only ${innerCount} component inside — too thin to be a web. Consider a plain node.`);
    }

    out.push(layer);
  }
  return out;
}

/**
 * Sketch a graph in shorthand and expand it to a full spec.
 *
 * The expandedSpec IS the executable input to buildComposition (and to
 * createPopulatedGraph / populateDefinitionGraph for the flat parts) — pass it
 * through rather than re-authoring it.
 *
 * @param {Object} args - { name, nodes, edges, groups?, layers?, palette? }
 * @param {Object} graphState - Current graph state (palette context, `use:` validation)
 * @returns {Object} Preview with quality analysis and expanded spec
 */
export async function sketchGraph(args, graphState) {
  const { name, nodes = [], edges = [], groups = [], layers = [], palette } = args;

  if (!name) {
    throw new Error('name is required — what graph/node is this sketch for? Example: sketchGraph({"name": "GTA Locations", "nodes": ["Los Santos", "San Fierro"]})');
  }
  if ((!nodes || nodes.length === 0) && (!layers || layers.length === 0) && (!groups || groups.length === 0)) {
    throw new Error('At least one node or layer is required in the sketch. Example: sketchGraph({"name": "GTA Locations", "nodes": ["Los Santos", "San Fierro"]})');
  }

  // Parse shorthand into structured data
  const parsedNodes = nodes.map(parseNodeString);
  const parsedEdges = edges.map(parseEdgeString).filter(Boolean);
  const parsedEntries = (groups || []).map(parseGroupString).filter(Boolean);
  const parsedGroups = parsedEntries.filter(g => g.kind === 'group');
  const shorthandLayers = parsedEntries.filter(g => g.kind === 'layer');

  // Expand to full spec format
  const activePalette = palette || getRandomPalette();
  const paletteColors = PALETTES[activePalette]?.colors || {};
  const colorKeys = Object.keys(paletteColors);
  const colorFor = (i) => (colorKeys.length > 0
    ? paletteColors[colorKeys[i % colorKeys.length]]
    : resolvePaletteColor(activePalette, null));

  const ctx = {
    palette: activePalette,
    colorFor,
    knownPrototypes: knownPrototypeNames(graphState),
    warnings: [],
    maxDepth: 0,
    layerCount: 0
  };

  // "Name:: a, b" shorthand becomes a layer whose definition holds those members.
  // Members named here are MOVED off the top level: a layer's members live inside
  // its web, and decomposing the layer materializes them in the parent.
  const shorthandLayerSpecs = expandLayerSpecs(
    shorthandLayers.map(l => (l.use
      ? { name: l.name, display: l.display, use: l.use }
      : { name: l.name, display: l.display, definition: { nodes: l.memberNames } }
    )),
    ctx, 0, name
  );
  const structuredLayerSpecs = expandLayerSpecs(layers, ctx, 0, name);
  const expandedLayers = [...shorthandLayerSpecs, ...structuredLayerSpecs];

  const movedIntoLayers = new Set();
  for (const l of shorthandLayers) {
    for (const m of l.memberNames) movedIntoLayers.add(m.toLowerCase());
  }
  const movedNames = parsedNodes.filter(n => movedIntoLayers.has(n.name.toLowerCase())).map(n => n.name);
  const topLevelNodes = parsedNodes.filter(n => !movedIntoLayers.has(n.name.toLowerCase()));
  if (movedNames.length > 0) {
    ctx.warnings.push(`Moved ${movedNames.join(', ')} into their layer's web (a layer's members live inside it, not beside it).`);
  }

  // Validate: check for duplicate node names
  const nodeNameSet = new Set();
  const duplicates = [];
  for (const node of topLevelNodes) {
    const lower = node.name.toLowerCase();
    if (nodeNameSet.has(lower)) {
      duplicates.push(node.name);
    }
    nodeNameSet.add(lower);
  }
  // Layer names are legal edge/group endpoints at this level — a layer
  // materializes as a Thing here, and edges to it attach to that Thing.
  const layerNameSet = new Set();
  for (const l of expandedLayers) {
    const lower = l.name.toLowerCase();
    if (layerNameSet.has(lower)) duplicates.push(l.name);
    layerNameSet.add(lower);
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

  // Assign colors to nodes by cycling through palette
  const expandedNodes = topLevelNodes.map((node, i) => ({
    name: node.name,
    color: colorFor(i),
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

  // Run quality analysis on the expanded spec. Layers count as nodes here — a
  // layer occupies a spot on the canvas exactly like a Thing does.
  const quality = analyzeGraphQuality(
    [...expandedNodes, ...expandedLayers.map(l => ({ name: l.name, color: l.color, description: l.description }))],
    expandedEdges
  );

  // Build validation warnings
  const warnings = [...ctx.warnings];
  if (duplicates.length > 0) {
    warnings.push(`Duplicate node names: ${duplicates.join(', ')}`);
  }
  if (invalidEdges.length > 0) {
    warnings.push(`Invalid edges (referencing non-existent nodes): ${invalidEdges.map(e => e.edge + ' — ' + e.reason).join('; ')}`);
  }
  if (invalidGroupMembers.length > 0) {
    warnings.push(`Invalid group members: ${invalidGroupMembers.map(m => `"${m.member}" in group "${m.group}"`).join(', ')}`);
  }
  if (ctx.maxDepth > 3) {
    warnings.push(`Nesting is ${ctx.maxDepth} levels deep — deep stacks are hard to read. Consider marking some layers "collapsed".`);
  }

  const feedback = warnings.length > 0
    ? 'SKETCH ISSUES: ' + warnings.join(' | ') + ' — ' + quality.feedback
    : quality.feedback;

  return {
    action: null, // Read-only tool — no graph mutation
    name,
    palette: activePalette,
    // How to execute this sketch: layers require buildComposition; a flat sketch
    // goes to createPopulatedGraph/populateDefinitionGraph as before.
    buildWith: expandedLayers.length > 0 ? 'buildComposition' : 'createPopulatedGraph',
    preview: {
      nodeCount: expandedNodes.length,
      edgeCount: expandedEdges.length,
      groupCount: expandedGroups.length,
      layerCount: ctx.layerCount,
      maxDepth: ctx.maxDepth,
      decomposedLayers: expandedLayers.filter(l => l.display !== 'collapsed').map(l => l.name),
      collapsedLayers: expandedLayers.filter(l => l.display === 'collapsed').map(l => l.name),
      orphanedNodes: quality.orphanedNodes,
      disconnectedComponents: quality.disconnectedComponents,
      avgConnections: quality.avgConnectionsPerNode,
      densityScore: quality.densityScore
    },
    // This IS the executable input — pass it straight to buildComposition (or to
    // createPopulatedGraph/populateDefinitionGraph when there are no layers).
    // Do not re-author it.
    expandedSpec: {
      nodes: expandedNodes,
      edges: expandedEdges,
      groups: expandedGroups,
      layers: expandedLayers
    },
    warnings,
    feedback
  };
}

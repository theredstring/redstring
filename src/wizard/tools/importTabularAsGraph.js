/**
 * importTabularAsGraph — Mutating wizard tool
 *
 * Converts parsed tabular data into a graph based on the LLM's mapping decisions.
 * Supports four data shapes: entity_list, edge_list, adjacency_matrix, relational.
 *
 * Returns a spec in the same format as createPopulatedGraph, so the existing
 * applyToolResultToStore handler can apply it.
 */

const MAX_NODES_DEFAULT = 200;

// ─── Color palette for auto-coloring groups ──────────────────────────

const GROUP_COLORS = [
  '#4A90D9', '#D94A4A', '#4AD98F', '#D9A64A', '#9B59B6',
  '#1ABC9C', '#E74C3C', '#3498DB', '#F39C12', '#2ECC71',
  '#E67E22', '#8E44AD', '#16A085', '#C0392B', '#2980B9',
  '#27AE60', '#D35400', '#7D3C98', '#138D75', '#A93226',
];

/**
 * @param {Object} args - Mapping configuration from the LLM
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @returns {Promise<Object>} Action spec for applyToolResultToStore
 */
export async function importTabularAsGraph(args, graphState, cid) {
  const {
    graphName = 'Imported Data',
    description = '',
    dataShape = 'entity_list',
    mapping = {},
    maxNodes = MAX_NODES_DEFAULT,
    enrich = false,
    fileIndex = 0,
    sheetName,
    targetGraphId,
    palette,
  } = args;

  // Access tabular data from config passthrough
  const tabularData = graphState?._tabularData;
  if (!tabularData || !Array.isArray(tabularData) || tabularData.length === 0) {
    return {
      error: 'No tabular data found. Make sure a CSV, TSV, XLSX, or JSON file is attached.'
    };
  }

  if (fileIndex >= tabularData.length) {
    return {
      error: `File index ${fileIndex} out of range. ${tabularData.length} file(s) available.`
    };
  }

  const parsed = tabularData[fileIndex];
  const rows = parsed.rows;

  if (!rows || rows.length === 0) {
    return { error: 'No data rows found in the file.' };
  }

  let spec;
  try {
    switch (dataShape) {
      case 'edge_list':
        spec = buildEdgeListGraph(rows, mapping, maxNodes);
        break;
      case 'adjacency_matrix':
        spec = buildAdjacencyMatrixGraph(rows, parsed.columns, mapping, maxNodes);
        break;
      case 'relational':
        spec = buildRelationalGraph(rows, mapping, maxNodes);
        break;
      case 'entity_list':
      default:
        spec = buildEntityListGraph(rows, mapping, maxNodes);
        break;
    }
  } catch (err) {
    return { error: `Failed to build graph: ${err.message}` };
  }

  // Generate a graph ID
  const graphId = targetGraphId || `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    action: 'importTabularAsGraph',
    graphId,
    graphName,
    description,
    enrich,
    spec,
    stats: {
      dataShape,
      sourceFile: parsed.filename,
      sourceRows: parsed.totalRows,
      importedNodes: spec.nodes.length,
      importedEdges: spec.edges.length,
      importedGroups: spec.groups.length,
    }
  };
}

// ─── Data shape builders ─────────────────────────────────────────────

/**
 * Entity list: each row becomes a node.
 */
function buildEntityListGraph(rows, mapping, maxNodes) {
  const {
    nodeNameColumn,
    nodeDescriptionColumns = [],
    nodeTypeColumn,
    nodeColorColumn,
    groupByColumn,
  } = mapping;

  if (!nodeNameColumn) {
    throw new Error('mapping.nodeNameColumn is required for entity_list data shape.');
  }

  const nodes = [];
  const groups = [];
  const edges = [];
  const groupMap = new Map(); // groupValue → { name, color }
  const seenNames = new Set();
  let colorIdx = 0;

  for (const row of rows) {
    if (nodes.length >= maxNodes) break;

    const name = String(row[nodeNameColumn] ?? '').trim();
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    // Build description from selected columns
    const descParts = [];
    for (const col of nodeDescriptionColumns) {
      const val = row[col];
      if (val != null && String(val).trim()) {
        descParts.push(`**${col}**: ${val}`);
      }
    }

    // Determine color from group
    let color = null;
    let groupName = null;
    if (groupByColumn && row[groupByColumn]) {
      groupName = String(row[groupByColumn]).trim();
      if (!groupMap.has(groupName)) {
        const groupColor = GROUP_COLORS[colorIdx % GROUP_COLORS.length];
        colorIdx++;
        groupMap.set(groupName, { name: groupName, color: groupColor });
      }
      color = groupMap.get(groupName).color;
    } else if (nodeColorColumn && row[nodeColorColumn]) {
      // Use color column value as group color
      const colorVal = String(row[nodeColorColumn]).trim();
      if (!groupMap.has(colorVal)) {
        const groupColor = GROUP_COLORS[colorIdx % GROUP_COLORS.length];
        colorIdx++;
        groupMap.set(colorVal, { name: colorVal, color: groupColor });
      }
      color = groupMap.get(colorVal).color;
    }

    const node = {
      name,
      description: descParts.join('\n'),
      color: color || '#4A90D9',
    };

    if (nodeTypeColumn && row[nodeTypeColumn]) {
      node.type = String(row[nodeTypeColumn]).trim();
    }

    nodes.push(node);
  }

  // Build groups from the group map
  for (const [, group] of groupMap) {
    const memberNames = [];
    for (const row of rows) {
      const name = String(row[nodeNameColumn] ?? '').trim();
      const groupVal = groupByColumn
        ? String(row[groupByColumn] ?? '').trim()
        : (nodeColorColumn ? String(row[nodeColorColumn] ?? '').trim() : null);
      if (groupVal === group.name && seenNames.has(name.toLowerCase())) {
        memberNames.push(name);
      }
    }
    if (memberNames.length > 0) {
      groups.push({
        name: group.name,
        color: group.color,
        memberNames,
      });
    }
  }

  return { nodes, edges, groups };
}

/**
 * Edge list: each row is a connection between two entities.
 */
function buildEdgeListGraph(rows, mapping, maxNodes) {
  const {
    sourceColumn,
    targetColumn,
    edgeLabelColumn,
    edgeWeightColumn,
  } = mapping;

  if (!sourceColumn || !targetColumn) {
    throw new Error('mapping.sourceColumn and mapping.targetColumn are required for edge_list data shape.');
  }

  const nodeSet = new Map(); // name → { name, color }
  const edges = [];

  for (const row of rows) {
    const source = String(row[sourceColumn] ?? '').trim();
    const target = String(row[targetColumn] ?? '').trim();
    if (!source || !target) continue;

    // Register nodes
    if (!nodeSet.has(source.toLowerCase()) && nodeSet.size < maxNodes) {
      nodeSet.set(source.toLowerCase(), { name: source, color: '#4A90D9', description: '' });
    }
    if (!nodeSet.has(target.toLowerCase()) && nodeSet.size < maxNodes) {
      nodeSet.set(target.toLowerCase(), { name: target, color: '#4A90D9', description: '' });
    }

    // Only add edge if both nodes are in our set
    if (nodeSet.has(source.toLowerCase()) && nodeSet.has(target.toLowerCase())) {
      const edgeLabel = edgeLabelColumn ? String(row[edgeLabelColumn] ?? '').trim() : 'relates to';
      edges.push({
        source: nodeSet.get(source.toLowerCase()).name,
        target: nodeSet.get(target.toLowerCase()).name,
        type: edgeLabel || 'relates to',
        directionality: 'unidirectional',
      });
    }
  }

  return {
    nodes: [...nodeSet.values()],
    edges,
    groups: [],
  };
}

/**
 * Adjacency matrix: row/column headers are entities, cell values are edge weights.
 */
function buildAdjacencyMatrixGraph(rows, columns, mapping, maxNodes) {
  const labelColumn = mapping.labelColumn || columns[0];
  const entityColumns = columns.filter(c => c !== labelColumn);

  const nodeSet = new Map();
  const edges = [];

  // Collect all entity names (from both row labels and column headers)
  const allEntities = new Set();
  for (const row of rows) {
    const label = String(row[labelColumn] ?? '').trim();
    if (label) allEntities.add(label);
  }
  for (const col of entityColumns) {
    allEntities.add(col);
  }

  // Create nodes (up to maxNodes)
  let count = 0;
  for (const entity of allEntities) {
    if (count >= maxNodes) break;
    if (!nodeSet.has(entity.toLowerCase())) {
      nodeSet.set(entity.toLowerCase(), { name: entity, color: '#4A90D9', description: '' });
      count++;
    }
  }

  // Create edges from non-zero cells
  for (const row of rows) {
    const source = String(row[labelColumn] ?? '').trim();
    if (!source || !nodeSet.has(source.toLowerCase())) continue;

    for (const col of entityColumns) {
      const val = row[col];
      if (val && val !== 0 && val !== '0' && val !== '') {
        const target = col;
        if (!nodeSet.has(target.toLowerCase())) continue;
        if (source.toLowerCase() === target.toLowerCase()) continue; // skip self-loops

        edges.push({
          source: nodeSet.get(source.toLowerCase()).name,
          target: nodeSet.get(target.toLowerCase()).name,
          type: typeof val === 'number' ? `weight: ${val}` : String(val),
          directionality: 'unidirectional',
        });
      }
    }
  }

  return {
    nodes: [...nodeSet.values()],
    edges,
    groups: [],
  };
}

/**
 * Relational: entity list + foreign key references become edges.
 */
function buildRelationalGraph(rows, mapping, maxNodes) {
  const {
    nodeNameColumn,
    nodeDescriptionColumns = [],
    groupByColumn,
    foreignKeyMappings = [],
  } = mapping;

  if (!nodeNameColumn) {
    throw new Error('mapping.nodeNameColumn is required for relational data shape.');
  }

  // First build the entity list (nodes + groups)
  const entitySpec = buildEntityListGraph(rows, {
    nodeNameColumn,
    nodeDescriptionColumns,
    groupByColumn,
  }, maxNodes);

  // Now add edges from foreign key mappings
  const nodeNameSet = new Set(entitySpec.nodes.map(n => n.name.toLowerCase()));

  for (const fk of foreignKeyMappings) {
    const { column, edgeLabel = 'references', directionality = 'unidirectional' } = fk;

    for (const row of rows) {
      const sourceName = String(row[nodeNameColumn] ?? '').trim();
      const targetName = String(row[column] ?? '').trim();

      if (!sourceName || !targetName) continue;
      if (!nodeNameSet.has(sourceName.toLowerCase())) continue;
      if (!nodeNameSet.has(targetName.toLowerCase())) continue;
      if (sourceName.toLowerCase() === targetName.toLowerCase()) continue;

      entitySpec.edges.push({
        source: sourceName,
        target: targetName,
        type: edgeLabel,
        directionality,
      });
    }
  }

  return entitySpec;
}

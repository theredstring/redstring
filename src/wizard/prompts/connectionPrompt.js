/**
 * Ask The Wizard prompt for one or more selected Connections.
 *
 * Moved verbatim out of NodeCanvas.jsx. These builders were always pure over
 * useGraphStore.getState() — they closed over nothing from the component, which
 * is why every one of them declared an empty useCallback dependency array — so
 * living outside React costs them nothing and makes them testable.
 */
import { connectionContext } from './connectionContext.js';
import { buildGraphContextLines } from './shared.js';

export function buildWizardConnectionPrompt(edges, opts = {}) {
  const includeInstructions = opts.includeInstructions === 'short' ? 'short' : 'full';
  const {
    activeGraph,
    activeGraphName,
    instances,
    nodePrototypesMap,
    nodeLabelForInstance,
    nodeContextForInstance,
    activeGraphConnectionTypes,
    allConnectionTypes,
    siblings,
    edgeLines
  } = connectionContext(edges);

  const lines = [];
  lines.push(`I need help refining ${edges.length === 1 ? 'a connection' : `${edges.length} connections`} in graph "${activeGraphName}".`);

  // Endpoint prototype IDs — exclude these from the "other prototypes in graph" listing
  // (their descriptions are surfaced separately below in the endpoint context block).
  const endpointProtoIds = new Set();
  if (instances) {
    edges.forEach((edge) => {
      [edge.sourceId, edge.destinationId || edge.targetId].forEach((iid) => {
        if (!iid) return;
        const inst = instances.get(iid);
        if (inst?.prototypeId) endpointProtoIds.add(inst.prototypeId);
      });
    });
  }
  const graphCtxLines = buildGraphContextLines(activeGraph, nodePrototypesMap, { excludePrototypeIds: endpointProtoIds });
  if (graphCtxLines.length > 0) {
    lines.push('');
    lines.push('About this graph:');
    lines.push(...graphCtxLines);
  }

  lines.push('');
  lines.push(`Selected connection${edges.length === 1 ? '' : 's'}:`);
  lines.push(...edgeLines);

  // Per-endpoint context (descriptions + types). Dedupe instances across selected edges.
  const seenEndpointInstances = new Set();
  const endpointContextLines = [];
  edges.forEach((edge) => {
    [edge.sourceId, edge.destinationId || edge.targetId].forEach((iid) => {
      if (!iid || seenEndpointInstances.has(iid)) return;
      seenEndpointInstances.add(iid);
      const ctx = nodeContextForInstance(iid);
      if (!ctx) return;
      const desc = ctx.description ? ` — ${ctx.description}` : ' — (no description)';
      const typePart = ctx.typeName ? ` [type: "${ctx.typeName}"]` : '';
      endpointContextLines.push(`- "${ctx.name}"${typePart}${desc}`);
    });
  });
  if (endpointContextLines.length > 0) {
    lines.push('');
    lines.push('What the endpoint nodes are:');
    lines.push(...endpointContextLines);
  }

  if (siblings.length > 0) {
    lines.push('');
    lines.push('Other connections that already exist between the same endpoints in this graph:');
    lines.push(...siblings);
  } else {
    lines.push('');
    lines.push('No other connections exist between the same endpoints in this graph.');
  }
  lines.push('');
  if (activeGraphConnectionTypes.length > 0) {
    lines.push(`Connection prototypes already used in this graph (prefer reusing one of these): ${activeGraphConnectionTypes.join(', ')}.`);
  } else {
    lines.push('No connection prototypes are currently used in this graph other than the default "Connection".');
  }
  if (allConnectionTypes.length > 0) {
    lines.push('');
    lines.push('All connection prototypes used anywhere in the project:');
    allConnectionTypes.forEach((entry) => lines.push(`- ${entry}`));
  }
  lines.push('');
  if (includeInstructions === 'full') {
    lines.push('Goals:');
    lines.push('- The usual goal is to REPLACE the current connection type with a more specific, semantically accurate one — but if the current type genuinely fits, leave it.');
    lines.push('- Strongly prefer reusing an existing connection prototype, especially one already used in this graph.');
    lines.push('- Only create a NEW connection prototype if no existing prototype fits. If you must create one, give it a clear name and a description that explains the relationship.');
    lines.push('- If a new node is genuinely needed to define the relationship, create it and use its description to clarify novel terms.');
    lines.push('');
    lines.push('Before applying changes (only if needed):');
    lines.push('- If the endpoint descriptions and connection-prototype catalog above already give you enough to choose, proceed directly.');
    lines.push('- If you genuinely need more context (e.g., the endpoints are unfamiliar concepts or the existing prototype names are ambiguous), FIRST call search / readGraph / inspectPrototype before mutating. Skip this step otherwise — do not call read tools just to be thorough.');
    lines.push('');
    lines.push('Tool-call rules (important):');
    edges.forEach((edge, idx) => {
      const sourceName = nodeLabelForInstance(edge.sourceId);
      const targetName = nodeLabelForInstance(edge.destinationId || edge.targetId);
      lines.push(`- Connection ${idx + 1}: identify with sourceName="${sourceName}" and targetName="${targetName}".`);
    });
    lines.push('- To modify a connection, call updateEdge or replaceEdges with the source and target NODE NAMES above.');
    lines.push('- To remove a connection, call deleteEdge with sourceName and targetName. DO NOT pass an edgeId — edge IDs are not visible to you and any value you supply will be ignored.');
    lines.push('');
    lines.push('Please review the selected connection(s) and recommend a concrete action.');
  } else {
    // Short mode — instructions were already given earlier in this conversation, so emit
    // only the per-call identifiers and a one-line reminder.
    lines.push('Identifiers for this call:');
    edges.forEach((edge, idx) => {
      const sourceName = nodeLabelForInstance(edge.sourceId);
      const targetName = nodeLabelForInstance(edge.destinationId || edge.targetId);
      lines.push(`- Connection ${idx + 1}: sourceName="${sourceName}", targetName="${targetName}".`);
    });
    lines.push('');
    lines.push('(Reminder: same goals, search-first guidance, and tool-call rules as the previous Ask The Wizard message in this conversation. Use sourceName/targetName, never edge IDs.)');
  }

  // Build a short subject label and summary (used for the chat-side chip + history replay,
  // so subsequent turns don't replay the full prompt).
  let subjectLabel;
  let summary;
  if (edges.length === 1) {
    const onlyEdge = edges[0];
    const sName = nodeLabelForInstance(onlyEdge.sourceId);
    const tName = nodeLabelForInstance(onlyEdge.destinationId || onlyEdge.targetId);
    subjectLabel = `"${sName}" → "${tName}"`;
    summary = `Refine connection: ${subjectLabel}`;
  } else {
    subjectLabel = `${edges.length} connections`;
    summary = `Refine ${edges.length} connections in graph "${activeGraphName}"`;
  }

  return {
    message: lines.join('\n'),
    summary,
    action: 'refine-connections',
    subjectLabel
  };
}

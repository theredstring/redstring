/**
 * Ask The Wizard prompt for defining a Thing's components.
 *
 * Moved verbatim out of NodeCanvas.jsx. These builders were always pure over
 * useGraphStore.getState() — they closed over nothing from the component, which
 * is why every one of them declared an empty useCallback dependency array — so
 * living outside React costs them nothing and makes them testable.
 */
import useGraphStore from '../../store/graphStore.js';
import { buildGraphContextLines } from './shared.js';

export function buildWizardNodeDefinitionPrompt(prototype, opts = {}) {
  if (!prototype) return null;
  const includeInstructions = opts.includeInstructions === 'short' ? 'short' : 'full';
  const st = useGraphStore.getState();
  const graphs = st.graphs;
  const nodePrototypesMap = st.nodePrototypes;
  const edgesMap = st.edges;
  const activeId = st.activeGraphId;
  const activeGraph = activeId ? graphs.get(activeId) : null;
  const activeGraphName = activeGraph?.name || 'the active graph';

  const protoName = prototype.name || 'this node';
  const protoDescription = (prototype.description || '').trim();
  const typeProto = prototype.typeNodeId ? nodePrototypesMap.get(prototype.typeNodeId) : null;
  const typeName = typeProto?.name || null;
  const typeDescription = (typeProto?.description || '').trim();

  // Find an existing empty definition graph (if any), so the wizard can populate it instead of creating a new one
  const defIds = Array.isArray(prototype.definitionGraphIds) ? prototype.definitionGraphIds : [];
  let existingEmptyDefGraphName = null;
  let existingEmptyDefGraphId = null;
  for (const gid of defIds) {
    const g = graphs.get(gid);
    if (!g) continue;
    const instCount = g.instances instanceof Map
      ? g.instances.size
      : (g.instances ? Object.keys(g.instances).length : 0);
    if (instCount === 0) {
      existingEmptyDefGraphName = g.name || gid;
      existingEmptyDefGraphId = gid;
      break;
    }
  }

  // Existing connections that reference this prototype as the type or definition.
  // Walk edges across all graphs and surface ones whose connection-type is THIS prototype,
  // OR whose source/target instance has this prototype.
  const connectionsAsType = [];
  const connectionsInvolving = []; // edges where this proto is an endpoint's prototype
  const seenTypeEdges = new Set();
  const seenEndpointEdges = new Set();

  graphs.forEach((g) => {
    const gName = g?.name || 'graph';
    const instances = g?.instances;
    if (!instances) return;
    const instMap = instances instanceof Map ? instances : new Map(Object.entries(instances));
    (g?.edgeIds || []).forEach((eid) => {
      const edge = edgesMap.get(eid);
      if (!edge) return;
      const typeId = (edge.definitionNodeIds && edge.definitionNodeIds[0]) || edge.typeNodeId || null;

      if (typeId === prototype.id && !seenTypeEdges.has(eid)) {
        seenTypeEdges.add(eid);
        const sInst = instMap.get(edge.sourceId);
        const tInst = instMap.get(edge.destinationId || edge.targetId);
        const sName = sInst ? (nodePrototypesMap.get(sInst.prototypeId)?.name || 'Node') : '?';
        const tName = tInst ? (nodePrototypesMap.get(tInst.prototypeId)?.name || 'Node') : '?';
        connectionsAsType.push(`- "${sName}" --[${protoName}]--> "${tName}" (in graph "${gName}")`);
      }

      const sInst = instMap.get(edge.sourceId);
      const tInst = instMap.get(edge.destinationId || edge.targetId);
      const sIsThis = sInst && sInst.prototypeId === prototype.id;
      const tIsThis = tInst && tInst.prototypeId === prototype.id;
      if ((sIsThis || tIsThis) && !seenEndpointEdges.has(eid)) {
        seenEndpointEdges.add(eid);
        const typeProtoForEdge = typeId ? nodePrototypesMap.get(typeId) : null;
        const tName = typeProtoForEdge?.name || 'Connection';
        const sLabel = sInst ? (nodePrototypesMap.get(sInst.prototypeId)?.name || 'Node') : '?';
        const dLabel = tInst ? (nodePrototypesMap.get(tInst.prototypeId)?.name || 'Node') : '?';
        connectionsInvolving.push(`- "${sLabel}" --[${tName}]--> "${dLabel}" (in graph "${gName}")`);
      }
    });
  });

  const lines = [];
  lines.push(`I need help defining the components of the node "${protoName}" in graph "${activeGraphName}".`);
  if (existingEmptyDefGraphName) {
    lines.push(`There is already an empty definition graph for this node: "${existingEmptyDefGraphName}" (id: ${existingEmptyDefGraphId}). You should populate that graph (do NOT create a new one).`);
  } else {
    lines.push(`This node has no definition graph yet — create a new one and populate it.`);
  }

  // Surrounding graph context (the graph in which the node lives) — exclude the focus node itself
  const graphCtxLines = buildGraphContextLines(activeGraph, nodePrototypesMap, { excludePrototypeIds: new Set([prototype.id]) });
  if (graphCtxLines.length > 0) {
    lines.push('');
    lines.push('About the surrounding graph (where this node currently lives):');
    lines.push(...graphCtxLines);
  }

  lines.push('');
  lines.push('What we know about this node:');
  lines.push(`- Name: "${protoName}"`);
  if (protoDescription) {
    lines.push(`- Description: ${protoDescription}`);
  } else {
    lines.push('- Description: (none — infer from the name and context)');
  }
  if (typeName) {
    lines.push(`- Type: "${typeName}"${typeDescription ? ` — ${typeDescription}` : ''}`);
  }
  if (connectionsInvolving.length > 0) {
    lines.push('');
    lines.push('Existing connections involving this node (across all graphs):');
    connectionsInvolving.slice(0, 30).forEach((entry) => lines.push(entry));
    if (connectionsInvolving.length > 30) {
      lines.push(`- ...and ${connectionsInvolving.length - 30} more`);
    }
  }
  if (connectionsAsType.length > 0) {
    lines.push('');
    lines.push('Connections that USE this node as their connection type (across all graphs):');
    connectionsAsType.slice(0, 20).forEach((entry) => lines.push(entry));
    if (connectionsAsType.length > 20) {
      lines.push(`- ...and ${connectionsAsType.length - 20} more`);
    }
  }
  lines.push('');
  if (includeInstructions === 'full') {
    lines.push('Goals:');
    lines.push('- Populate the definition graph with the components or compositional structure of this node — the parts/members/sub-concepts that compose it.');
    lines.push('- The components should reflect what this node IS made of (compositional), not what it RELATES to. Use the description, type, and existing connections as evidence.');
    lines.push('- Add edges between the components when their relationship is genuinely meaningful and well-known. Prefer reusing existing connection prototypes from the project where possible.');
    lines.push('- If a component is novel, you may create a new node for it and use its description to clarify the term.');
    lines.push('- Where a component has an obvious, uncontested generalization, give it an is-a ladder in the same call: add `isA: [{ "name": "Company", "description": "A legally constituted business entity." }]` (broadest last) to that node. Every rung needs a bio — a rung is created as a real node, and one born with only a name is a dead end. One rung is a complete ladder; leave `isA` off any component whose broader category is arguable. This is the abstraction carousel, not a connection; do not draw an edge for it.');
    lines.push('');
    lines.push('Before applying changes (only if needed):');
    lines.push('- If you genuinely lack information about what "this node" is composed of, FIRST call search / readGraph to learn more about the project. Skip this step if the description and connections above already give you enough to proceed.');
    lines.push('- You may also call inspectPrototype, getPrototype, or querySparql for additional context if relevant — but only if you actually need more info.');
    lines.push('');
    lines.push('Tool-call rules (important):');
    if (existingEmptyDefGraphName) {
      lines.push(`- The empty definition graph "${existingEmptyDefGraphName}" already exists. Use expandGraph with targetGraphId="${existingEmptyDefGraphId}" (the EXACT id, not the name) to populate it. Do NOT create a new definition graph.`);
      lines.push('- expandGraph edges accept a simple `type` string. Example edge:');
      lines.push('    { "source": "Axioms", "target": "Logical Constraints", "type": "Establishes" }');
    } else {
      lines.push(`- Use populateDefinitionGraph (single composite call) with nodeName="${protoName}". This both creates the definition graph and fills it in one step.`);
      lines.push('- For populateDefinitionGraph edges: provide EITHER a `type` string OR a `definitionNode` object — never both, never neither. The simple shape is fine; only use `definitionNode` if you want to attach a description/color to the connection type.');
      lines.push('    Simple shape:    { "source": "Axioms", "target": "Logical Constraints", "type": "Establishes" }');
      lines.push('    Richer shape:    { "source": "Axioms", "target": "Logical Constraints", "definitionNode": { "name": "Establishes", "description": "Foundational relationship where axioms set the basis for logical constraints." } }');
    }
    lines.push('- Do NOT pass node IDs you have not seen in the data above. Use node names exactly as provided.');
    lines.push('- The image of the node is intentionally not provided and is irrelevant here.');
    lines.push('');
    lines.push('Please review the context and either populate this node\'s definition with components, or — if you genuinely need more information first — call a search/read tool, then proceed.');
  } else {
    // Short mode — instructions were already given earlier in this conversation; emit only
    // the per-call "which tool" pointer plus a compact reminder that ties back to that
    // earlier instruction block.
    lines.push('Tool to use this time:');
    if (existingEmptyDefGraphName) {
      lines.push(`- expandGraph with targetGraphId="${existingEmptyDefGraphId}" (the empty definition graph "${existingEmptyDefGraphName}" — pass the exact id, not the name).`);
    } else {
      lines.push(`- populateDefinitionGraph with nodeName="${protoName}" (creates + populates in one call).`);
    }
    lines.push('');
    lines.push('(Reminder: same compositional-components goal, search-first guidance, and edge-shape rules as the previous Ask The Wizard message in this conversation. Use node names, never IDs.)');
  }

  const subjectLabel = `"${protoName}"`;
  const summary = `Define components of ${subjectLabel}`;

  return {
    message: lines.join('\n'),
    summary,
    action: 'define-node',
    subjectLabel
  };
}

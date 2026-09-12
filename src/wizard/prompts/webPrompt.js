/**
 * Ask The Wizard prompt for growing or populating the active Web.
 *
 * Moved verbatim out of NodeCanvas.jsx. These builders were always pure over
 * useGraphStore.getState() — they closed over nothing from the component, which
 * is why every one of them declared an empty useCallback dependency array — so
 * living outside React costs them nothing and makes them testable.
 */
import useGraphStore from '../../store/graphStore.js';
import { buildGraphContextLines } from './shared.js';

// Build the "Grow with The Wizard" prompt for the active graph. Branches on whether the
// graph is blank (populate from scratch) or already has content (expand / deepen it).
export function buildWizardGrowGraphPrompt(opts = {}) {
  const includeInstructions = opts.includeInstructions === 'short' ? 'short' : 'full';
  const st = useGraphStore.getState();
  const graphs = st.graphs;
  const nodePrototypesMap = st.nodePrototypes;
  const activeId = st.activeGraphId;
  const activeGraph = activeId ? graphs.get(activeId) : null;
  if (!activeGraph) return null;
  const activeGraphName = activeGraph.name || 'the active graph';

  const instances = activeGraph.instances;
  const instanceCount = instances instanceof Map
    ? instances.size
    : (instances ? Object.keys(instances).length : 0);
  const isBlank = instanceCount === 0;

  const graphCtxLines = buildGraphContextLines(activeGraph, nodePrototypesMap);
  const lines = [];

  if (isBlank) {
    lines.push(`I have a blank graph "${activeGraphName}" and I'd like you to populate it from scratch.`);
  } else {
    lines.push(`I'd like you to expand and grow my existing graph "${activeGraphName}" — deepen and enrich it.`);
  }
  lines.push('');
  lines.push('About this graph:');
  lines.push(...graphCtxLines);
  lines.push('');

  if (includeInstructions === 'full') {
    lines.push('Goals:');
    if (isBlank) {
      lines.push('- Populate this graph with a meaningful set of nodes that flesh out its subject. Use the graph name and description as the seed.');
      lines.push('- Add connections between nodes where the relationship is genuinely meaningful and well-known. Prefer reusing existing connection prototypes from the project where possible.');
      lines.push('- Give novel nodes a short description so the terms are clear.');
    } else {
      lines.push('- Grow the graph by adding new nodes and connections that extend the existing structure in meaningful directions. Build on what is already here rather than duplicating it.');
      lines.push('- Where an existing node is a rich concept that lacks its own definition graph, consider populating a definition graph for it (populateDefinitionGraph) to show what it is composed of — but only when it genuinely adds depth.');
      lines.push('- Add connections where the relationship is genuinely meaningful and well-known. Prefer reusing existing connection prototypes from the project.');
      lines.push('- Give novel nodes a short description so the terms are clear.');
    }
    lines.push('');
    lines.push('Before applying changes:');
    if (isBlank) {
      lines.push('- If the graph name/description is ambiguous about what direction to take, use the askMultipleChoice tool to ask ONE clarifying question before populating. Only ask if the scope is genuinely ambiguous.');
    } else {
      lines.push('- The direction to grow may be ambiguous. Use the askMultipleChoice tool to ask ONE clarifying question about what to focus on (e.g. which subtopic to expand, breadth vs depth) before making large changes. Only skip this if the intent is obvious.');
    }
    lines.push('- If you need more information about the subject, call search / searchNodes / readGraph / querySparql first.');
    lines.push('');
    lines.push('Tool-call rules (important):');
    lines.push(`- Use expandGraph with targetGraphId="${activeGraph.id}" (the EXACT id, not the name) to add nodes and connections to this graph.`);
    if (!isBlank) {
      lines.push('- To give an existing node its own definition graph, use populateDefinitionGraph with nodeName="<the node name>".');
    }
    lines.push('- expandGraph edges accept a simple `type` string. Example edge:');
    lines.push('    { "source": "Axioms", "target": "Logical Constraints", "type": "Establishes" }');
    lines.push('- Use node names exactly as provided; do NOT pass node IDs you have not seen.');
  } else {
    // Short mode — full instructions were already given earlier in this conversation.
    lines.push('Tool to use this time:');
    lines.push(`- expandGraph with targetGraphId="${activeGraph.id}" (the EXACT id, not the name) to add nodes and connections to this graph.`);
    if (!isBlank) {
      lines.push('- populateDefinitionGraph with nodeName="<the node name>" to give an existing node its own definition graph, when it adds depth.');
    }
    lines.push('');
    lines.push('(Reminder: same grow goals, askMultipleChoice-when-ambiguous, search-first guidance, and edge-shape rules as the previous Grow message in this conversation. Use node names, never IDs.)');
  }

  const subjectLabel = `"${activeGraphName}"`;
  const summary = isBlank ? `Populate ${subjectLabel}` : `Grow ${subjectLabel}`;

  return {
    message: lines.join('\n'),
    summary,
    action: 'grow-graph',
    subjectLabel,
    isBlank
  };
}

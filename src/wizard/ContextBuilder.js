/**
 * ContextBuilder - Builds graph state context for LLM
 * Formats graph data into a concise context string for the system prompt
 *
 * This header is THE authoritative view of graph state for the model. It is
 * rebuilt and re-uploaded on every iteration of every ask, which makes its size
 * the single largest recurring cost in an agentic run — and previously it had no
 * ceiling at all: it listed every node with its description, every edge as a
 * triplet, and every group of the active graph, then appended a roster of the
 * rest. On a large universe that alone could crowd out the conversation.
 *
 * Two ideas keep it bounded:
 *
 *   1. Detail falls off with distance. The active graph is rendered in full; the
 *      open tabs nearest it get names and types; further tabs get counts; closed
 *      graphs get a name in a roster. What the user is looking at is what the
 *      model sees clearly.
 *   2. The whole thing is budgeted, not flat-capped. Each graph is measured as
 *      actually rendered rather than assumed to cost some fixed amount, and when
 *      the budget runs out the remaining graphs are demoted a tier instead of
 *      being cut off mid-list. A partial view always says so, so the model knows
 *      to call readGraph rather than assuming it saw everything.
 */

import { estimateTokens } from './tokenEstimate.js';

/**
 * Total token budget for the graph portion of the context header.
 *
 * Sized against the ~25k-token fixed floor (system prompt + tool schemas) that
 * every request already carries: at 6k this keeps the whole static preamble near
 * 31k, leaving real room for conversation inside a 200k window while still
 * showing the active graph in full in the overwhelming majority of cases.
 */
export const CONTEXT_TOKEN_BUDGET = 6000;

/**
 * Share of the budget the active graph may claim before it starts degrading.
 * It is the graph being edited, so it earns the lion's share — but not all of
 * it, or a huge active graph would erase every trace of the surrounding webs.
 */
const ACTIVE_GRAPH_BUDGET_RATIO = 0.6;

/**
 * How many open tabs on either side of the active one count as "near". These
 * get real node names; everything further gets counts. Three a side is enough
 * to cover the parent/sibling/child a user typically works across without
 * paying for tabs they opened an hour ago.
 */
export const NEIGHBOR_RADIUS = 3;

/** Node descriptions are trimmed to this many characters in full detail. */
const DESC_CHAR_LIMIT = 60;

/** Cap on the name-only roster of graphs that didn't make a richer tier. */
const ROSTER_LIMIT = 12;

// Detail levels, richest first. Demotion walks down this list.
const DETAIL = {
  FULL: 'full',       // names + types + descriptions, edge triplets, groups
  NO_DESC: 'no_desc', // names + types, edge triplets, groups
  MEDIUM: 'medium',   // names + types, edge count only
  LIGHT: 'light',     // name + counts
  NAME: 'name'        // name only
};

const DEMOTION_ORDER = [DETAIL.FULL, DETAIL.NO_DESC, DETAIL.MEDIUM, DETAIL.LIGHT, DETAIL.NAME];

/** Normalize the several shapes `instances` arrives in (Map, array, object). */
function getInstances(graph) {
  if (!graph || !graph.instances) return [];
  if (graph.instances instanceof Map) return Array.from(graph.instances.values());
  if (Array.isArray(graph.instances)) return graph.instances;
  return Object.values(graph.instances || {});
}

/** Same normalization for groups. */
function getGroups(graph) {
  if (!graph || !graph.groups) return [];
  if (graph.groups instanceof Map) return Array.from(graph.groups.values());
  if (Array.isArray(graph.groups)) return graph.groups;
  return Object.values(graph.groups || {});
}

/**
 * Resolve an edge's human-readable connection type. definitionNodeIds[0] points
 * at the prototype whose NAME is the connection type; the other fields are
 * fallbacks for edges that predate it.
 */
function resolveEdgeType(edge, protoMap) {
  if (Array.isArray(edge.definitionNodeIds) && edge.definitionNodeIds.length > 0) {
    const defProto = protoMap.get(edge.definitionNodeIds[0]);
    if (defProto?.name) return defProto.name;
  }
  return edge.type || edge.connectionType || 'relates to';
}

/**
 * Render one graph at a given detail level.
 *
 * Returns a string with no trailing newline. `isActive` switches the framing —
 * the active graph is introduced as the current screen, the rest as context.
 */
function renderGraph(graph, level, { protoMap, edgesByGraph, isActive = false }) {
  const name = graph.name || 'Unnamed';

  if (level === DETAIL.NAME) return `  - "${name}"`;

  const instances = getInstances(graph);
  const graphEdges = edgesByGraph.get(graph.id) || [];
  const groups = getGroups(graph);
  const nodeCount = instances.length;
  const edgeCount = graphEdges.length;

  if (level === DETAIL.LIGHT) {
    const parts = [`${nodeCount} Thing${nodeCount !== 1 ? 's' : ''}`, `${edgeCount} Connection${edgeCount !== 1 ? 's' : ''}`];
    if (groups.length > 0) parts.push(`${groups.length} Group${groups.length !== 1 ? 's' : ''}`);
    return `  - "${name}" (${parts.join(', ')})`;
  }

  // Instance id → display name, needed to render edges and group members.
  const nodeNameById = new Map();
  for (const inst of instances) {
    const proto = inst.prototypeId ? protoMap.get(inst.prototypeId) : null;
    nodeNameById.set(inst.id, inst.name || proto?.name || '');
  }

  const nodeLine = (inst) => {
    const proto = inst.prototypeId ? protoMap.get(inst.prototypeId) : null;
    const nm = inst.name || proto?.name || inst.id;

    let typeStr = '';
    if (proto?.typeNodeId) {
      const typeProto = protoMap.get(proto.typeNodeId);
      if (typeProto) typeStr = ` [Type: ${typeProto.name || proto.typeNodeId}]`;
    }

    const defGraphIds = proto?.definitionGraphIds;
    const expandable = Array.isArray(defGraphIds) && defGraphIds.length > 0 ? ' [has def]' : '';

    if (level === DETAIL.FULL) {
      const rawDesc = inst.description || proto?.description || '';
      const desc = rawDesc.length > DESC_CHAR_LIMIT ? `${rawDesc.substring(0, DESC_CHAR_LIMIT)}...` : rawDesc;
      return desc ? `  - ${nm}${typeStr}${expandable}: ${desc}` : `  - ${nm}${typeStr}${expandable}`;
    }
    return `  - ${nm}${typeStr}${expandable}`;
  };

  // MEDIUM: names and types, but connections collapse to a count. This is the
  // tier that makes neighbouring tabs affordable — edge triplets are usually
  // the bulk of a graph's rendered size.
  if (level === DETAIL.MEDIUM) {
    let out = `  - "${name}" (${nodeCount} Things, ${edgeCount} Connections)`;
    if (nodeCount > 0) {
      out += `\n${instances.map(inst => `  ${nodeLine(inst)}`).join('\n')}`;
    }
    return out;
  }

  // FULL / NO_DESC: the active graph's own section.
  let out = isActive ? '' : `  - "${name}"`;
  if (nodeCount === 0) {
    return isActive ? 'Status: Empty (perfect for populating!)' : `${out} (empty)`;
  }

  const header = `Status: ${nodeCount} Thing${nodeCount !== 1 ? 's' : ''}, ${edgeCount} Connection${edgeCount !== 1 ? 's' : ''}`;
  const sections = [isActive ? header : `${out}\n${header}`];

  sections.push(`Things:\n${instances.map(nodeLine).join('\n')}`);

  if (edgeCount > 0) {
    const triplets = graphEdges.map(e => {
      const sourceId = e.sourceId || e.source;
      const targetId = e.destinationId || e.targetId || e.target;
      const sourceName = nodeNameById.get(sourceId) || sourceId || '?';
      const targetName = nodeNameById.get(targetId) || targetId || '?';
      return `  - ${sourceName} --[${resolveEdgeType(e, protoMap)}]--> ${targetName}`;
    });
    sections.push(`Connections:\n${triplets.join('\n')}`);
  }

  if (groups.length > 0) {
    const groupLines = groups.map(g => {
      const memberIds = g.memberInstanceIds || g.members || [];
      const memberNames = memberIds.map(mid => nodeNameById.get(mid)).filter(Boolean);
      const memberList = memberNames.length > 0 ? `: ${memberNames.join(', ')}` : '';
      const isThingGroup = !!g.linkedNodePrototypeId;
      const thingIndicator = isThingGroup
        ? ` [Thing-Group: ${protoMap.get(g.linkedNodePrototypeId)?.name || 'Unknown'}]`
        : '';
      return `  - ${g.name || 'Unnamed'}${thingIndicator} (${memberIds.length} members)${memberList}`;
    });
    sections.push(`Groups:\n${groupLines.join('\n')}`);
  }

  return sections.join('\n');
}

/**
 * Assign each graph a tier from its distance to the active graph in the open-tab
 * ordering. Returns { active, near, open, closed } arrays of graph objects.
 *
 * `openGraphIds` may be missing entirely — the MCP entry point builds its own
 * graphState and doesn't always carry tab state — in which case every non-active
 * graph is treated as closed, which is the correct conservative default.
 */
export function assignGraphTiers(graphs, activeGraphId, openGraphIds = []) {
  const open = Array.isArray(openGraphIds) ? openGraphIds : [];
  const byId = new Map(graphs.map(g => [g.id, g]));
  const active = activeGraphId ? byId.get(activeGraphId) || null : null;

  const activeIdx = open.indexOf(activeGraphId);
  const near = [];
  const openRest = [];

  for (let i = 0; i < open.length; i++) {
    const g = byId.get(open[i]);
    if (!g || g.id === activeGraphId) continue;
    // Distance is measured in tab positions. With no active tab in the list
    // there is no centre to measure from, so every open graph is "rest".
    if (activeIdx >= 0 && Math.abs(i - activeIdx) <= NEIGHBOR_RADIUS) near.push(g);
    else openRest.push(g);
  }

  const accounted = new Set([activeGraphId, ...open]);
  const closed = graphs.filter(g => g && !accounted.has(g.id));

  return { active, near, open: openRest, closed };
}

/**
 * Build context string from graph state
 * @param {Object} graphState - Graph state from UI
 * @returns {string} Formatted context string
 */
export function buildContext(graphState) {
  if (!graphState) {
    return 'No graph state available.';
  }

  const {
    graphs = [],
    nodePrototypes = [],
    edges = [],
    activeGraphId,
    openGraphIds = []
  } = graphState;

  // Build the prototype map ONCE. The definition-graph branch below used to run
  // nodePrototypes.find() inside a loop over every instance of every graph —
  // quadratic work repeated on every single iteration of every ask.
  const protoMap = new Map();
  for (const proto of nodePrototypes) {
    if (proto?.id) protoMap.set(proto.id, proto);
  }

  // Index edges by graph once, rather than filtering the universe per graph.
  const edgesById = new Map();
  for (const e of edges) {
    if (e?.id) edgesById.set(e.id, e);
  }
  const edgesByGraph = new Map();
  for (const g of graphs) {
    if (!g?.id) continue;
    const ids = Array.isArray(g.edgeIds) ? g.edgeIds : [];
    const list = [];
    for (const eid of ids) {
      const e = edgesById.get(eid);
      if (e) list.push(e);
    }
    edgesByGraph.set(g.id, list);
  }

  const renderCtx = { protoMap, edgesByGraph };
  const tiers = assignGraphTiers(graphs, activeGraphId, openGraphIds);

  let context = '';
  let spent = 0;
  const budget = CONTEXT_TOKEN_BUDGET;
  const droppedNotes = [];

  if (tiers.active) {
    const activeGraph = tiers.active;
    context += '\n\n## Environment Snapshot';
    context += `\nCURRENT WEB (open on user's screen): "${activeGraph.name}"`;

    // Definition-graph framing: tell the model it is inside a node.
    const definingNodes = nodePrototypes.filter(proto =>
      Array.isArray(proto.definitionGraphIds) && proto.definitionGraphIds.includes(activeGraphId)
    );
    if (definingNodes.length > 0) {
      context += `\n⚡ This web is a DEFINITION GRAPH for: ${definingNodes.map(p => p.name).join(', ')}`;
      context += '\n   (You are inside a node, viewing/editing what it is made of)';

      // The most common failure mode is re-adding nodes that already exist as
      // siblings elsewhere. Scoped to OPEN graphs: those are the ones the user is
      // actually working across, and scanning the whole universe here was half of
      // the old quadratic cost for a warning that is capped at 12 names anyway.
      const nearbyNames = new Set();
      for (const g of [...tiers.near, ...tiers.open]) {
        for (const inst of getInstances(g)) {
          const nm = inst.name || protoMap.get(inst.prototypeId)?.name;
          if (nm) nearbyNames.add(nm);
          if (nearbyNames.size >= ROSTER_LIMIT) break;
        }
        if (nearbyNames.size >= ROSTER_LIMIT) break;
      }
      if (nearbyNames.size > 0) {
        context += `\n   ⚠ Nodes that already exist in other open webs (DO NOT duplicate them here): ${Array.from(nearbyNames).join(', ')}`;
      }
    }

    // Render the active graph as richly as its share of the budget allows,
    // stepping down the detail ladder until it fits.
    const activeAllowance = Math.floor(budget * ACTIVE_GRAPH_BUDGET_RATIO);
    let activeRendered = null;
    let activeLevel = null;
    for (const level of DEMOTION_ORDER) {
      const candidate = renderGraph(activeGraph, level, { ...renderCtx, isActive: true });
      activeRendered = candidate;
      activeLevel = level;
      if (estimateTokens(candidate) <= activeAllowance) break;
    }
    context += `\n${activeRendered}`;
    spent += estimateTokens(activeRendered);
    if (activeLevel !== DETAIL.FULL) {
      droppedNotes.push(
        `the current web is shown at reduced detail (${activeLevel}) because it is too large to render in full — call readGraph for its complete contents`
      );
    }
  }

  if (!tiers.active) {
    if (graphs.length > 0) {
      const graphNames = graphs.slice(0, 3).map(g => `"${g.name}"`).join(', ');
      context += `\n\nAVAILABLE WEBS: ${graphs.length} total (${graphNames}${graphs.length > 3 ? '...' : ''})`;
      context += '\nNo active web - create one or open an existing web.';
    } else {
      context += '\n\nNo webs yet - perfect time to create one!';
    }
    return context;
  }

  // Remaining tiers, each demoted as far as needed to fit what's left.
  const renderTier = (graphList, startLevel, heading, label) => {
    if (graphList.length === 0) return;
    const lines = [];
    const overflow = [];
    let demoted = 0;
    const startIdx = DEMOTION_ORDER.indexOf(startLevel);
    for (const g of graphList) {
      let placed = false;
      for (let i = startIdx; i < DEMOTION_ORDER.length; i++) {
        const candidate = renderGraph(g, DEMOTION_ORDER[i], renderCtx);
        const cost = estimateTokens(candidate);
        if (spent + cost <= budget) {
          lines.push(candidate);
          spent += cost;
          // Rendered below the detail this tier is supposed to get. The model
          // would otherwise read a bare name as "this web is empty" rather than
          // "you weren't shown this web's contents".
          if (i > startIdx) demoted++;
          placed = true;
          break;
        }
      }
      // Even a name-only line didn't fit — record it so the count stays honest
      // rather than the graph silently vanishing.
      if (!placed) overflow.push(g.name || 'Unnamed');
    }
    if (lines.length > 0) context += `\n\n${heading}\n${lines.join('\n')}`;
    if (demoted > 0) {
      droppedNotes.push(`${demoted} ${label} web${demoted !== 1 ? 's are' : ' is'} shown at reduced detail for space`);
    }
    if (overflow.length > 0) {
      droppedNotes.push(`${overflow.length} ${label} web${overflow.length !== 1 ? 's were' : ' was'} omitted entirely for space`);
    }
  };

  renderTier(tiers.near, DETAIL.MEDIUM, 'Nearby open webs (tabs adjacent to the current one):', 'nearby');
  renderTier(tiers.open, DETAIL.LIGHT, 'Other open webs:', 'other open');

  // Closed graphs never get more than a name, and only as many as the roster cap
  // and the remaining budget allow.
  if (tiers.closed.length > 0) {
    const shown = [];
    for (const g of tiers.closed) {
      if (shown.length >= ROSTER_LIMIT) break;
      const line = `"${g.name || 'Unnamed'}"`;
      const cost = estimateTokens(line);
      if (spent + cost > budget) break;
      shown.push(line);
      spent += cost;
    }
    if (shown.length > 0) {
      const more = tiers.closed.length - shown.length;
      context += `\n\nOther webs available (not open): ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`;
    }
  }

  // Type palette — cheap and disproportionately useful for keeping the model's
  // vocabulary consistent with what already exists.
  const types = new Set();
  for (const proto of nodePrototypes) {
    if (proto.typeNodeId) {
      const typeProto = protoMap.get(proto.typeNodeId);
      if (typeProto?.name) types.add(typeProto.name);
    }
  }
  if (types.size > 0) {
    const typeList = Array.from(types).slice(0, 8).join(', ');
    context += `\nTypes in use: ${typeList}${types.size > 8 ? '...' : ''}`;
  }

  // Always say when the view is partial. A model that believes it has seen
  // everything will confidently act on a graph it only half-read — which is how
  // deletes get attempted against connections that were never in view.
  if (droppedNotes.length > 0) {
    context += `\n\n⚠ This snapshot is partial: ${droppedNotes.join('; ')}.`;
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
export function buildPlanContext(plan, iteration, maxIterations, { isResumed = false } = {}) {
  if (!plan || plan.length === 0) return '';
  // `skipped` settles a step just as `done` does — see planTask.js. Counting only
  // `done` here made a deliberately-skipped step read as outstanding forever.
  const isSettled = (s) => s.status === 'done' || s.status === 'skipped';
  const settled = plan.filter(isSettled).length;
  const iterInfo = typeof iteration === 'number' && typeof maxIterations === 'number'
    ? ` — Iteration ${iteration + 1} of ${maxIterations}`
    : '';
  const statusIcon = (status) => {
    if (status === 'done') return '[DONE]';
    if (status === 'in_progress') return '[IN PROGRESS]';
    if (status === 'skipped') return '[SKIPPED]';
    return '[ ]';
  };
  const lines = plan.map((step, i) => {
    let line = `  ${i + 1}. ${statusIcon(step.status)} ${step.description}`;

    // Add substep lines if present
    if (step.substeps && step.substeps.length > 0) {
      for (let j = 0; j < step.substeps.length; j++) {
        const sub = step.substeps[j];
        const letter = String.fromCharCode(97 + j);
        line += `\n    ${letter}. ${statusIcon(sub.status)} ${sub.description}`;
      }
    }
    return line;
  });
  const allDone = settled === plan.length;
  const planDirective = allDone
    ? 'All steps are settled. Respond to the user now with a brief summary. Do NOT call any more tools.'
    : 'Steps remain. You MUST call a tool right now — do NOT write a text-only response. Pick the first unfinished step and call the appropriate tool (sketchGraph, createPopulatedGraph, expandGraph, populateDefinitionGraph, or planTask to update status). If a remaining step is no longer needed, mark it "skipped" rather than leaving it open.';

  // A resumed plan carries over from a previous turn that ran out of budget or
  // iterations. Saying so is what stops the model greeting it as a fresh request
  // and calling planTask to rewrite a plan it is already halfway through.
  const resumeNote = isResumed && !allDone
    ? '\nThis plan carried over from your previous turn — it is already underway. Do NOT re-plan it; continue from the first unfinished step.'
    : '';

  return `\n\n## Active Plan (${settled}/${plan.length} complete)${iterInfo}${resumeNote}\n${lines.join('\n')}\nIMPORTANT: ${planDirective}`;
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

/**
 * Prompts for the asks that are not "build me something".
 *
 * The four original builders all say some version of "go and change this". These
 * are the rest: the questions, the audits, and the one where you type your own.
 *
 * ── The honest no ────────────────────────────────────────────────────────────
 *
 * Two of these are query-first: "does this connect to anything here?" and "is
 * there anything else between these two?". They are QUESTIONS, and the answer is
 * frequently no. That is the whole point — it makes a library of Things
 * explorable by experiment. Drag one into any Web, ask whether it belongs, keep
 * it or pull it back out. The moment the wizard starts finding something rather
 * than nothing, the test is worthless and you are back to wiring by hand.
 *
 * So the goals below name the pressure explicitly rather than just permitting a
 * no. The pressure is real: a Thing you just dropped on the canvas reads as
 * intent, and graphQuality.js documents how reliably a model will manufacture a
 * hub to make a connectivity score look better.
 *
 * These asks also run under a read-only tool policy, which is not a safety rail
 * on top of the prose — it is what makes the no trustworthy at all. See
 * toolPolicy.js.
 *
 * ── Stated absence ───────────────────────────────────────────────────────────
 *
 * The context blocks already name absences rather than omitting them ("No other
 * connections exist between the same endpoints", "Description: (none — infer…)").
 * Answers are asked to match: not a silent nothing-found, but one line in the
 * slot a found Connection would have occupied, with its reason. A "no" with
 * reasoning is something you can disagree with; a bare "no" is indistinguishable
 * from the wizard not having tried.
 */
import useGraphStore from '../../store/graphStore.js';
import { buildGraphContextLines } from './shared.js';
import { connectionContext } from './connectionContext.js';

/** Wrap a built prompt's pieces into the shape every opener expects. */
const result = (lines, { summary, action, subjectLabel }) => ({
  message: lines.filter(l => l !== undefined).join('\n'),
  summary,
  action,
  subjectLabel
});

/** The read-only tools an ask is actually offered, named so it stops guessing. */
const READ_TOOL_NOTE =
  '- You may call search, readGraph, getNodeContext, inspectPrototype and inspectWorkspace to look things up. Only call them if the context above genuinely leaves you unsure — do not call read tools to be thorough.\n'
  + '- To look at another Web, call readGraph with its targetGraphId. Do NOT try to switch Webs: that moves the user\'s view out from under them and is not available here.';

const PROSE_NOTE =
  'Answer in prose, in the chat. Do not try to change anything — you cannot, and the user did not ask you to. Be concrete and specific to what is actually here rather than generically true.';

// ── Thing ────────────────────────────────────────────────────────────────────

function thingFactLines(prototype) {
  const st = useGraphStore.getState();
  const nodePrototypesMap = st.nodePrototypes;
  const typeProto = prototype.typeNodeId ? nodePrototypesMap.get(prototype.typeNodeId) : null;
  const desc = (prototype.description || '').trim();
  const lines = [`- Name: "${prototype.name || 'this Thing'}"`];
  lines.push(desc ? `- Description: ${desc}` : '- Description: (none)');
  if (typeProto?.name) {
    const td = (typeProto.description || '').trim();
    lines.push(`- Type: "${typeProto.name}"${td ? ` — ${td}` : ''}`);
  }
  const defIds = Array.isArray(prototype.definitionGraphIds) ? prototype.definitionGraphIds : [];
  if (defIds.length > 0) lines.push(`- It has ${defIds.length} definition Web(s) of its own.`);
  return lines;
}

/** Connections this prototype is already an endpoint of, across every Web. */
function thingConnectionLines(prototype, { limit = 25 } = {}) {
  const st = useGraphStore.getState();
  const { graphs, nodePrototypes, edges: edgesMap } = st;
  const out = [];
  graphs.forEach((g) => {
    const instances = g?.instances;
    if (!instances) return;
    const instMap = instances instanceof Map ? instances : new Map(Object.entries(instances));
    (g?.edgeIds || []).forEach((eid) => {
      const edge = edgesMap.get(eid);
      if (!edge) return;
      const sInst = instMap.get(edge.sourceId);
      const tInst = instMap.get(edge.destinationId || edge.targetId);
      if (!sInst && !tInst) return;
      if (sInst?.prototypeId !== prototype.id && tInst?.prototypeId !== prototype.id) return;
      const typeId = (edge.definitionNodeIds && edge.definitionNodeIds[0]) || edge.typeNodeId || null;
      const typeName = typeId ? (nodePrototypes.get(typeId)?.name || 'Connection') : 'Connection';
      const sName = sInst ? (nodePrototypes.get(sInst.prototypeId)?.name || 'Thing') : '?';
      const tName = tInst ? (nodePrototypes.get(tInst.prototypeId)?.name || 'Thing') : '?';
      out.push(`- "${sName}" --[${typeName}]--> "${tName}" (in "${g.name || 'a Web'}")`);
    });
  });
  return out.slice(0, limit);
}

function thingHeader(prototype, lines) {
  const st = useGraphStore.getState();
  const activeGraph = st.activeGraphId ? st.graphs.get(st.activeGraphId) : null;
  lines.push('', 'The Thing:', ...thingFactLines(prototype));
  const conns = thingConnectionLines(prototype);
  if (conns.length > 0) {
    lines.push('', 'Connections it already has:', ...conns);
  } else {
    lines.push('', 'It has no Connections anywhere yet.');
  }
  const ctx = buildGraphContextLines(activeGraph, st.nodePrototypes, {
    excludePrototypeIds: new Set([prototype.id])
  });
  if (ctx.length > 0) lines.push('', 'The Web it is sitting in:', ...ctx);
  return activeGraph;
}

export function buildExplainThingPrompt(prototype) {
  if (!prototype) return null;
  const name = prototype.name || 'this Thing';
  const lines = [`Explain what "${name}" is, as it is being used in this Web.`];
  thingHeader(prototype, lines);
  lines.push('',
    'What to do:',
    `- Say what "${name}" is, and — more usefully — what work it is doing HERE. A Thing can be a place in general and a port of entry in this particular Web; the second is the interesting half.`,
    '- Ground it in what is actually above: its description, its type, the Connections it sits on, what surrounds it. Say which of those you are reading it from.',
    '- If the Web uses it in a way its name or description does not lead you to expect, say so plainly. That mismatch is worth more than a tidy summary.',
    '- If there is genuinely too little here to say anything specific, say that instead of padding.',
    '',
    PROSE_NOTE,
    READ_TOOL_NOTE
  );
  return result(lines, {
    summary: `Explain "${name}"`,
    action: 'explain-thing',
    subjectLabel: `"${name}"`
  });
}

export function buildConnectThingPrompt(prototype) {
  if (!prototype) return null;
  const name = prototype.name || 'this Thing';
  const lines = [
    `Question: does "${name}" connect to anything already in this Web?`,
    '',
    'This is a QUESTION, not an instruction. "No, nothing here it belongs to" is a complete and correct answer, and often the right one — the user is testing whether this Thing belongs, not asking you to attach it.'
  ];
  const activeGraph = thingHeader(prototype, lines);
  lines.push('',
    'How to answer:',
    '- Look for relationships that are genuinely true and would be recognised by someone who knows this subject. Not "these co-occur", not "these are both important" — an actual relation you could name.',
    '- Do NOT reach for the best-connected Thing in the Web. Attaching a newcomer to whatever hub is already there is the single most common way a false yes gets manufactured, and it produces a Web that says "these things are near each other" where the truth was "nothing, yet".',
    '- If the honest answer is none, say so in one line AND say why — what this Web is about, and why this Thing sits outside it. "Nothing here it connects to — this Web is about postwar monetary policy and Rotterdam is a place, not an instrument." A no with a reason is something the user can disagree with; a bare no is indistinguishable from you not having looked.',
    '',
    'If the answer IS yes:',
    '- Do not create anything. Call askMultipleChoice with the Connections you would draw, one option per Connection, each written as `"Source" --[Type]--> "Target"` plus a few words on what it asserts. The user decides.',
    '- Prefer a Connection type already used in this Web over inventing a new one.',
    activeGraph?.id ? `- This Web's targetGraphId is "${activeGraph.id}" if you need to read it.` : undefined,
    '',
    READ_TOOL_NOTE
  );
  return result(lines, {
    summary: `Does "${name}" connect to anything here?`,
    action: 'connect-thing',
    subjectLabel: `"${name}"`
  });
}

export function buildFillDetailsPrompt(prototype) {
  if (!prototype) return null;
  const name = prototype.name || 'this Thing';
  const lines = [`Fill in the details for "${name}" — its description, and its type if it is missing one.`];
  thingHeader(prototype, lines);
  lines.push('',
    'What to do:',
    `- Call updateNode with nodeName="${name}" and a description: two or three sentences saying what it is, written so someone meeting the term here understands it. Not a dictionary entry — say what it is in a way that fits how this Web uses it.`,
    '- If it has no type and an uncontested one exists, call setNodeType. Skip this where the category is arguable; a wrong type is worse than none.',
    '- If it is a real-world subject with a stable identity, you may call enrichFromWikipedia or linkIdentifier to ground it.',
    '- Leave a description that is already good alone. Say what you left and why rather than rewriting it to have done something.',
    '',
    'Do not add Connections and do not build a definition Web — this ask is only about the Thing\'s own details.'
  );
  return result(lines, {
    summary: `Fill in details for "${name}"`,
    action: 'fill-details',
    subjectLabel: `"${name}"`
  });
}

// ── Connection ───────────────────────────────────────────────────────────────

function connectionHeader(edges, lines) {
  const ctx = connectionContext(edges);
  lines.push('', `The Connection${edges.length === 1 ? '' : 's'}:`, ...ctx.edgeLines);

  const seen = new Set();
  const endpoints = [];
  edges.forEach((edge) => {
    [edge.sourceId, edge.destinationId || edge.targetId].forEach((iid) => {
      if (!iid || seen.has(iid)) return;
      seen.add(iid);
      const c = ctx.nodeContextForInstance(iid);
      if (!c) return;
      endpoints.push(`- "${c.name}"${c.typeName ? ` [type: "${c.typeName}"]` : ''} — ${c.description || '(no description)'}`);
    });
  });
  if (endpoints.length > 0) lines.push('', 'What the endpoints are:', ...endpoints);

  if (ctx.siblings.length > 0) {
    lines.push('', 'Other Connections that already exist between the same endpoints:', ...ctx.siblings);
  } else {
    lines.push('', 'No other Connections exist between the same endpoints in this Web.');
  }
  return ctx;
}

export function buildExplainConnectionPrompt(edges) {
  if (!edges || edges.length === 0) return null;
  const lines = [`Explain what this Connection asserts, and what it rests on.`];
  const ctx = connectionHeader(edges, lines);
  const graphCtx = buildGraphContextLines(ctx.activeGraph, ctx.nodePrototypesMap);
  if (graphCtx.length > 0) lines.push('', 'The Web it is in:', ...graphCtx);
  lines.push('',
    'What to do:',
    '- Say what claim this Connection is making about its two endpoints, in plain language. "X --[Funds]--> Y" asserts something specific; say what.',
    '- Say what it rests on — the endpoint descriptions, their types, the surrounding Web, or general knowledge of the subject. Be explicit about which, especially where it is the last one.',
    '- If the Connection type is vague, or the direction reads backwards, or it asserts something the endpoints do not support, say so. Do not fix it — the user did not ask you to.',
    '',
    PROSE_NOTE,
    READ_TOOL_NOTE
  );
  const sName = ctx.nodeLabelForInstance(edges[0].sourceId);
  const tName = ctx.nodeLabelForInstance(edges[0].destinationId || edges[0].targetId);
  return result(lines, {
    summary: `Explain connection: "${sName}" → "${tName}"`,
    action: 'explain-connection',
    subjectLabel: `"${sName}" → "${tName}"`
  });
}

export function buildConnectionGapsPrompt(edges) {
  if (!edges || edges.length === 0) return null;
  const lines = [
    'Question: is there anything else that should exist between these two Things?',
    '',
    'This is a QUESTION. "No — the Connection they already have covers it" is a complete answer, and the usual one. Two Things rarely stand in five relations to each other, and a Web that says they do is harder to read, not richer.'
  ];
  const ctx = connectionHeader(edges, lines);
  if (ctx.activeGraphConnectionTypes.length > 0) {
    lines.push('', `Connection types already used in this Web: ${ctx.activeGraphConnectionTypes.join(', ')}.`);
  }
  lines.push('',
    'How to answer:',
    '- Only count a relation that is genuinely distinct from the one already drawn. A rewording of the existing Connection is not a gap.',
    '- Only count one that is well established, not one you can construct. If you find yourself reasoning toward it, it is not missing.',
    '- If the answer is no, say so in one line and say what the existing Connection already covers.',
    '',
    'If the answer IS yes:',
    '- Do not create anything. Call askMultipleChoice with one option per proposed Connection, written as `"Source" --[Type]--> "Target"` plus a few words on what it would assert.',
    '- Prefer a Connection type already used in this Web.',
    '',
    READ_TOOL_NOTE
  );
  const sName = ctx.nodeLabelForInstance(edges[0].sourceId);
  const tName = ctx.nodeLabelForInstance(edges[0].destinationId || edges[0].targetId);
  return result(lines, {
    summary: `Anything else between "${sName}" and "${tName}"?`,
    action: 'connection-gaps',
    subjectLabel: `"${sName}" → "${tName}"`
  });
}

// ── Web ──────────────────────────────────────────────────────────────────────

function webHeader(lines) {
  const st = useGraphStore.getState();
  const activeGraph = st.activeGraphId ? st.graphs.get(st.activeGraphId) : null;
  const ctx = buildGraphContextLines(activeGraph, st.nodePrototypes, { maxOtherNodes: 60 });
  if (ctx.length > 0) lines.push('', 'The Web:', ...ctx);
  return activeGraph;
}

export function buildSummarizeWebPrompt() {
  const lines = ['Summarize this Web.'];
  const activeGraph = webHeader(lines);
  if (!activeGraph) return null;
  lines.push('',
    'What to do:',
    '- Say what this Web is about, and what it is claiming — not a list of what is in it, which the user can already see.',
    '- Name the two or three Things doing the most structural work, and say why they are load-bearing.',
    '- If the Web is really two subjects sitting in one place, say so.',
    `- Read the full structure first with readGraph, targetGraphId="${activeGraph.id}". The listing above is a sample, not the whole Web.`,
    '',
    PROSE_NOTE,
    READ_TOOL_NOTE
  );
  return result(lines, {
    summary: `Summarize "${activeGraph.name || 'this Web'}"`,
    action: 'summarize-web',
    subjectLabel: `"${activeGraph.name || 'this Web'}"`
  });
}

export function buildAuditWebPrompt() {
  const lines = ['Audit this Web and report what is structurally wrong with it.'];
  const activeGraph = webHeader(lines);
  if (!activeGraph) return null;
  lines.push('',
    'What to look for:',
    `- Read the whole structure first with readGraph, targetGraphId="${activeGraph.id}".`,
    '- Stranded Things: present but connected to nothing. Worth reporting — but a Thing can be deliberately unconnected, so report it as an observation, not a defect to be fixed.',
    '- Over-central hubs: one Thing on most of the Connections. That usually means a containment relationship was drawn as Connections when it should be a layer.',
    '- One Connection type doing all the work, which usually means the distinctions between relations have been flattened away.',
    '- Things with no description, especially ones whose names are not self-explanatory.',
    '- Whole regions of the Web that are disconnected from the rest.',
    '',
    'How to report it:',
    '- Name specific Things. "Three Things have no description" is useless; naming them is not.',
    '- Say which findings actually matter and which are cosmetic. Not every stranded Thing is a problem.',
    '- Do not fix anything. Report, and let the user decide what to act on.',
    '',
    PROSE_NOTE,
    READ_TOOL_NOTE
  );
  return result(lines, {
    summary: `Audit "${activeGraph.name || 'this Web'}"`,
    action: 'audit-web',
    subjectLabel: `"${activeGraph.name || 'this Web'}"`
  });
}

// ── Free text ────────────────────────────────────────────────────────────────

/**
 * The user's own sentence, wrapped in the element's context.
 *
 * The context IS the feature. Without it this is just the chat box, which the
 * user already had. Deliberately carries no tool policy: we cannot know whether
 * "clean these up" is a question or an instruction, and the user typed the words,
 * which is exactly the input the keyword tool tiers were built for.
 */
export function buildFreeTextPrompt(surface, payload, freeText) {
  const question = (freeText || '').trim();
  if (!question) return null;
  const lines = [];
  let subjectLabel = '';

  if (surface === 'thing' && payload?.prototype) {
    const name = payload.prototype.name || 'this Thing';
    subjectLabel = `"${name}"`;
    lines.push(`The user is asking about the Thing "${name}".`);
    thingHeader(payload.prototype, lines);
  } else if (surface === 'connection' && payload?.edges?.length) {
    const ctx = connectionContext(payload.edges);
    const sName = ctx.nodeLabelForInstance(payload.edges[0].sourceId);
    const tName = ctx.nodeLabelForInstance(payload.edges[0].destinationId || payload.edges[0].targetId);
    subjectLabel = `"${sName}" → "${tName}"`;
    lines.push(`The user is asking about the Connection ${subjectLabel}.`);
    connectionHeader(payload.edges, lines);
  } else {
    const activeGraph = webHeader(lines);
    if (!activeGraph) return null;
    subjectLabel = `"${activeGraph.name || 'this Web'}"`;
    lines.unshift(`The user is asking about the Web ${subjectLabel}.`);
  }

  lines.push('',
    'Their question:',
    question,
    '',
    'Answer that question. It may want an explanation, or it may want you to change something — read it as written. If it asks for a change, make it. If it asks something, answer in prose. When it is ambiguous, ask rather than guessing at a change that is hard to undo.',
    'The context above is what the user is looking at; use it before reaching for tools.'
  );

  return result(lines, {
    summary: question.length > 80 ? `${question.slice(0, 77)}…` : question,
    action: `ask-${surface}`,
    subjectLabel
  });
}

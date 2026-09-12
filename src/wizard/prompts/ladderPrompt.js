/**
 * Ask The Wizard prompt for a Thing's abstraction ladder.
 *
 * Moved verbatim out of NodeCanvas.jsx. These builders were always pure over
 * useGraphStore.getState() — they closed over nothing from the component, which
 * is why every one of them declared an empty useCallback dependency array — so
 * living outside React costs them nothing and makes them testable.
 */
import useGraphStore from '../../store/graphStore.js';
import { resolveChain, THING_PROTOTYPE_ID } from '../tools/utils/abstractionSpec.js';
import { buildGraphContextLines, collectTypeAncestry } from './shared.js';

// "Ask The Wizard" from the abstraction carousel: build out or refine the focused
// node's abstraction chain for the dimension the carousel is currently showing.
//
// This is DATA abstraction — a generalization spectrum where each step is a strictly
// broader category that the step above it is a kind of. It is not composition (that's
// the define-node prompt above) and it is not a relationship graph: no edges are
// involved, only chain membership and its ordering. The work is nearly always toward
// the generic end; the specific end is where concrete examples live and is rare.
export function buildWizardAbstractionPrompt(prototype, dimension, opts = {}) {
  if (!prototype || !dimension) return null;
  const includeInstructions = opts.includeInstructions === 'short' ? 'short' : 'full';
  const st = useGraphStore.getState();
  const graphs = st.graphs;
  const nodePrototypesMap = st.nodePrototypes;
  const activeId = st.activeGraphId;
  const activeGraph = activeId ? graphs.get(activeId) : null;

  const protoName = prototype.name || 'this node';
  const protoDescription = (prototype.description || '').trim();

  // Resolve the chain the carousel is actually showing, through the same helper the
  // carousel uses. This matters more than it looks: addToAbstractionChain writes to
  // whichever prototype it's handed, so naming a mere member starts a SECOND,
  // competing chain instead of extending the one on screen.
  const resolvedChain = resolveChain(prototype.id, dimension, nodePrototypesMap.values());
  const chainOwner = nodePrototypesMap.get(resolvedChain.ownerId) || prototype;
  // Render whatever the carousel is rendering, INCLUDING a synthesized one.
  // This used to null out the virtual case and tell the model "there is no chain
  // yet" — while the user was looking at a carousel showing the node, its type and
  // Thing, because resolveChain synthesizes exactly that. The model then built a
  // ladder from scratch and re-added the type that was already on screen, which is
  // the doubled rung at the type.
  const chain = resolvedChain.chain;
  // Seeded means nobody has edited it: it is [node, type, Thing], derived from the
  // type rather than authored. The rungs are real and on screen either way.
  const chainIsSeeded = resolvedChain.seeded;
  const ownerName = chainOwner.name || protoName;
  const chainMemberIdSet = new Set(Array.isArray(chain) ? chain : []);

  // Render the chain as the carousel reads it: index order runs specific → generic,
  // with the focused node at level 0. Signed levels are how readAbstractionChain
  // reports a chain back to the wizard, so the two agree on what "+2" means.
  const chainLines = [];
  if (Array.isArray(chain) && chain.length > 0) {
    const focusIndex = chain.indexOf(prototype.id);
    chain.forEach((memberId, index) => {
      const member = nodePrototypesMap.get(memberId);
      const memberName = member?.name || memberId;
      const level = focusIndex >= 0 ? index - focusIndex : index;
      const marker = memberId === prototype.id
        ? ' ← the focused node'
        : (memberId === THING_PROTOTYPE_ID ? ' ← the base Thing, the floor of every ladder' : '');
      const role = level < 0 ? 'more specific' : level > 0 ? 'more generic' : 'current';
      const memberDesc = (member?.description || '').trim();
      const descPart = memberDesc ? ` — ${memberDesc.length > 120 ? memberDesc.slice(0, 120) + '…' : memberDesc}` : '';
      chainLines.push(`- ${level >= 0 ? '+' : ''}${level}: "${memberName}" (${role})${descPart}${marker}`);
    });
  }

  // The focused node's type ladder — its most direct evidence for what sits below it.
  const typeAncestry = collectTypeAncestry(prototype, nodePrototypesMap);

  // Categories the project already uses as types, so the wizard reuses an existing
  // node rather than minting a near-duplicate of one. Ranked by how many prototypes
  // point at them, since a heavily used type is a category this project has settled on.
  const typeUsage = new Map();
  nodePrototypesMap.forEach((proto) => {
    const tid = proto?.typeNodeId;
    if (!tid || tid === 'base-thing-prototype' || tid === prototype.id) return;
    typeUsage.set(tid, (typeUsage.get(tid) || 0) + 1);
  });
  const chainMemberIds = new Set(Array.isArray(chain) ? chain : []);
  const typeRoster = [...typeUsage.entries()]
    .filter(([tid]) => !chainMemberIds.has(tid) && nodePrototypesMap.has(tid))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tid, count]) => {
      const proto = nodePrototypesMap.get(tid);
      return `"${proto.name || tid}" (used as the type of ${count} node${count === 1 ? '' : 's'})`;
    });

  const lines = [];
  lines.push(`I need help building out the abstraction chain for the node "${protoName}", on the "${dimension}" axis.`);
  lines.push('');
  lines.push('This is data abstraction: a ladder of generality, where each step down is a strictly broader category that the step above it is a kind of. It is NOT composition (parts of a thing) and NOT a relationship graph. No connections/edges are involved here — only which nodes are on the ladder and in what order.');
  lines.push('');
  lines.push('Examples of well-formed ladders, in different domains:');
  lines.push('- "Ford Motor Company" → "Automaker" → "Manufacturing Company" → "Company" → "Organization"');
  lines.push('- "Rotterdam" → "Port City" → "City" → "Settlement" → "Place"');
  lines.push('- "Marie Curie" → "Physicist" → "Scientist" → "Person"');
  lines.push('- "The Marshall Plan" → "Aid Program" → "Government Program" → "Policy Instrument"');
  lines.push('');
  lines.push('The test for every adjacent pair is that "<upper> is a kind of <lower>" reads as plainly true. Apply it to each step you add; if it does not read true, the step is wrong.');
  lines.push('');
  lines.push('Things that are NOT levels on this ladder, and are the usual way this goes wrong:');
  lines.push('- A node whose NAME merely overlaps the category you want. Sharing a word is not evidence of anything — "Company Town" is not the category "Company".');
  lines.push('- A part or component of the node ("Engine" is not a generalization of a car).');
  lines.push('- Something merely associated with it — a place it operated, a person who ran it, a thing it produced. Those are connections, not abstraction levels.');
  lines.push('- A sibling: another thing of the same kind, at the same level of generality.');

  lines.push('');
  lines.push('What we know about the focused node:');
  lines.push(`- Name: "${protoName}"`);
  lines.push(protoDescription
    ? `- Description: ${protoDescription}`
    : '- Description: (none — infer from the name, type and context)');
  if (typeAncestry.length > 0) {
    const ladder = typeAncestry.map((t) => {
      const desc = (t.description || '').trim();
      const onChain = chainMemberIdSet.has(t.id) ? ' [ALREADY ON THE CHAIN]' : '';
      return desc
        ? `"${t.name || 'Node'}"${onChain} (${desc.length > 120 ? desc.slice(0, 120) + '…' : desc})`
        : `"${t.name || 'Node'}"${onChain}`;
    });
    lines.push(`- Type ladder (this node's type, then that type's type, …): ${ladder.join(' → ')}`);
    // Without the exclusion this line actively caused the duplicate: the node's
    // own type is on the seeded chain by construction, and the model was being
    // told in as many words to put it there again.
    const offChain = typeAncestry.filter((t) => !chainMemberIdSet.has(t.id));
    if (offChain.length > 0) {
      lines.push('  These are already generalizations of the focused node. Strongly prefer putting the ones NOT yet on the chain onto it — reusing them keeps the ladder consistent with how the project is typed — before inventing new category nodes.');
    } else {
      lines.push('  Every one of these is already on the chain above. They are shown as evidence of what this node is, not as rungs to add — adding them again would duplicate them.');
    }
  } else {
    lines.push('- Type: (untyped, or typed only as the base Thing — no ready-made generalization to reuse)');
  }

  lines.push('');
  if (chainLines.length > 0) {
    lines.push(`The "${dimension}" chain the carousel is showing right now (level 0 is the focused node; negative is more specific, positive is more generic):`);
    lines.push(...chainLines);
    lines.push(`- This chain is owned by the node "${ownerName}".`);
    if (chainIsSeeded) {
      lines.push('- It is still the automatic chain: a node\'s type IS a generalization of it, so assigning a type puts the type on this axis, with the base "Thing" as the floor. Nobody has edited it by hand yet.');
    }
    lines.push('- EVERY rung listed above already exists on this chain. Do NOT name any of them again: a rung you re-list is inserted a second time, and the carousel then shows it twice. Name only the levels that are MISSING.');
    lines.push('- In particular, do not re-add the type and do not add another floor beneath "Thing". The useful work is the levels BETWEEN the focused node and the rungs already there.');
  } else {
    lines.push(`There is no "${dimension}" chain yet — the focused node is on its own. You are building the first one, which is owned by "${ownerName}".`);
  }

  if (typeRoster.length > 0) {
    lines.push('');
    lines.push('Categories this project already uses as types (reuse one of these when it means the level you want, instead of creating a near-duplicate):');
    lines.push(`- ${typeRoster.join(', ')}`);
  }

  const graphCtxLines = buildGraphContextLines(activeGraph, nodePrototypesMap, { excludePrototypeIds: new Set([prototype.id]) });
  if (graphCtxLines.length > 0) {
    lines.push('');
    lines.push('About the graph this node lives in:');
    lines.push(...graphCtxLines);
  }

  lines.push('');
  if (includeInstructions === 'full') {
    lines.push('Goals:');
    lines.push('- Extend the chain toward the GENERIC end — this is nearly all of the work. Each level you add should be one honest step broader than the one above it: broad enough to be a real generalization, not so broad that it skips a category anyone would name.');
    lines.push('- A ladder of ONE rung is a complete ladder, and often the right one. If the only honest generalization is "Company", add "Company" and stop — do not pad it out to a tidy-looking four. Stop as soon as the next level up stops saying anything about this node.');
    lines.push('- Name each level for what it SHOULD be, not for what happens to exist. Reach for an existing category when it genuinely means that level — the type ladder above is the best place to look — but never bend a rung to fit a node that is merely nearby. New category nodes are the normal case here, and the tool creates them for you; an ill-fitting rung is far worse than a new one.');
    lines.push('- Refine what is already there if it is wrong: a level out of order, a step that is not actually a generalization of the one above it, or a gap big enough that a named category is obviously missing between two levels.');
    lines.push('- The SPECIFIC end (adding levels above the focused node) is for concrete examples and well-known subtypes. Only add one when it is genuinely useful and unambiguous — most chains do not need it.');
    lines.push('');
    lines.push('Before applying changes (only if needed):');
    lines.push(`- Call abstractionChain with action="read" and nodeName="${ownerName}" if you want the chain re-read straight from the project.`);
    lines.push('- You do NOT need to search for whether a category already exists — the build call matches by name itself. Search only if you are unsure what the node actually is.');
    lines.push('- You may call querySparql or enrichFromWikipedia for outside evidence about how a term is normally classified — but only if you actually need it.');
    lines.push('');
    lines.push('How to apply it (important):');
    lines.push(`- ONE call does the whole ladder: abstractionChain with action="build", nodeName="${protoName}", dimension="${dimension}", and moreGeneric=[…] listing the rungs broader than this node, ordered nearest-first.`);
    lines.push('- Give EVERY rung a description, not just a name — pass objects, not bare strings:');
    lines.push(`    { "action": "build", "nodeName": "${protoName}", "dimension": "${dimension}", "moreGeneric": [`);
    lines.push('        { "name": "Automaker", "description": "A company that designs and manufactures motor vehicles." },');
    lines.push('        { "name": "Company", "description": "A legally constituted business entity formed to produce or trade goods and services." } ] }');
    lines.push('  The description is what that node shows in the carousel and everywhere else in the project, so write a one-sentence gloss of what the category covers — not of the node the ladder was built from.');
    lines.push(`- Name the rungs to agree with "${protoName}" itself. If it is plural, the categories above it are plural too; if singular, singular. A plural node is a real concept, not a mistake to be corrected — do not quietly re-number the ladder away from the node it belongs to.`);
    lines.push('- Beyond that, you do not need to match the spelling of anything that already exists: a rung is reused across minor wording differences, and only genuinely new categories get created.');
    lines.push('- Do NOT call createNode for the rungs. The build call creates whatever is missing itself, in the right order and the right carousel shading.');
    lines.push('- moreSpecific=[…] adds rungs on the narrow side, nearest-first. Usually leave it out.');
    lines.push('- Use action="add" only to fix up one level of a chain that already exists. For building, "build" is the whole job in one call.');
    lines.push('- Use node names exactly as they appear above. Do not pass IDs you have not seen in this message.');
    lines.push('');
    lines.push('Searching is never the finished job. If you look something up first, come back and make the build call in the same turn — the task is done when the levels are actually on the chain, not when you have decided what they should be.');
    lines.push('');
    lines.push('Reporting back: the user does NOT see this message — on their side it appears only as a small "Build abstraction chain" chip. So write your reply as if they had simply asked for the chain in their own words. Say what the ladder now is and flag anything you were unsure of. Do not refer to these instructions, to the context you were given, to the goals or rules above, or to the tool call itself.');
  } else {
    lines.push('Tool to use this time:');
    lines.push(`- abstractionChain with action="build", nodeName="${protoName}", dimension="${dimension}", moreGeneric=[…] ordered nearest-first, each rung as { name, description }, worded to agree with "${protoName}". One call; it reuses or creates each rung itself.`);
    lines.push('');
    lines.push('(Reminder: same generalization-ladder goal and rules as the previous Ask The Wizard message in this conversation. Use node names, never IDs. As before, the user does not see this message — reply as if they had asked for the chain in their own words, without referring to these instructions.)');
  }

  const subjectLabel = `"${protoName}"`;
  const summary = `Build abstraction chain for ${subjectLabel}`;

  return {
    message: lines.join('\n'),
    summary,
    action: 'refine-abstraction',
    subjectLabel
  };
}

/**
 * The Wizard asks before it deletes a lot.
 *
 * The model reads text it didn't write — a Wikipedia extract, an imported
 * file, a web page, another universe — and any of it can carry instructions.
 * Every Wizard edit is undoable, so a single stray delete is cheap. What isn't
 * cheap is a whole web gone, or fifty Things merged away in one reply, where
 * undoing means noticing first.
 *
 * So two kinds of change are held until the person says yes:
 *  - anything that deletes a web (removeDefinitionGraph, mergeGraphs);
 *  - node deletes and merges past the tenth in a single Wizard turn. The first
 *    ten apply as they come (each is undoable); the rest wait, together.
 *
 * Held changes sit in this store. LeftAIView shows them in the panel's usual
 * ConfirmDialog with Allow / Don't allow. Allow applies them through the
 * normal applier path, as one undo step; Don't allow drops them and says so in
 * the chat.
 *
 * Browser only. In Node (the headless daemon, the CLI) there is nobody to ask
 * and the person driving it is the one who typed the command, so nothing is
 * held there.
 */
import { create } from 'zustand';

/** Node deletes/merges a single turn may make before the rest are held. */
export const NODE_CHANGE_THRESHOLD = 10;

/** A turn with no Wizard activity for this long is over (bridge / MCP path). */
const TURN_IDLE_MS = 2 * 60 * 1000;

const GRAPH_LEVEL_ACTIONS = new Set(['removeDefinitionGraph', 'mergeGraphs']);
const NODE_LEVEL_ACTIONS = new Set(['deleteNode', 'mergeNodes']);

export const useWizardConfirmationStore = create(() => ({
  /** [{ id, conversationId, toolName, result, toolCallId, kind, summary }] */
  pending: [],
}));

const turns = new Map(); // turnKey → { count, lastAt }
let heldCounter = 0;

const turnKeyFor = (conversationId) => conversationId || '__external__';

/**
 * Start a new Wizard turn for a conversation: the node-change count starts
 * again from zero. LeftAIView calls this when it sends an ask.
 */
export function beginWizardTurn(conversationId) {
  turns.set(turnKeyFor(conversationId), { count: 0, lastAt: Date.now() });
}

const quote = (value) => `"${String(value ?? '').slice(0, 80)}"`;

/** One line, in the Wizard's voice, saying what a held change would do. */
export function describeHeldChange(toolName, result) {
  const action = result?.action || toolName;
  if (action === 'removeDefinitionGraph') {
    return `remove the definition web ${quote(result?.graphName || result?.graphId)} from ${quote(result?.nodeName)}, deleting the web`;
  }
  if (action === 'mergeGraphs') {
    const pairs = Array.isArray(result?.pairs) ? result.pairs.length : 0;
    return `merge the web ${quote(result?.sourceGraphName || result?.sourceGraphId)} into ${quote(result?.targetGraphName || result?.targetGraphId)} and delete it`
      + (pairs ? ` (merging ${pairs} duplicate pair${pairs === 1 ? '' : 's'})` : '');
  }
  if (action === 'deleteNode') return `delete ${quote(result?.name)}`;
  if (action === 'mergeNodes') {
    return `merge ${quote(result?.secondaryName || result?.secondaryProtoId)} into ${quote(result?.primaryName || result?.primaryProtoId)}`;
  }
  return `apply ${action}`;
}

/**
 * Whether this result must wait for a yes. Counting is a side effect: a node
 * delete or merge that is let through still counts toward the turn.
 *
 * @returns {null | 'graph' | 'bulk'}
 */
export function classifyForConfirmation(toolName, result, conversationId, now = Date.now()) {
  if (typeof window === 'undefined') return null;
  const action = result?.action || toolName;
  if (GRAPH_LEVEL_ACTIONS.has(action)) return 'graph';
  if (!NODE_LEVEL_ACTIONS.has(action)) return null;

  const key = turnKeyFor(conversationId);
  let turn = turns.get(key);
  if (!turn || now - turn.lastAt > TURN_IDLE_MS) {
    turn = { count: 0, lastAt: now };
    turns.set(key, turn);
  }
  turn.count += 1;
  turn.lastAt = now;
  return turn.count > NODE_CHANGE_THRESHOLD ? 'bulk' : null;
}

/** Put a result on hold. */
export function holdForConfirmation({ toolName, result, toolCallId, conversationId, kind }) {
  const entry = {
    id: `held-${Date.now()}-${++heldCounter}`,
    conversationId: conversationId || null,
    toolName,
    // Held by value: the agent loop may reuse or mutate its result objects.
    result: JSON.parse(JSON.stringify(result)),
    toolCallId: toolCallId || null,
    kind,
    summary: describeHeldChange(toolName, result),
  };
  useWizardConfirmationStore.setState((state) => ({ pending: [...state.pending, entry] }));
  return entry;
}

/**
 * Held changes a conversation's panel should ask about: its own, plus any that
 * came in over the MCP bridge with no conversation.
 */
export const pendingForConversation = (pending, conversationId) =>
  pending.filter((entry) => entry.conversationId === null || entry.conversationId === conversationId);

/** The question shown to the person, built from the held changes. */
export function buildConfirmationQuestion(entries) {
  const graphLevel = entries.filter((e) => e.kind === 'graph');
  const bulk = entries.filter((e) => e.kind !== 'graph');
  const lines = [];
  for (const entry of graphLevel) lines.push(`- ${entry.summary}`);
  if (bulk.length > 0) {
    const names = bulk.slice(0, 6).map((e) => e.summary).join('; ');
    const more = bulk.length > 6 ? `; and ${bulk.length - 6} more` : '';
    lines.push(`- ${bulk.length} more deletes and merges in this reply: ${names}${more}`);
  }
  return `The Wizard wants to:\n${lines.join('\n')}`;
}

/** Take the held changes out of the store (without applying them). */
export function takePending(ids) {
  const wanted = new Set(ids);
  let taken = [];
  useWizardConfirmationStore.setState((state) => {
    taken = state.pending.filter((entry) => wanted.has(entry.id));
    return { pending: state.pending.filter((entry) => !wanted.has(entry.id)) };
  });
  return taken;
}

/** Test hook. */
export function _resetWizardConfirmationGate() {
  turns.clear();
  heldCounter = 0;
  useWizardConfirmationStore.setState({ pending: [] });
}

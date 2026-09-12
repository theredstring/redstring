/**
 * Per-ask tool policies.
 *
 * An "Ask The Wizard" intent can declare that its ask is a QUESTION rather than
 * an instruction. Asking politely in the prompt is not enough — the model will
 * happily call updateEdge on its way to explaining something — so a policy
 * restricts the schemas the model is offered and hard-refuses anything outside
 * the set at execution time.
 *
 * ── The load-bearing part ────────────────────────────────────────────────────
 *
 * THE POLICY IS ALSO THE HALT MECHANISM for query-first intents. `askMultipleChoice`
 * does not stop the agent loop by itself: it returns an ordinary result and the
 * loop iterates on. "Propose, then wait for the user" works because a restricted
 * policy leaves the model nothing else it *can* call. If you widen a query-first
 * policy to include mutating tools, the flow silently becomes "propose, then do
 * it anyway" — the proposal stops being a proposal. Change one, check the other.
 *
 * ── Why an explicit allow-set and not a derived predicate ────────────────────
 *
 * The tempting test is "does the tool return a non-null `action`", since wizard
 * tools are pure spec-producers and every store write happens in
 * services/toolResultApplier.js keyed on that field. It does not work:
 * `selectNode` returns action 'selectNode' but the applier only dispatches a
 * window event for it — nothing is written. The honest question is "does the
 * applier's branch for this action write graph data", and that is not derivable
 * at runtime. So the sets below are maintained by hand, and a test pins them to
 * the real tool names so a rename cannot silently empty one.
 */

/**
 * Tools that cannot change anything: no graph writes, no navigation, no
 * conversation state. Safe for an ask whose answer is prose.
 *
 * Deliberately EXCLUDED, despite looking harmless:
 * - `listTools` sets graphState._unlockAllTools, which re-expands the toolset
 *   for the rest of the ask and would defeat the policy outright.
 * - `switchToGraph` opens a tab and moves the viewport. Nothing about graph data
 *   changes, but the user's view jumping during a question they asked about
 *   something on screen is its own kind of side effect. Intents that need
 *   another Web read it with readGraph(targetGraphId) instead — say so in the
 *   intent's tool rules, or the model burns a refusal guessing.
 * - `planTask` / `declareGoal` write conversation state to the store, and a
 *   question is not a build to be planned.
 */
export const READ_ONLY_TOOLS = new Set([
  'readGraph',
  'search',
  'getNodeContext',
  'inspectPrototype',
  'inspectWorkspace',
  'sketchGraph',
  'findDuplicates',
  'analyzeTabularData',
  'discoverOrbit',
  'semanticSearch',
  'querySparql',
  'findWork',
  'askMultipleChoice',
  // Conditionally mutating — offered with their action enum narrowed to the
  // read branch. See NARROWED_TOOLS.
  'abstractionChain',
  'manageDefinitions'
]);

/**
 * Query-first intents ("Does this connect to anything here?") investigate under
 * read-only rules and then either report an honest nothing-found or propose via
 * askMultipleChoice. They additionally get `selectNode`, which is how the wizard
 * points at what it found — desirable when the answer is about specific Things
 * on screen, jarring in the middle of an Explain or a Summarize.
 */
export const QUERY_FIRST_TOOLS = new Set([...READ_ONLY_TOOLS, 'selectNode']);

/**
 * Schema overrides for tools whose read branch is safe but whose write branches
 * are not. The clone is applied at selection time; the originals are shared
 * literals returned by getToolDefinitions() and must never be mutated in place.
 */
const NARROWED_TOOLS = {
  abstractionChain: {
    description: 'Read a node\'s abstraction chains (the carousel\'s generalization ladders).',
    actionEnum: ['read'],
    actionDescription: '"read" (the only action available for this ask): view all chains.'
  },
  manageDefinitions: {
    description: 'List the definition graphs for a node.',
    actionEnum: ['list'],
    actionDescription: '"list" (the only action available for this ask): show definition graphs with node/edge counts.'
  }
};

/** Policy identifiers a caller may request. `null`/unknown means unrestricted. */
export const TOOL_POLICIES = {
  READ_ONLY: 'readonly',
  QUERY_FIRST: 'query'
};

/**
 * Resolve a policy name to its allow-set. Returns null for anything unrecognized,
 * including undefined — an ask with no policy behaves exactly as it did before
 * policies existed, which is what keeps free-text and every imperative intent on
 * the normal selectToolsForTurn path.
 */
export function resolveToolPolicy(policy) {
  if (policy === TOOL_POLICIES.READ_ONLY) {
    return { id: TOOL_POLICIES.READ_ONLY, allow: READ_ONLY_TOOLS };
  }
  if (policy === TOOL_POLICIES.QUERY_FIRST) {
    return { id: TOOL_POLICIES.QUERY_FIRST, allow: QUERY_FIRST_TOOLS };
  }
  return null;
}

/**
 * Build the tool list for a restricted ask.
 *
 * This BUILDS rather than filters selectToolsForTurn's output, and that is not a
 * stylistic choice. selectToolsForTurn gates on TOOL_TIERS, which withholds
 * exactly what the restricted intents need — getNodeContext, inspectPrototype
 * and abstractionChain are all 'hasNodes'-gated, findDuplicates needs five
 * nodes, and the semantic tools are keyword-matched against the user's message.
 * Asking "does this connect to anything here?" about a Thing in a sparse Web
 * would be offered a handful of tools and NOT getNodeContext, the single most
 * relevant one. Its small-model whitelist is worse: intersected with the
 * read-only set it leaves three tools and no search at all.
 *
 * Building from the full catalog also makes the set constant for the whole ask
 * regardless of what the graph looks like, which is exactly what the tool-block
 * prompt cache wants (see the freeze comment in AgentLoop).
 */
export function buildPolicyToolList(allTools, resolved) {
  if (!resolved) return allTools;
  return allTools
    .filter((tool) => resolved.allow.has(tool.name))
    .map((tool) => {
      const narrowing = NARROWED_TOOLS[tool.name];
      if (!narrowing) return tool;
      const actionProp = tool.parameters?.properties?.action;
      if (!actionProp) return tool;
      // Clone down to the property being changed — the schema objects are shared
      // across every caller of getToolDefinitions().
      return {
        ...tool,
        description: narrowing.description,
        parameters: {
          ...tool.parameters,
          properties: {
            ...tool.parameters.properties,
            action: {
              ...actionProp,
              enum: narrowing.actionEnum,
              description: narrowing.actionDescription
            }
          }
        }
      };
    });
}

/**
 * Is this tool call permitted under the active policy? Schema filtering alone is
 * not enough — a model can emit a tool_call for a name it was never offered
 * (replayed history, provider quirks), and without this check it would execute.
 */
export function isToolAllowed(name, resolved) {
  if (!resolved) return true;
  return resolved.allow.has(name);
}

/**
 * The refusal handed back to the model when it reaches for something the policy
 * withholds. Shaped like the planTask/declareGoal locks so the loop can treat it
 * the same way: a settled tool result the model reads and moves on from, not an
 * error that reads as a malfunction.
 */
export function toolRefusalResult(name, resolved) {
  const detail = resolved?.id === TOOL_POLICIES.QUERY_FIRST
    ? 'This ask is a question, not an instruction. Report what you found — including finding nothing, which is a complete answer — or propose the change with askMultipleChoice and let the user accept it.'
    : 'This ask is read-only. Answer in prose; do not try to change anything.';
  return {
    locked: true,
    message: `"${name}" is not available for this ask. ${detail}`
  };
}

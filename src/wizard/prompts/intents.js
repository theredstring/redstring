/**
 * What you can ask The Wizard about a given element.
 *
 * Every "Ask The Wizard" button used to fire exactly one hardcoded prompt — the
 * Thing menu could only ever say "define your components", the Connection menu
 * only "refine yourself". The alternative was typing the question into chat by
 * hand, which throws away the context payload (endpoint descriptions, sibling
 * Connections, the Connection-prototype catalog, the identity rules that keep the
 * model using names instead of IDs) that makes these asks work at all.
 *
 * So the buttons now open a picker, and this is what it renders. The default
 * intent is pre-selected, so the old one-click path costs one extra click and
 * buys everything else.
 *
 * ── Tiers ────────────────────────────────────────────────────────────────────
 *
 * imperative  Do this. Full tool access, today's behaviour.
 * query       A QUESTION whose honest answer is often "no, nothing". Runs under
 *             a read-only policy and proposes via askMultipleChoice if the answer
 *             turns out to be yes. The read-only policy is not a safety rail here,
 *             it is what makes the "no" trustworthy — see toolPolicy.js.
 * readonly    Answer in prose. Cannot change anything, enforced by tool policy.
 * freetext    Your own sentence, wrapped in the same context payload. Deliberately
 *             carries NO policy: we cannot know in advance whether "clean these up"
 *             is a question or an instruction, and a wrong guess costs a refusal
 *             round-trip. The user typed the words, which is exactly the input
 *             TOOL_TIERS' keyword gating was built for.
 *
 * ── Vocabulary ───────────────────────────────────────────────────────────────
 *
 * Labels say Thing, Web and Connection. Never node, graph or edge.
 */
import { TOOL_POLICIES } from '../toolPolicy.js';

export const SURFACES = {
  THING: 'thing',
  CONNECTION: 'connection',
  WEB: 'web',
  LADDER: 'ladder'
};

const POLICY_FOR_TIER = {
  imperative: undefined,
  freetext: undefined,
  readonly: TOOL_POLICIES.READ_ONLY,
  query: TOOL_POLICIES.QUERY_FIRST
};

/**
 * Every intent, in the order the picker lists them. The first available intent on
 * a surface is its default — which is always the ask that button used to perform,
 * so nobody's muscle memory breaks.
 *
 * `label` and `availableWhen` take the `facts` object its surface's context builder
 * produces, so a conditional label reads a field instead of re-deriving state.
 */
const INTENTS = [
  // ── Thing ──────────────────────────────────────────────────────────────────
  {
    id: 'define-components',
    surface: SURFACES.THING,
    action: 'define-node',
    tier: 'imperative',
    label: () => 'Define its components',
    sublabel: "Populate its Web with what it's made of."
  },
  {
    id: 'connect-into-web',
    surface: SURFACES.THING,
    action: 'connect-thing',
    tier: 'query',
    // Plainly an action, not a question put to the user. It was phrased as one
    // ("Does this connect to anything here?") and the model answered the literal
    // question — listing the Connections it already had, which is on the canvas.
    // Coming back empty is still a real result; that lives in the prompt, not in
    // a hedge on the button.
    label: () => 'Find connections',
    sublabel: 'Look for relationships to the Things already here that nobody has drawn.',
    // Nothing to check it against in an otherwise empty Web.
    availableWhen: (facts) => (facts?.webInstanceCount ?? 0) > 1
  },
  {
    id: 'fill-in-details',
    surface: SURFACES.THING,
    action: 'fill-details',
    tier: 'imperative',
    label: () => 'Fill in its details',
    sublabel: 'Write its description, type and links from what surrounds it.'
  },
  {
    id: 'thing-ladder',
    surface: SURFACES.THING,
    action: 'refine-abstraction',
    tier: 'imperative',
    label: (facts) => facts?.hasLadder ? 'Expand its abstraction ladder' : 'Build its abstraction ladder',
    sublabel: 'Place it on a ladder of broader categories.'
  },
  {
    id: 'explain-thing',
    surface: SURFACES.THING,
    action: 'explain-thing',
    tier: 'readonly',
    label: () => 'Explain this Thing',
    sublabel: 'What it is, read from what surrounds it.'
  },
  {
    id: 'thing-freetext',
    surface: SURFACES.THING,
    action: 'ask-thing',
    tier: 'freetext',
    label: () => 'Ask something specific…'
  },

  // ── Connection ─────────────────────────────────────────────────────────────
  {
    id: 'refine-connection',
    surface: SURFACES.CONNECTION,
    action: 'refine-connections',
    tier: 'imperative',
    label: () => 'Refine this Connection',
    sublabel: 'Replace it with a more precise Connection type.'
  },
  {
    id: 'connection-gaps',
    surface: SURFACES.CONNECTION,
    action: 'connection-gaps',
    tier: 'query',
    label: () => 'Find missing connections',
    sublabel: "Look for a relationship these two have that isn't drawn.",
    // Only meaningful about one pair of endpoints.
    availableWhen: (facts) => (facts?.edgeCount ?? 1) === 1
  },
  {
    id: 'explain-connection',
    surface: SURFACES.CONNECTION,
    action: 'explain-connection',
    tier: 'readonly',
    label: () => 'Explain this Connection',
    sublabel: 'What it asserts, and what it rests on.'
  },
  {
    id: 'connection-freetext',
    surface: SURFACES.CONNECTION,
    action: 'ask-connection',
    tier: 'freetext',
    label: () => 'Ask something specific…'
  },

  // ── Web ────────────────────────────────────────────────────────────────────
  {
    id: 'grow-web',
    surface: SURFACES.WEB,
    action: 'grow-graph',
    tier: 'imperative',
    label: (facts) => facts?.isBlank ? 'Populate this Web' : 'Grow this Web',
    sublabel: 'Add Things and Connections that extend it.'
  },
  {
    id: 'summarize-web',
    surface: SURFACES.WEB,
    action: 'summarize-web',
    tier: 'readonly',
    label: () => 'Summarize this Web',
    sublabel: 'What it is about, and what it claims.',
    availableWhen: (facts) => !facts?.isBlank
  },
  {
    id: 'audit-web',
    surface: SURFACES.WEB,
    action: 'audit-web',
    tier: 'readonly',
    label: () => 'Audit this Web',
    sublabel: 'Stranded Things, over-central hubs, thin descriptions.',
    availableWhen: (facts) => !facts?.isBlank
  },
  {
    id: 'web-freetext',
    surface: SURFACES.WEB,
    action: 'ask-web',
    tier: 'freetext',
    label: () => 'Ask something specific…'
  },

  // ── Abstraction ladder ─────────────────────────────────────────────────────
  // One intent on purpose, so this surface skips the picker entirely (see
  // shouldSkipPicker). Free-text about the Thing lives on the Thing's own button,
  // which is a different surface with its own picker.
  {
    id: 'ladder-build',
    surface: SURFACES.LADDER,
    action: 'refine-abstraction',
    tier: 'imperative',
    label: (facts) => facts?.hasLadder ? 'Expand its abstraction ladder' : 'Build its abstraction ladder',
    sublabel: 'Work the ladder for the axis on screen.'
  }
];

/** The tool policy an intent's ask should run under, or undefined for unrestricted. */
export function policyForIntent(intent) {
  return POLICY_FOR_TIER[intent?.tier];
}

/** Intents offered on a surface, given what that surface's context builder found. */
export function intentsForSurface(surface, facts) {
  return INTENTS.filter(i => i.surface === surface && (!i.availableWhen || i.availableWhen(facts)));
}

/** The pre-selected intent: the first available one, which is always today's behaviour. */
export function defaultIntentForSurface(surface, facts) {
  return intentsForSurface(surface, facts)[0] || null;
}

export function getIntent(id) {
  return INTENTS.find(i => i.id === id) || null;
}

/**
 * A picker with one thing in it is a confirmation dialog wearing a costume, so
 * fire that intent directly instead.
 *
 * Counts CANNED intents only — free-text is a row in the list, not an ask of its
 * own — which is what makes the abstraction ladder skip the picker. The rule is
 * self-maintaining: give the ladder a second ask and its picker comes back.
 */
export function shouldSkipPicker(surface, facts) {
  return intentsForSurface(surface, facts).filter(i => i.tier !== 'freetext').length <= 1;
}

/** Human-readable label, for the chip and the picker row. */
export function intentLabel(intent, facts) {
  if (!intent) return '';
  return typeof intent.label === 'function' ? intent.label(facts) : intent.label;
}

export { INTENTS };

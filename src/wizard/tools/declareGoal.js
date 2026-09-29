/**
 * declareGoal — the Goal Based mode's counterpart to planTask.
 *
 * Where a plan says what the Wizard will DO, a goal says what would COUNT: the
 * desire, the condition under which it is satisfied, and the ways it can fail —
 * all stated before building, so the verdict at the end has something it did
 * not write for itself. The tool does not touch the graph. It stores the goal
 * on graphState for context injection (AgentLoop) and returns the rendered
 * text for the conversation history.
 *
 * The same tool issues the verdict: re-call it with status 'satisfied' or
 * 'failed' and a `verdict` naming the evidence. A goal with status 'open' is
 * the only thing that holds a turn open in Goal Based mode, and it carries
 * across turns until it is judged.
 */

export const GOAL_STATUSES = ['open', 'satisfied', 'failed'];

/** A goal is settled when a verdict has been issued on it. */
export function isGoalSettled(goal) {
  return goal?.status === 'satisfied' || goal?.status === 'failed';
}

const statusLabel = (status) => {
  if (status === 'satisfied') return '[SATISFIED]';
  if (status === 'failed') return '[FAILED]';
  return '[OPEN]';
};

/**
 * Render the goal as the model and the user both read it. Doubles as the
 * goal's identity: two goals render identically exactly when they are the
 * same goal, which is how AgentLoop tells a real update from a re-statement.
 * Read-only.
 */
export function renderGoalText(goal) {
  if (!goal || !goal.goal) return '';
  const lines = [`Goal ${statusLabel(goal.status)}: ${goal.goal}`];
  lines.push(`  Satisfied when: ${goal.satisfiedWhen}`);
  const fails = Array.isArray(goal.failsIf) ? goal.failsIf.filter(Boolean) : [];
  if (fails.length > 0) {
    lines.push('  Fails if:');
    for (const f of fails) lines.push(`    - ${f}`);
  }
  if (goal.verdict) {
    lines.push(`  Verdict: ${goal.verdict}`);
  }
  return lines.join('\n');
}

const cleanString = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Target sizes. The goal is a rubric, not a spec, and everything here is
 * re-read every iteration and rendered in the chat, so these are what the
 * model is steered toward.
 *
 * They are targets, not gates. Rejecting an over-long field cost a full round
 * trip (the whole context re-sent, ~25k tokens) to save a few dozen tokens per
 * iteration, and a rejected verdict landed on screen as an error after the work
 * was done. Over a target, the text is accepted and the result carries a note so
 * the next one is shorter; only text past HARD_CEILING times the target is
 * trimmed, to keep a runaway field from riding in every request.
 */
export const GOAL_LIMITS = {
  goal: 240,
  satisfiedWhen: 480,
  failsIfItems: 6,
  failsIfItem: 160,
  verdict: 600
};

const HARD_CEILING = 3;

const trimTo = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export async function declareGoal(args) {
  const goalText = cleanString(args?.goal);
  const satisfiedWhen = cleanString(args?.satisfiedWhen);
  const verdict = cleanString(args?.verdict);
  let status = GOAL_STATUSES.includes(args?.status) ? args.status : 'open';

  if (!goalText) {
    throw new Error('declareGoal requires a goal — one sentence naming what the web must achieve.');
  }
  if (!satisfiedWhen) {
    throw new Error('declareGoal requires satisfiedWhen — a checkable condition on the web (which nodes, connections, or structure must exist) that would make the goal count as reached. Without it there is nothing to judge against.');
  }

  const failsIf = Array.isArray(args?.failsIf)
    ? args.failsIf.map(cleanString).filter(Boolean)
    : [];

  // Over a target: accept, note it for next time, trim only a runaway.
  const notes = [];
  const fit = (text, limit, field, advice) => {
    if (text.length <= limit) return text;
    notes.push(`${field} ran ${text.length} characters (aim for under ${limit}): ${advice}`);
    return trimTo(text, limit * HARD_CEILING);
  };
  const goalFit = fit(goalText, GOAL_LIMITS.goal, 'goal', 'one sentence; conditions belong in satisfiedWhen.');
  const satisfiedFit = fit(satisfiedWhen, GOAL_LIMITS.satisfiedWhen, 'satisfiedWhen', 'a rubric, not a spec.');
  const verdictFit = fit(verdict, GOAL_LIMITS.verdict, 'verdict', 'cite the deciding nodes and connections; don\'t narrate.');
  if (failsIf.length > GOAL_LIMITS.failsIfItems) {
    notes.push(`failsIf has ${failsIf.length} items (aim for ${GOAL_LIMITS.failsIfItems} or fewer): fold related conditions together.`);
  }
  const failsIfFit = failsIf
    .slice(0, GOAL_LIMITS.failsIfItems * HARD_CEILING)
    .map(f => fit(f, GOAL_LIMITS.failsIfItem, 'A failsIf item', 'a short clause naming the failure.'));

  // A verdict without evidence is the goal grading itself. Refuse it so the
  // model has to point at the web (or at the failure mode it hit) before the
  // turn is allowed to end.
  if (status !== 'open' && !verdictFit) {
    throw new Error(`A ${status} verdict needs a verdict string naming the evidence: for "satisfied", which nodes and connections meet satisfiedWhen; for "failed", which failsIf condition tripped and why.`);
  }
  // A verdict on an open goal is just commentary — keep the goal open.
  if (status === 'open' && verdictFit) {
    status = 'open';
  }

  const goal = {
    goal: goalFit,
    satisfiedWhen: satisfiedFit,
    failsIf: failsIfFit,
    status,
    verdict: status === 'open' ? '' : verdictFit
  };

  return {
    action: 'declareGoal',
    goal,
    settled: isGoalSettled(goal),
    goalText: renderGoalText(goal),
    summary: status === 'open'
      ? `Goal declared: ${goalFit}`
      : `Goal ${status}: ${goalFit}`,
    ...(notes.length ? { note: `Accepted as written; no need to resend. For next time: ${notes.join(' ')}` } : {})
  };
}

export default declareGoal;

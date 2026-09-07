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
 * Size limits. The goal is a rubric, not a spec, and everything here is
 * re-read every iteration and rendered in the chat: a verdict that restates
 * every condition with proof is three copies of the same content on screen.
 * Generous enough that a real citation fits; tight enough that an essay
 * does not.
 */
export const GOAL_LIMITS = {
  goal: 240,
  satisfiedWhen: 480,
  failsIfItems: 6,
  failsIfItem: 160,
  verdict: 600
};

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

  if (goalText.length > GOAL_LIMITS.goal) {
    throw new Error(`goal is ${goalText.length} characters; keep it to one sentence (under ${GOAL_LIMITS.goal}). Put conditions in satisfiedWhen, not in the goal.`);
  }
  if (satisfiedWhen.length > GOAL_LIMITS.satisfiedWhen) {
    throw new Error(`satisfiedWhen is ${satisfiedWhen.length} characters; keep it to one or two sentences (under ${GOAL_LIMITS.satisfiedWhen}). It is a rubric, not a spec — name what must exist, not how you will build it.`);
  }
  if (failsIf.length > GOAL_LIMITS.failsIfItems) {
    throw new Error(`failsIf has ${failsIf.length} items; keep it to ${GOAL_LIMITS.failsIfItems} or fewer. Fold related conditions together, and do not restate satisfiedWhen as its negation.`);
  }
  const longFail = failsIf.find(f => f.length > GOAL_LIMITS.failsIfItem);
  if (longFail) {
    throw new Error(`A failsIf item is ${longFail.length} characters; keep each under ${GOAL_LIMITS.failsIfItem} — a short clause naming the failure, not an explanation.`);
  }
  if (verdict.length > GOAL_LIMITS.verdict) {
    throw new Error(`verdict is ${verdict.length} characters; keep it under ${GOAL_LIMITS.verdict}. Cite, don't narrate: name the specific nodes and connections that decide it (or the failsIf that tripped) in two or three sentences. Do not restate the conditions.`);
  }

  // A verdict without evidence is the goal grading itself. Refuse it so the
  // model has to point at the web (or at the failure mode it hit) before the
  // turn is allowed to end.
  if (status !== 'open' && !verdict) {
    throw new Error(`A ${status} verdict needs a verdict string naming the evidence: for "satisfied", which nodes and connections meet satisfiedWhen; for "failed", which failsIf condition tripped and why.`);
  }
  // A verdict on an open goal is just commentary — keep the goal open.
  if (status === 'open' && verdict) {
    status = 'open';
  }

  const goal = {
    goal: goalText,
    satisfiedWhen,
    failsIf,
    status,
    verdict: status === 'open' ? '' : verdict
  };

  return {
    action: 'declareGoal',
    goal,
    settled: isGoalSettled(goal),
    goalText: renderGoalText(goal),
    summary: status === 'open'
      ? `Goal declared: ${goalText}`
      : `Goal ${status}: ${goalText}`
  };
}

export default declareGoal;

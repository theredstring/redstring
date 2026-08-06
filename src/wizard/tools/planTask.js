/**
 * planTask - Create or update a task plan with numbered steps and optional substeps
 *
 * This tool manages a step-by-step plan that the wizard works through.
 * It doesn't mutate the graph — it stores the plan state and returns
 * a formatted plan for the conversation history.
 *
 * The wizard calls this FIRST before multi-step work, then updates
 * step statuses as it progresses. Substeps break down each step into
 * specific actions. The plan is injected into the LLM context every
 * iteration so it always knows where it is.
 */

/**
 * Create or update a task plan
 * @param {Object} args - { steps: [{ description, status, substeps?: [{ description, status }] }] }
 * @returns {Object} Plan state for conversation history
 */
/**
 * Valid step statuses. `skipped` means "considered and deliberately not done" —
 * it settles a step without claiming the work happened. Without it the loop had
 * no way to end a plan whose remaining steps turned out to be unnecessary: it
 * would nudge the model three times and then stop with `nudge_limit`, leaving
 * the plan permanently unfinished.
 */
export const STEP_STATUSES = ['pending', 'in_progress', 'done', 'skipped'];

/** A step is settled when no further work on it is expected. */
export function isSettled(step) {
  return step?.status === 'done' || step?.status === 'skipped';
}

export async function planTask(args) {
  const { steps } = args;

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    throw new Error('planTask requires a non-empty steps array');
  }

  // Reject trivially small plans — if there's only 1 step, you don't need a plan, just do it.
  if (steps.length === 1) {
    throw new Error('A 1-step plan is not a plan. If the task is that simple, just do it directly without planTask. Only use planTask for multi-step graph construction or 3+ coordinated tool calls.');
  }

  // Reject plans that don't involve graph work — check if any step mentions graph-related actions
  const graphKeywords = /graph|node|edge|sketch|build|populate|definition|create|expand|connect|layout|enrich/i;
  const hasGraphWork = steps.some(s => graphKeywords.test(s.description) ||
    (s.substeps && s.substeps.some(sub => graphKeywords.test(sub.description))));
  if (!hasGraphWork) {
    throw new Error('planTask is only for graph construction tasks. This plan does not involve building or modifying graphs. Just respond to the user directly with text — no plan needed.');
  }

  // Validate step and substep format, apply auto-complete
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.description) {
      throw new Error(`Step ${i + 1} is missing a description`);
    }
    if (!STEP_STATUSES.includes(step.status)) {
      step.status = 'pending';
    }

    // Validate substeps if present
    if (step.substeps && Array.isArray(step.substeps)) {
      for (let j = 0; j < step.substeps.length; j++) {
        const sub = step.substeps[j];
        if (!sub.description) {
          throw new Error(`Step ${i + 1}, substep ${j + 1} is missing a description`);
        }
        if (!STEP_STATUSES.includes(sub.status)) {
          sub.status = 'pending';
        }
      }

      // Auto-complete: if every substep is settled, so is the parent. `skipped`
      // settles a step just as `done` does — a plan whose remaining steps turned
      // out to be unnecessary is finished, not stuck.
      if (step.substeps.length > 0 && step.substeps.every(s => isSettled(s))) {
        step.status = step.substeps.every(s => s.status === 'skipped') ? 'skipped' : 'done';
      }
    }
  }

  const done = steps.filter(s => s.status === 'done').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;
  const inProgress = steps.filter(s => s.status === 'in_progress').length;
  const total = steps.length;

  const statusIcon = (status) => {
    if (status === 'done') return '[DONE]';
    if (status === 'in_progress') return '[IN PROGRESS]';
    if (status === 'skipped') return '[SKIPPED]';
    return '[ ]';
  };

  // Build formatted plan text for LLM conversation history
  const lines = steps.map((step, i) => {
    let line = `  ${i + 1}. ${statusIcon(step.status)} ${step.description}`;

    // Add substep lines
    if (step.substeps && step.substeps.length > 0) {
      const subSettled = step.substeps.filter(isSettled).length;
      line += ` (${subSettled}/${step.substeps.length} substeps)`;
      for (let j = 0; j < step.substeps.length; j++) {
        const sub = step.substeps[j];
        const letter = String.fromCharCode(97 + j); // a, b, c...
        line += `\n    ${letter}. ${statusIcon(sub.status)} ${sub.description}`;
      }
    }
    return line;
  });

  const settled = done + skipped;
  const skippedNote = skipped > 0 ? `, ${skipped} skipped` : '';
  const planText = `Plan (${done}/${total} complete${skippedNote}):\n${lines.join('\n')}`;

  return {
    action: 'planTask',
    steps,
    done,
    skipped,
    inProgress,
    total,
    // A plan is complete when every step is settled, whether by doing it or by
    // deciding it wasn't needed. Keying this on `done === total` alone is what
    // made a skipped step an unfinishable plan.
    allComplete: settled === total,
    planText
  };
}

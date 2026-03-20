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
    if (!['pending', 'in_progress', 'done'].includes(step.status)) {
      step.status = 'pending';
    }

    // Validate substeps if present
    if (step.substeps && Array.isArray(step.substeps)) {
      for (let j = 0; j < step.substeps.length; j++) {
        const sub = step.substeps[j];
        if (!sub.description) {
          throw new Error(`Step ${i + 1}, substep ${j + 1} is missing a description`);
        }
        if (!['pending', 'in_progress', 'done'].includes(sub.status)) {
          sub.status = 'pending';
        }
      }

      // Auto-complete: if all substeps are done, mark parent as done
      if (step.substeps.length > 0 && step.substeps.every(s => s.status === 'done')) {
        step.status = 'done';
      }
    }
  }

  const done = steps.filter(s => s.status === 'done').length;
  const inProgress = steps.filter(s => s.status === 'in_progress').length;
  const total = steps.length;

  // Build formatted plan text for LLM conversation history
  const lines = steps.map((step, i) => {
    const icon = step.status === 'done' ? '[DONE]'
      : step.status === 'in_progress' ? '[IN PROGRESS]'
      : '[ ]';
    let line = `  ${i + 1}. ${icon} ${step.description}`;

    // Add substep lines
    if (step.substeps && step.substeps.length > 0) {
      const subDone = step.substeps.filter(s => s.status === 'done').length;
      line += ` (${subDone}/${step.substeps.length} substeps)`;
      for (let j = 0; j < step.substeps.length; j++) {
        const sub = step.substeps[j];
        const subIcon = sub.status === 'done' ? '[DONE]'
          : sub.status === 'in_progress' ? '[IN PROGRESS]'
          : '[ ]';
        const letter = String.fromCharCode(97 + j); // a, b, c...
        line += `\n    ${letter}. ${subIcon} ${sub.description}`;
      }
    }
    return line;
  });

  const planText = `Plan (${done}/${total} complete):\n${lines.join('\n')}`;

  return {
    action: 'planTask',
    steps,
    done,
    inProgress,
    total,
    allComplete: done === total,
    planText
  };
}

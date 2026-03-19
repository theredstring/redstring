/**
 * planTask - Create or update a task plan with numbered steps
 *
 * This tool manages a step-by-step plan that the wizard works through.
 * It doesn't mutate the graph — it stores the plan state and returns
 * a formatted plan for the conversation history.
 *
 * The wizard calls this FIRST before multi-step work, then updates
 * step statuses as it progresses. The plan is injected into the LLM
 * context every iteration so it always knows where it is.
 */

/**
 * Create or update a task plan
 * @param {Object} args - { steps: [{ description: string, status: 'pending' | 'in_progress' | 'done' }] }
 * @param {Object} graphState - Current graph state (not used)
 * @returns {Object} Plan state for conversation history
 */
export async function planTask(args) {
  const { steps } = args;

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    throw new Error('planTask requires a non-empty steps array');
  }

  // Validate step format
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.description) {
      throw new Error(`Step ${i + 1} is missing a description`);
    }
    if (!['pending', 'in_progress', 'done'].includes(step.status)) {
      step.status = 'pending'; // Default to pending if invalid
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
    return `  ${i + 1}. ${icon} ${step.description}`;
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

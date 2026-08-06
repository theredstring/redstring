import { describe, it, expect } from 'vitest';
import { planTask, isSettled } from './planTask.js';

const step = (description, status = 'pending') => ({ description, status });

describe('planTask step statuses', () => {
  it('treats a skipped step as settled', () => {
    expect(isSettled({ status: 'skipped' })).toBe(true);
    expect(isSettled({ status: 'done' })).toBe(true);
    expect(isSettled({ status: 'pending' })).toBe(false);
    expect(isSettled({ status: 'in_progress' })).toBe(false);
  });

  it('reports a plan complete when every step is done or skipped', async () => {
    // The behaviour that makes a plan abandonable: a step the model decided
    // wasn't needed must not hold the plan open forever. Before `skipped`
    // existed, the loop nudged three times and gave up with the plan unfinished.
    const result = await planTask({
      steps: [
        step('Build the graph', 'done'),
        step('Add optional enrichment', 'skipped')
      ]
    });

    expect(result.allComplete).toBe(true);
    expect(result.done).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('does not report complete while a step is still open', async () => {
    const result = await planTask({
      steps: [step('Build the graph', 'done'), step('Connect the nodes', 'pending')]
    });

    expect(result.allComplete).toBe(false);
  });

  it('preserves an unrecognised status as pending', async () => {
    const result = await planTask({
      steps: [step('Build the graph', 'banana'), step('Connect nodes', 'done')]
    });

    expect(result.steps[0].status).toBe('pending');
    expect(result.allComplete).toBe(false);
  });

  it('renders skipped steps distinctly in the plan text', async () => {
    const result = await planTask({
      steps: [step('Build the graph', 'done'), step('Enrich nodes', 'skipped')]
    });

    expect(result.planText).toContain('[DONE] Build the graph');
    expect(result.planText).toContain('[SKIPPED] Enrich nodes');
    expect(result.planText).toContain('1 skipped');
  });

  it('auto-settles a parent whose substeps are all settled', async () => {
    const result = await planTask({
      steps: [
        {
          description: 'Build every layer',
          status: 'in_progress',
          substeps: [
            { description: 'Layer 1', status: 'done' },
            { description: 'Layer 2', status: 'skipped' }
          ]
        },
        step('Verify', 'done')
      ]
    });

    expect(result.steps[0].status).toBe('done');
    expect(result.allComplete).toBe(true);
  });

  it('marks a parent skipped when every substep was skipped', async () => {
    const result = await planTask({
      steps: [
        {
          description: 'Optional polish',
          status: 'pending',
          substeps: [
            { description: 'Recolour', status: 'skipped' },
            { description: 'Relayout', status: 'skipped' }
          ]
        },
        step('Build', 'done')
      ]
    });

    expect(result.steps[0].status).toBe('skipped');
    expect(result.allComplete).toBe(true);
  });

  it('still rejects a one-step plan', async () => {
    await expect(planTask({ steps: [step('Do it')] })).rejects.toThrow(/not a plan/);
  });
});

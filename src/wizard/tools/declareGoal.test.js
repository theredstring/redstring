import { describe, it, expect } from 'vitest';
import { declareGoal, isGoalSettled, renderGoalText, GOAL_LIMITS } from './declareGoal.js';
import { selectToolsForTurn } from './schemas.js';

const base = {
  goal: 'Show why transistors leak',
  satisfiedWhen: 'A "Leakage Current" node connects to at least three physical causes',
  failsIf: ['Only one cause is present', 'No connection names the mechanism']
};

describe('declareGoal', () => {
  it('declares an open goal with its satisfaction condition and failure modes', async () => {
    const result = await declareGoal(base);
    expect(result.action).toBe('declareGoal');
    expect(result.goal.status).toBe('open');
    expect(result.settled).toBe(false);
    expect(result.goal.failsIf).toHaveLength(2);
    expect(result.goalText).toContain('[OPEN]');
    expect(result.goalText).toContain('Satisfied when:');
  });

  it('refuses a goal without a satisfaction condition — there would be nothing to judge against', async () => {
    await expect(declareGoal({ goal: 'Do something' })).rejects.toThrow(/satisfiedWhen/);
  });

  it('refuses a verdict that cites no evidence', async () => {
    await expect(declareGoal({ ...base, status: 'satisfied' })).rejects.toThrow(/evidence/);
    await expect(declareGoal({ ...base, status: 'failed', verdict: '   ' })).rejects.toThrow(/evidence/);
  });

  it('settles the goal on a verdict with evidence', async () => {
    const satisfied = await declareGoal({ ...base, status: 'satisfied', verdict: 'Leakage Current connects to Subthreshold, Gate Tunneling, Junction.' });
    expect(satisfied.settled).toBe(true);
    expect(isGoalSettled(satisfied.goal)).toBe(true);
    expect(satisfied.goalText).toContain('[SATISFIED]');
    expect(satisfied.goalText).toContain('Verdict:');

    const failed = await declareGoal({ ...base, status: 'failed', verdict: 'Only one cause is present.' });
    expect(failed.goal.status).toBe('failed');
    expect(failed.settled).toBe(true);
  });

  it('keeps an unrecognised status open and drops verdict text on an open goal', async () => {
    const result = await declareGoal({ ...base, status: 'banana', verdict: 'premature' });
    expect(result.goal.status).toBe('open');
    expect(result.goal.verdict).toBe('');
  });

  it('refuses an essay where a rubric was asked for', async () => {
    // Every field is re-read each iteration and rendered in the chat, so the
    // tool holds the line on size rather than the prompt merely asking nicely.
    await expect(declareGoal({ ...base, verdict: 'x'.repeat(GOAL_LIMITS.verdict + 1), status: 'satisfied' })).rejects.toThrow(/Cite, don't narrate/);
    await expect(declareGoal({ ...base, satisfiedWhen: 'y'.repeat(GOAL_LIMITS.satisfiedWhen + 1) })).rejects.toThrow(/rubric, not a spec/);
    await expect(declareGoal({ ...base, failsIf: Array.from({ length: GOAL_LIMITS.failsIfItems + 1 }, (_, i) => `fail ${i}`) })).rejects.toThrow(/Fold related conditions/);
    await expect(declareGoal({ ...base, failsIf: ['z'.repeat(GOAL_LIMITS.failsIfItem + 1)] })).rejects.toThrow(/short clause/);
    // At the limit is fine.
    const ok = await declareGoal({ ...base, status: 'satisfied', verdict: 'v'.repeat(GOAL_LIMITS.verdict) });
    expect(ok.settled).toBe(true);
  });

  it('renders identically for identical goals (used as the goal identity)', async () => {
    const a = await declareGoal(base);
    const b = await declareGoal({ ...base, failsIf: [...base.failsIf] });
    expect(renderGoalText(a.goal)).toBe(renderGoalText(b.goal));
    expect(renderGoalText(null)).toBe('');
  });
});

describe('declareGoal tool availability', () => {
  const graphState = { activeGraphId: 'g1', graphs: [{ id: 'g1', instances: [], edgeIds: [], groups: [] }], nodePrototypes: [] };

  it('is offered only in Goal Based mode', () => {
    const planTools = selectToolsForTurn({ graphState: { ...graphState, _wizardMode: 'plan' }, userMessage: 'build' });
    expect(planTools.some(t => t.name === 'declareGoal')).toBe(false);

    const goalTools = selectToolsForTurn({ graphState: { ...graphState, _wizardMode: 'goal' }, userMessage: 'build' });
    expect(goalTools.some(t => t.name === 'declareGoal')).toBe(true);
    // planTask stays available: a plan is still useful, it just no longer ends the turn.
    expect(goalTools.some(t => t.name === 'planTask')).toBe(true);
  });

  it('is withheld from small models even in Goal Based mode', () => {
    const tools = selectToolsForTurn({ graphState: { ...graphState, _wizardMode: 'goal' }, userMessage: 'build', modelTier: 'small' });
    expect(tools.some(t => t.name === 'declareGoal')).toBe(false);
  });
});

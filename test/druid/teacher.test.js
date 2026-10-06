// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { teaching, label, targetFrom, readJson, teacherBackend } from '../../src/druid/lab/teacher.js';
import { rewardWithLabel, sameName } from '../../src/druid/lab/rewards.js';

const listRec = {
  subject: 'Bread', kind: 'fill', system: 'You are the Druid.', user: 'What are the main parts of Crust, as part of Bread in Ham sandwich? Separate them with commas.',
  meta: { phase: 'blank', question: 'What are the main parts of Crust, as part of Bread in Ham sandwich? Name the parts you could point to on Crust itself, not the materials it is made of. Separate them with commas.', maxWords: 16 },
  schema: { name: 'fill' }, where: { web: 'Bread', things: ['Crust', 'Crumb'] }
};
const crustLabel = { best: ['Outer skin', 'Scoring marks', 'Bottom crust'], acceptable: ['Ear', 'Blisters'], wrong: ['Ham', 'Cheese', 'Lettuce', 'Surface', 'Texture'] };
const said = (text) => JSON.stringify({ text });

describe('the teacher', () => {
  it('shows it what the small model saw, and asks for a label it can score anything against', () => {
    const t = teaching(listRec);
    expect(t.type).toBe('list');
    expect(t.user).toContain(listRec.user);
    expect(t.user).toMatch(/"wrong": \[up to 8 plausible wrong answers/);
    expect(readJson('Here you go: {"best": ["A"]} done')).toEqual({ best: ['A'] });
  });

  it('keeps a target only when the Druid\'s own checks pass it', () => {
    expect(targetFrom(listRec, 'list', crustLabel)).toMatchObject({ content: said('Outer skin, Scoring marks, Bottom crust'), ok: true });
    expect(targetFrom(listRec, 'list', { best: ['Middle', 'Upper'] }).ok).toBe(false);
    const choose = { kind: 'choose', meta: { phase: 'choose', options: ['a', 'b'] } };
    expect(targetFrom(choose, 'choose', { best: [2] })).toMatchObject({ content: '{"choice":"2"}', ok: true });
  });

  it('labels through a backend, here a stand-in for the API', async () => {
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers['x-api-key']).toBe('k');
      expect(body.temperature).toBe(0);
      return { ok: true, json: async () => ({ content: [{ text: JSON.stringify(crustLabel) }], usage: { input_tokens: 900, output_tokens: 60 } }) };
    };
    const r = await label(teacherBackend({ model: 'm', apiKey: 'k', fetchImpl }), listRec);
    expect(r).toMatchObject({ type: 'list', label: crustLabel, target: { ok: true }, usage: { input: 900, output: 60 } });
  });
});

describe('rewards with a teacher\'s label', () => {
  it('pays for the right names, a little for unknown ones, and takes away for the wrong ones', () => {
    // The Druid 12 run: Ham, Cheese and Lettuce as the parts of a crust's surface.
    const right = rewardWithLabel(listRec, said('Outer skin, Scoring marks, Ear, Blisters'), crustLabel);
    const invented = rewardWithLabel(listRec, said('Golden shell, Toasted edge, Hard rim, Flaky bits'), crustLabel);
    const wrong = rewardWithLabel(listRec, said('Ham, Cheese, Lettuce'), crustLabel);
    expect(right.reward).toBe(1);
    expect(invented.reward).toBeGreaterThan(0);
    expect(invented.reward).toBeLessThan(0.3);
    expect(wrong.reward).toBe(-0.5);
    expect(right.rl).toBe(true);
  });

  it('scores choices and yes or no against the label, and leaves free text to teaching by example', () => {
    const choose = { kind: 'choose', meta: { phase: 'choose', options: ['a', 'b', 'c'] } };
    const l = { best: [2], acceptable: [3], bad: [1] };
    expect(rewardWithLabel(choose, '{"choice":"2"}', l).reward).toBe(1);
    expect(rewardWithLabel(choose, '{"choice":"3"}', l).reward).toBe(0.4);
    expect(rewardWithLabel(choose, '{"choice":"1"}', l).reward).toBe(-0.6);
    const yes = { kind: 'helper:onSubject', meta: { phase: 'helper', helper: 'onSubject' }, schema: { schema: { properties: { answer: { enum: ['yes', 'no'] } } } } };
    expect(rewardWithLabel(yes, '{"answer":"no"}', { answer: 'no' }).reward).toBe(1);
    expect(rewardWithLabel(yes, '{"answer":"yes"}', { answer: 'no' }).reward).toBe(-1);
    const thought = { kind: 'fill', meta: { phase: 'thought', maxWords: 30 }, where: { things: ['Crust'] } };
    expect(rewardWithLabel(thought, said('Crust holds the Crumb in.'), { best: 'x' }).rl).toBe(false);
    expect(sameName('Haze layer', 'Upper haze layer')).toBe(true);
    expect(sameName('Haze', 'Upper haze layer')).toBe(false);
    // Found by the canaries (2026-10-06): a right answer scored wrong, and stages in another form scored unknown.
    expect(sameName('Mix', 'Mixing')).toBe(true);
    expect(sameName('Rise', 'Rising')).toBe(true);
    const kind = { kind: 'fill', meta: { phase: 'blank', question: 'Name one kind of Bread.', maxWords: 4 }, where: { things: [] } };
    expect(rewardWithLabel(kind, said('White loaf'), { best: 'Sourdough', acceptable: ['White bread', 'White loaf'], wrong: ['Loaf'] }).reward).toBe(1);
    expect(rewardWithLabel(kind, said('Loaf'), { best: 'Sourdough', wrong: ['Loaf'] }).reward).toBe(-0.5);
  });

  it('answers the trainer, one line in and one out', async () => {
    const child = spawn(process.execPath, ['scripts/druid-reward.mjs'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const reply = new Promise((resolve) => { let buf = ''; child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) resolve(JSON.parse(buf.split('\n')[0])); }); });
    child.stdin.write(`${JSON.stringify({ rec: listRec, label: crustLabel, completions: [said('Outer skin, Ear'), 'garbage'] })}\n`);
    const r = await reply;
    child.kill();
    expect(r.rewards[1]).toBe(-1);
    expect(r.rewards[0]).toBeGreaterThan(0);
    expect(r.details[0]).toMatchObject({ type: 'list', rl: true });
  }, 20000);
});

describe('the canaries', () => {
  it('score a good model well and a gaming one badly', async () => {
    const { CANARIES, runCanaries } = await import('../../src/druid/lab/canaries.js');
    // The answers a good model would give: its label's best.
    const good = { complete: async ({ user }) => {
      const c = CANARIES.find(x => x.rec.user === user);
      if (c.rec.kind === 'choose') return { content: JSON.stringify({ choice: String(c.label.best[0]) }) };
      if (c.label.answer) return { content: JSON.stringify({ answer: c.label.answer }) };
      return { content: JSON.stringify({ text: [].concat(c.label.best).join(', ') }) };
    } };
    // A model that learned to say little: "none", "yes", the first option.
    const gaming = { complete: async ({ user }) => {
      const c = CANARIES.find(x => x.rec.user === user);
      if (c.rec.kind === 'choose') return { content: '{"choice":"5"}' };
      if (c.label.answer) return { content: '{"answer":"yes"}' };
      return { content: '{"text":"none"}' };
    } };
    const a = await runCanaries(good, { rewardWithLabel });
    const b = await runCanaries(gaming, { rewardWithLabel });
    expect(a.score).toBeGreaterThan(0.8);
    expect(b.score).toBeLessThan(0);
  });
});

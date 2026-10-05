// @vitest-environment node
/**
 * Apple's model reads its prompt at about 1 ms a token, and reading is nearly
 * all of a call's time. A moment's calls share their context, so they share a
 * session: the context is read once, and each call is a turn in it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { afmClient } from '../../src/druid/mind/afmClient.js';
import { createMind } from '../../src/druid/mind/createMind.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { runLife } from '../../src/druid/life.js';
import { druidMoves } from '../../src/druid/druid.js';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';

beforeAll(() => quiet());

const fill = { name: 'fill', schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } };

function bridge(answer = () => ({ ok: true, content: '{"text":"Ice"}' })) {
  const sent = [];
  const send = async (req) => { sent.push(req); return req.op === 'end' ? { ok: true } : answer(req); };
  return { sent, client: afmClient(send, { contextSize: 4096 }) };
}

describe("Apple's model, one session a moment", () => {
  it('reads a context once, takes the next calls as turns, and starts afresh for a new context', async () => {
    const { sent, client } = bridge();
    const ask = (context, turn) => client.complete({ system: 'sys', user: `${context}\n\n${turn}`, context, turn, schema: fill, maxTokens: 20, temperature: 0 });
    await ask('Where you are: Everest.', 'What are you thinking now?');
    await ask('Where you are: Everest.', 'What do you do next?');
    await ask('Where you are: Everest.', 'Name a part of it.');
    await ask('Where you are: Ice.', 'What are you thinking now?');
    const completes = sent.filter(r => r.op === 'complete');
    expect(completes.map(r => [r.sid, !!r.context, r.user])).toEqual([
      ['m1', true, 'What are you thinking now?'],
      ['m1', false, 'What do you do next?'],
      ['m1', false, 'Name a part of it.'],
      ['m2', true, 'What are you thinking now?']
    ]);
    expect(completes[0].context).toMatch(/^This is written in English\.\n\nWhere you are: Everest\.$/);
    expect(sent.filter(r => r.op === 'end').map(r => r.sid)).toEqual(['m1']);
  });

  it('starts a new session when the turns would overflow the window, and asks whole when a context is too big for one', async () => {
    const { sent, client } = bridge();
    const context = 'mountain '.repeat(5000); // far past 4K tokens
    await client.complete({ system: 'sys', user: `${context}\n\nq`, context, turn: 'q', schema: fill, maxTokens: 20, temperature: 0 });
    expect(sent.at(-1)).toMatchObject({ op: 'complete' });
    expect(sent.at(-1).sid).toBeUndefined();

    const mid = 'word '.repeat(1500);
    for (let i = 0; i < 6; i++) await client.complete({ system: 'sys', user: `${mid}\n\nq${i}`, context: mid, turn: `q${i} ${'more '.repeat(200)}`, schema: fill, maxTokens: 200, temperature: 0 });
    const sids = sent.filter(r => r.op === 'complete' && r.sid).map(r => r.sid);
    expect(new Set(sids).size).toBeGreaterThan(1);
  });

  it('a refused turn falls back to the whole prompt only for a language refusal; other errors are errors', async () => {
    let n = 0;
    const { sent, client } = bridge(() => (++n === 1 ? { ok: false, error: 'unsupportedLanguageOrLocale' } : { ok: true, content: '{"text":"Ice"}' }));
    const r = await client.complete({ system: 'sys', user: 'ctx\n\nq', context: 'ctx', turn: 'q', schema: fill, maxTokens: 20, temperature: 0 });
    expect(r.content).toBe('{"text":"Ice"}');
    expect(sent.filter(x => x.op === 'complete').at(-1).sid).toBeUndefined();
    const bad = bridge(() => ({ ok: false, error: 'guardrailViolation' }));
    await expect(bad.client.complete({ system: 'sys', user: 'ctx\n\nq', context: 'ctx', turn: 'q', schema: fill, maxTokens: 20, temperature: 0 })).rejects.toThrow(/guardrailViolation/);
  });
});

describe('a moment shares one context', () => {
  it('its thought, its choice and what it fills in are asked over the same context; the thought comes first', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Everest: { things: { Summit: 's', Glacier: 'g' } } } });
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'choice') {
        const options = [...req.user.matchAll(/^(\d+)\. (.*)$/gm)];
        const hit = options.find(o => /^open up Summit/.test(o[2]));
        return { choice: hit ? hit[1] : '1' };
      }
      if (/thinking now/.test(req.user)) return { text: 'The Summit is the top of Everest.' };
      return { text: /separated by commas/.test(req.user) ? 'Snow cap, Rock' : 'The top layer of the summit.' };
    }) });
    const out = [];
    for await (const r of runLife({ world, mind }, { maxCycles: 1, moves: druidMoves(), resume: { tick: 0, locus: { web: webs.Everest, focus: ids.Summit, path: [] } } })) if (r.type === 'cycle') out.push(r);
    const moment = seen.filter(r => r.context);
    expect(/thinking now/.test(moment[0].turn)).toBe(true);
    expect(moment.length).toBeGreaterThanOrEqual(3);
    expect(new Set(moment.map(r => r.context)).size).toBe(1);
    // The choice sees the thought just made.
    expect(moment.find(r => r.schema.name === 'choice').turn).toMatch(/What you are thinking now: The Summit is the top of Everest\./);
    expect(out[0].thought).toBe('The Summit is the top of Everest.');
  });
});

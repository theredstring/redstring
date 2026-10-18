// People editing one shared universe at random, through the real store.
//
// Taking turns: after every edit the editor saves and everyone else checks
// for it, so after every step every device must hold the same universe.
// At once: edits, saves, checks and dropped connections interleave at random
// against a host whose reads trail its writes; once everyone settles, all
// must hold the same universe as each other and as the repository, with no
// broken references, and stay quiet while idle.
//
// A failure names its seed and the steps that led to it. Rerun one seed with
// REDSTRING_SYNC_SEED=<seed>; more seeds with REDSTRING_SYNC_SEEDS=<count>.
import { describe, it, expect, beforeEach } from 'vitest';
import { runRandomAction, seededRandom, idSource } from './actionCatalog.js';
import { makeHost, makeDevice, PATH, fromFile, sameDocument, describeDifference, brokenReferences } from './storeDevices.js';

const ONE = process.env.REDSTRING_SYNC_SEED ? [Number(process.env.REDSTRING_SYNC_SEED)] : null;
const COUNT = Number(process.env.REDSTRING_SYNC_SEEDS || 25);
const seeds = (offset) => ONE || Array.from({ length: COUNT }, (_, i) => offset + i);

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

const PEOPLE = ['ana', 'ben', 'cy'];

function setup(host, people) {
  const devices = people.map((who) => makeDevice(host, who));
  for (const d of devices) {
    d.dirty = false;
    // What the app's SaveCoordinator tells the engine: edits not yet saved.
    d.engine.isLocalBusy = () => d.dirty;
  }
  return devices;
}

async function begin(host, devices) {
  const [first, ...rest] = devices;
  first.start();
  await first.save();
  host.settle();
  for (const d of rest) await d.open();
}

const failure = (seed, log, message) => `seed ${seed}: ${message}\nsteps:\n  ${log.slice(-15).join('\n  ')}`;

describe('taking turns', () => {
  for (const seed of seeds(1000)) {
    it(`seed ${seed}`, async () => {
      const rng = seededRandom(seed);
      const host = makeHost();
      const devices = setup(host, PEOPLE.slice(0, 2 + (seed % 2)));
      await begin(host, devices);
      const ids = Object.fromEntries(devices.map((d) => [d.author, idSource(d.author)]));
      const log = [];

      for (let step = 0; step < 25; step++) {
        const actor = rng.pick(devices);
        const did = actor.act(() => runRandomAction(rng, ids[actor.author]));
        if (!did) continue;
        log.push(`${actor.author}: ${did.description}`);
        await actor.save();
        for (const other of devices) if (other !== actor) await other.check();

        for (const other of devices) {
          if (other === actor) continue;
          expect(sameDocument(other.state, actor.state), failure(seed, log, `${other.author} doesn't match ${actor.author}:\n${describeDifference(other.state, actor.state)}`)).toBe(true);
        }
        const repo = host.current();
        if (!did.action.personal) {
          expect(sameDocument(fromFile(repo.content), actor.state), failure(seed, log, `the repository doesn't match ${actor.author}:\n${describeDifference(fromFile(repo.content), actor.state)}`)).toBe(true);
        }
      }
      for (const d of devices) expect(d.conflicts, failure(seed, log, `${d.author} was asked to resolve a conflict`)).toBe(0);
      expect(brokenReferences(devices[0].state), failure(seed, log, 'broken references')).toEqual([]);
    });
  }
});

describe('at the same time', () => {
  for (const seed of seeds(2000)) {
    it(`seed ${seed}`, async () => {
      const rng = seededRandom(seed);
      const host = makeHost({ readLag: seed % 3 });
      const devices = setup(host, PEOPLE.slice(0, 2 + (seed % 2)));
      await begin(host, devices);
      const ids = Object.fromEntries(devices.map((d) => [d.author, idSource(d.author)]));
      const log = [];

      for (let step = 0; step < 40; step++) {
        host.tick();
        const d = rng.pick(devices);
        const roll = rng.next();
        if (roll < 0.55) {
          const did = d.act(() => runRandomAction(rng, ids[d.author]));
          if (did) { d.dirty = true; log.push(`${d.author}: ${did.description}`); }
        } else if (roll < 0.8) {
          const saved = await d.save();
          if (saved !== undefined && !d.notices.at(-1)?.startsWith('save failed')) d.dirty = false;
          log.push(`${d.author}: save${d.provider.online ? '' : ' (offline)'}`);
        } else if (roll < 0.95) {
          const r = await d.check();
          log.push(`${d.author}: check -> ${JSON.stringify(r)}`);
        } else {
          d.provider.online = !d.provider.online;
          log.push(`${d.author}: ${d.provider.online ? 'back online' : 'offline'}`);
        }
      }

      // Everyone back online; let things settle the way the app would.
      for (const d of devices) d.provider.online = true;
      for (let round = 0; round < 6; round++) {
        host.settle();
        for (const d of devices) {
          const before = d.notices.length;
          await d.save();
          if (d.notices.length === before) d.dirty = false;
        }
        host.settle();
        for (const d of devices) await d.check();
      }

      // The one conflict that is the design: the merge stops and asks when one
      // side removed most of the universe (its guard against a failed load
      // emptying the repository), which random deleting in a small universe
      // can do. Any other conflict is a failure.
      const SAFETY = /removed \d+ of \d+ Things and webs/;
      if (devices.some((d) => d.conflicts && d.notices.some((n) => SAFETY.test(n)))) return;

      const repo = fromFile(host.current(PATH).content);
      for (const d of devices) {
        expect(d.conflicts, failure(seed, log, `${d.author} was asked to resolve a conflict (${d.notices.slice(-3).join(' | ')})`)).toBe(0);
        expect(sameDocument(d.state, repo), failure(seed, log, `${d.author} doesn't match the repository:\n${describeDifference(d.state, repo)}`)).toBe(true);
      }
      expect(brokenReferences(repo), failure(seed, log, 'broken references in the repository')).toEqual([]);

      // Idle: nothing more to save, nothing new to bring in.
      const commits = host.commits.length;
      host.settle();
      for (const d of devices) {
        expect(await d.save(), failure(seed, log, `${d.author} saved again while idle`)).toBe(false);
        expect(await d.check(), failure(seed, log, `${d.author} found news while idle`)).toEqual({ changed: false });
      }
      expect(host.commits.length).toBe(commits);
    });
  }
});

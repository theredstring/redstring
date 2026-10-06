/**
 * The Druid, living in the universe that is open in the app.
 *
 * The same Druid as `npm run druid` (createDruid), over the live store rather
 * than a headless one, so every Thing it makes appears on the canvas as it
 * makes it, and the canvas goes to whichever web it is looking at.
 *
 * Its loop state (cycle count, where it was, its last thoughts) is kept on its
 * Home Thing, so it travels with the universe: close the app, reopen, start,
 * and it wakes where it left off.
 */

import { createWorld } from '../world.js';
import { createMind } from '../mind/createMind.js';
import { openaiCompatible } from '../mind/backends.js';
import { afmClient, assertAvailable } from '../mind/afmClient.js';
import { createDruid } from '../druid.js';
import { ensureHome, HOME_MARK } from '../roles.js';
import { answer, TALK_KEEP } from '../talk.js';

const UNREACHABLE_AFTER = 3;

/** Where the Druid's loop state lives: on its Home Thing. */
async function homeOwner(world) {
  const home = await ensureHome(world);
  return home ? world.ownerOf(home) : null;
}

/**
 * A backend over Electron's main process, or a direct fetch in a plain browser
 * (which needs the model server to allow cross-origin requests).
 *
 * @param {Object} opts { mind: 'openai'|'afm', endpoint, model }
 * @param {Object} [electron]  window.electron
 */
export async function backendFor({ mind, endpoint, model }, electron = globalThis.window?.electron) {
  if (mind === 'afm') {
    if (!electron?.druid?.afm) throw new Error("Apple's on-device model needs the desktop app.");
    const send = (req) => electron.druid.afm(req);
    const health = await send({ op: 'health' });
    assertAvailable(health);
    return afmClient(send, health);
  }
  const fetchImpl = electron?.druid?.chat
    ? async (url, init) => {
      const r = await electron.druid.chat(url, JSON.parse(init.body));
      return { ok: r.ok, status: r.status, text: async () => r.text, json: async () => JSON.parse(r.text) };
    }
    : globalThis.fetch.bind(globalThis);
  return openaiCompatible({ endpoint, model, fetchImpl });
}

/**
 * Start the Druid. Returns { stop, done }; `done` settles when it stops.
 *
 * @param {Object} deps
 * @param {Object} deps.store            the graph store (useGraphStore)
 * @param {Function} deps.executeTool
 * @param {Function} deps.applyToolResult
 * @param {Object} deps.promptSpace
 * @param {Object} deps.backend          a mind backend (backendFor)
 * @param {Object} opts
 * @param {string} [opts.seed]
 * @param {'menu'|'commands'} [opts.speak]
 * @param {number} [opts.pauseMs]        a breath between cycles, so a person can read along
 * @param {Function} [opts.onCycle]      (cycle record) → void
 * @param {Function} [opts.onStop]       ({ reason, error }) → void
 * @param {Function} [opts.onReply]      (text, tick) → void: its answer to what was said, as soon as it has one
 * @param {Function} [opts.onLook]       (graphId) → void: where it looks; given, the canvas is the person's (world.js)
 */
export function startDruid({ store, executeTool, applyToolResult, promptSpace, backend }, { seed = '', speak = 'menu', pauseMs = 600, onCycle = () => {}, onStop = () => {}, onReply = null, onLook = null, window = 4096 } = {}) {
  const controller = new AbortController();
  // With onLook, it looks and writes without moving the person's canvas (world.js).
  const world = createWorld({ store, executeTool, applyToolResult, onLook });
  // What a person says, waiting for its next moment (runLife's `heard`).
  const inbox = [];
  const mind = createMind({ backend, window });

  const done = (async () => {
    let reason = 'stopped';
    let error = null;
    try {
      const owner = await homeOwner(world);
      // Copies both ways: the store freezes what it holds, and the loop changes its own.
      const resume = owner && world.druidOf(owner).life ? JSON.parse(JSON.stringify(world.druidOf(owner).life)) : {};
      const life = createDruid({ world, mind, promptSpace }, { resume, seed, speak, signal: controller.signal, hear: () => inbox.splice(0), onReply });
      let unreachable = 0;
      for await (const r of life) {
        const owner2 = await homeOwner(world);
        if (owner2 && r.state) world.setDruid(owner2, { life: JSON.parse(JSON.stringify(r.state)) });
        if (r.type === 'stopped') { reason = r.reason; break; }
        onCycle({ ...r, stats: { ...mind.stats } });
        // Every call failing, cycle after cycle, is a model that cannot be
        // reached (LM Studio not running, no model loaded): say so and stop.
        const failed = (r.calls || []).filter(c => c.error);
        unreachable = r.calls?.length && failed.length === r.calls.length ? unreachable + 1 : 0;
        if (unreachable >= UNREACHABLE_AFTER) {
          reason = 'error';
          error = `The model is not answering: ${failed[0].error}`;
          break;
        }
        // Always a turn of the event loop between moments, even at a quick
        // pace: with a model that answers at once, moments ran back to back
        // in microtasks and nothing else on the page (timers, the panel) ran.
        if (!controller.signal.aborted) await new Promise(res => setTimeout(res, Math.max(0, pauseMs)));
      }
    } catch (err) {
      reason = 'error';
      error = err?.message || String(err);
    } finally {
      world.actor = null;
      backend.close?.();
    }
    onStop({ reason, error });
    return { reason, error };
  })();

  return { stop: () => controller.abort(), say: (text, { answered = false } = {}) => { inbox.push({ text: String(text), at: Date.now(), answered }); }, done, world, mind };
}

/**
 * Talk with the Druid while it sleeps: one answer, from what the universe
 * holds (talk.js), with what it was doing and the conversation it keeps on
 * Home. Writes nothing into the universe but the exchange, onto Home's loop
 * state; what was said is also heard when it wakes, but not answered again.
 * Returns { ok, text, error? }.
 *
 * @param {Object} deps   { store, promptSpace, backend }
 * @param {Object} talk   { text, history? } (history: [{ who, text }], from the panel when Home has none)
 */
export async function talkTo({ store, promptSpace, backend }, { text, history = null, window = 4096 } = {}) {
  const world = createWorld({ store, executeTool: async () => ({ ok: false }), applyToolResult: () => {} });
  const home = [...store.getState().nodePrototypes.values()].find(p => p.semanticMetadata?.druid?.homeOf === HOME_MARK);
  const life = home?.semanticMetadata?.druid?.life || {};
  try {
    const past = life.talk || history || [];
    const r = await answer(world, createMind({ backend, window }), {
      text,
      history: past,
      throughLine: life.throughLine || '',
      focus: life.locus?.focus || null,
      doing: life.lastDid || '',
      thoughts: Array.isArray(life.loop) ? life.loop : [],
      system: promptSpace?.talk
    });
    // Kept with its loop state, so it remembers the conversation when it wakes.
    if (home && r.text) {
      const tick = life.tick || 0;
      world.setDruid(home.id, { life: { ...life, talk: [...past, { who: 'person', text, tick }, { who: 'druid', text: r.text, tick }].slice(-TALK_KEEP * 2) } });
    }
    return r;
  } finally {
    backend.close?.();
  }
}

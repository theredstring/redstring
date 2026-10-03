/**
 * Mind backend for Apple's on-device model, through native/afm-bridge.
 *
 * Spawns the bridge once and talks to it over stdio, one JSON object per line
 * each way. Requests are numbered and answered in order. Node only — the
 * browser and iOS reach the same model another way (a Capacitor plugin built
 * from the same Swift).
 *
 *   swift build -c release --package-path native/afm-bridge
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

const ENGLISH = 'This is written in English.';

/**
 * @param {Object} opts
 * @param {string} opts.executable   path to the built afm-bridge
 * @returns {Promise<Object>} a backend, after checking the model is available
 */
export async function afmBackend({ executable }) {
  if (!fs.existsSync(executable)) {
    throw new Error(`afm-bridge not built at ${executable}. Run: swift build -c release --package-path native/afm-bridge`);
  }
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let nextId = 1;
  let closed = false;

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    p.resolve(msg);
  });
  child.on('exit', () => {
    closed = true;
    for (const p of pending.values()) p.reject(new Error('afm-bridge exited'));
    pending.clear();
  });

  const send = (req) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('afm-bridge is not running')); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, ...req })}\n`);
  });

  const health = await send({ op: 'health' });
  if (!health.available) {
    child.kill();
    throw new Error(`Apple's on-device model is unavailable: ${health.reason || 'unknown reason'}`);
  }

  return {
    id: 'afm:apple-on-device',
    contextSize: health.contextSize,
    async complete({ system, user, schema, maxTokens, temperature }) {
      // The on-device model checks the prompt's language first and refuses
      // what it cannot place. A Druid's view — many capitalized names, the
      // same few repeated — sometimes reads as no language at all:
      // "unsupportedLanguageOrLocale" on 26 of 73 calls in one long run, every
      // time for a given prompt. One plain sentence saying what language it is
      // fixed every captured case; a retry with a second one covers the rest.
      let r = await send({ op: 'complete', system, user: `${ENGLISH}\n\n${user}`, schema, maxTokens, temperature });
      if (!r.ok && /unsupportedLanguage/i.test(r.error || '')) {
        r = await send({ op: 'complete', system: `${system}\n\nAlways read and answer in English.`, user: `${ENGLISH} Plain English words follow.\n\n${user}`, schema, maxTokens, temperature });
      }
      if (!r.ok) throw new Error(`afm: ${r.error}`);
      return { content: r.content, usage: { prompt: r.usage?.prompt || 0, completion: r.usage?.completion || 0 } };
    },
    close() {
      if (!closed) child.stdin.end();
    }
  };
}

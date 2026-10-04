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
import { afmClient, assertAvailable } from './afmClient.js';

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
  try { assertAvailable(health); } catch (err) { child.kill(); throw err; }
  return afmClient(send, health, () => { if (!closed) child.stdin.end(); });
}

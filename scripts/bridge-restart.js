#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const killOnly = process.argv.includes('--kill-only');

function run(cmd) {
  try { return execSync(cmd, { stdio: 'pipe' }).toString().trim(); } catch { return ''; }
}

function killOnPort(port) {
  const pids = run(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`) || '';
  if (pids) {
    run(`echo "${pids}" | xargs -r kill -9`);
    return pids.split(/\s+/).filter(Boolean);
  }
  return [];
}

const port = process.env.BRIDGE_PORT || 3001;
const killed = killOnPort(port);
if (killed.length) {
  console.log(`🔪 Killed PIDs on :${port}: ${killed.join(', ')}`);
} else {
  console.log(`✅ No existing listener on :${port}`);
}

if (killOnly) process.exit(0);

// Start bridge-daemon.js
const proc = spawn('node', ['bridge-daemon.js'], { cwd: `${__dirname}/..`, stdio: 'ignore', detached: true });
proc.unref();
console.log(`🚀 Bridge daemon started on :${port} (pid ${proc.pid || 'bg'})`);



#!/usr/bin/env node
// Two people, one shared universe, all on this machine.
//
//   npm run harness:shared            # keep the repositories from last time
//   npm run harness:shared -- --fresh # start from an empty host
//   npm run harness:shared -- --github                 # through the GitHub API
//   npm run harness:shared -- --github --read-lag 3000 # ...whose reads trail writes
//
// Starts scripts/fake-forge.mjs (a Git host speaking the Gitea and GitHub
// APIs, over real Git repositories) and two dev servers on two ports. Each port is its own
// origin with its own storage, so it behaves like a separate device. Open one
// link per person; src/dev/devForge.js does the rest.
//
// Ports: host 4510, Ana 5181, Ben 5182 (override with --forge-port, --ports 5181,5182).
// Repositories live in <tmp>/redstring-shared-harness (override with --dir).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const FORGE_PORT = Number(arg('forge-port', 4510));
const PORTS = arg('ports', '5181,5182').split(',').map(Number);
const PEOPLE = ['ana', 'ben', 'cy', 'dee'].slice(0, PORTS.length);
const DIR = path.resolve(arg('dir', path.join(os.tmpdir(), 'redstring-shared-harness')));
const REPO = arg('repo', 'harness/forest');
const API = args.includes('--github') ? 'github' : 'gitea';
const READ_LAG = arg('read-lag', null);

if (args.includes('--fresh')) fs.rmSync(DIR, { recursive: true, force: true });

const children = [];
const run = (label, command, commandArgs, env = {}) => {
  const child = spawn(command, commandArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (line) => line && console.log(`[${label}] ${line}`);
  child.stdout.on('data', (d) => String(d).split('\n').forEach(prefix));
  child.stderr.on('data', (d) => String(d).split('\n').forEach(prefix));
  child.on('exit', (code) => console.log(`[${label}] exited (${code})`));
  children.push(child);
  return child;
};

run('host', process.execPath, ['scripts/fake-forge.mjs', '--port', String(FORGE_PORT), '--dir', DIR, ...(READ_LAG ? ['--read-lag', READ_LAG] : [])]);
PORTS.forEach((port, i) => run(PEOPLE[i], 'npx', ['vite', '--config', 'scripts/harness.vite.config.mjs', '--port', String(port), '--strictPort'], { HARNESS_PORT: String(port) }));

const forge = `http://localhost:${FORGE_PORT}`;
setTimeout(() => {
  console.log(`\nShared universe harness (${API === 'github' ? 'GitHub' : 'Gitea'} API${READ_LAG ? `, reads trail writes by ${READ_LAG} ms` : ''})`);
  console.log(`  Host (history, offline switches): ${forge}/`);
  PORTS.forEach((port, i) => {
    console.log(`  ${PEOPLE[i].padEnd(4)} http://localhost:${port}/?devForge=${encodeURIComponent(forge)}&devForgeUser=${PEOPLE[i]}&devForgeRepo=${encodeURIComponent(REPO)}&devForgeApi=${API}`);
  });
  console.log('  After the first visit, plain http://localhost:<port>/ remembers who that port is.');
  console.log('  ?devForge=off on a port turns it back into a normal dev session.\n');
}, 2500);

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

#!/usr/bin/env node
// Two people in two real app windows, editing one shared universe at random,
// half through real mouse and keyboard input (dragging Things, the canvas
// menu's Auto Layout, select-and-Delete, Cmd+Z) and half through the same
// store actions the tests use (test/sync/actionCatalog.js), with dropped
// connections along the way. Every so often everyone settles and it checks:
//   - both windows hold the same universe, compared in full, and it is the
//     repository's latest file;
//   - no broken references;
//   - both save indicators read "Saved";
//   - nothing more is saved while everyone is idle.
//
//   npm run soak:shared                          # seed 1, Gitea API
//   npm run soak:shared -- --seed 7 --steps 80 --github --read-lag 3000
//   npm run soak:shared -- --seed 7 --headed     # watch it
//
// Seeded: a failure prints its seed and the steps before it; the same seed
// replays the same choices (timing can still differ). Starts its own fake
// forge and dev servers on 4710 / 5381 / 5382 (override: --forge-port,
// --ports), so it never touches a harness already running.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { seededRandom } from '../test/sync/random.js';
import { fromFile, sameDocument, describeDifference, brokenReferences } from '../test/sync/documentCompare.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const SEED = Number(arg('seed', 1));
const STEPS = Number(arg('steps', 60));
const SETTLE_EVERY = Number(arg('settle-every', 15));
const FORGE_PORT = Number(arg('forge-port', 4710));
const PORTS = arg('ports', '5381,5382').split(',').map(Number);
const API = args.includes('--github') ? 'github' : 'gitea';
const READ_LAG = arg('read-lag', null);
const HEADED = args.includes('--headed');
const PEOPLE = ['ana', 'ben', 'cy'].slice(0, PORTS.length);
const REPO = 'harness/forest';
const FILE = 'universes/shared-forest/shared-forest.redstring';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'redstring-soak-'));
const FORGE = `http://127.0.0.1:${FORGE_PORT}`;

const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A page that stops answering: its main thread is stuck. */
class FrozenPage extends Error {}

/**
 * Where a stuck page's main thread is: pause it in the debugger and read the
 * stack (the debugger answers while the page's own thread is busy).
 */
async function frozenStack(p) {
  try {
    const frames = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('debugger did not pause')), 10000);
      p.cdp.once('Debugger.paused', (event) => { clearTimeout(timer); resolve(event.callFrames); });
      p.cdp.send('Debugger.pause').catch(reject);
    });
    const lines = frames.slice(0, 25).map((f) => `${f.functionName || '(anonymous)'}  ${f.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')}:${f.location.lineNumber + 1}`);
    await p.cdp.send('Debugger.resume').catch(() => {});
    return lines.join('\n    ');
  } catch (error) {
    return `(no stack: ${error.message})`;
  }
}

/** page.evaluate with a time limit: a frozen page fails the run with its stack. */
async function inPage(p, fn, arg, limitMs = 45000) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new FrozenPage(`${p.who}'s page stopped answering`)), limitMs); });
  try {
    return await Promise.race([p.page.evaluate(fn, arg), limit]);
  } catch (error) {
    if (error instanceof FrozenPage) error.stack = `${error.message}; stuck in:\n    ${await frozenStack(p)}`;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Run `fn`, logging it when it takes long (to find what makes a run slow). */
async function timed(label, fn, slowMs = 8000) {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - start;
    if (ms > slowMs) log(`slow: ${label} took ${(ms / 1000).toFixed(1)}s`);
  }
}

// ---------------------------------------------------------------------------
// Servers

const children = [];
function run(label, command, commandArgs, env = {}) {
  // Its own process group, so stopping it also stops what it started (npx -> vite).
  const child = spawn(command, commandArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.label = label;
  child.on('exit', (code, signal) => { if (!stopping) log(`${label} exited (${code ?? signal})`); });
  const out = [];
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  children.push(child);
  child.output = out;
  return child;
}
let stopping = false;
function stopServers() {
  stopping = true;
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch { /* gone */ } }
  }
}
const serverTail = () => children.map((c) => `--- ${c.label}\n${c.output.join('').split('\n').filter((l) => !/proxy error|ECONNREFUSED|TCPConnectWrap/.test(l)).slice(-12).join('\n')}`).join('\n');
/** Vite's own word on optimizing and reloading, for the log. */
const viteReloads = () => children.flatMap((c) => c.output.join('').split('\n').filter((l) => /optimiz|reload/i.test(l)).map((l) => `${c.label}: ${l.trim()}`));
async function waitFor(urls, what) {
  for (let i = 0; i < 300; i++) {
    for (const url of [].concat(urls)) {
      try {
        if ((await fetch(url)).status < 500) return;
      } catch { /* not up */ }
    }
    await sleep(200);
  }
  throw new Error(`${what} did not start`);
}

// ---------------------------------------------------------------------------
// The repository, read past any lag (the Gitea dialect never lags)

async function repoCommits() {
  const res = await fetch(`${FORGE}/api/v1/repos/${REPO}/commits?limit=100`, { headers: { Authorization: 'token observer' } });
  return res.ok ? (await res.json()).map((c) => c.author.login) : [];
}
async function repoFile() {
  const res = await fetch(`${FORGE}/api/v1/repos/${REPO}/contents/${FILE}`, { headers: { Authorization: 'token observer', Accept: 'application/octet-stream' } });
  return res.ok ? res.text() : null;
}
const setOffline = (user, on) => fetch(`${FORGE}/_control/offline`, { method: 'POST', body: new URLSearchParams({ user, on: on ? '1' : '0' }), redirect: 'manual' });

// ---------------------------------------------------------------------------
// A person: one window

async function openPerson(browser, port, who) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await context.route(/github\.com/, (route) => route.abort());
  const link = `http://localhost:${port}/?devForge=${encodeURIComponent(`http://localhost:${FORGE_PORT}`)}&devForgeUser=${who}&devForgeRepo=${encodeURIComponent(REPO)}&devForgeApi=${API}`;
  const person = { who, page, context, errors, online: true, reloads: 0 };
  person.cdp = await context.newCDPSession(page);
  await person.cdp.send('Debugger.enable');
  // A reload (the person's, or Vite's after optimizing a dependency) is part
  // of the run: note it, and wait for the app before the next step.
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) person.reloads++; });
  await page.goto(link);
  person.reloads = 0;
  await timed(`${who} opening`, () => ready(person), 10000);
  return person;
}

/** The app is up and the soak's helpers are loaded (again, after a reload). */
async function ready(p) {
  await p.page.waitForFunction(() => !!window.__redstringDevForge && !!window.useGraphStore, null, { timeout: 120000 });
  // The action catalog and file export, loaded through Vite like the app's own modules.
  await inPage(p, async () => {
    if (window.__soak) return;
    const [catalog, format, bytes, sc] = await Promise.all([
      import('/test/sync/actionCatalog.js'),
      import('/src/formats/redstringFormat.js'),
      import('/src/formats/universeBytes.js'),
      import('/src/services/SaveCoordinator.js')
    ]);
    window.__soak = { catalog, format, bytes };
    window.__saveCoordinatorForSoak = sc.default || sc.saveCoordinator;
  });
}

const fileOf = async (p) => { await ready(p); return inPage(p, () => {
  const { format, bytes } = window.__soak;
  return new TextDecoder().decode(bytes.serializeRedstring(format.exportToRedstring(window.useGraphStore.getState())));
}); };
const indicator = (p) => inPage(p, () => document.querySelector('.save-status-display')?.textContent?.trim() || '');
const engineStatus = (p) => inPage(p, () => {
  const { backend } = window.__redstringDevForge;
  const s = backend.getSyncStatus(backend.activeUniverseSlug) || {};
  return { pending: s.pendingCommits || 0, running: !!s.isRunning, changes: !!s.hasChanges };
});
/** A window's sync state, for a failure report. */
const syncState = (p) => inPage(p, () => {
  const { backend } = window.__redstringDevForge;
  const slug = backend.activeUniverseSlug;
  const engine = backend.gitSyncEngines?.get(slug);
  const sc = window.__saveCoordinatorForSoak || null;
  return {
    engine: engine ? {
      pending: engine.pendingCommits?.length, hasChanges: engine.hasChanges, committing: engine.isCommitInProgress,
      conflict: engine.remoteConflictPending, paused: engine.isPaused, backoff: engine.isInErrorBackoff, errors: engine.consecutiveErrors,
      base: engine.syncBaseSha?.slice(0, 8), lastKnown: typeof engine.lastKnownRemoteSha === 'string' ? engine.lastKnownRemoteSha.slice(0, 8) : String(engine.lastKnownRemoteSha)
    } : null,
    coordinator: sc ? { dragging: !!sc.isGlobalDragging, saving: !!sc.isSaving, unsaved: !!sc.hasUnsavedChanges?.(), dirty: !!sc.isDirty, pending: sc.pendingHash != null, loadInFlight: sc.loadInFlight } : '(not reachable)',
    indicator: document.querySelector('.save-status-display')?.textContent?.trim() || '',
    pendingConflict: !!backend.pendingConflict
  };
}, undefined, 15000).catch((e) => ({ error: e.message }));

async function repoSha() {
  const res = await fetch(`${FORGE}/api/v1/repos/${REPO}/commits?limit=1`, { headers: { Authorization: 'token observer' } });
  return res.ok ? (await res.json())[0]?.sha?.slice(0, 8) : null;
}

const checkNow = (p) => inPage(p, () => window.__redstringDevForge.checkNow()).catch((error) => {
  if (error instanceof FrozenPage) throw error;
  return null;
});

// ---------------------------------------------------------------------------
// What a person does

/** Things on screen that a pointer can reach: [{ id, x, y }] in page pixels. */
const reachableThings = (p) => inPage(p, () => {
  const out = [];
  for (const el of document.querySelectorAll('g.node[data-instance-id]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 10) continue;
    // The centre, or another point inside it when something covers the centre.
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
      const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) { out.push({ id: el.getAttribute('data-instance-id'), x, y }); break; }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
});

/** An empty spot on the canvas. */
const emptySpot = (p, rng) => inPage(p, ({ tries }) => {
  for (const [fx, fy] of tries) {
    const [x, y] = [window.innerWidth * fx, window.innerHeight * fy];
    const hit = document.elementFromPoint(x, y);
    if (hit && hit.closest('svg') && !hit.closest('g.node') && !hit.closest('[class*="panel" i]')) return { x, y };
  }
  return null;
}, { tries: Array.from({ length: 12 }, () => [0.3 + rng.next() * 0.4, 0.3 + rng.next() * 0.4]) });

/** Why no Thing was reachable: for the step log, with a screenshot the first time. */
let shotTaken = false;
async function unreachable(p, what) {
  const info = await inPage(p, () => {
    const nodes = [...document.querySelectorAll('g.node[data-instance-id]')];
    const onScreen = nodes.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
    });
    const s = window.useGraphStore.getState();
    return { dom: nodes.length, onScreen: onScreen.length, inWeb: s.graphs.get(s.activeGraphId)?.instances?.size ?? 0 };
  });
  if (!shotTaken) {
    shotTaken = true;
    await p.page.screenshot({ path: path.join(DIR, `unreachable-${p.who}.png`) });
    log(`no reachable Thing for ${what}; screenshot in ${DIR}`);
  }
  return `(${what}: nothing reachable: ${info.inWeb} in the web, ${info.dom} drawn, ${info.onScreen} on screen)`;
}

/** Help opens over the canvas on a first launch (What's New); a person closes it first. */
async function closeHelp(p) {
  const close = p.page.locator('.help-modal-sidebar').locator('xpath=ancestor::*[.//*[@title="Close"]][1]').locator('[title="Close"]').first();
  if (!(await close.isVisible().catch(() => false))) return false;
  await close.click();
  await sleep(400);
  return true;
}

/** A person working with the mouse is looking at a web with Things in it: open one if needed. Returns what they did, or null. */
async function lookAtThings(p, rng) {
  if (await closeHelp(p)) return "close What's New";
  const opened = await inPage(p, (pickIndex) => {
    const s = window.useGraphStore.getState();
    if ((s.graphs.get(s.activeGraphId)?.instances?.size || 0) > 0) return null;
    const webs = [...s.graphs.entries()].filter(([, g]) => (g.instances?.size || 0) > 0).map(([id]) => id).sort();
    if (!webs.length) return null;
    const id = webs[pickIndex % webs.length];
    (s.openGraphTab || s.setActiveGraph)(id);
    return id;
  }, rng.int(1000));
  if (opened) await sleep(800);
  return opened ? `open web ${opened}` : null;
}

async function dragThing(p, rng) {
  const opened = await lookAtThings(p, rng);
  if (opened) return opened;
  const things = await reachableThings(p);
  const thing = rng.pick(things);
  if (!thing) return unreachable(p, 'drag');
  const [dx, dy] = [rng.int(400) - 200, rng.int(300) - 150];
  await p.page.mouse.move(thing.x, thing.y);
  await p.page.mouse.down();
  await sleep(350); // past the lift delay
  for (let i = 1; i <= 8; i++) {
    await p.page.mouse.move(thing.x + (dx * i) / 8, thing.y + (dy * i) / 8);
    await sleep(25);
  }
  await p.page.mouse.up();
  await sleep(200);
  await p.page.mouse.click(5, 5).catch(() => {}); // let go of any selection
  return `drag ${thing.id} by ${dx},${dy}`;
}

async function autoLayout(p, rng) {
  if (await closeHelp(p)) return "close What's New";
  const spot = await emptySpot(p, rng);
  if (!spot) return null;
  await p.page.mouse.click(spot.x, spot.y, { button: 'right' });
  const item = p.page.getByText('Auto Layout Web', { exact: true }).first();
  try {
    await item.click({ timeout: 2000 });
  } catch {
    await p.page.keyboard.press('Escape');
    return null;
  }
  await sleep(1500); // the solver and the tween
  return 'auto layout (canvas menu)';
}

async function deleteThing(p, rng) {
  const opened = await lookAtThings(p, rng);
  if (opened) return opened;
  const thing = rng.pick(await reachableThings(p));
  if (!thing) return unreachable(p, 'delete');
  await p.page.mouse.click(thing.x, thing.y);
  await sleep(300);
  await p.page.keyboard.press('Delete');
  await sleep(400);
  await p.page.keyboard.press('Escape');
  return `select ${thing.id} and press Delete`;
}

async function undo(p) {
  if (await closeHelp(p)) return "close What's New";
  const spot = await emptySpot(p, seededRandom(1));
  if (spot) await p.page.mouse.click(spot.x, spot.y);
  await p.page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await sleep(300);
  return 'Cmd+Z';
}

async function storeAction(p, seed, step) {
  await ready(p);
  return inPage(p, ({ seed, prefix }) => {
    const { runRandomAction, seededRandom, idSource } = window.__soak.catalog;
    const did = runRandomAction(seededRandom(seed), idSource(prefix));
    return did?.description || null;
  }, { seed, prefix: `${p.who}-s${step}` });
}

// ---------------------------------------------------------------------------
// Settling and checking

async function settle(people, label) {
  for (const p of people) {
    if (!p.online) { await setOffline(p.who, false); p.online = true; }
  }
  const deadline = Date.now() + 120000;
  let lastCommits = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    for (const p of people) await timed(`${label} checkNow ${p.who}`, () => checkNow(p), 4000);
    await sleep(2500);
    const commits = (await repoCommits()).length;
    if (commits !== lastCommits) { lastCommits = commits; quietSince = Date.now(); }
    const busy = await Promise.all(people.map(async (p) => {
      const s = await engineStatus(p);
      return s.pending || s.running || s.changes;
    }));
    const files = await timed(`${label} export`, () => Promise.all(people.map(fileOf)), 4000);
    const repo = await repoFile();
    const allMatch = repo && files.every((f) => sameDocument(fromFile(f), fromFile(repo)));
    if (!busy.some(Boolean) && allMatch && Date.now() - quietSince > 6000) return { ok: true };
  }
  return { ok: false };
}

async function verify(people, history, label) {
  const problems = [];
  const settled = await timed(`${label} settle`, () => settle(people, label), 30000);
  const repo = await repoFile();
  const files = await Promise.all(people.map(fileOf));
  if (!settled.ok) problems.push('did not settle within 2 minutes');
  for (const [i, p] of people.entries()) {
    if (!repo || !sameDocument(fromFile(files[i]), fromFile(repo))) {
      problems.push(`${p.who} doesn't match the repository:\n${repo ? describeDifference(fromFile(files[i]), fromFile(repo)) : 'no repository file'}`);
    }
  }
  if (repo) {
    const broken = brokenReferences(fromFile(repo));
    if (broken.length) problems.push(`broken references:\n  ${broken.slice(0, 8).join('\n  ')}`);
  }
  // The indicator gets a moment to catch up with a pulled change.
  for (const p of people) {
    let text = '';
    for (let i = 0; i < 10 && text !== 'Saved' && !/updated/.test(text); i++) { text = await indicator(p); if (text !== 'Saved') await sleep(1000); }
    if (text !== 'Saved' && !/updated/.test(text)) problems.push(`${p.who}'s save indicator reads "${text}"`);
  }
  // Idle: nothing more should be saved.
  const before = (await repoCommits()).length;
  const fileBefore = await repoFile();
  for (let i = 0; i < 4; i++) { await sleep(3000); for (const p of people) await checkNow(p); }
  const after = (await repoCommits()).length;
  if (after !== before) {
    const who = (await repoCommits()).slice(0, after - before).join(', ');
    const fileAfter = await repoFile();
    const what = fileBefore && fileAfter ? describeDifference(fromFile(fileBefore), fromFile(fileAfter)) : '(no file)';
    problems.push(`${after - before} saves while everyone was idle, by ${who}; what changed:\n${what}`);
  }
  for (const p of people) if (p.errors.length) problems.push(`${p.who} page errors: ${p.errors.slice(-3).join(' | ')}`);

  if (problems.length) {
    problems.push(`repository at ${await repoSha()}`);
    for (const p of people) problems.push(`${p.who}: ${JSON.stringify(await syncState(p))}`);
    log(`FAIL at ${label} (seed ${SEED}):\n  ${problems.join('\n  ')}\nlast steps:\n  ${history.slice(-20).join('\n  ')}`);
    return false;
  }
  log(`ok at ${label}: ${(await repoCommits()).length} saves so far, both match the repository`);
  return true;
}

// ---------------------------------------------------------------------------

async function main() {
  try {
    await runSoak();
  } catch (error) {
    log('ERROR', error?.stack || error);
    stopServers();
    process.exit(1);
  }
}

async function runSoak() {
  log(`soak seed ${SEED}, ${STEPS} steps, ${API} API${READ_LAG ? `, reads lag ${READ_LAG} ms` : ''}`);
  run('forge', process.execPath, ['scripts/fake-forge.mjs', '--port', String(FORGE_PORT), '--dir', DIR, ...(READ_LAG ? ['--read-lag', READ_LAG] : [])]);
  PORTS.forEach((port) => run(`vite ${port}`, 'npx', ['vite', '--config', 'scripts/harness.vite.config.mjs', '--port', String(port), '--strictPort'], { HARNESS_PORT: String(port) }));
  await waitFor(`${FORGE}/api/v1/version`, 'fake forge');
  // Vite may listen on either loopback address for "localhost".
  for (const port of PORTS) await waitFor([`http://127.0.0.1:${port}/`, `http://[::1]:${port}/`], `dev server ${port}`);

  // The fake forge handles one request at a time with synchronous git calls;
  // if it stops answering, say what it is stuck on.
  const forgeChild = children.find((c) => c.label === 'forge');
  let forgeReported = false;
  const forgeWatch = setInterval(async () => {
    try {
      const res = await fetch(`${FORGE}/api/v1/version`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return;
    } catch { /* not answering */ }
    if (forgeReported) return;
    forgeReported = true;
    let tree = '';
    try { tree = execFileSync('ps', ['-o', 'pid,ppid,etime,command', '-g', String(forgeChild.pid)], { encoding: 'utf8' }); } catch (e) { tree = String(e.message); }
    log(`the fake forge stopped answering; its processes:\n${tree}`);
  }, 5000);
  forgeWatch.unref();

  const browser = await chromium.launch({ headless: !HEADED });
  const rng = seededRandom(SEED);
  const history = [];
  let ok = true;
  try {
    const people = [];
    // The first person makes the universe; the rest join once it's saved.
    people.push(await openPerson(browser, PORTS[0], PEOPLE[0]));
    await people[0].page.evaluate(() => {
      const s = window.useGraphStore.getState();
      if (!s.activeGraphId) s.createNewGraph({ id: 'web', name: 'Forest' });
    });
    for (let i = 0; i < 5; i++) {
      const d = await storeAction(people[0], SEED * 1000 + i, `seed${i}`);
      if (d) history.push(`${people[0].who}: ${d}`);
    }
    for (let i = 0; i < 60 && !(await repoCommits()).length; i++) await sleep(500);
    if (READ_LAG) await sleep(Number(READ_LAG) + 500);
    for (let i = 1; i < PORTS.length; i++) people.push(await openPerson(browser, PORTS[i], PEOPLE[i]));
    ok = await verify(people, history, 'join');

    for (let step = 1; ok && step <= STEPS; step++) {
      const p = rng.pick(people);
      const roll = rng.next();
      let did = null;
      for (const q of people) {
        if (q.reloads) { history.push(`${step} ${q.who}: (page reloaded x${q.reloads})`); q.reloads = 0; }
      }
      const stepStart = Date.now();
      try {
        await timed(`step ${step} ready ${p.who}`, () => ready(p), 4000);
        if (roll < 0.4) did = await storeAction(p, SEED * 100000 + step, step);
        else if (roll < 0.6) did = await dragThing(p, rng);
        else if (roll < 0.66) did = await autoLayout(p, rng);
        else if (roll < 0.72) did = await deleteThing(p, rng);
        else if (roll < 0.78) did = await undo(p);
        else if (roll < 0.88) { await sleep(1000 + rng.int(4000)); did = 'wait'; }
        else if (roll < 0.94) { await checkNow(p); did = 'check for others\' saves'; }
        else { p.online = !p.online; await setOffline(p.who, !p.online); did = p.online ? 'back online' : 'goes offline'; }
      } catch (error) {
        if (error instanceof FrozenPage) throw error;
        did = `(failed: ${error?.message?.split('\n')[0]})`;
      }
      if (did) history.push(`${step} ${p.who}: ${did}`);
      if (Date.now() - stepStart > 15000) log(`slow: step ${step} (${did}) took ${((Date.now() - stepStart) / 1000).toFixed(1)}s`);
      await sleep(150 + rng.int(600));
      if (step % SETTLE_EVERY === 0 || step === STEPS) ok = await verify(people, history, `step ${step}`);
    }
  } catch (error) {
    ok = false;
    log('ERROR', error?.stack || error);
    log(`server output:\n${serverTail()}`);
  } finally {
    await browser.close();
    stopServers();
  }
  const kinds = {};
  for (const line of history) {
    const what = line.replace(/^\d+ \w+: /, '').replace(/^\w+: /, '');
    const kind = what.startsWith('(failed') ? 'failed' : what.split(/ [\w-]*\d|"| by | in | to /)[0];
    kinds[kind] = (kinds[kind] || 0) + 1;
  }
  const vr = viteReloads();
  if (vr.length) log(`vite:\n  ${vr.slice(0, 10).join('\n  ')}`);
  log(`steps: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (args.includes('--show-steps')) log(`\n  ${history.join('\n  ')}`);
  log(ok ? `PASSED (seed ${SEED})` : `FAILED (seed ${SEED})`);
  process.exit(ok ? 0 : 1);
}

process.on('SIGINT', () => { stopServers(); process.exit(130); });
main();

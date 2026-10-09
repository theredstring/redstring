// @vitest-environment node
/**
 * Ontology import outside the browser: the mergeRedstringPack store action that
 * the CLI (and the bridge) uses, and `redstring import` itself.
 *
 * The CLI runs are pointed at a throwaway workspace, a throwaway REDSTRING_HOME
 * and a port nothing listens on, so they always take the one-shot path and can
 * never reach a Redstring that happens to be running on this machine.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';

const ROOT = path.resolve(__dirname, '../..');
const ZOO_OWL = path.join(ROOT, 'test/fixtures/ontology/zoo.owl');
const ZOO_TTL = path.join(ROOT, 'test/fixtures/ontology/zoo.ttl');

let useGraphStore;
let actions;
let exportToRedstring;
let importOntologyText;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  const { createStoreActions } = await import('../../src/services/storeActions.js');
  ({ exportToRedstring } = await import('../../src/formats/redstringFormat.js'));
  ({ importOntologyText } = await import('../../src/formats/ontology/importOntology.js'));
  actions = createStoreActions({ useGraphStore });
});

describe('mergeRedstringPack', () => {
  it('merges a pack into the active universe, then adds nothing the second time', async () => {
    useGraphStore.setState({
      graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), edgePrototypes: new Map(),
      openGraphIds: [], expandedGraphIds: new Set(), savedNodeIds: new Set(), savedGraphIds: new Set(),
      activeGraphId: null, isUniverseLoaded: true, _isLoadingUniverse: false,
    });
    const { state } = await importOntologyText(fs.readFileSync(ZOO_TTL, 'utf8'), 'zoo.ttl', { roots: ['cat'], depth: 0 });
    const pack = JSON.parse(JSON.stringify(exportToRedstring(state)));

    const first = await actions.mergeRedstringPack(pack);
    expect(first).toMatchObject({ success: true, thingsAlreadyHere: 0, websAdded: state.graphs.size, connectionsAdded: 1 });
    expect(first.thingsAdded).toBe(state.nodePrototypes.size);
    expect(first.laidOut).toBe(state.graphs.size);

    const second = await actions.mergeRedstringPack(JSON.stringify(pack));
    expect(second).toMatchObject({ success: true, thingsAdded: 0, websAdded: 0, connectionsAdded: 0 });
    expect(second.thingsAlreadyHere).toBe(state.nodePrototypes.size);
  });
});

describe('redstring import', () => {
  let tmp;
  let env;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ontology-'));
    env = { ...process.env, REDSTRING_HOME: path.join(tmp, 'home'), WIZARD_PORT: '1', BRIDGE_PORT: '1' };
    delete env.REDSTRING_AGENT_TOKEN;
    delete env.REDSTRING_WORKSPACE;
    delete env.REDSTRING_UNIVERSE;
  });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const cli = (...args) => {
    const r = spawnSync(process.execPath, ['cli/redstring.js', ...args, '--json'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) throw new Error(`redstring ${args.join(' ')} failed (${r.status}): ${r.stderr.slice(-800)}`);
    return JSON.parse(r.stdout.trim().split('\n').pop());
  };

  it('--dry-run reports what it would import', () => {
    const out = cli('import', ZOO_OWL, '--root', 'cat', '--depth', '0', '--dry-run');
    expect(out).toMatchObject({ dryRun: true, source: { title: 'Zoo Ontology' }, connections: 1 });
    expect(out.things).toBeGreaterThan(5);
  });

  it('--out writes a standalone pack universe with its webs laid out', () => {
    const file = path.join(tmp, 'zoo-pack.redstring');
    const out = cli('import', ZOO_OWL, '--out', file);
    expect(out.wrote).toBe(file);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    const names = Object.values(pack.prototypeSpace.prototypes).map((p) => p['skos:prefLabel'] || p.name);
    expect(names).toEqual(expect.arrayContaining(['cat', 'Garfield', 'Zoo Ontology']));
  });

  it('merges into the workspace\'s active universe, and a second run adds nothing', () => {
    const ws = path.join(tmp, 'ws');
    fs.mkdirSync(ws, { recursive: true });
    const first = cli('-w', ws, 'import', ZOO_OWL, '--root', 'cat');
    expect(first.merge).toMatchObject({ success: true, thingsAlreadyHere: 0 });
    // Every term, plus the source Thing, plus a Thing per connection type drawn.
    expect(first.merge.thingsAdded).toBe(first.things + 1 + first.relationTypes);
    const second = cli('-w', ws, 'import', ZOO_OWL, '--root', 'cat');
    expect(second.merge).toMatchObject({ success: true, thingsAdded: 0, websAdded: 0, connectionsAdded: 0 });
  });

  it('refuses a root it cannot find', () => {
    const r = spawnSync(process.execPath, ['cli/redstring.js', 'import', ZOO_OWL, '--root', 'unicorn', '--dry-run'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no term matches "unicorn"/);
  });
});

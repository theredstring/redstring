/**
 * syncMerge against real universes.
 *
 * Real files are not checked in. Point REDSTRING_REAL_UNIVERSES at a folder of
 * .redstring files (read only, never written):
 *
 *   REDSTRING_REAL_UNIVERSES=~/Documents npx vitest run test/formats/syncMergeReal.test.js
 *
 * Without it the suite is skipped.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncMerge, documentChanged, deepEqual } from '../../src/formats/syncMerge.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

const dirSetting = process.env.REDSTRING_REAL_UNIVERSES;
const dir = dirSetting ? dirSetting.replace(/^~/, os.homedir()) : null;
const MAX_BYTES = Number(process.env.REDSTRING_REAL_MAX_BYTES || 20 * 1024 * 1024);

const files = dir && fs.existsSync(dir)
  ? fs.readdirSync(dir)
    .filter((name) => name.endsWith('.redstring'))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).size > 1024 && fs.statSync(file).size <= MAX_BYTES)
  : [];

const load = (file) => importFromRedstring(JSON.parse(fs.readFileSync(file, 'utf8'))).storeState;
const roundTrip = (state) => importFromRedstring(JSON.parse(JSON.stringify(exportToRedstring(state)))).storeState;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Edits a person could make, cascading the way the store does. */
function edit(state, rand, tag) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const protos = [...state.nodePrototypes.keys()];
  const graphs = [...state.graphs.values()].filter((g) => g.instances instanceof Map);
  for (let k = 0; k < 12; k++) {
    const op = Math.floor(rand() * 5);
    if (op === 0 && protos.length) {
      const id = pick(protos);
      const p = state.nodePrototypes.get(id);
      if (p) state.nodePrototypes.set(id, { ...p, name: `${p.name} (${tag}${k})` });
    } else if (op === 1 && graphs.length) {
      const g = pick(graphs);
      const ids = [...g.instances.keys()];
      if (ids.length) {
        const iid = pick(ids);
        g.instances.set(iid, { ...g.instances.get(iid), x: Math.floor(rand() * 2000) });
      }
    } else if (op === 2 && graphs.length) {
      const g = pick(graphs);
      const pid = `${tag}-proto-${k}`;
      state.nodePrototypes.set(pid, { id: pid, name: `New ${tag}${k}`, color: '#8B0000', definitionGraphIds: [] });
      g.instances.set(`${tag}-inst-${k}`, { id: `${tag}-inst-${k}`, prototypeId: pid, x: 0, y: 0, scale: 1 });
    } else if (op === 3 && graphs.length) {
      const g = pick(graphs);
      const ids = [...g.instances.keys()];
      if (ids.length) {
        const iid = pick(ids);
        g.instances.delete(iid);
        for (const [eid, e] of state.edges) {
          if (e.sourceId === iid || e.destinationId === iid) {
            state.edges.delete(eid);
            for (const gg of state.graphs.values()) if (Array.isArray(gg.edgeIds)) gg.edgeIds = gg.edgeIds.filter((x) => x !== eid);
          }
        }
      }
    } else if (op === 4 && graphs.length) {
      const g = pick(graphs);
      const ids = [...g.instances.keys()];
      if (ids.length > 1) {
        const eid = `${tag}-edge-${k}`;
        state.edges.set(eid, { id: eid, sourceId: pick(ids), destinationId: pick(ids), typeNodeId: null, directionality: { arrowsToward: new Set() } });
        g.edgeIds = [...(g.edgeIds || []), eid];
      }
    }
  }
}

function dangling(state) {
  const out = [];
  const instances = new Set();
  for (const g of state.graphs.values()) for (const iid of g.instances?.keys?.() || []) instances.add(iid);
  for (const g of state.graphs.values()) {
    for (const inst of g.instances?.values?.() || []) {
      if (inst.prototypeId && !state.nodePrototypes.has(inst.prototypeId)) out.push(`${inst.id}→${inst.prototypeId}`);
    }
  }
  for (const e of state.edges.values()) {
    if (!instances.has(e.sourceId) || !instances.has(e.destinationId)) out.push(`edge ${e.id}`);
  }
  return out;
}

describe.skipIf(files.length === 0)('syncMerge on real universes', () => {
  for (const file of files) {
    const name = path.basename(file);

    it(`${name}: a written file reads back unchanged`, () => {
      // The first round trip may upgrade an older file; every file the app
      // writes has been through one, so from then on it must be stable.
      const written = roundTrip(load(file));
      expect(documentChanged(written, roundTrip(written))).toBe(false);
    });

    it(`${name}: two people editing merge without dangling references`, () => {
      const base = roundTrip(load(file));
      const before = dangling(base).length;
      const rand = rng(name.length * 7919);
      const ours = structuredClone(base);
      const theirs = structuredClone(base);
      edit(ours, rand, 'A');
      edit(theirs, rand, 'B');
      const started = performance.now();
      const { merged, safe } = syncMerge(base, roundTrip(ours), roundTrip(theirs));
      const ms = performance.now() - started;
      expect(safe).toBe(true);
      // A merge must never add broken references (some files already have a few).
      expect(dangling(merged).length).toBeLessThanOrEqual(before);
      expect(documentChanged(merged, roundTrip(merged))).toBe(false);
      // Unchanged side → the other side, exactly.
      const solo = syncMerge(base, base, roundTrip(theirs));
      expect(deepEqual(solo.merged.nodePrototypes, roundTrip(theirs).nodePrototypes)).toBe(true);
      if (ms > 500) console.warn(`[syncMergeReal] ${name}: merge took ${Math.round(ms)} ms`);
    });
  }
});

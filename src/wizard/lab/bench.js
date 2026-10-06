/**
 * The wizard's benchmark: what one request built, read from the store after
 * it (scripts/wizard-bench.mjs). The Druid's benchmark is lab/bench.js in
 * src/druid; this is its counterpart for the wizard, over the same subjects,
 * so one trained model can be judged in both roles, each by its own measures.
 *
 * Measured, per request:
 *   what it built   Things, webs, connections; how much of it is connected;
 *                   whether a web for the subject exists
 *   names           names the Redstring guardrails refuse (positions,
 *                   qualities, doings, sentences: src/druid/lab/rewards.js
 *                   badName), and the same name made twice
 *   how it worked   model calls, tool calls, tool calls that failed, whether
 *                   it answered at the end, whether the run errored
 */

import { badName } from '../../druid/lab/rewards.js';
import { normalizeName } from '../../druid/names.js';

const values = (x) => (x instanceof Map ? [...x.values()] : Array.isArray(x) ? x : Object.values(x || {}));
const keys = (x) => (x instanceof Map ? [...x.keys()] : Object.keys(x || {}));

/** What the store holds, as plain sets of ids, for a before and after. */
export function snapshotOf(st) {
  return {
    protos: new Set(keys(st.nodePrototypes)),
    graphs: new Set(keys(st.graphs)),
    edges: new Set(keys(st.edges))
  };
}

const failed = (result) => !result || Boolean(result.error || result.locked || result.cancelled || result.refused || result.success === false);

/**
 * @param {Object} st        the store's state after the request
 * @param {Object} before    snapshotOf(the state before)
 * @param {Object} run       { subject, events, calls, ms }
 */
export function measureWizard(st, before, { subject, events, calls = 0, ms = 0 }) {
  const newGraphs = keys(st.graphs).filter(id => !before.graphs.has(id));
  const newEdges = keys(st.edges).filter(id => !before.edges.has(id));
  const placed = new Map();
  for (const g of values(st.graphs)) for (const inst of values(g.instances)) placed.set(inst.id, inst.prototypeId);
  const things = [...new Set([...placed.values()])].filter(id => !before.protos.has(id));
  const nameOf = (pid) => st.nodePrototypes.get?.(pid)?.name ?? st.nodePrototypes[pid]?.name ?? '';

  // Connected: a new Thing with at least one connection to anything.
  const touching = new Set();
  for (const id of newEdges) {
    const e = st.edges.get?.(id) ?? st.edges[id];
    for (const end of [e?.sourceId, e?.destinationId, e?.targetId]) if (placed.has(end)) touching.add(placed.get(end));
  }

  const names = things.map(nameOf).filter(Boolean);
  const refused = names.map(n => [n, badName(n)]).filter(([, why]) => why);
  const counts = new Map();
  for (const n of names) counts.set(normalizeName(n), (counts.get(normalizeName(n)) || 0) + 1);
  const dupes = [...counts.values()].filter(c => c > 1).reduce((a, c) => a + c - 1, 0);

  const s = normalizeName(subject);
  const graphName = (g) => normalizeName(g?.name || '') || normalizeName(values(g?.definingNodeIds).map(nameOf)[0] || '');
  const subjectWeb = newGraphs.some(id => { const n = graphName(st.graphs.get?.(id) ?? st.graphs[id]); return n && (n === s || n.includes(s) || s.includes(n)); });

  const results = events.filter(e => e.type === 'tool_result');
  const failures = results.filter(e => failed(e.result));
  const said = events.filter(e => e.type === 'response').map(e => e.content || '').join('').trim();
  const error = events.find(e => e.type === 'error');

  return {
    subject,
    things: things.length,
    webs: newGraphs.length,
    edges: newEdges.length,
    connectedPct: things.length ? Math.round((100 * things.filter(t => touching.has(t)).length) / things.length) : 0,
    subjectWeb,
    refused: refused.map(([n, why]) => `${n}: ${why}`),
    dupes,
    calls,
    toolCalls: results.length,
    failedPct: results.length ? Math.round((1000 * failures.length) / results.length) / 10 : 0,
    failures: failures.slice(0, 5).map(e => `${e.name}: ${String(e.result?.error || e.result?.message || 'failed').slice(0, 120)}`),
    answered: said.length > 0,
    error: error ? String(error.message || error.error || 'error').slice(0, 200) : null,
    ms
  };
}

/** Averages over requests, for the compare gate. */
export function summarizeWizard(results) {
  const m = results.map(r => r.metrics);
  const avg = (f) => (m.length ? Math.round((10 * m.reduce((a, x) => a + (f(x) ?? 0), 0)) / m.length) / 10 : 0);
  const pct = (f) => (m.length ? Math.round((100 * m.filter(f).length) / m.length) : 0);
  return {
    requests: m.length,
    thingsPerRun: avg(x => x.things),
    websPerRun: avg(x => x.webs),
    edgesPerRun: avg(x => x.edges),
    connectedPct: avg(x => x.connectedPct),
    subjectWebPct: pct(x => x.subjectWeb),
    refusedPerRun: avg(x => x.refused.length),
    dupesPerRun: avg(x => x.dupes),
    callsPerRun: avg(x => x.calls),
    failedPct: avg(x => x.failedPct),
    answeredPct: pct(x => x.answered),
    erroredPct: pct(x => x.error)
  };
}

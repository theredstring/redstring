import { it } from 'vitest';
import './env.js';
import { syntheticCases } from './corpus.js';
import * as svc from '../../src/services/graphLayoutService.js';
it('profile', async () => {
  const c = syntheticCases().find(x => x.name === 'communities-3x10');
  const { Session } = await import('node:inspector/promises');
  const session = new Session(); session.connect();
  await session.post('Profiler.enable'); await session.post('Profiler.start');
  const t = performance.now();
  const log = console.log; console.log = () => {};
  svc.applyLayout(c.nodes.map((n, i) => ({ ...n, x: (i * 397) % 2000, y: (i * 911) % 2000 })), c.edges, 'best', { width: 100000, height: 100000, padding: 8000, groups: [], edgeLabelFontSize: 71.28, gridSize: 200, iterations: 600, alphaDecay: 0.008, useExistingPositions: true });
  console.log = log;
  const { profile } = await session.post('Profiler.stop');
  const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map(n => [n.id, n]));
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName}:${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
  console.log('total ms', Math.round(performance.now() - t));
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${Math.round(v / 1000)}ms`).join('\n'));
}, 600000);

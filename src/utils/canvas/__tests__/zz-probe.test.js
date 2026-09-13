import { describe, it } from 'vitest';
import {
  computeLombardiTangents,
  lombardiArcFor,
  computeLombardiRouting,
  distanceToArc,
  sampleArc,
  trimRouteEnd,
} from '../edgeRouting.js';
import { getNodeHitbox } from '../nodeHitbox.js';
import { distanceToPolyline } from '../geometryUtils.js';

const D = { currentWidth: 300, currentHeight: 200, scaledCornerRadius: 40 };
const dimsFor = () => ({ ...D });

describe('probe', () => {
  it('full-arc hit test vs drawn-only', () => {
    // Denser cluster: hub-and-spoke with the spokes close in, which is where
    // arcs actually crowd each other on screen.
    const nodes = [
      { id: 'hub', x: 0, y: 0 },
      { id: 'a', x: 500, y: -120 },
      { id: 'b', x: 480, y: 320 },
      { id: 'c', x: -480, y: 260 },
      { id: 'd', x: 60, y: 620 },
      { id: 'e', x: -430, y: -360 },
      { id: 'f', x: 20, y: -560 },
    ];
    const edges = [
      { id: 'e1', sourceId: 'hub', destinationId: 'a' },
      { id: 'e2', sourceId: 'hub', destinationId: 'b' },
      { id: 'e3', sourceId: 'hub', destinationId: 'c' },
      { id: 'e4', sourceId: 'hub', destinationId: 'd' },
      { id: 'e5', sourceId: 'hub', destinationId: 'e' },
      { id: 'e6', sourceId: 'hub', destinationId: 'f' },
      { id: 'e7', sourceId: 'a', destinationId: 'b' },
      { id: 'e8', sourceId: 'c', destinationId: 'd' },
      { id: 'e9', sourceId: 'e', destinationId: 'f' },
      { id: 'e10', sourceId: 'f', destinationId: 'a' },
      { id: 'e11', sourceId: 'c', destinationId: 'e' },
    ];
    const dims = new Map(nodes.map(n => [n.id, dimsFor()]));
    const tangents = computeLombardiTangents(nodes, edges, dims);
    const byId = new Map(nodes.map(n => [n.id, n]));

    const boxOf = (n) => getNodeHitbox(n, dimsFor(), false);

    const geo = new Map();
    for (const edge of edges) {
      const s = byId.get(edge.sourceId), d = byId.get(edge.destinationId);
      const g = lombardiArcFor(edge, s, d, dimsFor(), dimsFor(), tangents, 1, {});
      const raw = g.arc ? sampleArc(g.arc, 128) : [g.p, g.q];
      const t1 = trimRouteEnd(raw, boxOf(s), true, 0).points;
      const drawn = trimRouteEnd(t1, boxOf(d), false, 0).points;
      geo.set(edge.id, { ...g, drawn });
    }

    // Scan A: what the code does now — distance to the FULL centre-to-centre arc.
    const scanFull = (cx, cy, th) => {
      let best = null, bestD = Infinity;
      for (const edge of edges) {
        const { p, q, arc } = geo.get(edge.id);
        const d = arc ? distanceToArc(cx, cy, arc) : distanceToPolyline(cx, cy, [p, q]);
        if (d > th || d >= bestD) continue;
        bestD = d; best = edge.id;
      }
      return best;
    };
    // Scan B: distance to only the part that is actually drawn.
    const scanDrawn = (cx, cy, th) => {
      let best = null, bestD = Infinity;
      for (const edge of edges) {
        const d = distanceToPolyline(cx, cy, geo.get(edge.id).drawn);
        if (d > th || d >= bestD) continue;
        bestD = d; best = edge.id;
      }
      return best;
    };

    // Margin between the winner and the runner-up, walking each drawn line.
    const rank = (cx, cy, th) => {
      const ds = [];
      for (const edge of edges) {
        const { p, q, arc } = geo.get(edge.id);
        const d = arc ? distanceToArc(cx, cy, arc) : distanceToPolyline(cx, cy, [p, q]);
        if (d <= th) ds.push([edge.id, d]);
      }
      ds.sort((a, b) => a[1] - b[1]);
      return ds;
    };
    {
      const buckets = { '<1': 0, '<3': 0, '<6': 0, '<12': 0, 'clear': 0, 'alone': 0 };
      let n = 0;
      const tight = [];
      for (const edge of edges) {
        const arc = geo.get(edge.id).arc;
        const deltaDeg = arc ? Math.abs(arc.delta) * 180 / Math.PI : 0;
        const pts = geo.get(edge.id).drawn;
        let tightHere = 0;
        for (let i = 1; i < pts.length - 1; i++) {
          const r = rank(pts[i].x, pts[i].y, 50);
          n++;
          if (r.length < 2) { buckets.alone++; continue; }
          const m = r[1][1] - r[0][1];
          if (m < 1) buckets['<1']++;
          else if (m < 3) buckets['<3']++;
          else if (m < 6) buckets['<6']++;
          else if (m < 12) buckets['<12']++;
          else buckets.clear++;
          if (m < 12) tightHere++;
        }
        tight.push(`${edge.id} delta=${deltaDeg.toFixed(0)}deg tightPts=${tightHere}/${pts.length - 2}`);
      }
      console.log('runner-up margin along drawn lines, n=' + n, JSON.stringify(buckets));
      tight.forEach(t => console.log('   ', t));
    }

    const TH = 50;
    // Aim like a person: within `off` units perpendicular of the drawn line.
    for (const off of [0, 8, 16, 25]) {
      let total = 0, wrongFull = 0, wrongDrawn = 0, nullFull = 0, nullDrawn = 0;
      const samples = [];
      for (const edge of edges) {
        const pts = geo.get(edge.id).drawn;
        for (let i = 1; i < pts.length - 1; i++) {
          const tx = pts[i + 1].x - pts[i - 1].x, ty = pts[i + 1].y - pts[i - 1].y;
          const L = Math.hypot(tx, ty) || 1;
          for (const sign of [1, -1]) {
            const x = pts[i].x + (-ty / L) * off * sign;
            const y = pts[i].y + (tx / L) * off * sign;
            total++;
            const a = scanFull(x, y, TH);
            const b = scanDrawn(x, y, TH);
            if (a !== edge.id) { wrongFull++; if (a === null) nullFull++; }
            if (b !== edge.id) { wrongDrawn++; if (b === null) nullDrawn++; }
            if (a !== edge.id && b === edge.id && samples.length < 6) {
              samples.push(`on ${edge.id} @${Math.round(x)},${Math.round(y)} -> full picked ${a}`);
            }
          }
        }
      }
      console.log(`off=${off}px n=${total} | fullArc wrong=${wrongFull} (null ${nullFull}) | drawnOnly wrong=${wrongDrawn} (null ${nullDrawn})`);
      samples.forEach(s => console.log('   ', s));
    }
  });
});

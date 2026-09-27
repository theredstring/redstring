/**
 * COMMUNITIES — the clusters a graph has without anyone having drawn a group.
 *
 * A web is rarely uniform: a few densely connected neighbourhoods, bridged by
 * a handful of connections. A reader sees that structure only if the layout
 * keeps each neighbourhood together and apart from the others (Gestalt
 * proximity) — and a plain force layout doesn't reliably do either, because
 * repulsion is the same between any two nodes whether or not they share a
 * neighbourhood. So the layout needs to know where the neighbourhoods are.
 *
 * This is Louvain modularity optimisation (Blondel, Guillaume, Lambiotte &
 * Lefebvre 2008): repeatedly move each node to the neighbouring community
 * that most increases modularity Q (Newman & Girvan 2004), then collapse each
 * community to a single node and repeat on the smaller graph. It is also the
 * clustering force-directed layout is secretly doing — Noack (2009) showed
 * modularity clustering and the LinLog layout energy share their optima —
 * which is why making it explicit sharpens the layout rather than fighting it.
 *
 * Deterministic: nodes are visited in id order and ties keep the lowest
 * community id, so the same graph always partitions the same way.
 */

/**
 * @param {Array<{id: string}>} nodes
 * @param {Array<{sourceId: string, destinationId: string}>} edges
 * @returns {{ communities: string[][], modularity: number }} communities as
 *          arrays of node ids, largest first
 */
export function detectCommunities(nodes, edges) {
  const ids = nodes.map(n => n.id).sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  if (n === 0) return { communities: [], modularity: 0 };

  // Weighted undirected adjacency; parallel connections add weight.
  let adj = Array.from({ length: n }, () => new Map());
  let total = 0;
  edges.forEach(e => {
    const a = index.get(e.sourceId), b = index.get(e.destinationId);
    if (a === undefined || b === undefined || a === b) return;
    adj[a].set(b, (adj[a].get(b) || 0) + 1);
    adj[b].set(a, (adj[b].get(a) || 0) + 1);
    total += 1;
  });
  if (total === 0) return { communities: ids.map(id => [id]), modularity: 0 };
  const m2 = 2 * total;

  // membership[level-0 node] → community, carried through every aggregation.
  let membership = ids.map((_, i) => i);

  for (let level = 0; level < 10; level++) {
    const size = adj.length;
    const degree = adj.map(nb => { let d = 0; nb.forEach(w => { d += w; }); return d; });
    const comm = Array.from({ length: size }, (_, i) => i);
    const commTot = degree.slice();

    // Phase 1: local moving until no node wants to move.
    let moved = true;
    let anyMove = false;
    for (let pass = 0; moved && pass < 50; pass++) {
      moved = false;
      for (let i = 0; i < size; i++) {
        const ci = comm[i];
        const ki = degree[i];
        // Weights from i into each neighbouring community.
        const links = new Map();
        adj[i].forEach((w, j) => {
          if (j === i) return;
          links.set(comm[j], (links.get(comm[j]) || 0) + w);
        });
        commTot[ci] -= ki;
        // Gain of joining community c: k_i,in(c) − Σ_tot(c)·k_i / 2m
        let best = ci;
        let bestGain = (links.get(ci) || 0) - commTot[ci] * ki / m2;
        [...links.keys()].sort((a, b) => a - b).forEach(c => {
          const gain = links.get(c) - commTot[c] * ki / m2;
          if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
        });
        commTot[best] += ki;
        if (best !== ci) { comm[i] = best; moved = true; anyMove = true; }
      }
    }
    if (!anyMove) break;

    // Phase 2: collapse communities into nodes.
    const renumber = new Map();
    comm.forEach(c => { if (!renumber.has(c)) renumber.set(c, renumber.size); });
    membership = membership.map(c => renumber.get(comm[c]));
    const next = Array.from({ length: renumber.size }, () => new Map());
    adj.forEach((nb, i) => {
      const a = renumber.get(comm[i]);
      nb.forEach((w, j) => {
        const b = renumber.get(comm[j]);
        next[a].set(b, (next[a].get(b) || 0) + w);
      });
    });
    // Self-loops of a collapsed node were counted from both ends above; the
    // degree sums stay consistent because every other entry was too.
    adj = next;
    if (renumber.size === size) break;
  }

  // Modularity of the final partition, on the original graph.
  const groups = new Map();
  membership.forEach((c, i) => {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(ids[i]);
  });
  const commOf = new Map();
  groups.forEach((list, c) => list.forEach(id => commOf.set(id, c)));
  const deg = new Map(ids.map(id => [id, 0]));
  let inside = 0;
  edges.forEach(e => {
    if (!index.has(e.sourceId) || !index.has(e.destinationId) || e.sourceId === e.destinationId) return;
    deg.set(e.sourceId, deg.get(e.sourceId) + 1);
    deg.set(e.destinationId, deg.get(e.destinationId) + 1);
    if (commOf.get(e.sourceId) === commOf.get(e.destinationId)) inside += 1;
  });
  const tot = new Map();
  deg.forEach((d, id) => tot.set(commOf.get(id), (tot.get(commOf.get(id)) || 0) + d));
  let expected = 0;
  tot.forEach(t => { expected += (t / m2) ** 2; });
  const modularity = inside / total - expected;

  const communities = [...groups.values()]
    .map(list => list.sort())
    .sort((a, b) => (b.length - a.length) || (a[0] < b[0] ? -1 : 1));
  return { communities, modularity };
}

/**
 * Communities worth laying out as blocks, or null when the graph has no
 * structure strong enough to show.
 *
 * Q ≥ 0.3 is the conventional threshold for significant community structure
 * (Newman & Girvan 2004; Newman 2004). Below it, forcing blocks would invent
 * separation the data doesn't have. Singletons and pairs are left loose —
 * a two-node "neighbourhood" is just a connection.
 */
export function significantCommunities(nodes, edges, { minModularity = 0.3, minSize = 3 } = {}) {
  const { communities, modularity } = detectCommunities(nodes, edges);
  const big = communities.filter(c => c.length >= minSize);
  if (modularity < minModularity || big.length < 2) return null;
  return { communities: big, modularity };
}

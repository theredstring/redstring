/**
 * Everyday edits, made through the real store actions (src/store/graphStore.js),
 * for the shared-universe tests. Each picks its targets from the store as it
 * stands, with a seeded random source, and returns a one-line description, or
 * null when it doesn't apply (nothing to delete, say).
 *
 * The point of going through the store rather than building states by hand:
 * the store makes Things, webs and connections in the shape the app has them
 * (which is not the shape a file reads back as). Tests that built states by
 * hand missed two bugs that this shape caused (2026-10-18).
 *
 * `personal: true` marks an edit to one person's view (a saved bookmark),
 * which never reaches the shared document.
 */
import useGraphStore from '../../src/store/graphStore.js';
import { duplicatePairKey } from '../../src/formats/duplicatePairKey.js';

export { seededRandom, idSource } from './random.js';

const store = () => useGraphStore.getState();
const sorted = (iterable) => [...iterable].sort();

const BASE_IDS = new Set(['base-thing-prototype', 'base-connection-prototype']);
/** Things a person made (not the built-in Thing / Connection types). */
const userPrototypeIds = () => sorted(store().nodePrototypes.keys()).filter((id) => !BASE_IDS.has(id));
const webIds = () => sorted(store().graphs.keys());
const instancesOf = (graphId) => sorted(store().graphs.get(graphId)?.instances?.keys() || []);
/** A web with at least `n` Things in it. */
const webWith = (rng, n) => rng.pick(webIds().filter((id) => instancesOf(id).length >= n));
const edgesIn = (graphId) => sorted(store().graphs.get(graphId)?.edgeIds || []).filter((id) => store().edges.has(id));
const groupsIn = (graphId) => sorted(store().graphs.get(graphId)?.groups?.keys() || []);
const nameOf = (protoId) => store().nodePrototypes.get(protoId)?.name ?? protoId;
const instName = (graphId, iid) => nameOf(store().graphs.get(graphId)?.instances?.get(iid)?.prototypeId);

const WORDS = ['Oak', 'Fern', 'Moss', 'Lichen', 'Owl', 'Vole', 'Stream', 'Stone', 'Root', 'Seed', 'Wind', 'Frost', 'Hawk', 'Bee', 'Clover', 'Ash'];
const COLORS = ['#8B0000', '#2F4F2F', '#4B0082', '#8B4513', '#1F3A5F', '#556B2F'];
// A tiny picture as a data URL (each one distinct, so a change is a change).
const picture = (n) => `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD${'ABCDEFGHIJKLMNOP'[n % 16]}lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`;

export const ACTIONS = [
  {
    name: 'add a Thing',
    weight: 6,
    run(rng, ids) {
      const web = rng.pick(webIds());
      if (!web) return null;
      const id = ids.next('thing');
      const name = `${rng.pick(WORDS)} ${id.slice(-3)}`;
      store().addNodePrototype({ id, name, color: rng.pick(COLORS), description: '', definitionGraphIds: [], typeNodeId: null });
      store().addNodeInstance(web, id, { x: rng.int(1200) - 600, y: rng.int(800) - 400 }, ids.next('inst'));
      return `add "${name}" to ${web}`;
    }
  },
  {
    name: 'place an existing Thing in a web',
    weight: 2,
    run(rng, ids) {
      const web = rng.pick(webIds());
      const proto = rng.pick(userPrototypeIds());
      if (!web || !proto) return null;
      store().addNodeInstance(web, proto, { x: rng.int(1200) - 600, y: rng.int(800) - 400 }, ids.next('inst'));
      return `place "${nameOf(proto)}" in ${web}`;
    }
  },
  {
    name: 'move a Thing',
    weight: 6,
    run(rng) {
      const web = webWith(rng, 1);
      if (!web) return null;
      const iid = rng.pick(instancesOf(web));
      const [x, y] = [rng.int(1600) - 800, rng.int(1000) - 500];
      store().updateNodeInstance(web, iid, (inst) => { inst.x = x; inst.y = y; }, { finalize: true });
      return `move "${instName(web, iid)}" in ${web} to ${x},${y}`;
    }
  },
  {
    name: 'lay out a web',
    weight: 2,
    run(rng) {
      const web = webWith(rng, 2);
      if (!web) return null;
      const graph = store().graphs.get(web);
      const from = instancesOf(web).map((iid) => ({ instanceId: iid, x: graph.instances.get(iid).x, y: graph.instances.get(iid).y }));
      const to = from.map(({ instanceId }) => ({ instanceId, x: rng.int(2000) - 1000, y: rng.int(1400) - 700 }));
      store().commitPositionMove(web, from, to, { label: 'Auto layout' });
      return `lay out ${web} (${to.length} Things)`;
    }
  },
  {
    name: 'rename a Thing',
    weight: 4,
    run(rng) {
      const proto = rng.pick(userPrototypeIds());
      if (!proto) return null;
      const name = `${rng.pick(WORDS)} ${rng.int(1000)}`;
      store().updateNodePrototype(proto, (p) => { p.name = name; });
      return `rename "${nameOf(proto)}" -> "${name}"`;
    }
  },
  {
    name: 'describe a Thing',
    weight: 3,
    run(rng) {
      const proto = rng.pick(userPrototypeIds());
      if (!proto) return null;
      const text = `Seen ${rng.int(100)} times`;
      store().updateNodePrototype(proto, (p) => { p.description = text; });
      return `describe "${nameOf(proto)}"`;
    }
  },
  {
    name: 'recolour a Thing',
    weight: 2,
    run(rng) {
      const proto = rng.pick(userPrototypeIds());
      if (!proto) return null;
      const color = rng.pick(COLORS);
      store().updateNodePrototype(proto, (p) => { p.color = color; });
      return `recolour "${nameOf(proto)}" ${color}`;
    }
  },
  {
    name: 'give a Thing a picture',
    weight: 1,
    run(rng) {
      const proto = rng.pick(userPrototypeIds());
      if (!proto) return null;
      const src = picture(rng.int(16));
      store().updateNodePrototype(proto, (p) => { p.imageSrc = src; p.thumbnailSrc = src; p.imageAspectRatio = 1; });
      return `picture on "${nameOf(proto)}"`;
    }
  },
  {
    name: 'remove a Thing from a web',
    weight: 3,
    run(rng) {
      const web = webWith(rng, 1);
      if (!web) return null;
      const iid = rng.pick(instancesOf(web));
      const label = instName(web, iid);
      store().removeNodeInstance(web, iid);
      return `remove "${label}" from ${web}`;
    }
  },
  {
    name: 'delete a Thing everywhere',
    weight: 2,
    run(rng) {
      const proto = rng.pick(userPrototypeIds().filter((id) => !(store().nodePrototypes.get(id)?.definitionGraphIds || []).length));
      if (!proto) return null;
      const label = nameOf(proto);
      for (const web of webIds()) {
        for (const iid of instancesOf(web)) {
          if (store().graphs.get(web).instances.get(iid)?.prototypeId === proto) store().removeNodeInstance(web, iid);
        }
      }
      store().deleteNodePrototype(proto);
      return `delete "${label}"`;
    }
  },
  {
    name: 'connect two Things',
    weight: 5,
    run(rng, ids) {
      const web = webWith(rng, 2);
      if (!web) return null;
      const [a, b] = [rng.pick(instancesOf(web)), rng.pick(instancesOf(web))];
      if (a === b) return null;
      store().addEdge(web, { id: ids.next('edge'), sourceId: a, destinationId: b, typeNodeId: 'base-connection-prototype', directionality: { arrowsToward: new Set() } });
      return `connect "${instName(web, a)}" -> "${instName(web, b)}" in ${web}`;
    }
  },
  {
    name: 'disconnect',
    weight: 2,
    run(rng) {
      const web = rng.pick(webIds().filter((id) => edgesIn(id).length));
      if (!web) return null;
      const edge = rng.pick(edgesIn(web));
      store().removeEdge(edge);
      return `remove connection ${edge}`;
    }
  },
  {
    name: 'flip an arrow',
    weight: 2,
    run(rng) {
      const web = rng.pick(webIds().filter((id) => edgesIn(id).length));
      if (!web) return null;
      const edgeId = rng.pick(edgesIn(web));
      store().updateEdge(edgeId, (e) => {
        const arrows = e.directionality?.arrowsToward instanceof Set ? e.directionality.arrowsToward : new Set();
        if (arrows.has(e.destinationId)) arrows.delete(e.destinationId);
        else arrows.add(e.destinationId);
        e.directionality = { ...(e.directionality || {}), arrowsToward: arrows };
      });
      return `flip arrow on ${edgeId}`;
    }
  },
  {
    name: 'give a connection a type',
    weight: 1,
    run(rng, ids) {
      const web = rng.pick(webIds().filter((id) => edgesIn(id).length));
      if (!web) return null;
      const edgeId = rng.pick(edgesIn(web));
      const typeId = ids.next('ctype');
      store().addEdgePrototype({ id: typeId, name: `${rng.pick(['eats', 'shelters', 'feeds', 'grows on'])}`, color: rng.pick(COLORS), description: '' });
      store().setEdgeType(edgeId, typeId);
      return `type ${edgeId} as ${typeId}`;
    }
  },
  {
    name: 'group Things',
    weight: 2,
    run(rng) {
      const web = webWith(rng, 2);
      if (!web) return null;
      const members = [...new Set([rng.pick(instancesOf(web)), rng.pick(instancesOf(web))])];
      store().createGroup(web, { name: `${rng.pick(WORDS)} group`, memberInstanceIds: members });
      return `group ${members.length} in ${web}`;
    }
  },
  {
    name: 'rename a group',
    weight: 1,
    run(rng) {
      const web = rng.pick(webIds().filter((id) => groupsIn(id).length));
      if (!web) return null;
      const groupId = rng.pick(groupsIn(web));
      const name = `${rng.pick(WORDS)} circle`;
      store().updateGroup(web, groupId, (g) => { g.name = name; });
      return `rename group ${groupId} -> ${name}`;
    }
  },
  {
    name: 'ungroup',
    weight: 1,
    run(rng) {
      const web = rng.pick(webIds().filter((id) => groupsIn(id).length));
      if (!web) return null;
      const groupId = rng.pick(groupsIn(web));
      store().deleteGroup(web, groupId);
      return `ungroup ${groupId}`;
    }
  },
  {
    name: 'make a new web',
    weight: 1,
    run(rng, ids) {
      const id = ids.next('web');
      store().createNewGraph({ id, name: `${rng.pick(WORDS)} web` });
      return `new web ${id}`;
    }
  },
  {
    name: 'rename a web',
    weight: 1,
    run(rng) {
      const web = rng.pick(webIds());
      if (!web) return null;
      const name = `${rng.pick(WORDS)} place`;
      store().updateGraph(web, (g) => { g.name = name; });
      return `rename web ${web} -> ${name}`;
    }
  },
  {
    name: 'define a Thing (open its own web)',
    weight: 1,
    run(rng, ids) {
      const proto = rng.pick(userPrototypeIds());
      if (!proto) return null;
      const graphId = store().createAndAssignGraphDefinitionWithoutActivation(proto);
      if (!graphId) return null;
      const inner = rng.pick(userPrototypeIds());
      if (inner) store().addNodeInstance(graphId, inner, { x: 0, y: 0 }, ids.next('inst'));
      return `define "${nameOf(proto)}" as ${graphId}`;
    }
  },
  {
    name: 'set what kind a Thing is',
    weight: 1,
    run(rng) {
      const [a, b] = [rng.pick(userPrototypeIds()), rng.pick(userPrototypeIds())];
      if (!a || !b || a === b) return null;
      store().setNodeType(a, b);
      return `"${nameOf(a)}" is a "${nameOf(b)}"`;
    }
  },
  {
    name: 'duplicate a Thing',
    weight: 1,
    run(rng) {
      const proto = rng.pick(userPrototypeIds());
      if (!proto) return null;
      store().duplicateNodePrototype(proto);
      return `duplicate "${nameOf(proto)}"`;
    }
  },
  {
    name: 'merge two Things',
    weight: 1,
    run(rng) {
      const [a, b] = [rng.pick(userPrototypeIds()), rng.pick(userPrototypeIds())];
      if (!a || !b || a === b) return null;
      const label = `"${nameOf(b)}" into "${nameOf(a)}"`;
      store().mergeNodePrototypes(a, b);
      return `merge ${label}`;
    }
  },
  {
    name: 'put a Thing in another\'s abstraction chain',
    weight: 1,
    run(rng) {
      const [owner, member] = [rng.pick(userPrototypeIds()), rng.pick(userPrototypeIds())];
      if (!owner || !member || owner === member) return null;
      const chain = store().nodePrototypes.get(owner)?.abstractionChains?.specificity || [];
      if (chain.includes(member)) return null;
      store().addToAbstractionChain(owner, 'specificity', rng.chance(0.5) ? 'above' : 'below', member, chain.includes(owner) ? owner : (chain[0] || owner));
      return `"${nameOf(member)}" into "${nameOf(owner)}"'s chain`;
    }
  },
  {
    name: 'rule two Things not the same',
    weight: 1,
    run(rng) {
      const [a, b] = [rng.pick(userPrototypeIds()), rng.pick(userPrototypeIds())];
      if (!a || !b || a === b) return null;
      const key = duplicatePairKey(a, b);
      if (store().mergeDismissals?.[key]) return null;
      store().dismissDuplicatePair(key);
      return `"${nameOf(a)}" and "${nameOf(b)}" are not the same`;
    }
  },
  {
    name: 'close a web',
    weight: 1,
    personal: true,
    run(rng) {
      // closeGraph, then the orphan cleanup it schedules, run now: its 100 ms
      // timer would otherwise fire on whichever device's universe the shared
      // test store holds by then.
      const open = [...store().openGraphIds].sort();
      if (open.length < 2) return null;
      const id = rng.pick(open);
      const s = store();
      const remaining = s.openGraphIds.filter((g) => g !== id);
      useGraphStore.setState({ openGraphIds: remaining, activeGraphId: s.activeGraphId === id ? remaining[0] : s.activeGraphId });
      store().cleanupOrphanedData();
      return `close web ${id}`;
    }
  },
  {
    name: 'bookmark a Thing',
    weight: 1,
    personal: true,
    run(rng) {
      const proto = rng.pick(userPrototypeIds());
      if (!proto) return null;
      store().toggleSavedNode(proto);
      return `bookmark "${nameOf(proto)}"`;
    }
  }
];

/** Pick an action by weight and run it; tries others until one applies. */
export function runRandomAction(rng, ids, { exclude = [] } = {}) {
  const pool = ACTIONS.filter((a) => !exclude.includes(a.name));
  for (let attempt = 0; attempt < 20; attempt++) {
    const total = pool.reduce((sum, a) => sum + a.weight, 0);
    let roll = rng.next() * total;
    const action = pool.find((a) => (roll -= a.weight) < 0) || pool[pool.length - 1];
    const description = action.run(rng, ids);
    if (description) return { action, description };
  }
  return null;
}

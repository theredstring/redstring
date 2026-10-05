/**
 * Cognitive moves — the operations of thought, each one menu option for the
 * model and a deterministic chain underneath. They prescribe how thinking can
 * MOVE, never what it is about.
 *
 *   variant      a version of a Thing that differs in one respect; shares the
 *                parts that did not change (the same Things, placed again), not copies
 *   specialize   a kind of a Thing: is-a link, inherits its inside by reference
 *   chunk        gather Things that keep being in mind together into one Thing
 *                whose inside they become (blackboxing)
 *   contrast     code lists how two Things differ; the model names the key difference
 *   generalize   name what two Things are both kinds of; both are linked to it
 *   analogy      code finds a Thing elsewhere whose connections have the same
 *                shape; the model judges whether the likeness is real
 *   wonder       code lists gaps (no description, unconnected, much connected
 *                but never opened); the model picks one to look at
 */

import { normalizeName, sameHead } from '../names.js';
import { GENERIC_KIND } from './basic.js';
import { assocStrength, associate } from '../activation.js';
import { addEvidence, sourceKind } from '../roles.js';
import { tokenize } from '../recall.js';

/** Content words two Things' descriptions share — the moment a comparison is apt. */
export function sharedWords(world, a, b) {
  const A = new Set(tokenize(world.proto(a)?.description));
  return [...new Set(tokenize(world.proto(b)?.description))].filter(w => A.has(w));
}

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });

/**
 * Goals, beliefs, plans and episodes are thoughts about Things, not Things to
 * restructure: "say what Creative network and <a belief> are both kinds of"
 * is not a question. Structural moves skip them, and the furniture.
 */
const isContent = (world, id) => !!id && !world.druidOf(id).roleType && !world.typeChain(id).some(t => world.druidOf(t).roleType);
const titleish = (s) => String(s || '').trim().replace(/^(a|an|the)\s+/i, '').replace(/[.!?]+$/, '').replace(/^\w/, c => c.toUpperCase());

/**
 * Whether "a is a kind of b" makes sense, by the world's check (a contextless
 * helper call); true when there is no check or no usable answer. "Modern" was
 * once made a variant of House and given a copy of House's whole inside.
 */
async function isKindOf(world, a, b) {
  if (!world.check) return true;
  return (await world.isKindOf(a, b)) !== false;
}

// A kind is not given a copy of its kind's inside: it has those parts by
// being a kind of it (its carousel ladder). Copied, one long run held Ice's
// whole inside again in Ice cube, and Soil's in Loam and in Sandy soil.

export const variant = {
  id: 'variant',
  prior: 0.4,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !ctx.locus.web || !isContent(ctx.world, f.id)) return [];
    return [{ label: `imagine a variant of ${f.name}, named ___`, blank: { question: `Name a variant of ${f.name} (a version that differs in one way).`, maxWords: 4 }, data: { of: f.id }, target: f.id }];
  },
  async run(ctx, data, text) {
    const name = titleish(text);
    if (!name) return fail('no name');
    const { world } = ctx;
    if (name.toLowerCase() === world.nameOf(data.of).toLowerCase()) return fail(`a variant of ${name} has a name of its own`);
    if (!(await isKindOf(world, name, world.nameOf(data.of)))) return fail(`${name} is not a kind of ${world.nameOf(data.of)}, so it is no variant of it`);
    const how = await ctx.ask(`How is ${name} different from ${world.nameOf(data.of)}? One short sentence.`, 16);
    const r = await world.createThing(ctx.locus.web, name, { description: how ? `A variant of ${world.nameOf(data.of)}: ${how}` : `A variant of ${world.nameOf(data.of)}.`, fresh: true, noticed: true });
    if (!r.ok) return fail(r.error);
    // A variant is a kind of it, on its ladder, not a connection in this web.
    await world.addKind(r.id, data.of);
    return { ok: true, summary: `imagined ${name}, a variant of ${world.nameOf(data.of)}`, touched: [r.id, data.of], wrote: true };
  }
};

export const specialize = {
  id: 'specialize',
  prior: 0.5,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !ctx.locus.web || !isContent(ctx.world, f.id)) return [];
    return [{ label: `name a kind of ${f.name}: ___`, blank: { question: `Name one kind of ${f.name}.`, maxWords: 4 }, data: { of: f.id }, target: f.id }];
  },
  async run(ctx, data, text) {
    const name = titleish(text);
    if (!name) return fail('no name');
    const { world } = ctx;
    if (name.toLowerCase() === world.nameOf(data.of).toLowerCase()) return fail(`a kind of ${name} has a name of its own`);
    if (!(await isKindOf(world, name, world.nameOf(data.of)))) {
      // Asked for a kind of Argon, small models name what Argon is a kind of
      // ("noble gas"): taken the right way round, that is a kind too.
      if (world.check && !world.typeChain(data.of).some(t => world.nameOf(t).toLowerCase() === name.toLowerCase())
        && (await world.isKindOf(world.nameOf(data.of), name)) === true) {
        let parent = world.findThing(name);
        let made = false;
        if (!parent) {
          const p = await world.createThing(ctx.locus.web, name, { description: `What ${world.nameOf(data.of)} is a kind of.`, noticed: true });
          if (!p.ok) return fail(p.error);
          parent = p.id;
          made = !p.reused;
        }
        const k = await world.addKind(data.of, parent);
        // Refused, the kind it made for it goes too: "Kind of" stayed, and was connected to.
        if (!k.ok) { if (made) world.forget(parent); return fail(k.error); }
        return { ok: true, summary: `saw that ${world.nameOf(data.of)} is a kind of ${name}`, touched: [parent, data.of], wrote: true };
      }
      return fail(`${name} is not a kind of ${world.nameOf(data.of)}`);
    }
    const r = await world.createThing(ctx.locus.web, name, { typeNodeId: data.of, fresh: true, noticed: true });
    if (!r.ok) return fail(r.error);
    if (world.proto(r.id)?.typeNodeId !== data.of) world.state().setNodeType(r.id, data.of);
    world.writeLadders?.();
    const what = await ctx.ask(`What makes ${name} a particular kind of ${world.nameOf(data.of)}? One short sentence.`, 16);
    if (what) await world.act('updateNode', { nodeName: name, description: what, targetGraphId: r.web });
    return { ok: true, summary: `named ${name}, a kind of ${world.nameOf(data.of)}`, touched: [r.id, data.of], wrote: true };
  }
};

/**
 * The Things gathered into a Thing in a web (its Thing-groups): the Thing,
 * its members as Things, and whether the Thing has its title tab there.
 */
export function gatheredIn(world, webId) {
  const g = world.graph(webId);
  if (!g) return [];
  const all = (c) => (c instanceof Map ? [...c.values()] : Array.isArray(c) ? c : Object.values(c || {}));
  const protoOf = new Map(all(g.instances).map(i => [i.id, i.prototypeId]));
  return all(g.groups)
    .filter(gr => gr?.linkedNodePrototypeId && world.proto(gr.linkedNodePrototypeId))
    .map(gr => ({
      thing: gr.linkedNodePrototypeId,
      members: new Set((gr.memberInstanceIds || []).map(id => protoOf.get(id)).filter(Boolean)),
      anchored: protoOf.get(gr.anchorInstanceId) === gr.linkedNodePrototypeId
    }));
}

/**
 * What to gather, given what is already gathered: the same Things again is
 * nothing new (null); all of an existing gathering and more gathers that
 * Thing instead of its members, so the new one nests around it. Two
 * gatherings of the same Things were drawn one over the other, their titles
 * overlapping ("Temporary attachment" and "Stick-slip event", 2026-10-05).
 */
export function gatherable(world, webId, members) {
  let out = [...new Set(members)];
  const groups = gatheredIn(world, webId).sort((a, b) => b.members.size - a.members.size);
  for (const gr of groups) {
    const set = new Set(out);
    if (gr.members.size === set.size && [...gr.members].every(m => set.has(m))) return null;
    if (gr.anchored && gr.members.size >= 2 && gr.members.size < set.size && [...gr.members].every(m => set.has(m))) {
      out = [gr.thing, ...out.filter(m => !gr.members.has(m))];
    }
  }
  return out.length >= 2 ? out : null;
}

export const chunk = {
  id: 'chunk',
  // Below opening up: gathered only because they came up together, a run
  // made "Water" of Oxygen, Carbon and Carbon-12, and a second Protein.
  prior: 0.4,
  offer(ctx) {
    const { world, locus, tick } = ctx;
    const f = ctx.view.focus;
    if (!f || !locus.web || !isContent(world, f.id)) return [];
    const here = new Set(world.thingsIn(locus.web));
    const partners = Object.entries(world.druidOf(f.id).assoc || {})
      .map(([id, e]) => ({ id, s: assocStrength(e, tick) }))
      .filter(x => here.has(x.id) && x.s >= 0.35 && isContent(world, x.id))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);
    if (partners.length < 2) return [];
    const members = gatherable(world, locus.web, [f.id, ...partners.map(p => p.id)]);
    if (!members) return [];
    return [{ label: `gather ${members.map(id => world.nameOf(id)).join(', ')} into one Thing, named ___`, blank: { question: `These keep coming up together: ${members.map(id => world.nameOf(id)).join(', ')}. Name the one Thing they make up.`, maxWords: 4 }, data: { members }, target: f.id }];
  },
  async run(ctx, data, text) {
    const name = titleish(text);
    if (!name) return fail('no name');
    const { world } = ctx;
    // Named for one of them: the others are its parts, where the check agrees.
    // "Gather Atmosphere, Air, Gas into Atmosphere" was refused twice as a name clash.
    const among = data.members.find(id => normalizeName(world.nameOf(id)) === normalizeName(name));
    if (among) {
      const inside = world.ensureInside(among);
      const moved = [];
      for (const m of data.members.filter(id => id !== among)) {
        // Not a kind of it: "Down quark" was put inside Quarks.
        if (sameHead(world.nameOf(m), world.nameOf(among)) || world.typeChain(m).includes(among) || world.typeChain(among).includes(m)) continue;
        if ((await world.isPartOf(world.nameOf(m), world.nameOf(among))) === false) continue;
        if (world.insideOf(m) && world.thingsIn(world.insideOf(m)).includes(among)) continue;
        world.place(inside, m);
        moved.push(m);
      }
      if (!moved.length) return fail(`none of them is a part of ${world.nameOf(among)}`);
      return { ok: true, summary: `put ${moved.map(m => world.nameOf(m)).join(', ')} inside ${world.nameOf(among)}, as its parts`, touched: [among, ...moved], locus: { ...ctx.locus, focus: among }, wrote: true };
    }
    // By its name normalized too: "Protein" was gathered beside Proteins.
    if (world.findThing(name) || world.allThings().some(id => normalizeName(world.nameOf(id)) === normalizeName(name))) return fail(`${name} already exists; the gathered Thing needs a name of its own`);
    // A name of its own, not theirs run together: "Magma-Water".
    const theirs = new Set(data.members.flatMap(id => normalizeName(world.nameOf(id)).split(' ')));
    const words = normalizeName(name.replace(/[-/&+]/g, ' ')).split(' ').filter(w => !/^(and|of|the|with)$/.test(w));
    if (words.length >= 2 && words.every(w => theirs.has(w))) return fail(`"${name}" only puts their names together; name the one Thing they make up`);
    // Only what the new Thing is made of: gathered because they kept coming up
    // together, Cell and Nitrogen atoms became parts of a "Protein".
    const members = [];
    for (const m of data.members) if ((await world.isPartOf(world.nameOf(m), name)) !== false) members.push(m);
    if (members.length < 2) return fail(`${name} is not made of ${data.members.map(m => world.nameOf(m)).join(', ')}`);
    const same = gatheredIn(world, ctx.locus.web).find(gr => gr.members.size === members.length && members.every(m => gr.members.has(m)));
    if (same) return fail(`they already make up ${world.nameOf(same.thing)}; one whole is made of them, not two`);
    data = { ...data, members };
    const r = await world.act('condenseToNode', { memberNames: data.members.map(id => world.nameOf(id)), nodeName: name, collapse: false });
    if (!r.ok) return fail(r.error);
    const id = world.findThing(name);
    return { ok: true, summary: `gathered ${data.members.map(m => world.nameOf(m)).join(', ')} into ${name}`, touched: [id, ...data.members].filter(Boolean), locus: { ...ctx.locus, focus: id || ctx.locus.focus }, wrote: true };
  }
};

/** The web a web hangs from at the top (itself, when it is one): where claims about its Things are kept. */
function topWebOf(world, webId) {
  let web = webId;
  for (let i = 0; i < 12 && world.depthOf?.(web) > 0; i++) {
    const owner = world.ownerOf(web);
    const up = owner && world.websOf(owner).find(w => w !== web && !world.isSystemWeb(w) && world.depthOf(w) < world.depthOf(web));
    if (!up) break;
    web = up;
  }
  return web;
}

/** How two Things differ, from structure alone. */
export function differences(world, a, b, web) {
  const insideNames = (id) => new Set((world.insideOf(id) ? world.thingsIn(world.insideOf(id)) : []).map(x => world.nameOf(x)));
  const linkNames = (id) => new Set(world.linksIn(web).filter(l => l.a === id || l.b === id).map(l => `${l.relation} ${world.nameOf(l.a === id ? l.b : l.a)}`));
  const kinds = (id) => new Set(world.typeChain(id).map(t => world.nameOf(t)).filter(n => n && n !== 'Thing'));
  const out = [];
  for (const [label, fn] of [['made of', insideNames], ['connected', linkNames], ['a kind of', kinds]]) {
    const A = fn(a); const B = fn(b);
    const onlyA = [...A].filter(x => !B.has(x)); const onlyB = [...B].filter(x => !A.has(x));
    if (onlyA.length) out.push(`only ${world.nameOf(a)} is ${label}: ${onlyA.slice(0, 4).join(', ')}`);
    if (onlyB.length) out.push(`only ${world.nameOf(b)} is ${label}: ${onlyB.slice(0, 4).join(', ')}`);
  }
  return out;
}

export const contrast = {
  id: 'contrast',
  prior: 0.4,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !ctx.roles?.types.belief || !isContent(ctx.world, f.id)) return [];
    // Once per pair: "Mutual vs Friendship" was contrasted twice, ten moments apart.
    const done = (p) => [`${f.name} vs ${p.name}`, `${p.name} vs ${f.name}`].some(n => ctx.world.findThing(n));
    return ctx.view.peers
      .filter(p => isContent(ctx.world, p.id) && !done(p))
      .map(p => ({ p, shared: sharedWords(ctx.world, f.id, p.id) }))
      .sort((x, y) => y.shared.length - x.shared.length)
      .slice(0, 1)
      .map(({ p, shared }) => ({ label: `contrast ${f.name} with ${p.name}`, data: { a: f.id, b: p.id }, target: p.id, prior: shared.length ? 0.6 : 0.4 }));
  },
  async run(ctx, data) {
    const { world } = ctx;
    const diffs = differences(world, data.a, data.b, ctx.locus.web);
    const shown = diffs.length ? diffs.join('; ') : 'your universe records no difference between them yet';
    const key = await ctx.ask(`${world.nameOf(data.a)} and ${world.nameOf(data.b)} — ${shown}. In a few words, the key difference between them?`, 10);
    if (!key) return fail('no difference named');
    const claim = titleish(`${world.nameOf(data.a)} differs from ${world.nameOf(data.b)}: ${key}`);
    // A claim about two Things, kept in the web the topic hangs from, not
    // among the parts of whatever it stood inside ("Star vs Hydrogen" in Core).
    // A claim about two Things, kept with its beliefs: placed in a web, 33
    // "X vs Y" claims made a third of the largest web of one long run.
    const r = await world.createThing(world.beliefsWeb ? world.beliefsWeb() : topWebOf(world, ctx.locus.web), `${world.nameOf(data.a)} vs ${world.nameOf(data.b)}`, { description: `${claim}.${diffs.length ? ` ${shown}.` : ''}`, typeNodeId: ctx.roles.types.belief });
    if (!r.ok) return fail(r.error);
    world.setDruid(r.id, { claim });
    addEvidence(world, r.id, { source: data.a, judgment: 'support', kind: sourceKind(world, data.a), tick: ctx.tick });
    addEvidence(world, r.id, { source: data.b, judgment: 'support', kind: sourceKind(world, data.b), tick: ctx.tick });
    return { ok: true, summary: `contrasted them: ${key}`, touched: [r.id, data.a, data.b], wrote: true };
  }
};

export const generalize = {
  id: 'generalize',
  prior: 0.45,
  offer(ctx) {
    const { world } = ctx;
    const f = ctx.view.focus;
    if (!f || !isContent(world, f.id)) return [];
    const mine = new Set(world.typeChain(f.id));
    // Peers with no kind in common with the focus yet — and not its own parent
    // or child, which would ask what a Thing and its kind are "both kinds of".
    return ctx.view.peers
      .filter(p => isContent(world, p.id) && !mine.has(p.id) && !world.typeChain(p.id).includes(f.id)
        && !world.typeChain(p.id).some(t => mine.has(t) && world.nameOf(t) !== 'Thing'))
      .map(p => ({ p, shared: sharedWords(world, f.id, p.id) }))
      .sort((x, y) => y.shared.length - x.shared.length)
      .slice(0, 1)
      .map(({ p, shared }) => ({
        label: `say what ${f.name} and ${p.name} are both kinds of: ___`,
        blank: { question: `${f.name} and ${p.name} are both kinds of what?`, maxWords: 3 },
        data: { a: f.id, b: p.id }, target: p.id,
        // Apt when their descriptions already share a word ("animal").
        prior: shared.length ? 0.9 : 0.45
      }));
  },
  async run(ctx, data, text) {
    const name = titleish(text);
    if (!name) return fail('no name');
    const { world } = ctx;
    if (GENERIC_KIND.test(name)) return fail(`"${name}" is too general to be a kind; name what kind of thing they are`);
    for (const x of [data.a, data.b]) {
      if (!(await isKindOf(world, world.nameOf(x), name))) return fail(`${world.nameOf(x)} is not a kind of ${name}`);
    }
    let parent = world.findThing(name);
    if (!parent) {
      const r = await world.createThing(ctx.locus.web, name, { description: `What ${world.nameOf(data.a)} and ${world.nameOf(data.b)} both are.`, noticed: true });
      if (!r.ok) return fail(r.error);
      parent = r.id;
    }
    if (parent === data.a || parent === data.b) return fail('a Thing cannot be a kind of itself');
    const kinded = [];
    for (const x of [data.a, data.b]) { const k = await world.addKind(x, parent); if (k.ok || k.already) kinded.push(x); }
    if (!kinded.length) return fail(`${world.nameOf(data.a)} and ${world.nameOf(data.b)} already have kinds that ${name} does not fit`);
    return { ok: true, summary: `saw that ${world.nameOf(data.a)} and ${world.nameOf(data.b)} are both kinds of ${name}`, touched: [parent, data.a, data.b], wrote: true };
  }
};

/** Things elsewhere whose connections share relation names with the focus. */
export function analogues(world, focusId, k = 2) {
  const relsOf = (id) => {
    const out = new Set();
    for (const w of world.websOf(id)) for (const l of world.linksIn(w)) if (l.a === id || l.b === id) out.add(l.relation.toLowerCase());
    return out;
  };
  const mine = relsOf(focusId);
  if (mine.size < 2) return [];
  const myWebs = new Set(world.websOf(focusId));
  return world.allThings()
    .filter(id => id !== focusId && !world.websOf(id).some(w => myWebs.has(w)))
    .map(id => ({ id, shared: [...relsOf(id)].filter(r => mine.has(r)) }))
    .filter(x => x.shared.length >= 2)
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, k);
}

export const analogy = {
  id: 'analogy',
  prior: 0.5,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !isContent(ctx.world, f.id)) return [];
    return analogues(ctx.world, f.id, 1).filter(a => isContent(ctx.world, a.id)).map(a => ({ label: `consider whether ${f.name} is like ${ctx.world.nameOf(a.id)} (both: ${a.shared.join(', ')})`, data: { a: f.id, b: a.id, shared: a.shared }, target: a.id }));
  },
  async run(ctx, data) {
    const { world } = ctx;
    const key = await ctx.judge(`${world.nameOf(data.a)} and ${world.nameOf(data.b)} both have connections that ${data.shared.join(', ')}. Is ${world.nameOf(data.a)} really like ${world.nameOf(data.b)}?`, [
      { key: 'yes', label: 'yes, the likeness is real' },
      { key: 'partly', label: 'partly' },
      { key: 'no', label: 'no, it is only on the surface' }
    ]);
    if (!key) return fail('no judgment');
    if (key === 'no') return { ok: true, summary: `decided ${world.nameOf(data.a)} is not really like ${world.nameOf(data.b)}`, touched: [data.a], wrote: false };
    associate(world, [data.a, data.b], ctx.tick);
    if (key === 'yes') associate(world, [data.a, data.b], ctx.tick);
    return { ok: true, summary: `saw that ${world.nameOf(data.a)} is ${key === 'yes' ? '' : 'partly '}like ${world.nameOf(data.b)}`, touched: [data.a, data.b], wrote: true };
  }
};

/** Gaps in a web: Things with no description, unconnected, or much connected but never opened. */
export function gaps(world, webId) {
  const links = world.linksIn(webId);
  const degree = new Map();
  for (const l of links) { degree.set(l.a, (degree.get(l.a) || 0) + 1); degree.set(l.b, (degree.get(l.b) || 0) + 1); }
  const out = [];
  for (const id of world.thingsIn(webId)) {
    // Its furniture and its own webs (Working Memory, the Diary sit in Home)
    // are not gaps in what it knows: "wonder about Working Memory" was offered.
    if (world.druidOf(id).roleType || world.druidOf(id).system) continue;
    const p = world.proto(id);
    if (!p.description || p.description.length < 12) out.push({ id, why: 'no description yet' });
    else if (!degree.get(id)) out.push({ id, why: 'not connected to anything' });
    else if ((degree.get(id) || 0) >= 3 && !world.insideOf(id)) out.push({ id, why: 'much connected but never opened up' });
  }
  return out;
}

export const wonder = {
  id: 'wonder',
  prior: 0.4,
  offer(ctx) {
    if (!ctx.locus.web) return [];
    return gaps(ctx.world, ctx.locus.web).filter(g => g.id !== ctx.locus.focus).slice(0, 2)
      .map(g => ({ label: `wonder about ${ctx.world.nameOf(g.id)} (${g.why})`, data: { id: g.id }, target: g.id }));
  },
  async run(ctx, data) {
    return { ok: true, summary: `turned to ${ctx.world.nameOf(data.id)}`, touched: [data.id], locus: { ...ctx.locus, focus: data.id }, wrote: false };
  }
};

export const COGNITIVE_MOVES = [variant, specialize, chunk, contrast, generalize, analogy, wonder];

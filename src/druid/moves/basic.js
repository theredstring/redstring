/**
 * The basic moves: getting around and writing things down.
 *
 * A move is what the model sees as ONE option on a menu, and what code runs as
 * a chain of deterministic steps. Each move:
 *
 *   offer(ctx)              → menu items it can offer from here (may be none)
 *   run(ctx, data, text)    → { ok, summary, touched, locus?, wrote, error? }
 *
 * An item may carry a blank ({ question, maxWords }); its answer arrives as
 * `text`. A move that needs more than one answer asks for it itself through
 * ctx.ask / ctx.pick, so the model only ever answers one small question at a
 * time.
 *
 * ctx: { world, tick, locus, view, activation, held, ask, pick, judge }
 */

const titleish = (s) => String(s || '').trim().replace(/^(a|an|the)\s+/i, '').replace(/[.!?]+$/, '').replace(/^\w/, c => c.toUpperCase());

/**
 * A name blank answered with a list ("quartz, feldspar, mica") names several
 * Things, not one called that. On the lab's first run a 4B model did this two
 * times in five. Split it; callers that want one take the first.
 */
export const namesIn = (s) => {
  const text = String(s || '');
  // "and"/"or" only separate items in a list that also has commas, so
  // "Salt and Pepper" stays one Thing and "sand, rock, and mud" is three.
  const separators = /[,;\n]/.test(text) ? /,|;|\n|\band\b|\bor\b/i : /[,;\n]/;
  return text.split(separators).map(titleish).filter(n => n && n.split(/\s+/).length <= 5);
};

import { topLevelWebs, isHome } from '../attention.js';
import { isObject } from '../roles.js';
import { tokenize } from '../recall.js';

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });

export const newWeb = {
  id: 'newWeb',
  prior: 0.2,
  offer(ctx) {
    const empty = !ctx.locus.web;
    // A new web is offered once this one has something in it. Offered from an
    // empty web, a 4B model started three webs in four cycles and filled none.
    if (!empty && ctx.world.thingsIn(ctx.locus.web).length < 3) return [];
    // A Druid whose only web is its Home has nowhere of its own to think yet.
    const onlyHome = topLevelWebs(ctx.world).every(id => isHome(ctx.world, id));
    return [{ label: empty || onlyHome ? 'start your first web, named ___' : 'start a new web, named ___', blank: { question: 'Name the new web: what it will be about.', maxWords: 4 }, prior: empty ? 3 : onlyHome ? 1.3 : 0.2 }];
  },
  async run(ctx, _data, text) {
    const name = titleish(text);
    if (!name) return fail('no name');
    const r = await ctx.world.act('createGraph', { name });
    if (!r.ok) return fail(r.error);
    const web = [...ctx.world.state().graphs.values()].filter(g => g.name === name).pop()?.id;
    ctx.world.focusWeb(web);
    return { ok: true, summary: `started the web ${name}`, touched: [ctx.world.ownerOf(web)].filter(Boolean), locus: { web, focus: null, path: [] }, wrote: true };
  }
};

export const make = {
  id: 'make',
  prior: 1,
  offer(ctx) {
    if (!ctx.locus.web) return [];
    const f = ctx.view.focus && isObject(ctx.world, ctx.view.focus.id) ? ctx.view.focus : null;
    const near = f ? `, connected to ${f.name}` : '';
    return [{ label: `make a new Thing here${near}, named ___`, blank: { question: 'Name the new Thing.', maxWords: 4 }, data: { connectTo: f?.id || null }, prior: isHome(ctx.world, ctx.locus.web) ? 0.5 : 1 }];
  },
  async run(ctx, data, text) {
    const name = namesIn(text)[0];
    if (!name) return fail('no name');
    const { world, locus } = ctx;
    const r = await world.createThing(locus.web, name, { fresh: true });
    if (!r.ok) return fail(r.error);
    const touched = [r.id];
    // Not a part of what this web is the inside of: it went one level out.
    let summary = r.movedOut ? `made ${name} — not a part of ${world.nameOf(world.ownerOf(locus.web))}, so it went to ${world.graph(r.web)?.name}` : `made ${name}`;
    if (data?.connectTo && data.connectTo !== r.id && !r.movedOut) {
      const rel = await ctx.ask(`${world.nameOf(data.connectTo)} ___ ${name}. What is the relation? (a verb or short phrase)`, 3);
      if (rel) {
        const c = await connectSaying(ctx, data.connectTo, r.id, rel);
        if (c.ok) { summary += `: ${world.nameOf(data.connectTo)} ${c.relation} ${name}`; touched.push(data.connectTo); }
      }
    }
    const description = await ctx.ask(`Describe ${name} in one short sentence.`, 16);
    if (description) await world.act('updateNode', { nodeName: world.nameOf(r.id), description, targetGraphId: r.web });
    const web = r.web || locus.web;
    return { ok: true, summary, touched, locus: web === locus.web ? { ...locus, focus: r.id } : { web, focus: r.id, path: (locus.path || []).slice(0, -1) }, wrote: true };
  }
};

/**
 * Connect, and if the check finds the line does not make sense, ask once for
 * words that do. "River flows Delta" was refused (it is not a sentence) where
 * "River flows into Delta" was meant; "Dog is Cat" was refused and should be.
 */
export async function connectSaying(ctx, a, b, relation) {
  const { world } = ctx;
  let c = await world.connect(ctx.locus.web, a, b, relation);
  if (!c.ok && /does not make sense/.test(c.error || '')) {
    const again = await ctx.ask(`"${world.nameOf(a)} ${relation} ${world.nameOf(b)}" does not read as a true plain sentence. Give the relation as words that do (like "flows into"), or "none" if they are not related.`, 4);
    if (again && !/^none\b/i.test(again)) c = await world.connect(ctx.locus.web, a, b, again);
  }
  return c.ok ? { ...c, relation: c.relation || relation } : c;
}

export const connect = {
  id: 'connect',
  prior: 0.9,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !isObject(ctx.world, f.id)) return [];
    const linked = new Set(ctx.view.links.map(l => l.id));
    // Less tempting the more it already has: one Druid connected nine Things
    // with 27 links, most of them nonsense. Not offered past six.
    const degree = ctx.world.linksIn(ctx.locus.web).filter(l => l.a === f.id || l.b === f.id).length;
    if (degree >= 6) return [];
    // The relations it already uses, so it reuses one where it fits rather
    // than coining a near-synonym each time.
    const known = ctx.world.relationsInUse().filter(r => !/^then$/i.test(r)).slice(0, 6);
    const reuse = known.length ? ` Relations you already use: ${known.join(', ')}. Use one of them if it fits.` : '';
    return ctx.view.peers.filter(p => !linked.has(p.id) && isObject(ctx.world, p.id)).slice(0, 4).map(p => ({
      label: `connect ${f.name} to ${p.name}`,
      prior: 0.9 / (1 + degree / 2),
      blank: { question: `${f.name} ___ ${p.name}. What is the relation? (a verb or short phrase)${reuse}`, maxWords: 3 },
      data: { a: f.id, b: p.id },
      target: p.id
    }));
  },
  async run(ctx, data, text) {
    const rel = String(text || '').trim();
    if (!rel) return fail('no relation');
    const c = await connectSaying(ctx, data.a, data.b, rel);
    if (!c.ok) return fail(c.error);
    return { ok: true, summary: `${ctx.world.nameOf(data.a)} ${c.relation} ${ctx.world.nameOf(data.b)}`, touched: [data.a, data.b], wrote: true };
  }
};

export const follow = {
  id: 'follow',
  prior: 0.7,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f) return [];
    return ctx.view.links.map(l => ({
      label: l.out ? `go to ${l.name} (${f.name} ${l.relation} ${l.name})` : `go to ${l.name} (${l.name} ${l.relation} ${f.name})`,
      data: { to: l.id },
      target: l.id
    }));
  },
  async run(ctx, data) {
    return { ok: true, summary: `went to ${ctx.world.nameOf(data.to)}`, touched: [data.to], locus: { ...ctx.locus, focus: data.to }, wrote: false };
  }
};

export const look = {
  id: 'look',
  prior: 0.5,
  offer(ctx) {
    const items = ctx.view.peers.map(p => ({ label: `look at ${p.name}`, data: { at: p.id }, target: p.id }));
    for (const a of ctx.view.associated || []) {
      if (ctx.world.thingsIn(ctx.locus.web).includes(a.id)) items.push({ label: `look at ${a.name} (often in mind with ${ctx.view.focus.name})`, data: { at: a.id }, target: a.id });
    }
    return items;
  },
  async run(ctx, data) {
    return { ok: true, summary: `looked at ${ctx.world.nameOf(data.at)}`, touched: [data.at], locus: { ...ctx.locus, focus: data.at }, wrote: false };
  }
};

export const open = {
  id: 'open',
  prior: 0.8,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f) return [];
    if (f.inside && f.insideCount > 0) {
      return [{ label: `go inside ${f.name} (${f.insideCount} Thing${f.insideCount === 1 ? '' : 's'} there)`, data: { into: f.id } }];
    }
    if (!isObject(ctx.world, f.id)) return [];
    return [{ label: `open up ${f.name}: name one thing it is made of, ___`, blank: { question: `Name one part ${f.name} is made of.`, maxWords: 4 }, data: { into: f.id, create: true } }];
  },
  async run(ctx, data, text) {
    const { world, locus, activation } = ctx;
    const inside = world.ensureInside(data.into);
    if (!inside) return fail('could not open it');
    const path = [...(locus.path || []), data.into];
    if (data.create) {
      // Each part named becomes a Thing inside — a list is welcome here.
      // Nothing is a part of itself, or of what it sits inside: asked what
      // Flour is made of, a model answered "Flour".
      const enclosing = new Set([data.into, ...path].map(id => world.nameOf(id).trim().toLowerCase()));
      const named = namesIn(text);
      const names = named.filter(n => !enclosing.has(n.trim().toLowerCase())).slice(0, 4);
      if (names.length === 0) return fail(named.length ? `${named.join(', ')} cannot be a part of itself; name what it is made of` : 'no name');
      const made = [];
      for (const name of names) {
        const r = await world.createThing(inside, name);
        if (r.ok) made.push(r.id);
      }
      if (made.length === 0) return fail('could not make the parts');
      const first = made[0];
      const description = await ctx.ask(`Describe ${world.nameOf(first)}, as a part of ${world.nameOf(data.into)}, in one short sentence.`, 16);
      if (description) await world.act('updateNode', { nodeName: world.nameOf(first), description, targetGraphId: inside });
      world.focusWeb(inside);
      return { ok: true, summary: `opened up ${world.nameOf(data.into)} and found ${made.map(id => world.nameOf(id)).join(', ')} inside`, touched: [data.into, ...made], locus: { web: inside, focus: first, path }, wrote: true };
    }
    const first = world.thingsIn(inside).sort((a, b) => (activation.get(b) ?? -9) - (activation.get(a) ?? -9))[0] || null;
    world.focusWeb(inside);
    return { ok: true, summary: `went inside ${world.nameOf(data.into)}`, touched: [data.into, first].filter(Boolean), locus: { web: inside, focus: first, path }, wrote: false };
  }
};

export const close = {
  id: 'close',
  prior: 0.4,
  offer(ctx) {
    const c = ctx.view.container;
    if (!c) return [];
    const outer = ctx.world.websOf(c.id).filter(w => w !== ctx.locus.web && !ctx.world.isSystemWeb(w));
    if (outer.length === 0) return [];
    return [{ label: `step back out to ${c.name}`, data: { to: c.id, web: outer[0] } }];
  },
  async run(ctx, data) {
    const path = [...(ctx.locus.path || [])];
    if (path[path.length - 1] === data.to) path.pop();
    ctx.world.focusWeb(data.web);
    return { ok: true, summary: `stepped back out to ${ctx.world.nameOf(data.to)}`, touched: [data.to], locus: { web: data.web, focus: data.to, path }, wrote: false };
  }
};

export const describe = {
  id: 'describe',
  prior: 0.6,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f) return [];
    const thin = !f.description || f.description.length < 25;
    return [{ label: thin ? `describe ${f.name}: ___` : `redescribe ${f.name} as you understand it now: ___`, blank: { question: `Describe ${f.name} in one sentence.`, maxWords: 20 }, data: { id: f.id }, prior: thin ? 1.1 : 0.25 }];
  },
  async run(ctx, data, text) {
    if (!text) return fail('no description');
    const r = await ctx.world.act('updateNode', { nodeName: ctx.world.nameOf(data.id), description: text, targetGraphId: ctx.locus.web });
    if (!r.ok) return fail(r.error);
    return { ok: true, summary: `described ${ctx.world.nameOf(data.id)}: ${text}`, touched: [data.id], wrote: true };
  }
};

export const goWeb = {
  id: 'goWeb',
  prior: 0.3,
  offer(ctx) {
    // Only webs that are not the inside of something placed elsewhere: those
    // are reached by going inside. Offering "go to the web Engine" beside "go
    // inside Engine" gave the same place two names.
    const { world } = ctx;
    const top = new Set(topLevelWebs(world));
    return (ctx.view.webs || []).filter(w => top.has(w.id)).slice(0, 3).map(w => ({ label: `go to the web ${w.name}`, data: { web: w.id }, target: world.ownerOf(w.id) }));
  },
  async run(ctx, data) {
    ctx.world.focusWeb(data.web);
    return { ok: true, summary: `went to the web ${ctx.world.graph(data.web)?.name}`, touched: [ctx.world.ownerOf(data.web)].filter(Boolean), locus: { web: data.web, focus: null, path: [] }, wrote: false };
  }
};

export const letGoMove = {
  id: 'letGo',
  prior: 0.3,
  offer(ctx) {
    return ctx.held.filter(h => h.id !== ctx.locus.focus).slice(0, 2).map(h => ({ label: `let go of ${ctx.world.nameOf(h.id)}`, data: { id: h.id }, target: h.id }));
  },
  async run(ctx, data) {
    const name = ctx.world.nameOf(data.id);
    ctx.release(data.id);
    return { ok: true, summary: `let go of ${name}`, touched: [], wrote: false, released: [data.id] };
  }
};

export const note = {
  id: 'note',
  prior: 0.35,
  offer() {
    return [{ label: 'note a half-formed thought to hold onto: ___', blank: { question: 'The thought, in a few words.', maxWords: 6 } }];
  },
  async run(ctx, _data, text) {
    if (!text) return fail('no thought');
    const r = await ctx.scratch(text);
    if (!r?.ok) return fail(r?.error || 'could not note it');
    return { ok: true, summary: `noted a thought: ${text}`, touched: [r.id], wrote: false };
  }
};

export const promoteMove = {
  id: 'promote',
  prior: 0.8,
  offer(ctx) {
    if (!ctx.locus.web) return [];
    return ctx.held.filter(h => h.scratch).slice(0, 2).map(h => ({ label: `make "${ctx.world.nameOf(h.id)}" a lasting Thing in this web`, data: { id: h.id }, target: h.id }));
  },
  async run(ctx, data) {
    if (!ctx.promote(data.id, ctx.locus.web)) return fail('could not promote it');
    return { ok: true, summary: `kept the thought "${ctx.world.nameOf(data.id)}"`, touched: [data.id], locus: { ...ctx.locus, focus: data.id }, wrote: true };
  }
};

/** Content words in a thought that no Thing in the universe is named by. */
export function unkeptWords(world, thought) {
  const names = world.allThings().map(id => world.nameOf(id).toLowerCase());
  return [...new Set(tokenize(thought))].filter(w => w.length > 3 && !names.some(n => n.includes(w) || w.includes(n.replace(/s$/, ''))));
}

/** The web new knowledge should go to: this one, unless this is Home — then the last content web visited. */
function contentWebFor(ctx) {
  const { world, locus } = ctx;
  if (locus.web && !isHome(world, locus.web)) return locus.web;
  return topLevelWebs(world).filter(id => !isHome(world, id)).pop() || null;
}

/**
 * Keep what you just thought — the bridge from the phonological loop to
 * long-term memory. On a seeded run Apple's on-device model thought, cycle
 * after cycle, "rivers carve valleys by eroding hills and depositing
 * sediments" — and its graph held one Thing. Thoughts that name what the
 * universe does not hold are offered back as Things to keep.
 */
export const remember = {
  id: 'remember',
  prior: 0.8,
  offer(ctx) {
    const web = contentWebFor(ctx);
    const thought = ctx.lastThought || '';
    if (!web || !thought) return [];
    const unkept = unkeptWords(ctx.world, thought);
    if (unkept.length < 2) return [];
    return [{
      label: `keep what you just thought: name the Things in it worth remembering, ___`,
      blank: { question: `You just thought: "${thought}". Name up to three Things in that thought worth keeping, separated by commas.`, maxWords: 12 },
      data: { web },
      prior: unkept.length >= 4 ? 1.2 : 0.8
    }];
  },
  async run(ctx, data, text) {
    const { world } = ctx;
    const names = namesIn(text).slice(0, 3);
    if (names.length === 0) return fail('nothing named');
    const made = [];
    for (const name of names) {
      const r = await world.createThing(data.web, name);
      if (r.ok) made.push(r.id);
    }
    if (made.length === 0) return fail('could not keep them');
    for (const id of made) {
      if ((world.proto(id)?.description || '').length < 12) {
        const d = await ctx.ask(`Describe ${world.nameOf(id)} in one short sentence, as you understand it.`, 16);
        if (d) await world.act('updateNode', { nodeName: world.nameOf(id), description: d, targetGraphId: data.web });
      }
    }
    world.focusWeb(data.web);
    return { ok: true, summary: `kept ${made.map(id => world.nameOf(id)).join(', ')} from that thought`, touched: made, locus: { web: data.web, focus: made[0], path: [] }, wrote: true };
  }
};

export const BASIC_MOVES = [newWeb, make, connect, follow, look, open, close, describe, goWeb, letGoMove, note, promoteMove, remember];

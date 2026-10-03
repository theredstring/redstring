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

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });

export const newWeb = {
  id: 'newWeb',
  prior: 0.2,
  offer(ctx) {
    const empty = !ctx.locus.web;
    // A new web is offered once this one has something in it. Offered from an
    // empty web, a 4B model started three webs in four cycles and filled none.
    if (!empty && ctx.world.thingsIn(ctx.locus.web).length < 3) return [];
    return [{ label: empty ? 'start your first web, named ___' : 'start a new web, named ___', blank: { question: 'Name the new web.', maxWords: 4 }, prior: empty ? 3 : 0.2 }];
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
    const near = ctx.view.focus ? `, connected to ${ctx.view.focus.name}` : '';
    return [{ label: `make a new Thing here${near}, named ___`, blank: { question: 'Name the new Thing.', maxWords: 4 }, data: { connectTo: ctx.view.focus?.id || null } }];
  },
  async run(ctx, data, text) {
    const name = namesIn(text)[0];
    if (!name) return fail('no name');
    const { world, locus } = ctx;
    const r = await world.createThing(locus.web, name);
    if (!r.ok) return fail(r.error);
    const touched = [r.id];
    let summary = `made ${name}`;
    if (data?.connectTo && data.connectTo !== r.id) {
      const rel = await ctx.ask(`${world.nameOf(data.connectTo)} ___ ${name}. What is the relation? (a verb or short phrase)`, 3);
      if (rel) {
        const c = await world.connect(locus.web, data.connectTo, r.id, rel);
        if (c.ok) { summary += `: ${world.nameOf(data.connectTo)} ${rel} ${name}`; touched.push(data.connectTo); }
      }
    }
    const description = await ctx.ask(`Describe ${name} in one short sentence.`, 16);
    if (description) await world.act('updateNode', { nodeName: name, description, targetGraphId: locus.web });
    return { ok: true, summary, touched, locus: { ...locus, focus: r.id }, wrote: true };
  }
};

export const connect = {
  id: 'connect',
  prior: 0.9,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f) return [];
    const linked = new Set(ctx.view.links.map(l => l.id));
    return ctx.view.peers.filter(p => !linked.has(p.id)).slice(0, 4).map(p => ({
      label: `connect ${f.name} to ${p.name}`,
      blank: { question: `${f.name} ___ ${p.name}. What is the relation? (a verb or short phrase)`, maxWords: 3 },
      data: { a: f.id, b: p.id },
      target: p.id
    }));
  },
  async run(ctx, data, text) {
    const rel = String(text || '').trim();
    if (!rel) return fail('no relation');
    const c = await ctx.world.connect(ctx.locus.web, data.a, data.b, rel);
    if (!c.ok) return fail(c.error);
    return { ok: true, summary: `${ctx.world.nameOf(data.a)} ${rel} ${ctx.world.nameOf(data.b)}`, touched: [data.a, data.b], wrote: true };
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
    return [{ label: `open up ${f.name}: name one thing it is made of, ___`, blank: { question: `Name one part ${f.name} is made of.`, maxWords: 4 }, data: { into: f.id, create: true } }];
  },
  async run(ctx, data, text) {
    const { world, locus, activation } = ctx;
    const inside = world.ensureInside(data.into);
    if (!inside) return fail('could not open it');
    const path = [...(locus.path || []), data.into];
    if (data.create) {
      // Each part named becomes a Thing inside — a list is welcome here.
      const names = namesIn(text).slice(0, 4);
      if (names.length === 0) return fail('no name');
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
    const topLevel = (id) => { const owner = world.ownerOf(id); return !owner || world.websOf(owner).filter(w => !world.isSystemWeb(w)).length === 0; };
    return (ctx.view.webs || []).filter(w => topLevel(w.id)).slice(0, 3).map(w => ({ label: `go to the web ${w.name}`, data: { web: w.id }, target: world.ownerOf(w.id) }));
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

export const BASIC_MOVES = [newWeb, make, connect, follow, look, open, close, describe, goWeb, letGoMove, note, promoteMove];

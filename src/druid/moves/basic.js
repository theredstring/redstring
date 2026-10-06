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
  // An item with a verb is a thought, not a name: "Carbon dioxide produces Argon".
  // A name, not the clause after it: "H2O molecules arranged in a hexagonal lattice".
  const clip = (n) => String(n).replace(/\s+(?:arranged|found|located|formed|made|held|bound|linked|that|which|who|where|in\s+a|in\s+the)\b.*$/i, '');
  return text.split(separators).map(n => titleish(asSubject(clip(n)))).filter(n => n && n.split(/\s+/).length <= 5 && !VAGUE.test(n) && !(n.split(/\s+/).length >= 3 && hasVerb(n)));
};

import { topLevelWebs, isOwnPlace } from '../attention.js';
import { isObject, isBookkeeping, roleOf } from '../roles.js';
import { relationFromSentence } from '../relations.js';
import { namedIn as namedInThought } from '../talk.js';
import { tokenize } from '../recall.js';
import { aboutTheMedium, asSubject, normalizeName, wordsIn, hasVerb, isAspect, isDoing } from '../names.js';

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });

export const newWeb = {
  id: 'newWeb',
  prior: 0.2,
  offer(ctx) {
    const empty = !ctx.locus.web;
    // A new web is offered once this one has something in it. Offered from an
    // empty web, a 4B model started three webs in four cycles and filled none.
    // Home and the insides of its goals and plans are not such webs.
    if (!empty && !isOwnPlace(ctx.world, ctx.locus.web) && ctx.world.thingsIn(ctx.locus.web).length < 3) return [];
    // A Druid whose only web is its Home has nowhere of its own to think yet.
    const onlyHome = topLevelWebs(ctx.world).every(id => isOwnPlace(ctx.world, id));
    return [{ label: empty || onlyHome ? 'start your first web, named ___' : 'start a new web, named ___', blank: { question: 'Name the new web: a subject in the world it will be about.', maxWords: 4 }, prior: empty ? 3 : onlyHome ? 1.3 : 0.2 }];
  },
  async run(ctx, _data, text) {
    const name = titleish(asSubject(text));
    if (!name) return fail('no name');
    if (aboutTheMedium(name, ctx.world.personWords)) return fail(`"${name}" is about this place itself, not the world; name something in the world`);
    // A subject, not an aspect of every subject: a web named "Structure" filled with "Components, Patterns".
    if (isAspect(name) || isDoing(name)) return fail(`"${name}" is no subject of its own; name something in the world`);
    // A web of that name already: go there. Started again, "Why do people cry"
    // was two webs, and sleep merged one into the goal of the same name.
    const { world } = ctx;
    const same = [...world.state().graphs.values()].find(g => normalizeName(g.name) === normalizeName(name) && !isOwnPlace(world, g.id));
    if (same) {
      world.focusWeb(same.id);
      return { ok: true, summary: `went to the web ${same.name}, which is already there`, touched: [world.ownerOf(same.id)].filter(Boolean), locus: { web: same.id, focus: null, path: [] }, wrote: false };
    }
    const r = await ctx.world.act('createGraph', { name });
    if (!r.ok) return fail(r.error);
    const web = [...ctx.world.state().graphs.values()].filter(g => g.name === name).pop()?.id;
    // A web started as a topic is not the inside of a Thing that happens to
    // share its name: no part checks there (world.js, tidy.js).
    const owner = ctx.world.ownerOf(web);
    if (owner) ctx.world.setDruid(owner, { topic: true, madeBy: 'druid' });
    // What sort of subject it is decides how it is filled (openAsk).
    if (owner) await ctx.world.classify?.(owner);
    // Its Thing goes in Home, so the web is found by opening Home.
    ctx.world.shelve?.(web);
    ctx.world.focusWeb(web);
    return { ok: true, summary: `started the web ${name}`, touched: [ctx.world.ownerOf(web)].filter(Boolean), locus: { web, focus: null, path: [] }, wrote: true };
  }
};

/**
 * ", as it is in Snowflake formation": the subject a description is written
 * within. Asked about the name alone, "Slip before break" was "a hacker who
 * exploited vulnerabilities in the web", and "Water hits tip" an exhilarating
 * waterfall hike (Druid Test 10, 2026-10-05).
 */
function asIn(world, name, web) {
  const subject = web && world.topicOf ? world.topicOf(web) : null;
  return subject && subject.trim().toLowerCase() !== String(name).trim().toLowerCase() ? `, as it is in ${subject},` : '';
}

export const make = {
  id: 'make',
  prior: 1,
  offer(ctx) {
    const { world, locus } = ctx;
    if (!locus.web) return [];
    // A web is its Thing opened up, so what is made here is one of what makes
    // that Thing up, and is asked for as that. Not at Home or in its own
    // places (folders of webs, goals and steps): a new subject is a new web.
    if (isOwnPlace(world, locus.web)) return [];
    const whole = world.ownerOf(locus.web);
    if (!whole) return [];
    const schema = world.schemaOf ? world.schemaOf(whole) : 'parts';
    // A process's stages come in order, from opening it up (openStages).
    if (schema === 'stages') return [];
    const W = world.nameOf(whole);
    const question = schema === 'material' ? `Name something else ${W} is made of.`
      : schema === 'elements' ? `Name something else that makes up ${W}.`
      : `Name another part of ${W}, one you could point to on ${W} itself.`;
    const f = ctx.view.focus && isObject(world, ctx.view.focus.id) ? ctx.view.focus : null;
    const near = f ? `, connected to ${f.name}` : '';
    return [{ label: `add a part to ${W}${near}, named ___`, blank: { question, maxWords: 4 }, data: { connectTo: f?.id || null } }];
  },
  async run(ctx, data, text) {
    // One Thing: "Nitrogen and Methane" is two, and the first is made.
    const name = namesIn(text)[0]?.split(/\s+and\s+(?=[A-Z])/)[0];
    if (!name) return fail('no name');
    const { world, locus } = ctx;
    const r = await world.createThing(locus.web, name, { fresh: true });
    if (!r.ok) return fail(r.error);
    const touched = [r.id];
    // Named like a kind of the whole ("Up quark" in Quarks): on its ladder, noticed.
    let summary = r.kindOf ? `named ${name}, a kind of ${world.nameOf(r.kindOf)}, not a part of it` : `added ${name} to ${world.nameOf(world.ownerOf(locus.web))}`;
    if (data?.connectTo && data.connectTo !== r.id && !r.noticed) {
      const rel = await ctx.ask(`How do ${world.nameOf(data.connectTo)} and ${name} relate? Say it as one short plain sentence that names both.`, 12);
      if (rel) {
        const c = await connectSaying(ctx, data.connectTo, r.id, rel);
        if (c.ok) {
          const [from, to] = c.from ? [c.from, c.to] : c.reversed ? [r.id, data.connectTo] : [data.connectTo, r.id];
          summary += `: ${c.summary || `${world.nameOf(from)} ${c.relation} ${world.nameOf(to)}`}`;
          touched.push(data.connectTo);
        }
      }
    }
    const description = await ctx.ask(`Describe ${name}${asIn(world, name, locus.web)} in one short sentence.`, 16);
    if (description) await world.act('updateNode', { nodeName: world.nameOf(r.id), description, targetGraphId: r.web });
    return { ok: true, summary, touched, locus: r.noticed ? locus : { ...locus, focus: r.id }, wrote: true };
  }
};

/**
 * Connect, and if the check finds the line does not make sense, ask once for
 * words that do. "River flows Delta" was refused (it is not a sentence) where
 * "River flows into Delta" was meant; "Dog is Cat" was refused and should be.
 */
const KIND_REL = /^(is|are)\s+(a\s+|an\s+)?(kind|type|sort|form|variety)s?\s+of$/i;
const PART_REL = /^(is|are)\s+(a\s+|an\s+|the\s+)?(part|parts|component|components|piece|pieces|building\s+blocks?|ingredients?)\s+of$|^(make|makes)\s+up$/i;
const CONTAIN_REL = /^(contains?|includes?|holds?)$/i;
const WITHIN_REL = /\b(within|inside)$/i;
const MADE_REL = /^((is|are)\s+)?(made|composed|built|formed)\s+(up\s+)?(of|from)$|^consists?\s+of$/i;

/**
 * "X is a kind of Y" and "X is a part of Y" are structure, not connections:
 * the first gives X its kind, the second puts X inside Y, each when the check
 * agrees. As a link, "Electron is a kind of Proton" went unchecked.
 */
async function asStructure(ctx, x, y, relation) {
  const { world } = ctx;
  const [xn, yn] = [world.nameOf(x), world.nameOf(y)];
  // A bare "are" is a kind: "Amino acids are Nucleotides".
  if (/^(is|are)(\s+(a|an))?$/i.test(relation)) return asStructure(ctx, x, y, 'is a kind of');
  // "Cell contains Proteins": a part, when it is one; otherwise checked as a sentence.
  if (CONTAIN_REL.test(relation)) {
    if ((await world.isPartOf(yn, xn)) === true) return asStructure(ctx, y, x, 'is a part of');
    if (world.check && (await world.check(`${xn} ${relation} ${yn}`).catch(() => null)) === false) return { ok: false, error: `"${xn} ${relation} ${yn}" does not make sense` };
    return null;
  }
  if (KIND_REL.test(relation)) {
    if (world.typeChain(x).includes(y)) return { ok: false, error: `${xn} is already a kind of ${yn}` };
    if ((await world.isKindOf(xn, yn)) === false) return { ok: false, error: `${xn} is not a kind of ${yn}` };
    const k = await world.addKind(x, y);
    if (!k.ok) return { ok: false, error: k.error };
    return { ok: true, relation: 'is a kind of', structure: 'kind', from: x, to: y };
  }
  // "Electrons are particles that make up Hydrogen atoms": a part.
  if (!PART_REL.test(relation) && /\b(makes?\s+up|(?:a\s+)?parts?\s+of|components?\s+of|building\s+blocks?\s+of)$/i.test(relation)) return asStructure(ctx, x, y, 'is a part of');
  // "Galaxy is composed of Dark matter": Dark matter is a part of Galaxy.
  if (MADE_REL.test(relation)) return asStructure(ctx, y, x, 'is a part of');
  // "Neutrons are subatomic particles within Protons": a part, if it is one;
  // otherwise it stays a connection.
  if (WITHIN_REL.test(relation) && (await world.isPartOf(xn, yn)) === true) return asStructure(ctx, x, y, 'is a part of');
  if (PART_REL.test(relation)) {
    if ((await world.isPartOf(xn, yn)) === false) return { ok: false, error: `${xn} is not a part of ${yn}` };
    if (world.insideOf(x) && world.thingsIn(world.insideOf(x)).includes(y)) return { ok: false, error: `${yn} is already a part of ${xn}` };
    world.place(world.ensureInside(y), x);
    return { ok: true, relation: 'is a part of', structure: 'part', from: x, to: y };
  }
  return null;
}

/** Words that only mean this place, in a relation ("is home to", "links" mean things in the world). */
const MEDIUM_IN_RELATION = /^(webs?|nodes?|graphs?|redstring|descriptions?|navigation)$/i;

/** Too general to be a kind: everything is one. */
export const GENERIC_KIND = /^(parts?|components?|pieces?|things?|objects?|items?|stuff|aspects?|features?|entities|entity|concepts?|factors?|building blocks?)$/i;

const DIFFER_REL = /^(is|are)\s+(different|distinct|separate)\s+from$|^(is|are)\s+not\b|^differs?\s+from$/i;

/**
 * "A and B are (both) C": each a kind of C, where the check agrees. The
 * commonest answer a small model gives when asked how two Things relate,
 * and the one most often thrown away.
 */
async function bothKindsOf(ctx, a, b, said) {
  const { world } = ctx;
  const words = String(said || '').replace(/[.!?]+$/, '');
  const [an, bn] = [world.nameOf(a), world.nameOf(b)];
  const m = /^(.+?)\s+and\s+(.+?)\s+are\s+(?:both\s+)?(?:(?:kinds?|types?|forms?|sorts?)\s+of\s+)?(.+)$/i.exec(words);
  if (!m) return null;
  // "Both composed of molecules" is what they are made of, not a kind.
  if (/^(?:both\s+)?(?:composed|made|formed|built|found|located|used|seen|known|related|connected)\b/i.test(m[3])) return null;
  const same = (x, n) => normalizeName(x.replace(/^(the|a|an)\s+/i, '')) === normalizeName(n);
  if (!((same(m[1], an) && same(m[2], bn)) || (same(m[1], bn) && same(m[2], an)))) return null;
  // "Both parts of Neurons": both inside Neurons, not kinds of "Parts".
  const partsOf = /^(?:the\s+)?(?:parts?|components?|pieces?|building\s+blocks?|ingredients?)\s+of\s+(?:a\s+|an\s+|the\s+)?(.+)$/i.exec(m[3]);
  if (partsOf) {
    const whole = world.findThing(asSubject(partsOf[1].split(/\s+(?:that|which|who|where|with|because)\b|,/i)[0]));
    if (!whole || whole === a || whole === b) return null;
    const placed = [];
    for (const x of [a, b]) {
      if ((await world.isPartOf(world.nameOf(x), world.nameOf(whole))) === false) continue;
      if (world.insideOf(x) && world.thingsIn(world.insideOf(x)).includes(whole)) continue;
      world.place(world.ensureInside(whole), x);
      placed.push(x);
    }
    if (!placed.length) return { ok: false, error: `neither ${an} nor ${bn} is a part of ${world.nameOf(whole)}` };
    return { ok: true, relation: `are parts of ${world.nameOf(whole)}`, structure: 'part', summary: `${placed.map(x => world.nameOf(x)).join(' and ')} ${placed.length > 1 ? 'are parts' : 'is a part'} of ${world.nameOf(whole)}` };
  }
  // The kind is the noun phrase before any clause: "simple sugars that are building blocks".
  const kind = asSubject(m[3].split(/\s+(?:that|which|who|where|with|in|of|from|because|found|located|used|seen|known|made|called)\b|,/i)[0].replace(/^(a|an|the|both)\s+/i, '').trim());
  if (!kind || wordsIn(kind).length > 3 || /^(different|related|connected|similar|alike|the same|interconnected)\b/i.test(kind)) return null;
  if (GENERIC_KIND.test(kind)) return { ok: false, error: `"${kind}" is too general to be a kind; say what kind of thing ${an} and ${bn} are` };
  const name = kind.charAt(0).toUpperCase() + kind.slice(1);
  for (const n of [an, bn]) {
    if ((await world.isKindOf(n, name)) === false) return { ok: false, error: `${n} is not a kind of ${name}` };
  }
  let parent = world.findThing(name);
  if (parent === a || parent === b) return null;
  if (parent && world.typeChain(a).includes(parent) && world.typeChain(b).includes(parent)) return { ok: false, error: `${an} and ${bn} are already both kinds of ${world.nameOf(parent)}` };
  if (!parent) {
    const r = await world.createThing(ctx.locus.web, name, { description: `What ${an} and ${bn} both are.`, noticed: true });
    if (!r.ok) return { ok: false, error: r.error };
    parent = r.id;
  }
  const made = [];
  for (const x of [a, b]) { const k = await world.addKind(x, parent); if (k.ok || k.already) made.push(x); }
  if (!made.length) return { ok: false, error: `${an} and ${bn} already have kinds that ${name} does not fit` };
  return { ok: true, relation: `are both kinds of ${name}`, structure: 'kind', summary: `${an} and ${bn} are both kinds of ${name}` };
}

/** Relations that say nothing about how two Things relate: "Quantum field is about Superposition". */
const EMPTY_REL = /^(is|are)\s+(about|related\s+to|connected\s+to|linked\s+to|associated\s+with)$|^(relates?|connects?|links?)\s+(to|with)$|^(involves?|concerns?)$/i;
/** Relations that say only that one acts on the other: kept, but asked once for something sharper. */
export const GENERIC_REL = /^(impacts?|affects?|influences?|(is|are)\s+(important|essential|necessary)\s+(to|for)|interacts?\s+with|depends?\s+on)$/i;
const stem = (w) => normalizeName(w).replace(/(ions?|ing|ed|es|s|e)$/, '');

/**
 * Why a relation says nothing, or null: empty ("is about"), or only the name of
 * one of them again ("Gluons interact with Interaction", "Causes cause Magnitude").
 */
export function emptyRelation(relation, aName, bName) {
  const rel = String(relation || '').trim();
  if (EMPTY_REL.test(rel)) return `"${rel}" does not say how ${aName} and ${bName} relate; say what one does to or has of the other`;
  const nameStems = [aName, bName].flatMap(n => wordsIn(n)).map(stem).filter(x => x.length >= 4);
  const echo = wordsIn(rel).map(stem).find(w => w.length >= 4 && nameStems.includes(w));
  if (echo) return `"${rel}" only repeats a name; say how ${aName} and ${bName} relate in other words`;
  return null;
}

/**
 * Asked once more, as a blank between the names: told how two Things relate, a
 * small model says what they share ("Particles and Energy are fundamental to
 * quantum mechanics") about one time in three, or only that one "impacts" the
 * other. `error` is what to say if the answer is no better (null: just no).
 */
async function askAgain(ctx, a, b, error) {
  const { world } = ctx;
  const no = { ok: false, error: error || 'no sharper relation' };
  if (!ctx.ask) return no;
  const again = await ctx.ask(`Give the words that make "${world.nameOf(a)} ___ ${world.nameOf(b)}" a true plain sentence saying what one does to or has of the other, or "none" if neither does anything to the other.`, 4);
  if (!again || /^none\b/i.test(again.trim())) return no;
  const c = await connectSaying(ctx, a, b, again, { retried: true });
  return c.ok ? c : { ...no, error: error || c.error };
}

export async function connectSaying(ctx, a, b, saidWhole, { retried = false } = {}) {
  const { world } = ctx;
  // The first sentence: "Cosmic constant and Matter are different. Cosmic
  // constant is…" gave the relation "are different. Cosmic constant".
  const said = String(saidWhole || '').trim().split(/(?<=[.!?])\s+/)[0];
  // A sentence ("Bones support the feet") gives the relation by what lies
  // between the names; a fragment is taken as the relation itself.
  const fromSentence = relationFromSentence(said, world.nameOf(a), world.nameOf(b));
  // Said the other way round ("Screwdrivers drive screws into Boards"): connect it that way.
  const backward = !fromSentence && relationFromSentence(said, world.nameOf(b), world.nameOf(a));
  // "Glucose and Fructose are both simple sugars": both kinds of Simple sugars.
  const both = await bothKindsOf(ctx, a, b, said);
  // Refused ("Dust is not a kind of Minerals"), how they relate is still unsaid: asked once.
  if (both && !both.ok && !retried) return askAgain(ctx, a, b, both.error);
  if (both) return both;
  // How they differ is a contrast, not a connection: "Dark energy is different from Matter".
  if (DIFFER_REL.test(backward || fromSentence || '')) return { ok: false, error: `a connection says how ${world.nameOf(a)} and ${world.nameOf(b)} relate, not that they differ; contrast them instead` };
  const structural = await asStructure(ctx, backward ? b : a, backward ? a : b, backward || fromSentence || String(said || '').trim());
  if (structural) return structural.ok ? { ...structural, reversed: !!backward } : structural;
  if (backward) {
    const empty = emptyRelation(backward, world.nameOf(b), world.nameOf(a));
    if (empty) return retried ? { ok: false, error: empty } : askAgain(ctx, a, b, empty);
    if (GENERIC_REL.test(backward) && !retried) {
      const sharper = await askAgain(ctx, a, b, null);
      if (sharper.ok) return sharper;
    }
    const c = await world.connect(ctx.locus.web, b, a, backward, { fromSentence: true });
    return c.ok ? { ...c, relation: c.relation || backward, reversed: true } : c;
  }
  // A sentence that is not one relation between them is not a relation either.
  if (!fromSentence && String(said || '').trim().split(/\s+/).length > 4) {
    // Asked once more, as a blank between the names: told how they relate, a
    // small model says what they share ("Particles and Energy are fundamental
    // to quantum mechanics") about one time in three.
    const error = `could not tell from "${String(said).trim()}" how ${world.nameOf(a)} relates to ${world.nameOf(b)}`;
    return retried ? { ok: false, error } : askAgain(ctx, a, b, error);
  }
  // A fragment is the relation, without the names it may repeat: "Feelings
  // expressed physically" made "Feelings Feelings expressed physically Physical expression".
  const bare = (t) => {
    let r = String(t || '').trim().replace(/[.!?]+$/, '');
    for (const n of [world.nameOf(a), world.nameOf(b)]) r = r.replace(new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?=\\s|$)`, 'ig'), ' ');
    return r.replace(/\s+/g, ' ').trim();
  };
  // A fragment that names only one of them is about that one, not how they relate:
  // "Energy is matter", asked how Mass and Energy relate.
  if (!fromSentence) {
    const has = (n) => normalizeName(said).includes(normalizeName(n));
    if (has(world.nameOf(a)) !== has(world.nameOf(b))) return { ok: false, error: `"${String(said).trim()}" is not how ${world.nameOf(a)} and ${world.nameOf(b)} relate` };
  }
  const relation = fromSentence || bare(said);
  if (relation && wordsIn(relation).length > 4) return { ok: false, error: `"${relation}" is too long for a relation; say how ${world.nameOf(a)} and ${world.nameOf(b)} relate in a word or two` };
  // Not naming a third Thing: "orbit protons in", reused, made "Quarks orbit protons in Gluons".
  const others = world.thingsIn(ctx.locus.web).filter(id => id !== a && id !== b).map(id => normalizeName(world.nameOf(id))).filter(n => n.length > 2);
  const relWords = ` ${wordsIn(relation || '').map(w => normalizeName(w)).join(' ')} `;
  if (relation && others.some(n => relWords.includes(` ${n} `))) return { ok: false, error: `"${relation}" names another Thing; say how ${world.nameOf(a)} and ${world.nameOf(b)} relate to each other` };
  // Not about this place: "Tree Parts is a web about How to describe".
  if (relation && wordsIn(relation).some(w => MEDIUM_IN_RELATION.test(w) && !world.personWords?.has(w.toLowerCase()))) return { ok: false, error: `"${relation}" is about this place itself; say how ${world.nameOf(a)} and ${world.nameOf(b)} relate in the world` };
  if (!relation) return { ok: false, error: `no relation between ${world.nameOf(a)} and ${world.nameOf(b)} in "${String(said).trim()}"` };
  const empty = emptyRelation(relation, world.nameOf(a), world.nameOf(b));
  if (empty) return retried ? { ok: false, error: empty } : askAgain(ctx, a, b, empty);
  // "Queen impacts Workers": true, and says almost nothing. Asked once for what it does.
  if (GENERIC_REL.test(relation) && !retried) {
    const sharper = await askAgain(ctx, a, b, null);
    if (sharper.ok) return sharper;
  }
  let c = await world.connect(ctx.locus.web, a, b, relation, { fromSentence: !!fromSentence });
  if (!c.ok && !retried && /does not make sense/.test(c.error || '')) {
    // No example in the question: a small model copies it ("flows into", for tutorials).
    const again = await ctx.ask(`"${world.nameOf(a)} ${relation} ${world.nameOf(b)}" does not read as a true plain sentence. Give the relation as the words that make "${world.nameOf(a)} ___ ${world.nameOf(b)}" a true plain sentence, or "none" if they are not related.`, 4);
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
    // No relations offered for reuse: offered, one took over each run
    // ("impacts", "dissolve in", "surrounds", "makes" between nearly
    // everything). Near-synonyms are merged when connecting (world.connect).
    // Not a pair already related as a kind or a part: "Up quark is a kind of
    // Quarks" was connected six times over, each time a success.
    const { world } = ctx;
    const related = (x, y) => world.typeChain(x).includes(y) || world.typeChain(y).includes(x)
      || (world.insideOf(x) && world.thingsIn(world.insideOf(x)).includes(y)) || (world.insideOf(y) && world.thingsIn(world.insideOf(y)).includes(x));
    return ctx.view.peers.filter(p => !linked.has(p.id) && isObject(world, p.id) && !related(f.id, p.id)).slice(0, 4).map(p => ({
      label: `connect ${f.name} to ${p.name}`,
      // Parts of one Thing, side by side and unconnected: how they fit together
      // is what the inside is for.
      prior: ((ctx.locus.path || []).length && degree === 0 ? 1.3 : 0.9) / (1 + degree / 2),
      // Either order: told to begin with the focus, it wrote "Wood is a type
      // of Wooden planks" — the order forced the fact backwards.
      blank: { question: `How do ${f.name} and ${p.name} relate? Say it as one short plain sentence that names both.`, maxWords: 12 },
      data: { a: f.id, b: p.id },
      target: p.id
    }));
  },
  async run(ctx, data, text) {
    const rel = String(text || '').trim();
    if (!rel) return fail('no relation');
    const c = await connectSaying(ctx, data.a, data.b, rel);
    if (!c.ok) return fail(c.error);
    // Said the other way round, it was connected that way: say so that way too.
    const [from, to] = c.from ? [c.from, c.to] : c.reversed ? [data.b, data.a] : [data.a, data.b];
    return { ok: true, summary: c.summary || `${ctx.world.nameOf(from)} ${c.relation} ${ctx.world.nameOf(to)}`, touched: [data.a, data.b], wrote: true };
  }
};

export const follow = {
  id: 'follow',
  prior: 0.7,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f) return [];
    // Not along a belief's "is about": back and forth between a belief and
    // its Thing took five of a Druid's thirty moments.
    return ctx.view.links.filter(l => roleOf(ctx.world, l.id) !== 'belief' && roleOf(ctx.world, f.id) !== 'belief').map(l => ({
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
    // Not at its goals and plans: the loop shows them, and looking at them is no work.
    const items = ctx.view.peers.filter(p => !isBookkeeping(ctx.world, p.id) || roleOf(ctx.world, p.id) === 'belief').map(p => ({ label: `look at ${p.name}`, data: { at: p.id }, target: p.id }));
    for (const a of ctx.view.associated || []) {
      if (ctx.world.thingsIn(ctx.locus.web).includes(a.id)) items.push({ label: `look at ${a.name} (often in mind with ${ctx.view.focus.name})`, data: { at: a.id }, target: a.id });
    }
    return items;
  },
  async run(ctx, data) {
    return { ok: true, summary: `looked at ${ctx.world.nameOf(data.at)}`, touched: [data.at], locus: { ...ctx.locus, focus: data.at }, wrote: false };
  }
};

/**
 * A web it started, still nearly empty: begin with what its subject is made
 * of or involves. Standing in an empty "Space", a Druid tried to make Space
 * there, was told Space cannot go inside itself, thought "trying to
 * understand it leads to confusion", and spent the run on Understanding,
 * Confusion and Information.
 */
function fillTopic(ctx) {
  const { world, locus } = ctx;
  const owner = locus.web && world.ownerOf(locus.web);
  if (!owner || !world.druidOf(owner).topic) return [];
  if (world.thingsIn(locus.web).filter(id => isObject(world, id)).length >= 3) return [];
  const a = openAsk(world, owner);
  return [{
    label: a.label,
    blank: { question: a.question, maxWords: a.maxWords },
    data: { into: owner, create: true, topic: true, schema: a.schema },
    target: owner,
    prior: 1.8
  }];
}

/** Not a part: "Unknown", "Other things", "Various". */
const VAGUE = /^(unknown|other|others|other things|something|some things|things|stuff|various|many|more|etc|none|nothing|everything)$|^not\b|^(self|reason|reasons)$|^(kind|type|sort|part)s? of\b|^(each|every|both|with)\b/i;

/** Deepest an inside is opened into its own parts, counting from a web. */
export const MAX_DEPTH = 4;

/**
 * What opening a Thing up asks, by the sort of composition its inside is
 * (world.schemaOf). The question is the discipline: a small model cannot tell
 * which way round "is X a part of Y?" goes (it said a Bicycle is a part of a
 * Wheel), but asked for the right members it names them well. So what enters
 * an inside enters through the question that asked for it.
 *
 *   parts      an object's parts at its own scale: Mount Everest's summit,
 *              ridges, glaciers. Asked what it is "made of", a model said
 *              rock, ice, snow, and the Druid was in water chemistry in six moments.
 *   material   a substance's makeup: Ice, of water molecules
 *   stages     a process's stages, in order
 *   elements   what makes up an idea: Love, of intimacy and commitment
 */
export const PARTS_QUESTION = (name, it = name) => `What are the main parts of ${it.replace(/,$/, '')}? Name the parts you could point to on ${name} itself, not the materials it is made of. Separate them with commas.`;

/**
 * A Thing as the questions about it name it: with the whole it is part of,
 * and the subject that whole is in. Asked "What are the stages of
 * Expansion?", of an Expansion that was a stage of Pressure in a web about
 * Venus's atmosphere, Apple's model named Accretion, Volcanism and Plate
 * Tectonics, and the Druid was in planetary formation four moments on
 * (The Druid 12, 2026-10-06).
 */
export function inContext(world, id) {
  const name = world.nameOf(id);
  const web = world.websOf(id).find(w => !world.isSystemWeb?.(w) && !isOwnPlace(world, w));
  if (!web) return name;
  const owner = world.ownerOf(web);
  const whole = owner && !isBookkeeping(world, owner) ? world.nameOf(owner) : null;
  const topic = world.topicOf ? world.topicOf(web) : null;
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  if (whole && !same(whole, name)) return `${name}, as part of ${whole}${topic && !same(topic, whole) && !same(topic, name) ? ` in ${topic}` : ''},`;
  return topic && !same(topic, name) ? `${name}, as it is in ${topic},` : name;
}

export function openAsk(world, id, { partOf = null } = {}) {
  const name = world.nameOf(id);
  const it = inContext(world, id);
  const schema = world.schemaOf ? world.schemaOf(id) : 'parts';
  const where = partOf ? `, a part of ${partOf}` : '';
  if (schema === 'stages') return { schema, label: `open up ${name}${where}: name its stages in order, ___`, question: `What are the stages of ${it} in the order they happen? Name each stage in a few words, separated by commas.`, maxWords: 24 };
  if (schema === 'material') return { schema, label: `open up ${name}${where}: name what it is made of, ___`, question: `What is ${it} made of? Name what it is made of, separated by commas.`, maxWords: 16 };
  if (schema === 'elements') return { schema, label: `open up ${name}${where}: name what makes it up, ___`, question: `What makes up ${it}? Name the main things that together make it up, separated by commas.`, maxWords: 16 };
  return { schema, label: `open up ${name}${where}: name its parts, ___`, question: PARTS_QUESTION(name, it), maxWords: 16 };
}

export const open = {
  id: 'open',
  prior: 0.8,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f) return fillTopic(ctx);
    // A goal's or a plan's inside holds its steps, which the loop shows; it is
    // not a place to go and build in.
    if (isBookkeeping(ctx.world, f.id)) return [];
    if (f.inside && f.insideCount > 0) {
      return [{ label: `go inside ${f.name} (${f.insideCount} Thing${f.insideCount === 1 ? '' : 's'} there)`, data: { into: f.id } }];
    }
    if (!isObject(ctx.world, f.id)) return [];
    // A list: one part at a time, a whole run went by with one part named.
    // Less pressing the deeper it already is: unchecked, one Druid went nine
    // levels down (Strings, Quantum fields, Charge, Electricity, Electron…)
    // and connected almost nothing along the way.
    // How deep this web really sits: every topic went on down to quarks while
    // the walked path, reset by each "go to", read shallow.
    const depth = Math.max((ctx.locus.path || []).length, ctx.world.depthOf ? ctx.world.depthOf(ctx.locus.web) : 0);
    if (depth >= MAX_DEPTH) return [];
    const a = openAsk(ctx.world, f.id);
    return [{ label: a.label, blank: { question: a.question, maxWords: a.maxWords }, data: { into: f.id, create: true, schema: a.schema }, prior: 1.4 / (1 + depth * 0.5) }];
  },
  async run(ctx, data, text) {
    const { world, locus, activation } = ctx;
    const inside = world.ensureInside(data.into);
    if (!inside) return fail('could not open it');
    // Filling a web it started is filling that web, not going into it.
    const path = data.topic ? (locus.path || []) : [...(locus.path || []), data.into];
    if (data.create) {
      // Each part named becomes a Thing inside — a list is welcome here.
      // Nothing is a part of itself, or of what it sits inside: asked what
      // Flour is made of, a model answered "Flour".
      // By normalized name: "Galaxies" inside the web Galaxy was Galaxy inside itself.
      const enclosing = new Set([data.into, ...path].map(id => normalizeName(world.nameOf(id))));
      // The list, not the sentence around it: "Time is made of past, present,
      // and future" made a Thing named "Time is made of past".
      // And not a label before a colon: "Main parts of Hydrogen: Protons, …".
      const list = String(text || '').replace(/^[^:,]{0,60}:\s*/, '').replace(/^.*?\b(made|composed|consists?)\s+(up\s+)?of\s+/i, '');
      // A list of parts splits on "and" too: "dark energy and dark matter
      // particles" was one six-word name, and dropped.
      const listed = /[,;\n]/.test(list) ? namesIn(list) : list.split(/\band\b/i).flatMap(namesIn);
      // Not a clause: "is responsible" from "…the universe and is responsible".
      const named = listed.filter(n => !/\b(made|composed|consists?)\s+of\b|\bof$/i.test(n) && !VAGUE.test(n) && !/^(is|are|was|were|has|have|had|can|will|does|do|did|it|they|which|that)\b/i.test(n));
      // Nor what sits beside it, a part of the same whole: asked what the
      // Sun's Radiative Zone is made of, a model named the Photosphere and the
      // Chromosphere, the layers next to it.
      // Inside a Thing, what sits side by side are parts of one whole, the web
      // it started on a subject included (Thalamus went inside Cortex, both
      // parts of Brain). Not in a web of a person's that is no one's inside.
      const whole = locus.web && world.ownerOf(locus.web);
      const inAnInside = whole && !data.topic && locus.web !== inside
        && (world.druidOf(whole).topic || world.websOf(whole).some(w => w !== locus.web && !world.isSystemWeb(w)));
      const besideIt = new Map((inAnInside ? world.thingsIn(locus.web) : [])
        .filter(id => id !== data.into && isObject(world, id)).map(id => [normalizeName(world.nameOf(id)), id]));
      const siblings = named.filter(n => besideIt.has(normalizeName(n)));
      // Once each: "Minerals, Water, Minerals".
      const names = [...new Map(named.filter(n => !enclosing.has(normalizeName(n)) && !besideIt.has(normalizeName(n))).map(n => [normalizeName(n), n])).values()].slice(0, data.schema === 'stages' ? 6 : 5);
      if (names.length === 0 && siblings.length) return fail(`${siblings.join(', ')} ${siblings.length > 1 ? 'sit' : 'sits'} beside ${world.nameOf(data.into)}, not inside it; name what ${world.nameOf(data.into)} itself is made of`);
      if (names.length === 0) return fail(named.length ? `${named.join(', ')} cannot be a part of itself; name what it is made of` : 'no name');
      if (data.schema === 'stages') return openStages(ctx, data, inside, names, path);
      const made = [];
      const kinds = [];
      const beside = [];
      const errors = [];
      for (const name of names) {
        const r = await world.createThing(inside, name);
        // A kind of it went beside it, not inside: "Up quark", asked what Quarks are made of.
        if (r.ok && r.kindOf) kinds.push(r.id);
        else if (r.ok && r.web === inside) made.push(r.id);
        else if (r.ok) beside.push(r.id);
        else errors.push(r.error);
      }
      const kindNote = [
        kinds.length ? `${kinds.map(id => world.nameOf(id)).join(' and ')} ${kinds.length > 1 ? 'are kinds' : 'is a kind'} of ${world.nameOf(data.into)}, not ${kinds.length > 1 ? 'parts' : 'a part'} of it` : '',
        beside.length ? `${beside.map(id => world.nameOf(id)).join(' and ')} ${beside.length > 1 ? 'are' : 'is'} not part of it, so went beside it` : '',
        siblings.length ? `${siblings.join(' and ')} ${siblings.length > 1 ? 'sit' : 'sits'} beside it already` : ''
      ].filter(Boolean).join('; ');
      if (made.length === 0 && (kinds.length || beside.length)) return { ok: true, summary: `saw that ${kindNote}`, touched: [data.into, ...kinds, ...beside], wrote: true };
      // The reason, not "could not make the parts": that hid why the one time a
      // Druid asking what consciousness is made of tried to open it up.
      if (made.length === 0) return fail(errors.filter(Boolean).join('; ') || 'could not make the parts');
      const first = made[0];
      const description = await ctx.ask(`Describe ${world.nameOf(first)}, as a part of ${world.nameOf(data.into)}, in one short sentence.`, 16);
      if (description) await world.act('updateNode', { nodeName: world.nameOf(first), description, targetGraphId: inside });
      world.focusWeb(inside);
      return { ok: true, summary: [`opened up ${world.nameOf(data.into)} and found ${made.map(id => world.nameOf(id)).join(', ')} inside`, kindNote].filter(Boolean).join('; '), touched: [data.into, ...made, ...kinds, ...beside], locus: { web: inside, focus: first, path }, wrote: true };
    }
    const first = world.thingsIn(inside).sort((a, b) => (activation.get(b) ?? -9) - (activation.get(a) ?? -9))[0] || null;
    world.focusWeb(inside);
    return { ok: true, summary: `went inside ${world.nameOf(data.into)}`, touched: [data.into, first].filter(Boolean), locus: { web: inside, focus: first, path }, wrote: false };
  }
};

const ORDINAL = /^(then|first|firstly|second|secondly|third|next|finally|lastly|last|after that|afterwards|later|begin|beginning|start|end)$/i;
/** A stage's name without the words that only say where it falls in the order. Empty when nothing else is left. */
export function stageName(text) {
  const t = String(text || '').trim()
    .replace(/^(?:(?:then|first|firstly|second|secondly|third|next|finally|lastly|after that|afterwards|later)\b[,:]?\s*)+/i, '')
    .replace(/^(?:step|stage|phase)\s*\d+\s*[:.)-]?\s*/i, '')
    .replace(/[.:]\s*then$/i, '')
    .replace(/[.:;]+$/, '')
    .trim();
  if (!t || ORDINAL.test(t)) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * A process opened up: its stages inside it, each leading to the next. The
 * order is the model's; the links are code's, so every one of them says
 * something ("Evaporation leads to Condensation"), where links asked for one
 * pair at a time were judged sensible about a third of the time.
 */
async function openStages(ctx, data, inside, names, path) {
  const { world } = ctx;
  const made = [];
  const errors = [];
  for (const given of names) {
    // The stage, not its place in the order: "Then Freezing", "Step 2: Osmosis", "Intestines. Then".
    const name = stageName(given);
    if (!name) continue;
    // Not checked as parts: Rain is not "made of" Evaporation, it begins with it.
    const r = await world.createThing(inside, name);
    if (r.ok && r.web === inside && !made.includes(r.id)) made.push(r.id);
    else if (!r.ok) errors.push(r.error);
  }
  if (made.length === 0) return fail(errors.filter(Boolean).join('; ') || 'could not make the stages');
  for (let i = 0; i + 1 < made.length; i++) await world.connect(inside, made[i], made[i + 1], 'leads to', { fromSentence: true });
  world.setDruid(data.into, { insideIs: 'stages' });
  world.focusWeb(inside);
  const said = made.map(id => world.nameOf(id)).join(', then ');
  return { ok: true, summary: `opened up ${world.nameOf(data.into)} into its stages: ${said}`, touched: [data.into, ...made], locus: { web: inside, focus: made[0], path }, wrote: true };
}

/**
 * Inside a Thing, its parts that have no parts yet, offered to open up in
 * turn: understanding goes down, part by part, not only across.
 */
export const deepen = {
  id: 'deepen',
  prior: 1.1,
  offer(ctx) {
    const { world, locus } = ctx;
    if (!locus.web || !(locus.path || []).length) return [];
    const depth = Math.max(locus.path.length, world.depthOf ? world.depthOf(locus.web) : 0);
    if (depth >= MAX_DEPTH) return [];
    return world.thingsIn(locus.web)
      .filter(id => id !== locus.focus && isObject(world, id) && !(world.insideOf(id) && world.thingsIn(world.insideOf(id)).length))
      .sort((a, b) => (ctx.activation.get(b) ?? -9) - (ctx.activation.get(a) ?? -9))
      .slice(0, 2)
      .map(id => ({ id, a: openAsk(world, id, { partOf: world.nameOf(world.ownerOf(locus.web)) }) }))
      .map(({ id, a }) => ({ label: a.label, blank: { question: a.question, maxWords: a.maxWords }, data: { into: id, create: true, schema: a.schema }, target: id, prior: 1.1 / (1 + depth * 0.5) }));
  },
  run: (ctx, data, text) => open.run(ctx, data, text)
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
    return [{ label: thin ? `describe ${f.name}: ___` : `redescribe ${f.name} as you understand it now: ___`, blank: { question: `Describe ${f.name}${asIn(ctx.world, f.name, ctx.locus.web)} in one sentence.`, maxWords: 20 }, data: { id: f.id }, prior: thin ? 1.1 : 0.25 }];
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
    const here = new Set(ctx.locus.web ? world.thingsIn(ctx.locus.web) : []);
    return (ctx.view.webs || []).filter(w => top.has(w.id) && !here.has(world.ownerOf(w.id))).slice(0, 3).map(w => ({ label: `go to the web ${w.name}`, data: { web: w.id }, target: world.ownerOf(w.id) }));
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
    return ctx.held.filter(h => h.scratch).slice(0, 2).map(h => ({ label: `make "${ctx.world.nameOf(h.id)}" a lasting Thing`, data: { id: h.id }, target: h.id }));
  },
  async run(ctx, data) {
    // A half-formed thought may be a sentence; kept, it is named by a handle
    // for it: "Stars are red because of hot" was kept as a Thing's name.
    const { world } = ctx;
    const said = world.nameOf(data.id);
    if (world.nameGate && wordsIn(said).length >= 3 && hasVerb(said)) {
      const verdict = await world.nameGate?.(said).catch(() => null);
      const short = verdict?.kind === 'sentence' && verdict.short ? titleish(verdict.short) : null;
      if (short && !world.findThing(short)) {
        world.state().updateNodePrototype(data.id, (d) => { d.name = short; d.description = [said.replace(/[.!?]*$/, '.'), d.description].filter(Boolean).join(' '); });
      }
    }
    // Noticed, not a part of where it was thought: kept in the Noticed folder
    // until something places it where it belongs (world.js createThing).
    if (!ctx.promote(data.id, ctx.world.noticedWeb ? ctx.world.noticedWeb() : ctx.locus.web)) return fail('could not promote it');
    return { ok: true, summary: `kept the thought "${ctx.world.nameOf(data.id)}"`, touched: [data.id], wrote: true };
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
  if (locus.web && !isOwnPlace(world, locus.web)) return locus.web;
  return topLevelWebs(world).filter(id => !isOwnPlace(world, id)).pop() || null;
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
    // Only a thought about what it has built: kept from daydreams, "Interconnectedness
    // of nature", "Harmony", "Forest" became Things, and then grounded the next
    // daydream (The Druid 12, 2026-10-06).
    const content = (w) => !!w && !isOwnPlace(ctx.world, w) && !ctx.world.isSystemWeb?.(w);
    const built = (id) => ctx.world.websOf(id).some(content) || content(ctx.world.insideOf(id));
    if (!namedInThought(ctx.world, thought).some(built)) return [];
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
    // Kept, not placed: a Thing in a thought is not therefore a part of the
    // web it was thought in ("Mountain", kept while in Mount Everest, became a
    // part of Mount Everest). Noticed until something places it.
    const errors = [];
    for (const name of names) {
      const r = await world.createThing(data.web, name, { noticed: true });
      if (r.ok) made.push(r.id); else errors.push(r.error);
    }
    if (made.length === 0) return fail(errors.filter(Boolean).join('; ') || 'could not keep them');
    for (const id of made) {
      if ((world.proto(id)?.description || '').length < 12) {
        const d = await ctx.ask(`Describe ${world.nameOf(id)} in one short sentence, as you understand it.`, 16);
        if (d) await world.act('updateNode', { nodeName: world.nameOf(id), description: d, targetGraphId: world.websOf(id)[0] || data.web });
      }
    }
    return { ok: true, summary: `kept ${made.map(id => world.nameOf(id)).join(', ')} from that thought, as noticed`, touched: made, wrote: true };
  }
};

export const BASIC_MOVES = [newWeb, make, connect, follow, look, open, deepen, close, describe, goWeb, letGoMove, note, promoteMove, remember];

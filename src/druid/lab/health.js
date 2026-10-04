/**
 * The health of a Druid's universe — what a person sees when they open it,
 * as numbers, so two ways of running a Druid can be compared.
 *
 *   bloat      how much of the universe is bookkeeping (episodes above all)
 *   names      Things named with a sentence
 *   relations  how many relation types per connection, and near-duplicates
 *   density    connections per Thing, and the busiest Thing
 *   insides    whether what is inside a Thing is a part of it (judged)
 *   links      whether connections make sense (judged)
 *   claims     connections made TO a belief, as if it were a Thing
 *   stranded   Things placed in no web
 *
 * The judged numbers need `judge(statement) → true | false | null`; use a
 * different model from the Druid's own helpers, or the Druid grades itself.
 */

import { roleOf } from '../roles.js';
import { wordsIn, readsAsName, normalizeName, MAX_NAME_WORDS } from '../names.js';

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

/** Pick up to `k` items spread evenly, so a judged sample is the same each time. */
const sample = (list, k) => (list.length <= k ? list : Array.from({ length: k }, (_, i) => list[Math.floor((i * list.length) / k)]));

export async function health(world, { judge = null, judgeSample = 40 } = {}) {
  const st = world.state();
  const all = world.allThingsIncludingSystem();
  const relationTypes = world.relationTypeIds();
  const kindOf = (id) => {
    const d = world.druidOf(id);
    if (d.system || d.homeOf) return 'system';
    if (d.roleType) return 'roleType';
    if (d.role === 'day') return 'day';
    if (relationTypes.has(id) || d.relation) return 'relation';
    return roleOf(world, id) || 'content';
  };
  const kinds = {};
  for (const id of all) kinds[kindOf(id)] = (kinds[kindOf(id)] || 0) + 1;
  const content = all.filter(id => kindOf(id) === 'content');

  const sentenceNames = all
    .filter(id => ['content', 'belief', 'goal', 'plan'].includes(kindOf(id)))
    .map(id => world.nameOf(id))
    .filter(n => wordsIn(n).length > MAX_NAME_WORDS && !readsAsName(n));

  const contentWebs = [...st.graphs.values()].filter(g => !world.isSystemWeb(g.id) && !(world.ownerOf(g.id) && world.isOwnThinking(world.ownerOf(g.id))));
  const links = contentWebs.flatMap(g => world.linksIn(g.id).map(l => ({ ...l, web: g.id })));
  const relationNames = [...new Set(links.map(l => l.relation.toLowerCase()))];
  const byNorm = new Map();
  for (const r of relationNames) {
    const k = normalizeName(r).replace(/^(is|are|was|will)\s+/, '');
    byNorm.set(k, [...(byNorm.get(k) || []), r]);
  }
  const nearDuplicates = [...byNorm.values()].filter(g => g.length > 1);

  const degree = new Map();
  for (const l of links) { degree.set(l.a, (degree.get(l.a) || 0) + 1); degree.set(l.b, (degree.get(l.b) || 0) + 1); }
  const busiest = [...degree.entries()].sort((a, b) => b[1] - a[1])[0];

  const claims = links.filter(l => roleOf(world, l.b) === 'belief' || (roleOf(world, l.a) === 'belief' && !/^is about$/i.test(l.relation)));

  // Insides of Things that sit somewhere else: decompositions.
  const insides = contentWebs
    .map(g => ({ web: g.id, owner: world.ownerOf(g.id) }))
    .filter(({ web, owner }) => owner && world.websOf(owner).some(w => w !== web && !world.isSystemWeb(w)));
  const parts = insides.flatMap(({ web, owner }) => world.thingsIn(web).filter(id => kindOf(id) === 'content' && id !== owner).map(id => ({ part: id, owner })));

  const stranded = all.filter(id => world.websOf(id).length === 0 && !world.insideOf(id) && !['relation', 'system', 'roleType'].includes(kindOf(id)));

  const report = {
    things: all.length,
    content: content.length,
    kinds,
    bloatPct: pct(all.length - content.length - (kinds.belief || 0), all.length),
    episodePct: pct(kinds.episode || 0, all.length),
    sentenceNames: sentenceNames.length,
    sentenceNameExamples: sentenceNames.slice(0, 5),
    links: links.length,
    relationTypes: relationNames.length,
    relationsPerLink: links.length ? +(relationNames.length / links.length).toFixed(2) : 0,
    nearDuplicateRelations: nearDuplicates,
    linksPerThing: content.length ? +(links.length / content.length).toFixed(2) : 0,
    busiest: busiest ? { name: world.nameOf(busiest[0]), links: busiest[1] } : null,
    claimsAsThings: claims.length,
    insideWebs: insides.length,
    parts: parts.length,
    stranded: stranded.length
  };

  if (judge) {
    const judged = async (items, statement) => {
      let yes = 0; let no = 0; const bad = [];
      for (const it of sample(items, judgeSample)) {
        const s = statement(it);
        const v = await judge(s);
        if (v === true) yes++; else if (v === false) { no++; bad.push(s); }
      }
      return { judged: yes + no, sensiblePct: pct(yes, yes + no), examples: bad.slice(0, 6) };
    };
    report.partsJudged = await judged(parts, ({ part, owner }) => `${world.nameOf(part)} is a part of ${world.nameOf(owner)}`);
    report.linksJudged = await judged(links, (l) => `${world.nameOf(l.a)} ${l.relation.toLowerCase()} ${world.nameOf(l.b)}`);
  }
  return report;
}

export function renderHealth(r) {
  const lines = [
    `${r.things} Things — ${r.content} content, ${r.bloatPct}% bookkeeping (${r.episodePct}% episodes) · ${JSON.stringify(r.kinds)}`,
    `names: ${r.sentenceNames} sentences as names${r.sentenceNameExamples.length ? ` (e.g. "${r.sentenceNameExamples[0]}")` : ''}`,
    `connections: ${r.links} links, ${r.relationTypes} relation types (${r.relationsPerLink} per link), ${r.linksPerThing} per Thing, busiest ${r.busiest ? `${r.busiest.name} (${r.busiest.links})` : '—'}`,
    `near-duplicate relations: ${r.nearDuplicateRelations.map(g => g.join(' / ')).join('; ') || 'none'}`,
    `beliefs treated as Things: ${r.claimsAsThings} · insides: ${r.insideWebs} holding ${r.parts} parts · stranded: ${r.stranded}`
  ];
  if (r.partsJudged) lines.push(`judged: parts that are parts ${r.partsJudged.sensiblePct}% of ${r.partsJudged.judged}; links that make sense ${r.linksJudged.sensiblePct}% of ${r.linksJudged.judged}`);
  for (const e of r.partsJudged?.examples || []) lines.push(`  ✗ ${e}`);
  for (const e of r.linksJudged?.examples || []) lines.push(`  ✗ ${e}`);
  return lines.join('\n');
}

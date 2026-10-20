/**
 * The formula bank's source, fetched from Wikidata: every item whose defining
 * formula (P2534) has its symbols tied to concepts ("in defining formula",
 * P7235, qualified by "symbol represents", P9758), the concepts and classes
 * those name, how widely each item is written about, and which discipline
 * each class leads to. buildBank.js turns this snapshot into the bank.
 *
 * Also the known results around them (every theorem, law, equation, formula
 * and model with an English Wikipedia article), whether or not Wikidata writes
 * them as formulas yet, so each section can say what it is missing; and, for
 * every item, the topics of its Wikipedia categories (Population genetics,
 * Graph theory: a category's "main topic", P301), which say what field an
 * item is in far more often than Wikidata's own "studied by" does.
 *
 * With MathModDB's seeds, MathModDB's models too (fetchMathModDB.js), read
 * first: the Wikidata items its quantities and disciplines name are read
 * along with the bank's own, so its formulas join Wikidata's concepts and
 * sections (buildBank.js).
 *
 * Runs wherever fetch does: the app (Settings → Data → Formula Bank) and the
 * scripts (scripts/formula-bank). Wikidata is CC0, MathModDB CC BY 4.0;
 * nothing here is written by hand, and each item keeps its number.
 */
import { DISCIPLINE_ROOTS, MARKERS, RESULT_KINDS, RESULT_CLASS_KINDS } from './disciplines.js';
import { fetchMathModDB } from './fetchMathModDB.js';

const SPARQL = 'https://query.wikidata.org/sparql';
const API = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const BATCH = 50;
const TRACE_BATCH = 20;
const PAUSE_MS = 200;
const PARALLEL = 3; // at once, well inside what the query service allows one client

const P = {
  definingFormula: 'P2534',
  inDefiningFormula: 'P7235',
  symbolRepresents: 'P9758',
  instanceOf: 'P31',
  subclassOf: 'P279',
  studiedBy: 'P2579',
  partOf: 'P361',
  quantitySymbol: 'P416',
  mainTopic: 'P301',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Run `work` over `chunks`, PARALLEL at a time, reporting each one done. */
async function inParallel(chunks, work, onDone) {
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      await work(chunk);
      onDone?.(++done, chunks.length);
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, lane));
}

const chunked = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const label = (e) => e?.labels?.en?.value || null;
const description = (e) => e?.descriptions?.en?.value || null;
const wikipedia = (e) => e?.sitelinks?.enwiki?.title || null;
const claims = (e, p) => (e?.claims?.[p] || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value');
const itemValues = (e, p) => claims(e, p).map(c => c.mainsnak.datavalue.value.id).filter(Boolean);
const stringValues = (e, p) => claims(e, p).map(c => c.mainsnak.datavalue.value).filter(v => typeof v === 'string');
const idOf = (iri) => iri.split('/').pop();

/**
 * @param {object} [options]
 * @param {object} [options.headers] - sent with each request (a script sends
 *   its User-Agent; a browser sends none, which keeps requests simple)
 * @param {(step: {stage: string, done?: number, total?: number}) => void} [options.onProgress]
 * @param {object} [options.previous] - an earlier snapshot, whose classes'
 *   disciplines are kept rather than traced again
 * @param {string[]} [options.mathModDBSeeds] - MathModDB items to read down
 *   from (fetchMathModDB.js); none, and MathModDB isn't read
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} { source, fetchedAt, items, concepts, known, classes, mathmoddb }
 */
export async function fetchFormulaSnapshot({ headers = {}, onProgress, previous = null, mathModDBSeeds = null, signal } = {}) {
  const report = (stage, done, total) => onProgress?.({ stage, done, total });
  const mathmoddb = mathModDBSeeds?.length
    ? await fetchMathModDB({ seeds: mathModDBSeeds, headers, onProgress, signal })
    : null;

  async function getJson(url, tries = 4) {
    for (let i = 0; ; i++) {
      if (signal?.aborted) throw new Error('Stopped');
      let res;
      try {
        res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal });
      } catch (err) {
        // A dropped connection: wait and ask again.
        if (signal?.aborted || i >= tries) throw err;
        await sleep(3000 * (i + 1));
        continue;
      }
      if (res.ok) return res.json();
      if (i >= tries || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`Wikidata answered ${res.status}`);
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * (i + 1));
    }
  }
  const sparql = (query) => getJson(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`);

  /** Entities by id: { id: entity } with English labels and descriptions. */
  async function entities(ids, props, stage) {
    const out = {};
    await inParallel(chunked([...new Set(ids)], BATCH), async (chunk) => {
      // origin=* lets a browser read the answer.
      const url = `${API}?action=wbgetentities&format=json&origin=*&languages=en&languagefallback=1&maxlag=15&sitefilter=enwiki&props=${props}&ids=${chunk.join('|')}`;
      let data = await getJson(url);
      // A busy Wikidata answers "maxlag": wait as long as it says, then ask again.
      for (let tries = 0; data.error?.code === 'maxlag' && tries < 20; tries++) {
        await sleep(Math.max(1000, (data.error.lag || 5) * 1000));
        data = await getJson(url);
      }
      if (data.error) throw new Error(`Wikidata: ${data.error.info || data.error.code}`);
      Object.assign(out, data.entities || {});
    }, (done, total) => report(stage, done, total));
    return out;
  }

  report('Finding equations');
  const found = await sparql(`SELECT DISTINCT ?item WHERE { ?item p:${P.inDefiningFormula} ?st . ?st pq:${P.symbolRepresents} ?c . }`);
  const ids = found.results.bindings.map(b => idOf(b.item.value));

  const raw = await entities(ids, 'labels|descriptions|claims|sitelinks', 'Reading equations');
  const items = {};
  const conceptIds = new Set();
  const classIds = new Set();
  for (const id of ids) {
    const e = raw[id];
    if (!e || e.missing !== undefined) continue;
    const symbols = claims(e, P.inDefiningFormula).map(c => ({
      tex: c.mainsnak.datavalue.value,
      represents: (c.qualifiers?.[P.symbolRepresents] || []).map(q => q.datavalue?.value?.id).filter(Boolean),
    }));
    symbols.forEach(s => s.represents.forEach(c => conceptIds.add(c)));
    const item = {
      id, label: label(e), description: description(e), wikipedia: wikipedia(e),
      formulas: stringValues(e, P.definingFormula),
      symbols,
      instanceOf: itemValues(e, P.instanceOf),
      subclassOf: itemValues(e, P.subclassOf),
      studiedBy: itemValues(e, P.studiedBy),
      partOf: itemValues(e, P.partOf),
    };
    [...item.instanceOf, ...item.subclassOf, ...item.studiedBy, ...item.partOf].forEach(c => classIds.add(c));
    items[id] = item;
  }

  // MathModDB's quantities and disciplines that are Wikidata's too: its formulas' concepts and sections.
  if (mathmoddb) {
    Object.values(mathmoddb.quantities).forEach(q => q.wikidata && conceptIds.add(q.wikidata));
    Object.values(mathmoddb.disciplines).forEach(d => d.wikidata && classIds.add(d.wikidata));
  }
  const rawConcepts = await entities([...conceptIds], 'labels|descriptions|claims|sitelinks', 'Reading concepts');
  const concepts = {};
  for (const id of conceptIds) {
    const e = rawConcepts[id];
    if (!e || e.missing !== undefined) continue;
    const concept = {
      id, label: label(e), description: description(e), wikipedia: wikipedia(e),
      quantitySymbols: stringValues(e, P.quantitySymbol),
      instanceOf: itemValues(e, P.instanceOf),
      subclassOf: itemValues(e, P.subclassOf),
      studiedBy: itemValues(e, P.studiedBy),
    };
    [...concept.studiedBy, ...concept.instanceOf, ...concept.subclassOf].forEach(c => classIds.add(c));
    concepts[id] = concept;
  }

  // Known results: each kind's subclasses' instances with an English article.
  // Read lightly (labels here, a few statements by query): there are thousands.
  report('Finding known results');
  const knownFound = {};
  await inParallel(Object.keys(RESULT_KINDS).map(k => [k]), async ([kind]) => {
    const is = RESULT_CLASS_KINDS.has(kind) ? `wdt:${P.instanceOf}|wdt:${P.subclassOf}` : `wdt:${P.instanceOf}`;
    const data = await sparql(`SELECT ?item ?n WHERE { ?k wdt:${P.subclassOf}* wd:${kind} . ?item ${is} ?k . ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . ?item wikibase:sitelinks ?n . }`);
    for (const b of data.results.bindings) {
      const id = idOf(b.item.value);
      // A lemma is a theorem too: the narrower kind says more.
      if (!items[id] && !knownFound[id]) knownFound[id] = { n: Number(b.n.value), kind: RESULT_KINDS[kind] };
    }
  }, (done, total) => report('Finding known results', done, total));
  const knownIds = Object.keys(knownFound);
  const rawKnown = await entities(knownIds, 'labels|descriptions|sitelinks', 'Reading known results');
  const known = {};
  for (const id of knownIds) {
    const e = rawKnown[id];
    if (!e || e.missing !== undefined || !label(e)) continue;
    known[id] = {
      id, label: label(e), description: description(e), wikipedia: wikipedia(e), sitelinks: knownFound[id].n,
      kind: knownFound[id].kind, hasFormula: false, instanceOf: [], subclassOf: [], studiedBy: [], partOf: [],
    };
  }
  const statementOf = { [P.instanceOf]: 'instanceOf', [P.subclassOf]: 'subclassOf', [P.studiedBy]: 'studiedBy', [P.partOf]: 'partOf' };
  await inParallel(chunked(Object.keys(known), 200), async (chunk) => {
    const values = chunk.map(q => `wd:${q}`).join(' ');
    const data = await sparql(`SELECT ?item ?p ?v WHERE { VALUES ?item { ${values} } VALUES ?p { ${Object.keys(statementOf).map(x => `wdt:${x}`).join(' ')} } ?item ?p ?v . FILTER(isIRI(?v)) }`);
    for (const b of data.results.bindings) {
      const field = statementOf[b.p.value.split('/').pop()];
      known[idOf(b.item.value)][field].push(idOf(b.v.value));
    }
    const formulas = await sparql(`SELECT DISTINCT ?item WHERE { VALUES ?item { ${values} } ?item wdt:${P.definingFormula} ?f . }`);
    for (const b of formulas.results.bindings) known[idOf(b.item.value)].hasFormula = true;
  }, (done, total) => report('Reading known results', done, total));
  for (const k of Object.values(known)) [...k.instanceOf, ...k.subclassOf, ...k.studiedBy, ...k.partOf].forEach(c => classIds.add(c));

  // What each article's Wikipedia categories are about: Hardy–Weinberg
  // principle is in "Population genetics", whose main topic is the field.
  // A category with no main topic ("Lemmas in graph theory") counts by its
  // own categories' ("Graph theory"), one step up.
  async function categoriesOf(titles, stage) {
    const out = {};
    await inParallel(chunked([...new Set(titles)], 50), async (chunk) => {
      let cont = {};
      for (let tries = 0; cont && tries < 20; tries++) {
        const params = new URLSearchParams({
          action: 'query', format: 'json', origin: '*', prop: 'categories', clshow: '!hidden', cllimit: 'max',
          redirects: '1', titles: chunk.join('|'), ...cont,
        });
        const data = await getJson(`${WIKIPEDIA_API}?${params}`);
        const renamed = {};
        for (const r of [...(data.query?.normalized || []), ...(data.query?.redirects || [])]) renamed[r.to] = renamed[r.from] || r.from;
        for (const page of Object.values(data.query?.pages || {})) {
          const asked = renamed[page.title] || page.title;
          out[asked] = out[asked] || [];
          (page.categories || []).forEach(c => out[asked].push(c.title));
        }
        cont = data.continue || null;
      }
    }, (done, total) => report(stage, done, total));
    return out;
  }
  async function topicsOf(categoryTitles, stage) {
    const out = {};
    await inParallel(chunked([...new Set(categoryTitles)], 50), async (chunk) => {
      const url = `${API}?action=wbgetentities&format=json&origin=*&maxlag=15&sites=enwiki&sitefilter=enwiki&props=claims|sitelinks&titles=${encodeURIComponent(chunk.join('|'))}`;
      let data = await getJson(url);
      for (let tries = 0; data.error?.code === 'maxlag' && tries < 20; tries++) {
        await sleep(Math.max(1000, (data.error.lag || 5) * 1000));
        data = await getJson(url);
      }
      for (const e of Object.values(data.entities || {})) {
        const title = e?.sitelinks?.enwiki?.title;
        if (title) out[title] = itemValues(e, P.mainTopic);
      }
    }, (done, total) => report(stage, done, total));
    return out;
  }
  const withArticle = [...Object.values(items), ...Object.values(known)].filter(x => x.wikipedia);
  const categories = await categoriesOf(withArticle.map(x => x.wikipedia), 'Reading Wikipedia categories');
  const topicOf = await topicsOf(Object.values(categories).flat(), 'Reading what categories are about');
  const untopical = [...new Set(Object.values(categories).flat())].filter(c => !topicOf[c]?.length);
  const parents = await categoriesOf(untopical, 'Reading categories one step up');
  const parentTopicOf = await topicsOf(Object.values(parents).flat().filter(c => !(c in topicOf)), 'Reading what those are about');
  const topicsOfCategory = (c) => (topicOf[c]?.length ? topicOf[c]
    : (parents[c] || []).flatMap(p => topicOf[p] || parentTopicOf[p] || []));
  for (const x of withArticle) {
    x.topics = [...new Set((categories[x.wikipedia] || []).flatMap(topicsOfCategory))];
    x.topics.forEach(c => classIds.add(c));
  }

  const rawClasses = await entities([...classIds], 'labels|descriptions', 'Reading fields and kinds');
  const classes = {};
  for (const id of classIds) {
    const e = rawClasses[id];
    if (e && e.missing === undefined) classes[id] = { id, label: label(e), description: description(e) };
  }

  // How widely each is written about (how many Wikipedias have an article on
  // it), so a discipline lists its best-known equations first.
  await inParallel(chunked(Object.keys(items), 200), async (chunk) => {
    const data = await sparql(`SELECT ?item ?n WHERE { VALUES ?item { ${chunk.map(q => `wd:${q}`).join(' ')} } ?item wikibase:sitelinks ?n . }`);
    for (const b of data.results.bindings) {
      const id = idOf(b.item.value);
      if (items[id]) items[id].sitelinks = Number(b.n.value);
    }
  }, (done, total) => report('Ranking by how well known', done, total));

  // Subclass of, then at most one part of, then subclass of again: a field
  // reaches its discipline (thermodynamics -> physics) without part of's
  // longer chains reaching everything. Classes an earlier snapshot traced keep their trace.
  const roots = Object.keys(DISCIPLINE_ROOTS).map(q => `wd:${q}`).join(' ');
  const traced = previous?.classes || {};
  const toTrace = Object.keys(classes).filter((c) => {
    if (traced[c]?.leadsTo !== undefined && traced[c]?.marks !== undefined) {
      classes[c].leadsTo = traced[c].leadsTo;
      classes[c].marks = traced[c].marks;
      if (traced[c].byInstance) classes[c].byInstance = true;
      return false;
    }
    classes[c].leadsTo = [];
    classes[c].marks = [];
    return true;
  });
  await inParallel(chunked(toTrace, TRACE_BATCH), async (chunk) => {
    const data = await sparql(`SELECT DISTINCT ?c ?root WHERE { VALUES ?c { ${chunk.map(q => `wd:${q}`).join(' ')} } VALUES ?root { ${roots} } ?c wdt:P279*/wdt:P361?/wdt:P279* ?root . }`);
    for (const b of data.results.bindings) classes[idOf(b.c.value)].leadsTo.push(idOf(b.root.value));
  }, (done, total) => report('Sorting into disciplines', done, total));

  // A field Wikidata types rather than places (category theory, an instance
  // of "branch of mathematics") leads nowhere by subclass and part of: what
  // it is an instance of says, once.
  const unplaced = Object.keys(classes).filter(c => !classes[c].leadsTo.length && !classes[c].byInstance);
  await inParallel(chunked(unplaced, TRACE_BATCH), async (chunk) => {
    const data = await sparql(`SELECT DISTINCT ?c ?root WHERE { VALUES ?c { ${chunk.map(q => `wd:${q}`).join(' ')} } VALUES ?root { ${roots} } ?c wdt:P31/wdt:P279*/wdt:P361?/wdt:P279* ?root . }`);
    for (const b of data.results.bindings) classes[idOf(b.c.value)].leadsTo.push(idOf(b.root.value));
  }, (done, total) => report('Sorting fields by what they are', done, total));
  unplaced.forEach((c) => { classes[c].byInstance = true; });

  // Markers (unit of measurement): subclass of alone, which is quick.
  const markers = Object.keys(MARKERS).map(q => `wd:${q}`).join(' ');
  await inParallel(chunked(toTrace, 200), async (chunk) => {
    const data = await sparql(`SELECT DISTINCT ?c ?m WHERE { VALUES ?c { ${chunk.map(q => `wd:${q}`).join(' ')} } VALUES ?m { ${markers} } ?c wdt:P279* ?m . }`);
    for (const b of data.results.bindings) classes[idOf(b.c.value)].marks.push(MARKERS[idOf(b.m.value)]);
  }, (done, total) => report('Finding units', done, total));

  return {
    source: mathmoddb ? `Wikidata (CC0), https://www.wikidata.org; ${mathmoddb.source}` : 'Wikidata (CC0), https://www.wikidata.org',
    fetchedAt: new Date().toISOString(),
    query: `items with ${P.inDefiningFormula} qualified by ${P.symbolRepresents}`,
    items, concepts, known, classes,
    ...(mathmoddb ? { mathmoddb } : {}),
  };
}

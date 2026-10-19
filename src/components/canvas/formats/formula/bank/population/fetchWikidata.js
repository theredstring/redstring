/**
 * The formula bank's source, fetched from Wikidata: every item whose defining
 * formula (P2534) has its symbols tied to concepts ("in defining formula",
 * P7235, qualified by "symbol represents", P9758), the concepts and classes
 * those name, how widely each item is written about, and which discipline
 * each class leads to. buildBank.js turns this snapshot into the bank.
 *
 * Runs wherever fetch does: the app (Settings → Data → Formula Bank) and the
 * scripts (scripts/formula-bank). Wikidata is CC0; nothing here is written by
 * hand, and each item keeps its Q number.
 */
import { DISCIPLINE_ROOTS, MARKERS } from './disciplines.js';

const SPARQL = 'https://query.wikidata.org/sparql';
const API = 'https://www.wikidata.org/w/api.php';
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
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} { source, fetchedAt, items, concepts, classes }
 */
export async function fetchFormulaSnapshot({ headers = {}, onProgress, previous = null, signal } = {}) {
  const report = (stage, done, total) => onProgress?.({ stage, done, total });

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
  const known = previous?.classes || {};
  const toTrace = Object.keys(classes).filter((c) => {
    if (known[c]?.leadsTo !== undefined && known[c]?.marks !== undefined) {
      classes[c].leadsTo = known[c].leadsTo;
      classes[c].marks = known[c].marks;
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

  // Markers (unit of measurement): subclass of alone, which is quick.
  const markers = Object.keys(MARKERS).map(q => `wd:${q}`).join(' ');
  await inParallel(chunked(toTrace, 200), async (chunk) => {
    const data = await sparql(`SELECT DISTINCT ?c ?m WHERE { VALUES ?c { ${chunk.map(q => `wd:${q}`).join(' ')} } VALUES ?m { ${markers} } ?c wdt:P279* ?m . }`);
    for (const b of data.results.bindings) classes[idOf(b.c.value)].marks.push(MARKERS[idOf(b.m.value)]);
  }, (done, total) => report('Finding units', done, total));

  return {
    source: 'Wikidata (CC0), https://www.wikidata.org',
    fetchedAt: new Date().toISOString(),
    query: `items with ${P.inDefiningFormula} qualified by ${P.symbolRepresents}`,
    items, concepts, classes,
  };
}

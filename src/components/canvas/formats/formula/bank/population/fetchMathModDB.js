/**
 * The formula bank's second source: MathModDB, the MaRDI portal's knowledge
 * graph of mathematical models (https://portal.mardi4nfdi.de/wiki/MathModDB,
 * CC BY 4.0). It fills in where Wikidata is thin: models of epidemics, enzyme
 * reactions, populations and materials, each formula's symbols tied to the
 * quantities they stand for, the way Wikidata ties them.
 *
 * Its shape: a discipline contains research problems, each modelled by
 * models, each containing formulas (with the role each plays in it: a
 * governing equation, an initial condition), each symbol of which is a
 * quantity. Many of these items carry their Wikidata number, which is how
 * they join the bank's Wikidata concepts and sections.
 *
 * Read through the portal's Wikibase API, which a browser may ask (its query
 * service may not): from the items listed in `seeds` (the script finds them
 * all with one query; the app starts from the ones the bank shipped with),
 * following what each contains to everything under it.
 */
import { MATHMODDB_ENTITY } from './sources.js';

export const MATHMODDB = 'https://portal.mardi4nfdi.de';
const API = `${MATHMODDB}/w/api.php`;
const SPARQL = 'https://query.portal.mardi4nfdi.de/sparql';
const BATCH = 50;
const PAUSE_MS = 150;

const P = {
  instanceOf: 'P31',
  community: 'P1495',
  contains: 'P1560',
  modelledBy: 'P1513',
  specializedBy: 'P1684',
  definingFormula: 'P989',
  inDefiningFormula: 'P983',
  symbolRepresents: 'P984',
  role: 'P560',
  wikidata: 'P12',
  longDescription: 'P1459',
  assumes: 'P1674',
};
const COMMUNITY = 'Q6534265';
/** What each kind of item is, by its MathModDB class. */
export const KINDS = {
  Q60231: 'discipline', Q6534292: 'problem', Q68663: 'model', Q96183: 'formula',
  Q6534237: 'quantity', Q6534245: 'quantity',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const label = (e) => e?.labels?.en?.value || null;
const description = (e) => e?.descriptions?.en?.value || null;
const claims = (e, p) => (e?.claims?.[p] || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value');
const itemValues = (e, p) => claims(e, p).map(c => c.mainsnak.datavalue.value.id).filter(Boolean);
const stringValues = (e, p) => claims(e, p).map(c => c.mainsnak.datavalue.value).filter(v => typeof v === 'string');
const qualifierItems = (c, p) => (c.qualifiers?.[p] || []).map(q => q.datavalue?.value?.id).filter(Boolean);
const wikidataOf = (e) => stringValues(e, P.wikidata).find(v => /^Q\d+$/.test(v)) || null;

/** Every MathModDB discipline, problem, model and formula, by one query (a script's start; a browser may not ask it). */
export async function findMathModDBSeeds({ headers = {}, signal } = {}) {
  const kinds = Object.keys(KINDS).filter(k => KINDS[k] !== 'quantity').map(k => `<${MATHMODDB_ENTITY}${k}>`).join(' ');
  const query = `SELECT DISTINCT ?s WHERE { ?s <${MATHMODDB}/prop/direct/${P.community}> <${MATHMODDB_ENTITY}${COMMUNITY}> ; <${MATHMODDB}/prop/direct/${P.instanceOf}> ?k . VALUES ?k { ${kinds} } }`;
  const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, { headers: { Accept: 'application/sparql-results+json', ...headers }, signal });
  if (!res.ok) throw new Error(`MathModDB answered ${res.status}`);
  const data = await res.json();
  return data.results.bindings.map(b => b.s.value.split('/').pop());
}

/**
 * @param {object} options
 * @param {string[]} options.seeds - items to start from
 * @returns {Promise<object>} { source, fetchedAt, disciplines, problems, models, formulas, quantities, roles }
 */
export async function fetchMathModDB({ seeds, headers = {}, onProgress, signal } = {}) {
  const report = (stage, done, total) => onProgress?.({ stage, done, total });

  async function getJson(url, tries = 4) {
    for (let i = 0; ; i++) {
      if (signal?.aborted) throw new Error('Stopped');
      let res;
      try {
        res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal });
      } catch (err) {
        if (signal?.aborted || i >= tries) throw err;
        await sleep(3000 * (i + 1));
        continue;
      }
      if (res.ok) return res.json();
      if (i >= tries || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`MathModDB answered ${res.status}`);
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * (i + 1));
    }
  }
  async function read(ids) {
    const out = {};
    const list = [...new Set(ids)];
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const data = await getJson(`${API}?action=wbgetentities&format=json&origin=*&languages=en&props=labels|descriptions|claims&ids=${chunk.join('|')}`);
      if (data.error) throw new Error(`MathModDB: ${data.error.info || data.error.code}`);
      Object.assign(out, data.entities || {});
      report('Reading MathModDB', Math.min(i + BATCH, list.length), list.length);
      await sleep(PAUSE_MS);
    }
    return out;
  }

  const out = { disciplines: {}, problems: {}, models: {}, formulas: {}, quantities: {}, roles: {} };
  const seen = new Set();
  let next = [...new Set(seeds)];
  const roleIds = new Set();
  // Down from the seeds, through what each contains, until nothing is new.
  while (next.length) {
    next.forEach(id => seen.add(id));
    const raw = await read(next);
    const found = [];
    const follow = (id) => { if (id && !seen.has(id)) { seen.add(id); found.push(id); } };
    for (const [id, e] of Object.entries(raw)) {
      if (!e || e.missing !== undefined) continue;
      const kind = itemValues(e, P.instanceOf).map(k => KINDS[k]).find(Boolean);
      if (!kind) continue;
      const base = { id, label: label(e), description: description(e), wikidata: wikidataOf(e) };
      if (kind === 'quantity') {
        out.quantities[id] = base;
      } else if (kind === 'discipline') {
        out.disciplines[id] = { ...base, problems: itemValues(e, P.contains), narrower: itemValues(e, P.specializedBy) };
        [...out.disciplines[id].problems, ...out.disciplines[id].narrower].forEach(follow);
      } else if (kind === 'problem') {
        out.problems[id] = { ...base, models: itemValues(e, P.modelledBy), narrower: itemValues(e, P.specializedBy) };
        [...out.problems[id].models, ...out.problems[id].narrower].forEach(follow);
      } else {
        // A model, or a formula: both contain formulas (a system its equations), each in a role.
        const contains = claims(e, P.contains).map(c => ({ id: c.mainsnak.datavalue.value.id, roles: qualifierItems(c, P.role) }));
        contains.forEach(c => { follow(c.id); c.roles.forEach(r => roleIds.add(r)); });
        itemValues(e, P.specializedBy).forEach(follow);
        const entry = {
          ...base,
          contains,
          narrower: itemValues(e, P.specializedBy),
          longDescription: stringValues(e, P.longDescription)[0] || null,
          assumes: itemValues(e, P.assumes),
        };
        if (kind === 'model') {
          out.models[id] = entry;
        } else {
          const symbols = claims(e, P.inDefiningFormula).map(c => ({
            tex: c.mainsnak.datavalue.value,
            represents: qualifierItems(c, P.symbolRepresents),
          }));
          symbols.forEach(s => s.represents.forEach(follow));
          out.formulas[id] = { ...entry, formulas: stringValues(e, P.definingFormula), symbols };
        }
      }
    }
    next = found;
  }
  // What role a formula plays in its model (governing equation, initial condition), by name.
  const roles = await read([...roleIds]);
  for (const [id, e] of Object.entries(roles)) out.roles[id] = label(e);

  return {
    source: 'MathModDB, MaRDI portal (CC BY 4.0), https://portal.mardi4nfdi.de/wiki/MathModDB',
    fetchedAt: new Date().toISOString(),
    ...out,
  };
}

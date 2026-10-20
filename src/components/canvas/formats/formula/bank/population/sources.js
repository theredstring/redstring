/**
 * Where the bank's items come from. An id is a Wikidata number (Q11518), or a
 * MathModDB one marked as such (mardi:Q6674292): the MaRDI portal numbers its
 * items the same way, and the same number there is something else.
 */
export const WIKIDATA_ENTITY = 'http://www.wikidata.org/entity/';
export const MATHMODDB_ENTITY = 'https://portal.mardi4nfdi.de/entity/';
const MATHMODDB_PREFIX = 'mardi:';

export const mathModDBId = (q) => `${MATHMODDB_PREFIX}${q}`;
export const isMathModDBId = (id) => String(id).startsWith(MATHMODDB_PREFIX);

/** The item an id names, as its IRI. */
export const itemIri = (id) => (isMathModDBId(id)
  ? `${MATHMODDB_ENTITY}${id.slice(MATHMODDB_PREFIX.length)}`
  : `${WIKIDATA_ENTITY}${id}`);

/** The page a person reads it on. */
export const itemPage = (id) => (isMathModDBId(id)
  ? `https://portal.mardi4nfdi.de/wiki/Item:${id.slice(MATHMODDB_PREFIX.length)}`
  : `https://www.wikidata.org/wiki/${id}`);

/**
 * Reading a Wikidata export (Special:EntityData/Q….ttl, or a slice of a dump).
 *
 * An item's page is one Thing described with a lot of machinery: every claim
 * is written twice (once directly, once as a statement node with its rank,
 * qualifiers and references), every value gets a node of its own, and every
 * sitelink is a page about the item. Read as an ontology, all of that became
 * Things: image files, external ID URLs, statement codes, "Best Rank".
 *
 * What a Wikidata export means in Redstring's terms:
 *  - Items (Q numbers) are Things. Nothing else is.
 *  - Direct claims (wdt:) between items are the relations; subclass of is the
 *    specificity ladder, and so is instance of for an item that is a subclass
 *    of nothing (an individual: Garfield under Cat). A class's instance of
 *    names a class of classes and is kept as a relation instead. Has
 *    part / part of are composition. A direct claim to a value that isn't an
 *    item (a string, a quantity, an image, a URL) is not a Thing.
 *  - A property's name is its own label (wd:P527 "has part(s)"), read onto the
 *    direct-claim IRI the relations use (wdt:P527).
 *  - External IDs, as Wikidata normalizes them to IRIs (wdtn:, e.g. the ChEBI
 *    IRI for water), are kept as data on the Thing, like an OBO xref.
 *  - Wikimedia housekeeping claims (the item's category, template, WikiProjects,
 *    the encyclopedias that describe it) say something about Wikipedia, not
 *    about the subject, and are left out.
 *  - Items only mentioned in a qualifier or a reference (units, sources) carry
 *    a label but take part in no claim kept here, so they're dropped.
 */

export const WD = 'http://www.wikidata.org/entity/';
export const WDT = 'http://www.wikidata.org/prop/direct/';
export const WDTN = 'http://www.wikidata.org/prop/direct-normalized/';
export const WDT_INSTANCE_OF = `${WDT}P31`;
export const WDT_SUBCLASS_OF = `${WDT}P279`;
export const WIKIBASE = 'http://wikiba.se/ontology#';
export const WIKIBASE_ITEM = `${WIKIBASE}Item`;
/** The dataset node of an export: `data:Q283 schema:about wd:Q283`. */
export const WD_DATA = 'https://www.wikidata.org/wiki/Special:EntityData/';

const WIKIDATA_HOST = 'http://www.wikidata.org/';
const ITEM = /^http:\/\/www\.wikidata\.org\/entity\/Q\d+$/;
const PROPERTY = /^http:\/\/www\.wikidata\.org\/entity\/(P\d+)$/;

export const isWikidataItem = (iri) => ITEM.test(String(iri));

/** wd:P527 → wdt:P527, or null when the IRI isn't a property entity. */
export const directClaimOf = (iri) => {
  const m = String(iri).match(PROPERTY);
  return m ? `${WDT}${m[1]}` : null;
};

/**
 * Wikidata's own bookkeeping: statement, value and reference nodes, and every
 * prop/ namespace except the direct claims (p:, ps:, pq:, pr:, psv:, wdno:...).
 * Items, property entities and wdt:/wdtn: are not machinery.
 */
export const isWikidataMachinery = (iri) => {
  const s = String(iri);
  if (!s.startsWith(WIKIDATA_HOST)) return s.startsWith(WIKIBASE);
  if (ITEM.test(s) || PROPERTY.test(s)) return false;
  if (s.startsWith(WDT) || s.startsWith(WDTN)) return false;
  return true;
};

/**
 * Direct claims about Wikimedia rather than the subject. Matched on the
 * property, so a claim like "described by source" is left out whatever it
 * points at.
 */
export const HOUSEKEEPING_PROPERTIES = new Set([
  'P301',  // category's main topic
  'P360',  // is a list of
  'P910',  // topic's main category
  'P971',  // category combines topics
  'P1151', // topic's main Wikimedia portal
  'P1204', // Wikimedia portal's main topic
  'P1343', // described by source
  'P1423', // template has topic
  'P1424', // topic's main template
  'P1753', // list related to category
  'P1754', // category related to list
  'P2354', // has list
  'P2959', // permanent duplicated item
  'P4224', // category contains
  'P5008', // on focus list of Wikimedia project
  'P5125', // Wikimedia outline
  'P6104', // maintained by WikiProject
  'P7084', // related category
  'P7867', // category for maps
  'P8989', // category for the view of the item
].map((p) => `${WDT}${p}`));

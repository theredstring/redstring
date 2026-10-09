/**
 * Ontology import, end to end, with no store and no DOM.
 *
 *   indexOntology()  file text → ontology index (the slow, streaming part)
 *   summarizeIndex() what's in it, for the import dialog and the CLI
 *   planImport()     index + slice options → plan, universe state, report
 *
 * The browser runs this inside a worker (ontologyImport.worker.js) and merges
 * the resulting state into the live store; the CLI runs it in-process. Both get
 * the same universe from the same file and options.
 */

import { detectFormat, parseQuads, FORMATS } from './parseRdf.js';
import { OntologyIndexBuilder, indexOboGraphs } from './ontologyIndex.js';
import { computeSlice } from './slice.js';
import { buildImportPlan } from './plan.js';
import { buildUniverseState } from './buildUniverse.js';

export { FORMATS, detectFormat, ACCEPTED_EXTENSIONS } from './parseRdf.js';
export { searchTerms, resolveTermRef } from './slice.js';

async function* asChunks(source) {
  if (typeof source === 'string') { yield source; return; }
  for await (const chunk of source) yield typeof chunk === 'string' ? chunk : String(chunk);
}

/**
 * Parse and index an ontology.
 *
 * @param {Object} p
 * @param {string|AsyncIterable<string>} p.source - the file's text, whole or in chunks
 * @param {string} p.fileName - used to pick the parser and to name the source
 * @param {string} [p.format] - force a format (one of FORMATS)
 * @param {string} [p.sample] - the first few KB, for sniffing when the name is ambiguous
 * @param {Function} [p.onProgress] - ({ consumed, quads }) as chunks are parsed
 */
export async function indexOntology({ source, fileName, format = null, sample = '', onProgress = null }) {
  const head = sample || (typeof source === 'string' ? source.slice(0, 4096) : '');
  const fmt = format || detectFormat(fileName, head);
  if (!fmt) throw new Error(`Can't tell what format "${fileName}" is. Supported: Turtle, N-Triples, N-Quads, TriG, RDF/XML (.owl), JSON-LD and OBO Graphs JSON.`);
  const sourceName = baseName(fileName);

  if (fmt === FORMATS.OBOGRAPHS) {
    let text = '';
    for await (const chunk of asChunks(source)) {
      text += chunk;
      onProgress?.({ consumed: text.length, quads: 0 });
    }
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
    text = null;
    return indexOboGraphs(doc, { sourceName });
  }

  const builder = new OntologyIndexBuilder();
  await parseQuads({ source, format: fmt, onQuad: (q) => builder.addQuad(q), onProgress });
  return builder.finish({ format: fmt, sourceName });
}

/** "chebi_lite.owl.gz" → "chebi_lite" */
export function baseName(fileName) {
  return String(fileName || 'ontology').split(/[\\/]/).pop().replace(/\.gz$/i, '').replace(/\.[^.]+$/, '') || 'ontology';
}

/**
 * What an index holds: enough to show before anything is imported.
 */
export function summarizeIndex(index) {
  let deprecated = 0;
  let labelled = 0;
  const namespaces = new Map();
  for (const term of index.terms.values()) {
    if (term.deprecated) deprecated++;
    if (term.label) labelled++;
    const ns = namespaceOf(term.iri);
    namespaces.set(ns, (namespaces.get(ns) || 0) + 1);
  }
  return {
    ontology: index.ontology,
    format: index.format,
    sourceName: index.sourceName,
    terms: index.terms.size,
    labelled,
    deprecated,
    relations: index.properties.size,
    namespaces: [...namespaces.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 8)
      .map(([prefix, count]) => ({ prefix, count })),
    stats: index.stats,
  };
}

/**
 * The namespace part of an IRI: up to the last `#` or `/`, or for OBO-style
 * IRIs (`.../obo/CHEBI_15377`) up to and including the `_`.
 */
export function namespaceOf(iri) {
  const s = String(iri);
  const obo = s.match(/^(.*\/obo\/[A-Za-z]+_)\d/);
  if (obo) return obo[1];
  const cut = Math.max(s.lastIndexOf('#'), s.lastIndexOf('/'));
  return cut > 0 ? s.slice(0, cut + 1) : s;
}

/**
 * Slice, plan and build.
 *
 * @param {Object} index
 * @param {Object} [options] - slice options (roots, depth, namespaces,
 *   includeDeprecated, includeAncestors, includePartners) plus importedAt
 * @returns {{slice: Object, plan: Object, state: Object, report: Object}}
 */
export function planImport(index, options = {}) {
  const slice = computeSlice(index, options);
  const plan = buildImportPlan(index, slice, {
    sourceName: index.sourceName || null,
    importedAt: options.importedAt || null,
  });
  const state = buildUniverseState(plan);
  return { slice, plan, state, report: { ...plan.report, source: { title: plan.source.title, iri: plan.source.iri, license: plan.source.license, version: plan.source.version } } };
}

/** Convenience for tests and scripts: text in, universe state out. */
export async function importOntologyText(text, fileName, options = {}) {
  const index = await indexOntology({ source: text, fileName, format: options.format || null });
  return { index, ...planImport(index, options) };
}

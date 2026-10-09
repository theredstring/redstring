/**
 * Parse an RDF or ontology file into quads, chunk by chunk.
 *
 * One entry point for every serialization the importer takes. Turtle, TriG,
 * N-Triples and N-Quads go through N3.js; RDF/XML (which is what most `.owl`
 * files are) through rdfxml-streaming-parser; JSON-LD through jsonld.js with the
 * app's allowlisted context loader. OBO Graphs JSON is not RDF and is read
 * separately (oboGraphs.js).
 *
 * The text arrives as chunks so a 200 MB ontology never has to sit in memory as
 * one string: the browser feeds `File.stream()` decoded in a worker, Node feeds
 * a read stream. Quads come out through `onQuad` as each chunk is parsed.
 * JSON-LD is the exception — its parser needs the whole document — and is rare
 * for large ontologies.
 */

import { StreamParser } from 'n3';
import { RdfXmlParser } from 'rdfxml-streaming-parser';
import jsonld from 'jsonld';
import { JSONLD_SAFE_OPTIONS } from '../jsonldLoader.js';

export const FORMATS = Object.freeze({
  TURTLE: 'turtle',
  TRIG: 'trig',
  NTRIPLES: 'ntriples',
  NQUADS: 'nquads',
  RDFXML: 'rdfxml',
  JSONLD: 'jsonld',
  OBOGRAPHS: 'obographs',
});

const EXTENSION_FORMATS = {
  ttl: FORMATS.TURTLE,
  turtle: FORMATS.TURTLE,
  n3: FORMATS.TURTLE,
  trig: FORMATS.TRIG,
  nt: FORMATS.NTRIPLES,
  ntriples: FORMATS.NTRIPLES,
  nq: FORMATS.NQUADS,
  nquads: FORMATS.NQUADS,
  owl: FORMATS.RDFXML,
  rdf: FORMATS.RDFXML,
  xml: FORMATS.RDFXML,
  rdfxml: FORMATS.RDFXML,
  jsonld: FORMATS.JSONLD,
};

/** Formats the picker accepts, as `accept` extensions. */
export const ACCEPTED_EXTENSIONS = ['.ttl', '.turtle', '.n3', '.trig', '.nt', '.nq', '.owl', '.rdf', '.xml', '.jsonld', '.json'];

/**
 * Which parser a file needs.
 *
 * The extension decides when it is unambiguous. `.json` is not: it can be
 * JSON-LD or OBO Graphs JSON, so the first bytes decide (`"graphs"` with no
 * `@context` is OBO Graphs). A file with no usable extension is sniffed too.
 *
 * @param {string} filename
 * @param {string} [sample] - the first few KB of the file
 * @returns {string|null} one of FORMATS, or null when it can't tell
 */
export function detectFormat(filename, sample = '') {
  const ext = String(filename || '').toLowerCase().replace(/\.gz$/, '').split('.').pop();
  if (ext && EXTENSION_FORMATS[ext]) return EXTENSION_FORMATS[ext];

  const head = String(sample || '').replace(/^\uFEFF/, '').trimStart();
  if (ext === 'json' || head.startsWith('{') || head.startsWith('[')) {
    if (/"@context"|"@id"|"@graph"/.test(head)) return FORMATS.JSONLD;
    if (/"graphs"\s*:/.test(head)) return FORMATS.OBOGRAPHS;
    return ext === 'json' ? FORMATS.JSONLD : null;
  }
  if (head.startsWith('<?xml') || /^<rdf:RDF|^<RDF/.test(head)) return FORMATS.RDFXML;
  if (/^@prefix|^@base|^PREFIX\s|^BASE\s/im.test(head)) return FORMATS.TURTLE;
  if (/^(<[^>]+>|_:\S+)\s+<[^>]+>\s+.+\s\.\s*$/m.test(head)) return FORMATS.NTRIPLES;
  return null;
}

/** Turn a string or an (async) iterable of strings into an async iterable of strings. */
async function* asChunks(source) {
  if (typeof source === 'string') {
    // Large strings are fed in slices so progress can be reported.
    const SLICE = 1 << 20;
    for (let i = 0; i < source.length; i += SLICE) yield source.slice(i, i + SLICE);
    return;
  }
  for await (const chunk of source) yield typeof chunk === 'string' ? chunk : String(chunk);
}

/** Feed chunks into a Node-style stream parser and resolve when it ends. */
function runStreamParser(parser, source, onQuad, onProgress) {
  return new Promise((resolve, reject) => {
    let count = 0;
    let done = false;
    const fail = (error) => { if (!done) { done = true; reject(error); } };
    parser.on('data', (quad) => { count++; onQuad(quad); });
    parser.on('error', fail);
    parser.on('end', () => { if (!done) { done = true; resolve(count); } });
    (async () => {
      let consumed = 0;
      for await (const chunk of asChunks(source)) {
        if (done) return;
        parser.write(chunk);
        consumed += chunk.length;
        onProgress?.({ consumed, quads: count });
      }
      parser.end();
    })().catch(fail);
  });
}

/**
 * Parse RDF text into quads.
 *
 * @param {Object} p
 * @param {string|AsyncIterable<string>|Iterable<string>} p.source - the file's text
 * @param {string} p.format - one of FORMATS (not OBOGRAPHS)
 * @param {(quad: Object) => void} p.onQuad - receives RDF/JS quads
 * @param {string} [p.baseIRI] - for relative IRIs
 * @param {(progress: {consumed: number, quads: number}) => void} [p.onProgress]
 * @returns {Promise<number>} how many quads were parsed
 */
export async function parseQuads({ source, format, onQuad, baseIRI, onProgress }) {
  switch (format) {
    case FORMATS.TURTLE:
    case FORMATS.TRIG:
    case FORMATS.NTRIPLES:
    case FORMATS.NQUADS: {
      const n3Format = {
        [FORMATS.TURTLE]: 'text/turtle',
        [FORMATS.TRIG]: 'application/trig',
        [FORMATS.NTRIPLES]: 'application/n-triples',
        [FORMATS.NQUADS]: 'application/n-quads',
      }[format];
      return runStreamParser(new StreamParser({ format: n3Format, baseIRI }), source, onQuad, onProgress);
    }
    case FORMATS.RDFXML:
      return runStreamParser(new RdfXmlParser({ baseIRI: baseIRI || 'urn:redstring:import:' }), source, onQuad, onProgress);
    case FORMATS.JSONLD: {
      let text = '';
      for await (const chunk of asChunks(source)) text += chunk;
      let doc;
      try { doc = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
      // Remote @context URLs resolve only from the vocabulary allowlist (jsonldLoader.js).
      const quads = await jsonld.toRDF(doc, { safe: false, ...JSONLD_SAFE_OPTIONS, ...(baseIRI ? { base: baseIRI } : {}) });
      for (const quad of quads) onQuad(quad);
      onProgress?.({ consumed: text.length, quads: quads.length });
      return quads.length;
    }
    default:
      throw new Error(`Unsupported RDF format: ${format}`);
  }
}

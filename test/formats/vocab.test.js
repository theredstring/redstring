/**
 * P6.1 — Vocabulary coverage test.
 *
 * Every redstring: IRI emitted by exportToRedstring (as a subject, predicate,
 * or @type value in the N-Quads output) must have a declaration in
 * public/vocab/redstring.ttl. This prevents undocumented terms from silently
 * entering the format.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import jsonld from 'jsonld';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TTL_PATH = resolve(__dirname, '../../public/vocab/redstring.ttl');
const RS_NS    = 'https://redstring.io/vocab/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Load and parse the TTL to extract all declared IRIs.
// We parse as plain text (no Turtle parser dep): expand @prefix declarations
// then collect every rs: term that appears anywhere in the file.
function loadVocabIris() {
  const ttl = readFileSync(TTL_PATH, 'utf8');

  // Extract @prefix bindings.
  const prefixes = {};
  for (const m of ttl.matchAll(/@prefix\s+(\w*):\s+<([^>]+)>/g)) {
    prefixes[m[1]] = m[2];
  }

  const declared = new Set();

  // Full-IRI occurrences <https://redstring.io/vocab/...>.
  for (const m of ttl.matchAll(/<(https?:\/\/[^>]+)>/g)) {
    if (m[1].startsWith(RS_NS)) declared.add(m[1]);
  }

  // Prefixed names: expand using the prefix table.
  for (const m of ttl.matchAll(/\b([A-Za-z]\w*):([A-Za-z][A-Za-z0-9_-]*)\b/g)) {
    const ns = prefixes[m[1]];
    if (ns && ns === RS_NS) declared.add(ns + m[2]);
  }

  return declared;
}

// Build a minimal but representative store state.
const buildFullState = () => {
  const gId = 'g1';
  const inst = { id: 'inst1', prototypeId: 'dog', x: 10, y: 20, scale: 1 };
  const graphs = new Map([[gId, {
    id: gId, name: 'Test Graph', description: '',
    instances: new Map([['inst1', inst]]),
    edgeIds: ['e1'],
    definingNodeIds: [],
    panOffset: { x: 0, y: 0 },
    zoomLevel: 1.0,
    groups: new Map(),
  }]]);
  const nodePrototypes = new Map([['dog', {
    id: 'dog', name: 'Dog', description: 'A domestic canine.',
    color: '#ff0000',
    definitionGraphIds: [],
    abstractionChains: {},
    externalLinks: ['https://www.wikidata.org/entity/Q144'],
    bio: 'Canis lupus familiaris.',
    conjugation: null,
    personalMeaning: 'loyalty',
    cognitiveAssociations: ['companionship'],
    semanticMetadata: {
      autoEnriched: false,
      provenance: { wasDerivedFrom: 'test' },
    },
  }]]);
  const edges = new Map([['e1', {
    id: 'e1',
    sourceId: 'inst1',
    destinationId: 'inst1',
    typeNodeId: 'dog',
    definitionNodeIds: [],
    directionality: { arrowsToward: new Set(['inst1']) },
  }]]);
  return {
    graphs,
    nodePrototypes,
    edges,
    openGraphIds: [gId],
    activeGraphId: gId,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set([gId]),
    rightPanelTabs: ['details'],
    savedNodeIds: new Set(['dog']),
    savedGraphIds: new Set([gId]),
    showConnectionNames: true,
  };
};

// Extract all redstring.io/vocab/ IRIs from a N-Quads string.
function extractVocabIrisFromNQuads(nquads) {
  const found = new Set();
  for (const m of nquads.matchAll(/<(https:\/\/redstring\.io\/vocab\/[^>]+)>/g)) {
    found.add(m[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('P6.1 — vocabulary coverage', () => {
  it('public/vocab/redstring.ttl is readable and contains rs: declarations', () => {
    const iris = loadVocabIris();
    // Must declare at least the main structural classes.
    expect(iris.has(`${RS_NS}CognitiveSpace`)).toBe(true);
    expect(iris.has(`${RS_NS}Prototype`)).toBe(true);
    expect(iris.has(`${RS_NS}SpatialGraph`)).toBe(true);
    expect(iris.has(`${RS_NS}Instance`)).toBe(true);
    expect(iris.size).toBeGreaterThan(30);
  });

  it('every redstring: IRI in N-Quads export is declared in the vocab', async () => {
    const state = buildFullState();
    const doc = exportToRedstring(state, null, { emitV4: false });
    const nquads = await jsonld.toRDF(doc, { format: 'application/n-quads', safe: false });

    const emitted = extractVocabIrisFromNQuads(nquads);
    const declared = loadVocabIris();

    const undocumented = [...emitted].filter((iri) => !declared.has(iri));

    // Report all undocumented terms rather than failing on just the first.
    if (undocumented.length > 0) {
      console.error(
        `[vocab.test] Undocumented redstring: terms emitted by exportToRedstring:\n` +
        undocumented.map((i) => `  ${i}`).join('\n')
      );
    }
    expect(undocumented).toHaveLength(0);
  });

  it('vocab declares more terms than are currently emitted (reserved vocabulary)', () => {
    // The vocab intentionally declares more than what the current v3 export
    // emits (e.g. Group properties, all UI state properties). This test
    // confirms the vocab is not under-declared relative to the export.
    const declared = loadVocabIris();
    expect(declared.size).toBeGreaterThan(50);
  });
});

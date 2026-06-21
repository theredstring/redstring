---
compendium_version: 1
category: semantic-web
last_reviewed: 2026-06-13
---

# Semantic Web and Knowledge Discovery — Document Index

## Summary

These documents cover the RDF/JSON-LD dual-format storage architecture, SPARQL client (direct-fetch, no proxy), semantic enrichment via Wikipedia/Wikidata/DBpedia, and the connection browser for materializing semantic relationships as native Redstring nodes. Redstring uses semantic web infrastructure as an "invisible substrate" — it augments the graph with external knowledge without replacing Redstring's native node model. Key code paths: `src/services/sparqlClient.js`, `src/services/knowledgeFederation.js`, `src/services/semanticWebQuery.js`, `src/services/wikipediaEnrichment.js`, `src/components/SemanticEditor.jsx`, `src/components/LeftAIView.jsx`.

**Image architecture note**: Wikipedia images are stored as **direct URLs, never base64 data URLs** — converting to data URLs causes V8 OOM during serialization. See the "Image Data OOM Prevention Architecture" entry in the project memory for the full pattern.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [SEMANTIC_WEB_INTEGRATION.md](../SEMANTIC_WEB_INTEGRATION.md) | Core dual-format architecture: how Redstring nodes map to RDF resources, JSON-LD context, data model translation layer | Understanding the semantic web data model; extending the JSON-LD context |
| [RDF_INTEGRATION_README.md](../RDF_INTEGRATION_README.md) | RDF resolution architecture, direct-fetch SPARQL client design, background processing for enrichment, federated query patterns | Working with `sparqlClient.js` or `knowledgeFederation.js`; adding new SPARQL endpoints |
| [SEMANTIC_DISCOVERY_GUIDE.md](../SEMANTIC_DISCOVERY_GUIDE.md) | User guide for semantic discovery: property-path queries, the connection browser UI, how to import Wikidata relationships as native nodes | Understanding or extending the semantic discovery UI in `SemanticEditor.jsx` |

---

## Historical Documents

| File | Summary | Consult when |
|------|---------|--------------|
| [WIKIPEDIA_IMPROVEMENTS.md](../WIKIPEDIA_IMPROVEMENTS.md) | Documents disambiguation handling and Wikipedia photo extraction improvements (thumbnail URL sizing, aspect ratio storage) | Debugging Wikipedia enrichment; understanding why images use URL-based caching |
| [SEMANTIC_WEB_ENHANCEMENT.md](../SEMANTIC_WEB_ENHANCEMENT.md) | Documents OWL `sameAs` additions to the JSON-LD context and external site integration — **superseded-by: SEMANTIC_WEB_INTEGRATION.md** for the current context shape | Understanding the evolution of the JSON-LD context; historical OWL alignment work |

---

## Future-Intent Documents

| File | Summary | Note |
|------|---------|------|
| [SEMANTIC_WEB_IMPROVEMENTS_PLAN.md](../SEMANTIC_WEB_IMPROVEMENTS_PLAN.md) | Plans for authentication resilience, persistent OAuth refresh tokens for Wikidata, and background re-enrichment scheduling | **Not implemented** — design decisions only; no code exists for auth resilience or scheduled re-enrichment |

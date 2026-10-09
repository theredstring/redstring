# Ontology Import

Status: **current** (October 2026). The deterministic import path. A "smart" planner (wizard or a small decision model) is planned to sit on top of it; see *Where a smart planner goes* below.

Redstring reads an ontology file (OWL, Turtle, N-Triples, N-Quads, TriG, JSON-LD, OBO Graphs JSON, gzipped or not), takes a slice of it, and merges it into a universe as Things, types, composition webs and connections. Every term keeps its IRI, so the same term is the same Thing in every import, every pack and every universe.

Entry points:

- **App:** File → Import Ontology…, or Import Ontology… in the Universes panel's Load menu (`OntologyImportDialog.jsx`, mounted by `ModalHosts`, opened by the `openOntologyImport` window event).
- **CLI:** `redstring import <file> [--root <IRI|CURIE|label>]... [--depth <n|all>] [--namespace <iri-prefix>]... [--include-deprecated] [--keep-labels] [--no-kinds] [--dry-run] [--out <pack.redstring>]`. Without `--out` it merges into the active universe (through a running Redstring if there is one, via the `mergeRedstringPack` store action); with `--out` it writes a standalone pack universe with its webs laid out.

## Pipeline

All of it is plain JS under `src/formats/ontology/`, with no store and no DOM until the final merge:

| Step | File | What it does |
|---|---|---|
| Parse | `parseRdf.js` | Chunked parsing: N3.js (Turtle, TriG, N-Triples, N-Quads), rdfxml-streaming-parser (RDF/XML, `.owl`), jsonld.js with the app's allowlisted context loader (JSON-LD). Picks the parser from the extension, or sniffs the first bytes (`.json` can be JSON-LD or OBO Graphs). |
| Index | `ontologyIndex.js` | One pass over the quads (or OBO Graphs JSON) into a compact per-term index keyed by IRI: label, definition, synonyms, parents, relations, equivalents, cross-references, deprecation. Sorted at the end, so every serialization of one ontology gives the same index (the tests hold all five formats to this). |
| Slice | `slice.js` | Roots (IRI, OBO CURIE or label) plus everything more specific, to a depth. Adds ancestors, so ladders reach the top, and parts of selected wholes, so composition webs are complete. Deprecated terms are left out unless asked for; a namespace filter is optional. |
| Plan | `plan.js` | The deterministic rules below. Every ID is UUID v5 of an IRI (namespace `IMPORT_NAMESPACE`, never to change). |
| Build | `buildUniverse.js` | The plan as a universe state shaped exactly like a loaded `.redstring` file. |
| Merge | `services/ontologyImport.js` | `mergeUniverseState` (additive, like merging two universes), offscreen layout of the webs it added, save before and after. |

In the browser, steps 1–5 run in `ontologyImport.worker.js`. The index stays in the worker, so searching for a root and previewing a slice cost milliseconds after the one read. `ontologyHandlers.js` holds the same handlers for in-process use (tests, Node).

## The rules

These follow Redstring's model. Read `aiinstructions.txt` and the conceptual notes before changing them.

- **Every term is a Thing.** OWL classes, individuals and SKOS concepts all become Things. Redstring has no class/individual split: a leaf is a Thing with nothing more specific named yet.
- **`rdf:type` and `rdfs:subClassOf` are the same step down the specificity axis** (so are `skos:broader`, and Wikidata P31/P279). Garfield sits under Cat the way Cat sits under Mammal.
- **The type is the next lens down**: the term's most specific parent inside the slice (the one furthest from the top; ties broken by IRI). Linked types make the carousel, so the full ladder shows without being stored (`typeLadderFor` in `abstractionSpec.js`). Other parents are kept on the Thing as data (`semanticMetadata.ontology.otherParents`).
- **Composition becomes webs.** `has part` / `part of` (BFO, Dublin Core, schema.org, Wikidata) put the part in its whole's web, whichever side declares it. A web is the inside of its Thing, so it holds only parts.
- **A Thing with more specific kinds opens to them.** It gets a web of its kinds ("The kinds of Disease, from Mondo Disease Ontology."): every direct kind inside the slice, whichever parent is that kind's type, so a kind with two parents is in both webs. A kind is a subset of the set its Thing names, so this is composition too, of the set rather than of the object. It's what makes a source that is only a tree of kinds walkable by opening Things: Mondo has no part-of at all, and before this its 32,134 Things were reachable only through the four at the top. A Thing with parts opens to its parts first; its kinds are its second web. The dialog's "Webs of kinds" box, or `--no-kinds`, leaves kinds on the carousel only.
- **Connections are drawn only between parts, inside the whole's web.** Each relation becomes a connection type (a Thing named after the property's label, with the property IRI as its exact link).
- **Every relation is also kept on the Thing as readable data** (`semanticMetadata.ontology.relations`, with labels). That includes relations that have no web to sit in yet, like ChEBI's "has role".
- **OWL restrictions:** `SubClassOf P some D` is the relation (P, D). An `equivalentClass` intersection contributes its named members as parents and its restrictions as relations (A ≡ G ∧ R entails A ⊑ G and A ⊑ R). Universal restrictions, unions and complements are counted in `index.stats` and skipped.
- **Names are Title Cased by default** ("disease of cellular proliferation" becomes "Disease of Cellular Proliferation"). Only words written all in lower case change, so pH, mRNA, BRCA1 and alpha-D-glucose keep their case, and short joining words (of, and, the...) stay lower case after the first word. The source's own label is kept beside the name (`semanticMetadata.ontology.label`). The dialog's "Title Case names" box, or `--keep-labels` on the CLI, keeps the labels exactly as the source writes them instead. Relation names follow the same setting.
- **The source is one Thing**, named after the ontology. Its web is a declared folder holding the requested roots (or, with no roots, the top kinds). The source Thing is saved and its web is opened. Nothing else is saved.

## Identity and merging

- Each Thing's `externalLinks` holds its IRI, with `linkConfirmations[iri] = { state: 'exact', by: 'import' }`.
- **Same IRI, same ID.** Re-importing a slice changes nothing. Two sources that share an IRI (Uberon and CL both carrying `CL:…`) merge on it. The universe it lands in keeps its own values for a Thing; the other source's are banked in `_preserved.merge`, and each source's composition web survives as a separate definition of that Thing.
- **A Thing someone already linked to the IRI on the exact rung** folds with the imported one (merge class 2). Since this work, class 2 folds only when at least one side holds the shared link on the exact rung. Two Things that merely share an unconfirmed (auto or close) link are kept apart and offered in the duplicate review.
- Cross-references (`oboInOwl:hasDbXref`) are kept as data, never as links. Many terms share an xref, and folding on them would fuse different Things.

## What keeps imported Things alive

`cleanupOrphanedData` keeps a Thing whose `semanticMetadata.ontology.source` names a live Thing. While the source Thing is saved, or otherwise reachable, its whole import stays. Remove the source and its Things go too, except those the user has placed in a web of their own (and whatever they need, such as their types and the Things above them).

Two rules stop one kept Thing from keeping the whole import:
- An imported Thing in a web of its general Thing's kinds doesn't count as kept by that web. It lives by its source, or by a web of somebody's own. Otherwise keeping Mammal would keep every kind of mammal, and through Mammal's type, every kind beside it.
- An imported Thing's type is kept only while that Thing is live, so a removed import's leaves don't keep every class above them.

A kept web of kinds loses the placements of the Things that went.

## Scale

Measured on ChEBI LITE release 256 (184 MB OWL, 238,150 terms):

- Indexing: about 5 s in Node or a browser worker (gzipped or not). Peak about 0.9 GB in the worker.
- Planning a slice: milliseconds. Planning the whole ontology: about 2 s.
- **All of ChEBI as one universe: 218,728 Things, 3,224 webs, about 405 MB on disk** (about 1.9 KB per Thing). Every save writes all of it, so packs should be slices. The dialog warns above 20,000 Things, with the estimated growth.
- **All of Mondo Simple** (2026-10-06, 32,134 Things): 69 MB on disk without webs of kinds, 122 MB with them (7,832 webs of kinds, 46,736 placements, about 1.1 KB each). Importing it in the app takes about 4 s after the file is read.
- The webs an import brings in are laid out before the merge, in the built state (`layOutStateWebs` in `offscreenLayout.js`), so thousands of webs cost one store update. Laying out each in the store, one update apiece, took about a minute for Mondo. A web already in the universe keeps its arrangement unless the import adds Things to it (a wider slice of the same source; `grownGraphIds` in the merge report), and then it's laid out again.
- The dialog's size estimate is about 2.15 KB per Thing plus 1.15 KB per placement in a web.
- OBO Graphs JSON is read whole (`JSON.parse`), so very large ones are better imported from the OWL release.

## Where a smart planner goes

The plan is the seam. A smart planner revises individual decisions on the same plan, and the builder and merge stay as they are. The decisions it could make:
- which source classes are real lenses, rather than taking every rung;
- which parent is the type;
- where non-composition relations belong;
- whether two Things from different sources (different IRIs) are the same Thing.

Following `oneShot.js`: with no model configured, nothing changes.

## Tests

- `test/formats/ontology/index.test.js`: format detection, five-format equivalence (`test/fixtures/ontology/zoo.*`), every reading above.
- `test/formats/ontology/slicePlan.test.js`: slicing and the plan rules.
- `test/formats/ontology/chebi.test.js`: a real ChEBI LITE slice (`chebi-lite-water-ethanol.owl`, CC BY 4.0, see the fixture README).
- `test/store/ontologyImport.test.js`: merging, re-import, overlapping sources, round trip, cleanup, the carousel ladder.
- `test/headless/ontology-import.test.js`: `mergeRedstringPack` and `redstring import`.
- `test/e2e/canvas/f43-ontology-import.pw.js`: the dialog end to end in the app.
